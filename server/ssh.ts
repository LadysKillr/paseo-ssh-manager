import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { askpassScript, controlDir, type StoredServer } from "./store";

export function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

let sshBinary: string | null = null;
export function sshPath(): string {
  if (sshBinary) return sshBinary;
  const found = spawnSync("sh", ["-c", "command -v ssh"], { encoding: "utf8" });
  sshBinary = found.status === 0 && found.stdout.trim() ? found.stdout.trim() : "ssh";
  return sshBinary;
}

/** Split a string of extra ssh options, honouring simple quotes. */
function splitArgs(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

export type SshMode = "terminal" | "batch";

/** ssh options (everything before the destination). */
export function sshOptions(server: StoredServer, mode: SshMode): string[] {
  const args = [
    "-o", `ControlPath=${controlDir()}/%C`,
    "-o", "ControlMaster=auto",
    "-o", "ControlPersist=600",
    "-o", "ServerAliveInterval=30",
  ];
  if (server.port) args.push("-p", String(server.port));
  if (server.user) args.push("-l", server.user);
  if (server.identityFile) args.push("-i", expandHome(server.identityFile));
  if (server.jumpHost) args.push("-J", server.jumpHost);
  if (server.extraArgs) args.push(...splitArgs(server.extraArgs));
  const askpass = askpassScript(server);
  if (askpass) args.push("-o", "StrictHostKeyChecking=accept-new");
  if (mode === "batch") {
    args.push("-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new");
    if (askpass) args.push("-o", "NumberOfPasswordPrompts=1");
    else args.push("-o", "BatchMode=yes");
  }
  return args;
}

export function sshEnv(server: StoredServer): NodeJS.ProcessEnv {
  const askpass = askpassScript(server);
  if (!askpass) return { ...process.env };
  return { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY || ":0" };
}

export interface TerminalLaunch {
  command: string;
  args: string[];
}

/** Env var marking the remote shell of a terminal (LC_* is accepted by default sshd configs). */
export const TERM_TAG_VAR = "LC_PASEO_TERM";

export function terminalLaunch(server: StoredServer, startDir?: string, tag?: string): TerminalLaunch {
  const args = sshOptions(server, "terminal");
  if (tag) args.unshift("-o", `SendEnv=${TERM_TAG_VAR}`);
  const dir = startDir || server.startDir;
  const command = startDir ? undefined : server.startCommand;
  if (dir || command) args.push("-t");
  args.push("--", server.host);
  if (dir || command) {
    const parts: string[] = [];
    if (dir) parts.push(`cd ${dir === "~" || dir.startsWith("~/") ? `"$HOME"${q(dir.slice(1))}` : q(dir)} 2>/dev/null`);
    if (command) parts.push(command);
    // Then the usual login shell, so the session stays open like in MobaXterm.
    parts.push(`exec "\${SHELL:-/bin/sh}" -l`);
    args.push(parts.join("; "));
  }
  const askpass = askpassScript(server);
  const env: string[] = [];
  if (tag) env.push(`${TERM_TAG_VAR}=${tag}`);
  if (askpass) env.push(`SSH_ASKPASS=${askpass}`, "SSH_ASKPASS_REQUIRE=force", `DISPLAY=${process.env.DISPLAY || ":0"}`);
  if (env.length) return { command: "env", args: [...env, sshPath(), ...args] };
  return { command: sshPath(), args };
}

/**
 * Current directory of the shell of a tagged terminal: the topmost process carrying the tag
 * (its parent, sshd, does not). Linux only (/proc). Null when the tag is not found, e.g. when
 * the server does not accept LC_* variables.
 */
const CWD_SCRIPT = `t="${TERM_TAG_VAR}=$1"
best=""; bestpid=0; top=""
for f in $(grep -l -a -F "$t" /proc/[0-9]*/environ 2>/dev/null); do
  d=\${f%/environ}; pid=\${d#/proc/}
  # Skip the local ssh client itself (when the server is the Paseo host).
  case "$(readlink "$d/exe" 2>/dev/null)" in */ssh|*/env) continue ;; esac
  cwd=$(readlink "$d/cwd" 2>/dev/null) || continue
  pp=$(awk '/^PPid:/{print $2}' "$d/status" 2>/dev/null)
  if [ -n "$pp" ] && ! grep -q -a -F "$t" "/proc/$pp/environ" 2>/dev/null; then top="$cwd"; fi
  # Follow the most recent shell (a sub-shell, su to the same user...), like MobaXterm.
  case "$(cat "$d/comm" 2>/dev/null)" in
    bash|zsh|sh|dash|fish|ksh|mksh|tcsh|csh|ash) [ "$pid" -gt "$bestpid" ] && { bestpid=$pid; best="$cwd"; } ;;
  esac
done
[ -n "$best" ] || best="$top"
[ -n "$best" ] && printf '%s' "$best"
exit 0`;

export async function terminalCwd(server: StoredServer, tag: string): Promise<string | null> {
  if (!/^[a-f0-9]{8,32}$/.test(tag)) return null;
  const res = await runScript(server, CWD_SCRIPT, [tag], { timeoutMs: 10_000 });
  if (res.code !== 0) return null;
  const cwd = res.stdout.toString("utf8").trim();
  return cwd.startsWith("/") ? cwd : null;
}

/** "user@host:port", "host -p 2222", "ssh user@host" */
export function parseQuick(input: string): StoredServer {
  let text = input.trim().replace(/^ssh\s+/, "");
  let port: number | undefined;
  const portFlag = text.match(/\s-p\s*(\d+)/);
  if (portFlag) {
    port = Number(portFlag[1]);
    text = text.replace(portFlag[0], "").trim();
  }
  let user: string | undefined;
  let host = text;
  const at = text.lastIndexOf("@");
  if (at > 0) {
    user = text.slice(0, at);
    host = text.slice(at + 1);
  }
  const hostPort = host.match(/^([^:\[\]]+):(\d+)$/);
  if (hostPort) {
    host = hostPort[1]!;
    port = Number(hostPort[2]);
  }
  if (!host || /\s/.test(host)) throw new Error("Format attendu : user@hote[:port]");
  return { id: "quick", name: user ? `${user}@${host}` : host, host, user, port };
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

export interface RunOptions {
  input?: Buffer | string;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Run a remote command string through ssh (the remote login shell parses it). */
export function runRemote(server: StoredServer, remoteCommand: string, options: RunOptions = {}): Promise<RunResult> {
  const args = [...sshOptions(server, "batch"), "--", server.host, remoteCommand];
  return new Promise((resolve, reject) => {
    const child = spawn(sshPath(), args, { env: sshEnv(server), stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let overflow = false;
    const max = options.maxBytes ?? 64 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (overflow) {
        reject(new Error("Sortie trop volumineuse"));
        return;
      }
      resolve({ code, stdout: Buffer.concat(chunks), stderr });
    });
    child.stdin.on("error", () => {
      /* remote closed early */
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** Explain common ssh failures in a friendlier way. */
export function sshError(result: RunResult, fallback: string): Error {
  const stderr = result.stderr.trim();
  if (result.code === 255) {
    if (/Permission denied/i.test(stderr)) {
      return new Error(
        "Authentification refusée. Ouvrez d'abord un terminal SSH sur ce serveur (la connexion est ensuite partagée), ou enregistrez une clé / un mot de passe.",
      );
    }
    if (/timed out|Connection refused|Could not resolve|No route/i.test(stderr)) {
      return new Error(`Serveur injoignable : ${stderr.split("\n").pop()}`);
    }
  }
  const last = stderr.split("\n").filter(Boolean).slice(-3).join(" / ");
  return new Error(last || fallback);
}

/** Run `sh -c script` remotely with positional arguments. */
export async function runScript(
  server: StoredServer,
  script: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const remote = `sh -c ${q(script)} sh ${args.map(q).join(" ")}`;
  return runRemote(server, remote, options);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** Run a short command without blocking the plugin process (statuses run every 30 s). */
function runQuick(args: string[], timeoutMs = 5000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(sshPath(), args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** `ssh -G` (the effective HostName / Port / ProxyJump) only changes with the session settings: cached. */
const endpointCache = new Map<string, { key: string; at: number; value: { host: string; port: number; proxied: boolean } }>();

async function resolveEndpoint(server: StoredServer): Promise<{ host: string; port: number; proxied: boolean }> {
  const key = JSON.stringify([server.host, server.port, server.user, server.jumpHost, server.extraArgs, server.identityFile]);
  const cached = endpointCache.get(server.id);
  if (cached && cached.key === key && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const opts = sshOptions(server, "batch").filter((a) => a !== "-t");
  const res = await runQuick(["-G", ...opts, "--", server.host]);
  let host = server.host;
  let port = server.port ?? 22;
  let proxied = false;
  if (res.code === 0) {
    for (const line of res.out.split("\n")) {
      const [k, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (k === "hostname") host = value;
      else if (k === "port") port = Number(value) || port;
      else if ((k === "proxyjump" || k === "proxycommand") && value && value !== "none") proxied = true;
    }
  }
  const value = { host, port, proxied };
  if (res.code === 0) endpointCache.set(server.id, { key, at: Date.now(), value });
  return value;
}

function tcpPing(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = connect({ host, port });
    const done = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (err) reject(err);
      else resolve(Date.now() - start);
    };
    socket.setTimeout(timeoutMs, () => done(new Error("délai dépassé")));
    socket.once("connect", () => done());
    socket.once("error", (e) => done(e));
  });
}

export async function isMasterRunning(server: StoredServer): Promise<boolean> {
  const opts = sshOptions(server, "terminal");
  return (await runQuick([...opts, "-O", "check", "--", server.host])).code === 0;
}

export async function closeMaster(server: StoredServer): Promise<void> {
  const opts = sshOptions(server, "terminal");
  await runQuick([...opts, "-O", "exit", "--", server.host]);
}

export async function serverStatus(server: StoredServer) {
  const [connected, endpoint] = await Promise.all([isMasterRunning(server), resolveEndpoint(server)]);
  if (endpoint.proxied) {
    return { id: server.id, reachable: true, latencyMs: null, connected, error: null };
  }
  try {
    const latencyMs = await tcpPing(endpoint.host, endpoint.port, 3000);
    return { id: server.id, reachable: true, latencyMs, connected, error: null };
  } catch (err) {
    return { id: server.id, reachable: false, latencyMs: null, connected, error: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ */
/* ~/.ssh/config                                                       */
/* ------------------------------------------------------------------ */

export interface SshConfigHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  jumpHost?: string;
}

export function readSshConfig(): SshConfigHost[] {
  const file = join(homedir(), ".ssh", "config");
  if (!existsSync(file)) return [];
  const hosts: SshConfigHost[] = [];
  let current: SshConfigHost[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s*=?\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.replace(/^"(.*)"$/, "$1");
    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((a) => a && !/[*?!]/.test(a))
        .map((alias) => ({ alias }));
      hosts.push(...current);
    } else if (key === "match") {
      current = [];
    } else {
      for (const h of current) {
        if (key === "hostname") h.hostName = value;
        else if (key === "user") h.user = value;
        else if (key === "port") h.port = Number(value) || undefined;
        else if (key === "identityfile") h.identityFile = value;
        else if (key === "proxyjump") h.jumpHost = value;
      }
    }
  }
  return hosts;
}
