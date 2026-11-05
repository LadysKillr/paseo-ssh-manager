import { spawn } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, posix } from "node:path";
import type { FileEntry } from "../shared/rpc";
import { expandHome, runScript, sshEnv, sshError, sshOptions, sshPath, q } from "./ssh";
import { dataDir, type StoredServer } from "./store";

/** Shell prelude: resolve "~" and "" in $1 into an absolute path, stored in $p. */
const RESOLVE = `p="$1"; case "$p" in "") p="$HOME" ;; "~") p="$HOME" ;; "~/"*) p="$HOME/\${p#\\~/}" ;; esac;`;

const LIST_SCRIPT = `${RESOLVE}
cd "$p" 2>/dev/null || { echo "Dossier inaccessible : $p" >&2; exit 2; }
pwd; printf '\\000'
if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then
  find . -mindepth 1 -maxdepth 1 -printf '%y\\t%Y\\t%s\\t%T@\\t%m\\t%u\\t%l\\t%f\\000' 2>/dev/null
else
  for f in .[!.]* ..?* *; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    if [ -L "$f" ]; then y=l; elif [ -d "$f" ]; then y=d; elif [ -f "$f" ]; then y=f; else y=o; fi
    if [ -d "$f" ]; then Y=d; else Y=f; fi
    info=$(stat -c '%s\t%Y\t%a\t%U' "$f" 2>/dev/null || stat -f '%z\t%m\t%Lp\t%Su' "$f" 2>/dev/null || printf '0\\t0\\t0\\t?')
    l=""; [ -L "$f" ] && l=$(readlink "$f" 2>/dev/null)
    printf '%s\\t%s\\t%s\\t%s\\t%s\\000' "$y" "$Y" "$info" "$l" "$f"
  done
fi`;

function mapType(y: string): FileEntry["type"] {
  if (y === "d") return "dir";
  if (y === "f") return "file";
  if (y === "l") return "link";
  return "other";
}

export async function listDir(server: StoredServer, path: string): Promise<{ path: string; entries: FileEntry[] }> {
  const res = await runScript(server, LIST_SCRIPT, [path], { timeoutMs: 30_000 });
  if (res.code !== 0) throw sshError(res, "Impossible de lister le dossier");
  const parts = res.stdout.toString("utf8").split("\0");
  const cwd = (parts.shift() ?? "").trim();
  const entries: FileEntry[] = [];
  for (const record of parts) {
    if (!record) continue;
    const f = record.split("\t");
    if (f.length < 8) continue;
    const name = f.slice(7).join("\t").replace(/^\.\//, "");
    if (!name || name === "." || name === "..") continue;
    entries.push({
      name,
      type: mapType(f[0]!),
      linkDir: f[0] === "l" && f[1] === "d",
      linkTarget: f[6] ?? "",
      size: Number(f[2]) || 0,
      mtime: Math.floor(Number(f[3]) || 0),
      mode: (f[4] ?? "").padStart(3, "0"),
      owner: f[5] ?? "",
    });
  }
  entries.sort((a, b) => {
    const ad = a.type === "dir" || a.linkDir ? 0 : 1;
    const bd = b.type === "dir" || b.linkDir ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return { path: cwd, entries };
}

const MAX_TEXT = 5 * 1024 * 1024;

export async function readText(server: StoredServer, path: string) {
  const script = `${RESOLVE} [ -f "$p" ] || { echo "Fichier introuvable" >&2; exit 2; }; s=$(wc -c < "$p"); printf '%s\\n' "$s"; [ "$s" -le ${MAX_TEXT} ] && cat "$p"; exit 0`;
  const res = await runScript(server, script, [path], { timeoutMs: 60_000 });
  if (res.code !== 0) throw sshError(res, "Lecture impossible");
  const nl = res.stdout.indexOf(10);
  const size = Number(res.stdout.subarray(0, nl).toString().trim()) || 0;
  if (size > MAX_TEXT) throw new Error("Fichier trop volumineux pour l'éditeur (5 Mo max). Téléchargez-le.");
  const body = res.stdout.subarray(nl + 1);
  const binary = body.subarray(0, 8192).includes(0);
  return { text: binary ? "" : body.toString("utf8"), size, binary };
}

export async function writeText(server: StoredServer, path: string, text: string) {
  const res = await runScript(server, `${RESOLVE} cat > "$p"`, [path], { input: Buffer.from(text, "utf8"), timeoutMs: 60_000 });
  if (res.code !== 0) throw sshError(res, "Écriture impossible");
  return { ok: true };
}

function guardPath(path: string): void {
  const p = path.trim().replace(/\/+$/, "");
  if (!p || p === "/" || p === "~" || p === "." || p === "..") throw new Error(`Chemin refusé : "${path}"`);
}

export async function fileAction(server: StoredServer, input: { action: string; [k: string]: unknown }) {
  let script: string;
  let args: string[];
  switch (input.action) {
    case "mkdir":
      script = `${RESOLVE} mkdir -p -- "$p"`;
      args = [String(input.path)];
      break;
    case "touch":
      script = `${RESOLVE} [ -e "$p" ] && { echo "Le fichier existe déjà" >&2; exit 1; }; : > "$p"`;
      args = [String(input.path)];
      break;
    case "delete": {
      const paths = input.paths as string[];
      paths.forEach(guardPath);
      script = `rm -rf -- "$@"`;
      args = paths;
      break;
    }
    case "rename":
      guardPath(String(input.from));
      script = `[ -e "$2" ] && { echo "La destination existe déjà" >&2; exit 1; }; mv -- "$1" "$2"`;
      args = [String(input.from), String(input.to)];
      break;
    case "copy":
      script = `[ -e "$2" ] && { echo "La destination existe déjà" >&2; exit 1; }; cp -a -- "$1" "$2"`;
      args = [String(input.from), String(input.to)];
      break;
    case "chmod":
      if (!/^[0-7]{3,4}$|^[ugoa]*[+-=][rwxXst]*$/.test(String(input.mode))) throw new Error("Mode invalide");
      script = `chmod ${q(String(input.mode))} -- "$1"`;
      args = [String(input.path)];
      break;
    default:
      throw new Error("Action inconnue");
  }
  const res = await runScript(server, script, args, { timeoutMs: 120_000 });
  if (res.code !== 0) throw sshError(res, "Opération impossible");
  return { ok: true };
}

export async function downloadChunk(server: StoredServer, path: string, offset: number, length: number) {
  const script = `${RESOLVE} [ -f "$p" ] || { echo "Fichier introuvable" >&2; exit 2; }; s=$(wc -c < "$p"); printf '%s\\n' "$s"; tail -c +"$2" "$p" | head -c "$3"`;
  const res = await runScript(server, script, [path, String(offset + 1), String(length)], {
    timeoutMs: 120_000,
    maxBytes: length + 64,
  });
  if (res.code !== 0) throw sshError(res, "Téléchargement impossible");
  const nl = res.stdout.indexOf(10);
  const size = Number(res.stdout.subarray(0, nl).toString().trim()) || 0;
  return { base64: res.stdout.subarray(nl + 1).toString("base64"), size };
}

export async function uploadChunk(server: StoredServer, path: string, base64: string, append: boolean) {
  const script = append ? `${RESOLVE} cat >> "$p"` : `${RESOLVE} cat > "$p"`;
  const res = await runScript(server, script, [path], { input: Buffer.from(base64, "base64"), timeoutMs: 300_000 });
  if (res.code !== 0) throw sshError(res, "Envoi impossible");
  return { ok: true };
}

/**
 * Copy a file or folder between the Paseo host and the server by piping tar through ssh.
 * Folders keep their structure; existing files with the same name are overwritten.
 */
export function transfer(
  server: StoredServer,
  direction: "to-local" | "to-remote",
  source: string,
  targetDir: string,
): Promise<{ ok: boolean; target: string }> {
  if (direction === "to-local") targetDir = expandHome(targetDir.trim());
  else source = expandHome(source.trim());
  return new Promise((resolve, reject) => {
    const sshArgs = [...sshOptions(server, "batch"), "--", server.host];
    const src = source.replace(/\/+$/, "") || "/";
    const name = direction === "to-local" ? posix.basename(src) : basename(src);
    const parent = direction === "to-local" ? posix.dirname(src) : dirname(src);
    let remote: ReturnType<typeof spawn>;
    let local: ReturnType<typeof spawn>;
    let target: string;
    if (direction === "to-local") {
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      target = join(targetDir, name);
      remote = spawn(sshPath(), [...sshArgs, `tar -C ${q(parent)} -cf - -- ${q(name)}`], {
        env: sshEnv(server),
        stdio: ["ignore", "pipe", "pipe"],
      });
      local = spawn("tar", ["-xf", "-", "-C", targetDir], { stdio: ["pipe", "ignore", "pipe"] });
      remote.stdout!.pipe(local.stdin!);
    } else {
      if (!existsSync(src)) {
        reject(new Error(`Introuvable sur l'hôte Paseo : ${src}`));
        return;
      }
      statSync(src);
      target = posix.join(targetDir, name);
      local = spawn("tar", ["-C", parent, "-cf", "-", "--", name], { stdio: ["ignore", "pipe", "pipe"] });
      remote = spawn(sshPath(), [...sshArgs, `mkdir -p ${q(targetDir)} && tar -xf - -C ${q(targetDir)}`], {
        env: sshEnv(server),
        stdio: ["pipe", "ignore", "pipe"],
      });
      local.stdout!.pipe(remote.stdin!);
    }
    let errors = "";
    remote.stderr!.on("data", (d: Buffer) => (errors += d.toString()));
    local.stderr!.on("data", (d: Buffer) => (errors += d.toString()));
    let pending = 2;
    let failed = false;
    const finish = (code: number | null) => {
      if (code !== 0) failed = true;
      pending -= 1;
      if (pending > 0) return;
      if (failed) reject(new Error(errors.trim().split("\n").slice(-3).join(" / ") || "Transfert échoué"));
      else resolve({ ok: true, target });
    };
    remote.on("close", finish);
    local.on("close", finish);
    remote.on("error", (e) => reject(e));
    local.on("error", (e) => reject(e));
  });
}

/* ------------------------------------------------------------------ */
/* Archives (folders / several files) and server-to-server copy        */
/* ------------------------------------------------------------------ */

const archives = new Map<string, { file: string; name: string; at: number }>();

function archiveDir(): string {
  const dir = join(dataDir(), "downloads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Archives not fetched within 30 minutes are removed.
setInterval(() => {
  for (const [token, a] of archives) {
    if (Date.now() - a.at > 30 * 60_000) {
      rmSync(a.file, { force: true });
      archives.delete(token);
    }
  }
}, 5 * 60_000).unref?.();

/** Pack remote paths (relative to `dir`) into a .tar.gz on the Paseo host, ready to download. */
export function makeArchive(server: StoredServer, dir: string, names: string[]): Promise<{ token: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    if (!names.length) {
      reject(new Error("Rien à archiver"));
      return;
    }
    const token = randomUUID();
    const base = names.length === 1 ? names[0]! : posix.basename(dir) || "fichiers";
    const name = `${base.replace(/[^A-Za-z0-9._-]+/g, "_")}.tar.gz`;
    const file = join(archiveDir(), `${token}.tar.gz`);
    const out = createWriteStream(file, { mode: 0o600 });
    const child = spawn(
      sshPath(),
      [...sshOptions(server, "batch"), "--", server.host, `tar -C ${q(dir)} -czf - -- ${names.map(q).join(" ")}`],
      { env: sshEnv(server), stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.stdout.pipe(out);
    child.on("error", reject);
    child.on("close", (code) => {
      out.end(() => {
        if (code !== 0) {
          rmSync(file, { force: true });
          reject(new Error(err.trim().split("\n").slice(-2).join(" / ") || "Archive impossible"));
          return;
        }
        archives.set(token, { file, name, at: Date.now() });
        resolve({ token, name, size: statSync(file).size });
      });
    });
  });
}

export function readArchive(token: string, offset: number, length: number): { base64: string; size: number; done: boolean } {
  const a = archives.get(token);
  if (!a) throw new Error("Archive expirée");
  const size = statSync(a.file).size;
  const len = Math.max(0, Math.min(length, size - offset, 4 * 1024 * 1024));
  const buf = Buffer.alloc(len);
  if (len) {
    const fd = openSync(a.file, "r");
    try {
      readSync(fd, buf, 0, len, offset);
    } finally {
      closeSync(fd);
    }
  }
  const done = offset + len >= size;
  if (done) {
    rmSync(a.file, { force: true });
    archives.delete(token);
  }
  return { base64: buf.toString("base64"), size, done };
}

/** Copy files or folders from one server to another: ssh A "tar c" | ssh B "tar x" (nothing stored in between). */
export function copyBetweenServers(
  from: StoredServer,
  dir: string,
  names: string[],
  to: StoredServer,
  targetDir: string,
): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const src = spawn(sshPath(), [...sshOptions(from, "batch"), "--", from.host, `tar -C ${q(dir)} -cf - -- ${names.map(q).join(" ")}`], {
      env: sshEnv(from),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const dst = spawn(sshPath(), [...sshOptions(to, "batch"), "--", to.host, `mkdir -p ${q(targetDir)} && tar -xf - -C ${q(targetDir)}`], {
      env: sshEnv(to),
      stdio: ["pipe", "ignore", "pipe"],
    });
    src.stdout.pipe(dst.stdin);
    let errors = "";
    src.stderr.on("data", (d: Buffer) => (errors += `${from.name}: ${d}`));
    dst.stderr.on("data", (d: Buffer) => (errors += `${to.name}: ${d}`));
    let pending = 2;
    let failed = false;
    const finish = (code: number | null) => {
      if (code !== 0) failed = true;
      pending -= 1;
      if (pending) return;
      if (failed) reject(new Error(errors.trim().split("\n").slice(-3).join(" / ") || "Copie échouée"));
      else resolve({ ok: true });
    };
    src.on("close", finish);
    dst.on("close", finish);
    src.on("error", reject);
    dst.on("error", reject);
  });
}
