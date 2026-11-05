import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome, runScript, sshEnv, sshError, sshOptions, sshPath } from "./ssh";
import { dataDir, keyPassphraseFile, keysDir, readServers, saveServerPatch, type StoredServer } from "./store";

/**
 * Private keys never leave the Paseo host: the client can import or generate them, but only the
 * public half is ever sent back (to the client, or to servers' authorized_keys).
 * Passphrases go to ssh-keygen / ssh through SSH_ASKPASS scripts reading 0600 files, never argv.
 */

export interface KeyInfo {
  id: string;
  name: string;
  path: string;
  source: "plugin" | "ssh-dir";
  type: string;
  bits: number;
  fingerprint: string;
  comment: string;
  publicKey: string;
  encrypted: boolean;
  passphraseStored: boolean;
  usedBy: string[];
  createdAt: number | null;
}

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function slug(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 48);
  return s || "cle";
}

function uniqueId(name: string): string {
  const base = slug(name);
  let id = base;
  let n = 2;
  while (existsSync(join(keysDir(), id))) id = `${base}_${n++}`;
  return id;
}

/** Temporary 0700 dir with an askpass script answering every prompt with `secret`. */
function withAskpass<T>(secret: string | null, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(dataDir(), "tmp-"));
  chmodSync(dir, 0o700);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (secret !== null) {
    const pw = join(dir, "pw");
    writeFileSync(pw, secret, { mode: 0o600 });
    const ap = join(dir, "askpass.sh");
    writeFileSync(ap, `#!/bin/sh\ncat '${pw.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
    env.SSH_ASKPASS = ap;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = process.env.DISPLAY || ":0";
  }
  return fn(env).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    // detached: no controlling terminal, so OpenSSH tools use SSH_ASKPASS.
    const child = spawn(cmd, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err: err.trim() });
    });
  });
}

/** Whether the private key file is protected by a passphrase. */
function isEncrypted(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    if (/ENCRYPTED/.test(text.split("\n").slice(0, 3).join("\n"))) return true;
    const m = text.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/);
    if (!m) return false;
    const buf = Buffer.from(m[1]!.replace(/\s+/g, ""), "base64");
    const magic = "openssh-key-v1\0";
    if (buf.subarray(0, magic.length).toString("latin1") !== magic) return false;
    const len = buf.readUInt32BE(magic.length);
    const cipher = buf.subarray(magic.length + 4, magic.length + 4 + len).toString("latin1");
    return cipher !== "none";
  } catch {
    return false;
  }
}

const fingerprintCache = new Map<string, { mtime: number; value: { bits: number; fingerprint: string; comment: string; type: string } }>();

function fingerprint(pubPath: string): { bits: number; fingerprint: string; comment: string; type: string } {
  let mtime = 0;
  try {
    mtime = statSync(pubPath).mtimeMs;
  } catch {
    /* missing */
  }
  const cached = fingerprintCache.get(pubPath);
  if (cached && cached.mtime === mtime) return cached.value;
  const value = fingerprintUncached(pubPath);
  fingerprintCache.set(pubPath, { mtime, value });
  return value;
}

function fingerprintUncached(pubPath: string): { bits: number; fingerprint: string; comment: string; type: string } {
  const res = spawnSync("ssh-keygen", ["-l", "-f", pubPath], { encoding: "utf8", timeout: 5000 });
  const m = (res.stdout || "").trim().match(/^(\d+)\s+(\S+)\s+(.*?)\s*\((\w+)\)$/);
  if (!m) return { bits: 0, fingerprint: "", comment: "", type: "?" };
  return { bits: Number(m[1]), fingerprint: m[2]!, comment: m[3]!, type: m[4]! };
}

function usersOf(path: string): string[] {
  const p = expandHome(path);
  return readServers()
    .filter((s) => s.identityFile && expandHome(s.identityFile) === p)
    .map((s) => s.name);
}

function describe(id: string, name: string, path: string, source: KeyInfo["source"], createdAt: number | null): KeyInfo | null {
  const pubPath = `${path}.pub`;
  if (!existsSync(path) || !existsSync(pubPath)) return null;
  const publicKey = readFileSync(pubPath, "utf8").trim();
  const fp = fingerprint(pubPath);
  return {
    id,
    name,
    path,
    source,
    type: fp.type,
    bits: fp.bits,
    fingerprint: fp.fingerprint,
    comment: fp.comment,
    publicKey,
    encrypted: isEncrypted(path),
    passphraseStored: existsSync(keyPassphraseFile(path) ?? "/nonexistent"),
    usedBy: usersOf(path),
    createdAt,
  };
}

export function listKeys(): KeyInfo[] {
  const keys: KeyInfo[] = [];
  const dir = keysDir();
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".pub") || file.endsWith(".json") || !ID_RE.test(file)) continue;
    let meta: { name?: string; createdAt?: number } = {};
    try {
      meta = JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8"));
    } catch {
      /* no metadata */
    }
    const info = describe(file, meta.name ?? file, join(dir, file), "plugin", meta.createdAt ?? null);
    if (info) keys.push(info);
  }
  const sshDir = join(homedir(), ".ssh");
  if (existsSync(sshDir)) {
    for (const file of readdirSync(sshDir)) {
      if (!file.startsWith("id_") || file.endsWith(".pub")) continue;
      const info = describe(`ssh:${file}`, `~/.ssh/${file}`, join(sshDir, file), "ssh-dir", null);
      if (info) keys.push(info);
    }
  }
  return keys;
}

export function resolveKey(id: string): { path: string; source: KeyInfo["source"] } {
  if (id.startsWith("ssh:")) {
    const file = id.slice(4);
    if (!ID_RE.test(file)) throw new Error("Clé invalide");
    const path = join(homedir(), ".ssh", file);
    if (!existsSync(path)) throw new Error("Clé introuvable");
    return { path, source: "ssh-dir" };
  }
  if (!ID_RE.test(id)) throw new Error("Clé invalide");
  const path = join(keysDir(), id);
  if (!existsSync(path)) throw new Error("Clé introuvable");
  return { path, source: "plugin" };
}

function storePassphrase(path: string, passphrase: string | null): void {
  const file = keyPassphraseFile(path);
  if (!file) return;
  if (passphrase) {
    writeFileSync(file, passphrase, { mode: 0o600 });
    chmodSync(file, 0o600);
  } else rmSync(file, { force: true });
}

/** Derive the public key, which also proves the passphrase is right. */
async function derivePublic(path: string, passphrase: string | null): Promise<string> {
  const res = await withAskpass(passphrase ?? "", (env) => run("ssh-keygen", ["-y", "-f", path], env));
  if (res.code !== 0) {
    if (/incorrect passphrase|bad passphrase/i.test(res.err)) {
      throw new Error(passphrase ? "Phrase de passe incorrecte." : "Cette clé est protégée : saisissez sa phrase de passe.");
    }
    throw new Error(`Clé privée invalide : ${res.err || "format non reconnu"}`);
  }
  return res.out.trim();
}

let puttygenCache: { at: number; value: boolean } | null = null;
export function hasPuttygen(): boolean {
  if (puttygenCache && Date.now() - puttygenCache.at < 60_000) return puttygenCache.value;
  const value = spawnSync("sh", ["-c", "command -v puttygen"], { encoding: "utf8" }).status === 0;
  puttygenCache = { at: Date.now(), value };
  return value;
}

export async function importKey(input: {
  name: string;
  privateKey?: string;
  path?: string;
  passphrase?: string;
  rememberPassphrase?: boolean;
  comment?: string;
}) {
  let raw = input.privateKey ?? "";
  if (!raw && input.path) {
    const src = expandHome(input.path.trim());
    if (!existsSync(src)) throw new Error(`Fichier introuvable sur l'hôte Paseo : ${src}`);
    raw = readFileSync(src, "utf8");
  }
  if (!raw.trim()) throw new Error("Aucune clé fournie");
  let text = raw.replace(/\r\n?/g, "\n").trim() + "\n";
  if (text.length > 64 * 1024) throw new Error("Fichier trop volumineux pour une clé privée.");
  if (/^ssh-(rsa|ed25519|dss)|^ecdsa-sha2|^sk-/.test(text)) {
    throw new Error("Ceci est une clé PUBLIQUE. Importez le fichier de la clé privée (sans .pub).");
  }
  const id = uniqueId(input.name);
  const path = join(keysDir(), id);
  const passphrase = input.passphrase ? input.passphrase : null;
  try {
    if (text.startsWith("PuTTY-User-Key-File")) {
      if (!hasPuttygen()) {
        throw new Error("Clé PuTTY (.ppk) : installez puttygen sur l'hôte Paseo (sudo apt install putty-tools) puis réessayez.");
      }
      await withAskpass(null, async () => {
        const dir = mkdtempSync(join(dataDir(), "tmp-"));
        chmodSync(dir, 0o700);
        try {
          const ppk = join(dir, "in.ppk");
          writeFileSync(ppk, text, { mode: 0o600 });
          const args = [ppk, "-O", "private-openssh", "-o", path];
          if (passphrase) {
            const pf = join(dir, "pp");
            writeFileSync(pf, passphrase, { mode: 0o600 });
            args.push("--old-passphrase", pf, "--new-passphrase", pf);
          }
          const res = await run("puttygen", args, process.env);
          if (res.code !== 0) throw new Error(`Conversion PuTTY impossible : ${res.err || "phrase de passe ?"}`);
          chmodSync(path, 0o600);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    } else {
      if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
        throw new Error("Format non reconnu : attendu une clé OpenSSH / PEM (-----BEGIN ... PRIVATE KEY-----) ou PuTTY (.ppk).");
      }
      writeFileSync(path, text, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    const pub = await derivePublic(path, passphrase);
    const comment = input.comment?.trim() || input.name.trim();
    writeFileSync(`${path}.pub`, `${pub.split(" ").slice(0, 2).join(" ")} ${comment}\n`, { mode: 0o644 });
    writeFileSync(`${path}.json`, JSON.stringify({ name: input.name.trim(), createdAt: Date.now(), origin: "import" }), { mode: 0o600 });
    if (input.rememberPassphrase && passphrase) storePassphrase(path, passphrase);
    return describe(id, input.name.trim(), path, "plugin", Date.now())!;
  } catch (err) {
    for (const f of [path, `${path}.pub`, `${path}.json`]) rmSync(f, { force: true });
    throw err;
  }
}

export async function generateKey(input: {
  name: string;
  type: "ed25519" | "rsa" | "ecdsa";
  comment?: string;
  passphrase?: string;
  rememberPassphrase?: boolean;
}) {
  const id = uniqueId(input.name);
  const path = join(keysDir(), id);
  const args = ["-q", "-t", input.type, "-f", path, "-C", input.comment?.trim() || `${input.name.trim()}@paseo`];
  if (input.type === "rsa") args.push("-b", "4096");
  if (input.type === "ecdsa") args.push("-b", "521");
  // ssh-keygen asks the new passphrase twice through SSH_ASKPASS (empty: no passphrase).
  const res = await withAskpass(input.passphrase ?? "", (env) => run("ssh-keygen", args, env));
  if (res.code !== 0 || !existsSync(path)) {
    for (const f of [path, `${path}.pub`]) rmSync(f, { force: true });
    throw new Error(`Génération impossible : ${res.err}`);
  }
  chmodSync(path, 0o600);
  writeFileSync(`${path}.json`, JSON.stringify({ name: input.name.trim(), createdAt: Date.now(), origin: "generated" }), { mode: 0o600 });
  if (input.rememberPassphrase && input.passphrase) storePassphrase(path, input.passphrase);
  return describe(id, input.name.trim(), path, "plugin", Date.now())!;
}

export async function setPassphrase(id: string, passphrase: string | null) {
  const { path } = resolveKey(id);
  if (passphrase) await derivePublic(path, passphrase);
  storePassphrase(path, passphrase);
  return { ok: true };
}

/**
 * Delete a private key (vault or ~/.ssh) with its public half and remembered passphrase.
 * Sessions using it are detached (their key field is cleared) when `detach` is set.
 */
export function deleteKey(id: string, detach: boolean) {
  const { path } = resolveKey(id);
  const abs = expandHome(path);
  const users = readServers().filter((s) => s.identityFile && expandHome(s.identityFile) === abs);
  if (users.length && !detach) {
    throw new Error(`Clé utilisée par : ${users.map((s) => s.name).join(", ")}.`);
  }
  for (const s of users) saveServerPatch(s.id, { identityFile: undefined });
  storePassphrase(path, null);
  for (const f of [path, `${path}.pub`, `${path}.json`]) rmSync(f, { force: true });
  return { ok: true, detached: users.map((s) => s.name) };
}

/* ------------------------------------------------------------------ */
/* Deploy / revoke / check on servers                                  */
/* ------------------------------------------------------------------ */

export interface KeyOpResult {
  id: string;
  name: string;
  ok: boolean;
  message: string;
}

function publicLine(path: string): { line: string; blob: string } {
  const line = readFileSync(`${path}.pub`, "utf8").trim().split("\n")[0]!;
  const parts = line.split(/\s+/);
  if (parts.length < 2) throw new Error("Clé publique illisible");
  return { line, blob: parts[1]! };
}

const PUBLISH = `k=$(cat); b="$1"
umask 077
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" || exit 3
f="$HOME/.ssh/authorized_keys"
[ -f "$f" ] || : > "$f"
chmod 600 "$f"
# Never glue the new key to a last line that lacks its newline.
if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\n' >> "$f"; fi
if grep -qF -- "$b" "$f"; then echo present; else printf '%s\\n' "$k" >> "$f" && echo added; fi`;

const REVOKE = `b="$1"; f="$HOME/.ssh/authorized_keys"
[ \${#b} -ge 40 ] || { echo "cle invalide" >&2; exit 2; }
[ -f "$f" ] || { echo absent; exit 0; }
grep -qF -- "$b" "$f" || { echo absent; exit 0; }
t="$f.paseo.$$"; grep -vF -- "$b" "$f" > "$t"; cat "$t" > "$f"; rm -f "$t"; echo removed`;

async function eachServer(serverIds: string[], fn: (s: StoredServer) => Promise<string>): Promise<KeyOpResult[]> {
  const all = readServers();
  return Promise.all(
    serverIds.map(async (id) => {
      const s = all.find((x) => x.id === id);
      if (!s) return { id, name: id, ok: false, message: "Session introuvable" };
      try {
        return { id, name: s.name, ok: true, message: await fn(s) };
      } catch (err) {
        return { id, name: s.name, ok: false, message: (err as Error).message };
      }
    }),
  );
}

/** Try to log in with this key only (no shared connection, no password). */
function checkWithKey(server: StoredServer, path: string): Promise<boolean> {
  const passFile = keyPassphraseFile(path);
  const hasPass = !!passFile && existsSync(passFile);
  const encrypted = isEncrypted(path);
  if (encrypted && !hasPass) return Promise.resolve(false);
  const first = [
    "-o", "ControlPath=none",
    "-o", "ControlMaster=no",
    "-o", "IdentitiesOnly=yes",
    "-o", "PreferredAuthentications=publickey",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", hasPass ? "BatchMode=no" : "BatchMode=yes",
    "-i", path,
  ];
  const opts = sshOptions(server, "batch");
  const cleaned: string[] = [];
  for (let i = 0; i < opts.length; i += 1) {
    if (opts[i] === "-i") {
      i += 1;
      continue;
    }
    cleaned.push(opts[i]!);
  }
  return withAskpass(hasPass ? readFileSync(passFile!, "utf8") : null, (env) =>
    run(sshPath(), [...first, ...cleaned, "--", server.host, "true"], { ...sshEnv(server), ...env }, 20_000),
  ).then((r) => r.code === 0);
}

export async function publishKey(id: string, serverIds: string[], setAsIdentity: boolean) {
  const { path } = resolveKey(id);
  const { line, blob } = publicLine(path);
  return eachServer(serverIds, async (server) => {
    const res = await runScript(server, PUBLISH, [blob], { input: `${line}\n`, timeoutMs: 30_000 });
    if (res.code !== 0) throw sshError(res, "Publication impossible");
    const state = res.stdout.toString().trim();
    const works = await checkWithKey(server, path);
    if (setAsIdentity && works) saveServerPatch(server.id, { identityFile: path });
    const head = state === "present" ? "Déjà présente" : "Ajoutée à ~/.ssh/authorized_keys";
    if (works) return `${head}. Connexion par clé vérifiée${setAsIdentity ? ", clé associée à la session" : ""}.`;
    return `${head}. Connexion par clé non vérifiée (clé protégée sans phrase mémorisée, ou serveur qui refuse les clés).`;
  });
}

export async function revokeKey(id: string, serverIds: string[]) {
  const { path } = resolveKey(id);
  const { blob } = publicLine(path);
  return eachServer(serverIds, async (server) => {
    if (server.identityFile && expandHome(server.identityFile) === path) {
      throw new Error("Cette session se connecte avec cette clé : changez d'abord sa clé, sinon vous perdriez l'accès.");
    }
    const res = await runScript(server, REVOKE, [blob], { timeoutMs: 30_000 });
    if (res.code !== 0) throw sshError(res, "Révocation impossible");
    return res.stdout.toString().trim() === "removed" ? "Retirée de authorized_keys" : "N'était pas présente";
  });
}

export async function checkKey(id: string, serverIds: string[]) {
  const { path } = resolveKey(id);
  return eachServer(serverIds, async (server) => {
    if (!(await checkWithKey(server, path))) throw new Error("Refusée (ou phrase de passe non mémorisée)");
    return "Acceptée";
  });
}
