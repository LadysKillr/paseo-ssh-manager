import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Server, ServerInput } from "../shared/rpc";

export interface StoredServer {
  id: string;
  name: string;
  host: string;
  port?: number;
  user?: string;
  group?: string;
  identityFile?: string;
  jumpHost?: string;
  startDir?: string;
  startCommand?: string;
  extraArgs?: string;
  logSession?: boolean;
  autoReconnect?: boolean;
  color?: string;
  lastUsed?: number;
}

/** mkdir + chmod once per directory (these helpers are called for every ssh command). */
const ensured = new Set<string>();
function ensureDir(dir: string): string {
  if (ensured.has(dir)) return dir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  ensured.add(dir);
  return dir;
}

export function dataDir(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const dir = join(home, "plugin-data", "ssh-manager");
  return ensureDir(dir);
}

function secretsDir(): string {
  const dir = join(dataDir(), "secrets");
  return ensureDir(dir);
}

/** Private keys imported or generated through the plugin (0700 dir, 0600 files). */
export function keysDir(): string {
  const dir = join(dataDir(), "keys");
  return ensureDir(dir);
}

/** File holding the remembered passphrase of a key, for any key path (plugin keys or ~/.ssh). */
export function keyPassphraseFile(keyPath: string | undefined): string | null {
  if (!keyPath) return null;
  const abs = keyPath.startsWith("~/") ? join(homedir(), keyPath.slice(2)) : keyPath;
  const tag = createHash("sha256").update(abs).digest("hex").slice(0, 24);
  return join(secretsDir(), `key-${tag}`);
}

/** Unix socket paths are limited to ~104 bytes; fall back to /tmp when the data dir is too deep. */
export function controlDir(): string {
  let dir = join(dataDir(), "cm");
  if (dir.length > 60) {
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    dir = join(tmpdir(), `paseo-ssh-${uid}`);
  }
  return ensureDir(dir);
}

function serversFile(): string {
  return join(dataDir(), "servers.json");
}

function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
  renameSync(tmp, file);
}

export function readServers(): StoredServer[] {
  const file = serversFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { servers?: StoredServer[] };
    return Array.isArray(parsed.servers) ? parsed.servers : [];
  } catch {
    return [];
  }
}

function writeServers(servers: StoredServer[]): void {
  writeJsonAtomic(serversFile(), { version: 1, servers });
}

export function getServer(id: string): StoredServer {
  const server = readServers().find((s) => s.id === id);
  if (!server) throw new Error(`Serveur introuvable (${id})`);
  return server;
}

function secretFile(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Identifiant invalide");
  return join(secretsDir(), id);
}

export function hasPassword(id: string): boolean {
  try {
    return existsSync(secretFile(id));
  } catch {
    return false;
  }
}

/**
 * Script used as SSH_ASKPASS: answers password / passphrase prompts with the stored secret,
 * so the secret never appears in a process argument list.
 */
const askpassWritten = new Map<string, string>();

export function askpassScript(server: StoredServer): string | null {
  const id = server.id;
  const pw = hasPassword(id) ? secretFile(id) : null;
  const kpFile = keyPassphraseFile(server.identityFile);
  const kp = kpFile && existsSync(kpFile) ? kpFile : null;
  if (!pw && !kp) return null;
  const quote = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  const script = join(secretsDir(), `${id}.askpass.sh`);
  const lines = ["#!/bin/sh", 'case "$1" in'];
  if (kp) lines.push(`  *assphrase*) cat ${quote(kp)} ;;`);
  if (pw) lines.push(`  *assword*|*assphrase*|*PIN*) cat ${quote(pw)} ;;`);
  lines.push("  *) exit 1 ;;", "esac", "");
  const body = lines.join("\n");
  // Called for every ssh command: write only when the content changed.
  if (askpassWritten.get(script) !== body || !existsSync(script)) {
    writeFileSync(script, body, { mode: 0o700 });
    chmodSync(script, 0o700);
    askpassWritten.set(script, body);
  }
  return script;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function toPublic(server: StoredServer): Server {
  return { ...server, hasPassword: hasPassword(server.id) };
}

export function saveServer(input: ServerInput): StoredServer {
  const servers = readServers();
  const id = input.id ?? randomUUID().replace(/-/g, "").slice(0, 16);
  const next: StoredServer = {
    id,
    name: input.name.trim(),
    host: input.host.trim(),
    port: input.port && input.port !== 22 ? input.port : undefined,
    user: clean(input.user),
    group: clean(input.group),
    identityFile: clean(input.identityFile),
    jumpHost: clean(input.jumpHost),
    startDir: clean(input.startDir),
    startCommand: clean(input.startCommand),
    logSession: input.logSession || undefined,
    autoReconnect: input.autoReconnect || undefined,
    extraArgs: clean(input.extraArgs),
    color: clean(input.color),
  };
  const index = servers.findIndex((s) => s.id === id);
  if (index >= 0) next.lastUsed = servers[index]!.lastUsed;
  if (index >= 0) servers[index] = next;
  else servers.push(next);
  writeServers(servers);

  if (input.password !== undefined) {
    const file = secretFile(id);
    if (input.password === "") {
      rmSync(file, { force: true });
      rmSync(join(secretsDir(), `${id}.askpass.sh`), { force: true });
    } else {
      writeFileSync(file, input.password, { mode: 0o600 });
      chmodSync(file, 0o600);
    }
  }
  return next;
}

export function addServers(list: Omit<StoredServer, "id">[]): number {
  const servers = readServers();
  for (const s of list) servers.push({ ...s, id: randomUUID().replace(/-/g, "").slice(0, 16) });
  writeServers(servers);
  return list.length;
}

export function saveServerPatch(id: string, patch: Partial<Omit<StoredServer, "id">>): void {
  const servers = readServers();
  const server = servers.find((s) => s.id === id);
  if (!server) return;
  Object.assign(server, patch);
  writeServers(servers);
}

/* Terminals opened by the plugin: terminal id -> session and shell tag (for "follow terminal folder"). */
interface TerminalEntry {
  serverId: string;
  tag: string;
  createdAt: number;
  /** Tab label chosen by the user (rename). */
  label?: string;
}

function terminalsFile(): string {
  return join(dataDir(), "terminals.json");
}

export function readTerminals(): Record<string, TerminalEntry> {
  try {
    return JSON.parse(readFileSync(terminalsFile(), "utf8")) as Record<string, TerminalEntry>;
  } catch {
    return {};
  }
}

export function registerTerminal(terminalId: string, serverId: string, tag: string): void {
  const all = readTerminals();
  all[terminalId] = { serverId, tag, createdAt: Date.now() };
  const entries = Object.entries(all).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 300);
  writeJsonAtomic(terminalsFile(), Object.fromEntries(entries));
}

export function setTerminalLabel(terminalId: string, label: string): void {
  const all = readTerminals();
  const entry = all[terminalId];
  if (!entry) return;
  entry.label = label;
  writeJsonAtomic(terminalsFile(), all);
}

export function touchServer(id: string): void {
  const servers = readServers();
  const server = servers.find((s) => s.id === id);
  if (!server) return;
  server.lastUsed = Date.now();
  writeServers(servers);
}

export function deleteServer(id: string): void {
  writeServers(readServers().filter((s) => s.id !== id));
  try {
    rmSync(secretFile(id), { force: true });
    rmSync(join(secretsDir(), `${id}.askpass.sh`), { force: true });
  } catch {
    /* ignore */
  }
}
