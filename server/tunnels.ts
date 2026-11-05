import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sshEnv, sshOptions, sshPath } from "./ssh";
import { dataDir, readServers } from "./store";

/**
 * SSH tunnels, like MobaXterm's MobaSSHTunnel: local (-L), remote (-R) and dynamic SOCKS (-D)
 * port forwarding. Each tunnel runs in its own `ssh -N` process on the Paseo host, outside the
 * shared connection (stopping a tunnel never cuts the terminals). Authentication: keys, agent or
 * the stored password.
 */

export interface Tunnel {
  id: string;
  name: string;
  serverId: string;
  type: "local" | "remote" | "dynamic";
  bindAddress: string;
  bindPort: number;
  destHost: string;
  destPort: number;
  autoStart: boolean;
}

export interface TunnelState {
  status: "stopped" | "starting" | "running" | "error";
  error: string | null;
  since: number | null;
}

interface Runtime {
  child: ChildProcess | null;
  state: TunnelState;
  wanted: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  stderr: string;
}

const runtimes = new Map<string, Runtime>();

function file(): string {
  return join(dataDir(), "tunnels.json");
}

export function readTunnels(): Tunnel[] {
  if (!existsSync(file())) return [];
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf8")) as { tunnels?: Tunnel[] };
    return Array.isArray(parsed.tunnels) ? parsed.tunnels : [];
  } catch {
    return [];
  }
}

function writeTunnels(tunnels: Tunnel[]): void {
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, tunnels }, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

function runtime(id: string): Runtime {
  let r = runtimes.get(id);
  if (!r) {
    r = { child: null, state: { status: "stopped", error: null, since: null }, wanted: false, retry: null, stderr: "" };
    runtimes.set(id, r);
  }
  return r;
}

export function tunnelStates(): Record<string, TunnelState> {
  const out: Record<string, TunnelState> = {};
  for (const t of readTunnels()) out[t.id] = runtime(t.id).state;
  return out;
}

function forwardSpec(t: Tunnel): string[] {
  const bind = t.bindAddress.trim() || "127.0.0.1";
  if (t.type === "dynamic") return ["-D", `${bind}:${t.bindPort}`];
  const flag = t.type === "local" ? "-L" : "-R";
  return [flag, `${bind}:${t.bindPort}:${t.destHost}:${t.destPort}`];
}

function launch(t: Tunnel): void {
  const r = runtime(t.id);
  const server = readServers().find((s) => s.id === t.serverId);
  if (!server) {
    r.state = { status: "error", error: "Session introuvable", since: null };
    return;
  }
  // First -o wins: no shared connection, fail fast when the port cannot be bound.
  const args = [
    "-N",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=3",
    ...forwardSpec(t),
    ...sshOptions(server, "batch"),
    "--",
    server.host,
  ];
  r.stderr = "";
  r.state = { status: "starting", error: null, since: null };
  const child = spawn(sshPath(), args, { env: sshEnv(server), stdio: ["ignore", "ignore", "pipe"] });
  r.child = child;
  child.stderr?.on("data", (d: Buffer) => {
    r.stderr = (r.stderr + d.toString()).slice(-4000);
  });
  // ssh -N prints nothing on success: consider it up once it survived the connection phase.
  const upTimer = setTimeout(() => {
    if (r.child === child && child.exitCode === null) r.state = { status: "running", error: null, since: Date.now() };
  }, 2500);
  child.on("exit", (code) => {
    clearTimeout(upTimer);
    if (r.child !== child) return;
    r.child = null;
    const message = r.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" / ") || `ssh terminé (code ${code})`;
    if (!r.wanted) {
      r.state = { status: "stopped", error: null, since: null };
      return;
    }
    r.state = { status: "error", error: message, since: null };
    // Keep the tunnel up like MobaSSHTunnel: retry while it is wanted.
    r.retry = setTimeout(() => {
      r.retry = null;
      if (r.wanted) launch(t);
    }, 10_000);
  });
  child.on("error", (err) => {
    r.state = { status: "error", error: err.message, since: null };
  });
}

export function startTunnel(id: string): TunnelState {
  const t = readTunnels().find((x) => x.id === id);
  if (!t) throw new Error("Tunnel introuvable");
  const r = runtime(id);
  r.wanted = true;
  if (r.retry) clearTimeout(r.retry);
  r.retry = null;
  if (!r.child) launch(t);
  return r.state;
}

export function stopTunnel(id: string): TunnelState {
  const r = runtime(id);
  r.wanted = false;
  if (r.retry) clearTimeout(r.retry);
  r.retry = null;
  const child = r.child;
  r.child = null;
  child?.kill("SIGTERM");
  r.state = { status: "stopped", error: null, since: null };
  return r.state;
}

export function saveTunnel(input: Omit<Tunnel, "id"> & { id?: string }): Tunnel {
  const tunnels = readTunnels();
  const t: Tunnel = { ...input, id: input.id ?? randomUUID().slice(0, 12), name: input.name.trim() || "tunnel" };
  const i = tunnels.findIndex((x) => x.id === t.id);
  const wasRunning = i >= 0 && runtime(t.id).wanted;
  if (wasRunning) stopTunnel(t.id);
  if (i >= 0) tunnels[i] = t;
  else tunnels.push(t);
  writeTunnels(tunnels);
  if (wasRunning) startTunnel(t.id);
  return t;
}

export function deleteTunnel(id: string): void {
  stopTunnel(id);
  runtimes.delete(id);
  writeTunnels(readTunnels().filter((x) => x.id !== id));
}

/** Plugin start: tunnels marked "auto" come up by themselves. */
export function startAutoTunnels(): void {
  for (const t of readTunnels()) if (t.autoStart) startTunnel(t.id);
}

export function stopAllTunnels(): void {
  for (const id of [...runtimes.keys()]) stopTunnel(id);
}
