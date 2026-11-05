import { appendFile, mkdirSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";

/**
 * Session logs (MobaXterm "log terminal output to file") and alerts (keyword, end of a command,
 * new activity). Fed with the live output of the terminal mirrors (term-mirror.ts); a terminal
 * with a log or an alert keeps its mirror alive even when no tab shows it.
 */

/* ------------------------------------------------------------------ */
/* Text cleanup                                                        */
/* ------------------------------------------------------------------ */

// CSI, OSC, charset and single-character escape sequences.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[@-Z\\-_]/g;

export function plainText(raw: string): string {
  let text = raw.replace(ANSI, "").replace(/\r\n/g, "\n");
  // Progress bars rewrite the line with \r: keep the last version only.
  text = text.replace(/[^\n]*\r(?!\n)/g, "");
  // Backspaces erase the previous character.
  while (/[^\x08\n]\x08/.test(text)) text = text.replace(/[^\x08\n]\x08/g, "");
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

export function logsDir(): string {
  const dir = join(dataDir(), "logs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "session"
  );
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

interface LogState {
  file: string;
  name: string;
  /** Writes are queued so the file keeps the output order. */
  queue: Promise<void>;
}

const logs = new Map<string, LogState>();

export function startLog(terminalId: string, label: string): { name: string } {
  const existing = logs.get(terminalId);
  if (existing) return { name: existing.name };
  const name = `${stamp()}_${slug(label)}.log`;
  const file = join(logsDir(), name);
  const state: LogState = { file, name, queue: Promise.resolve() };
  logs.set(terminalId, state);
  writeLog(state, `===== ${label} : début de l'enregistrement ${new Date().toLocaleString()} =====\n`);
  return { name };
}

export function stopLog(terminalId: string, reason = "fin de l'enregistrement"): void {
  const state = logs.get(terminalId);
  if (!state) return;
  writeLog(state, `\n===== ${reason} ${new Date().toLocaleString()} =====\n`);
  logs.delete(terminalId);
}

function writeLog(state: LogState, text: string): void {
  state.queue = state.queue.then(
    () =>
      new Promise<void>((resolve) => {
        appendFile(state.file, text, { mode: 0o600 }, () => resolve());
      }),
  );
}

export function activeLogs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, s] of logs) out[id] = s.name;
  return out;
}

export function listLogs(): { name: string; size: number; mtime: number }[] {
  return readdirSync(logsDir())
    .filter((n) => n.endsWith(".log"))
    .map((name) => {
      const st = statSync(join(logsDir(), name));
      return { name, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function logPath(name: string): string {
  if (!/^[A-Za-z0-9._-]+\.log$/.test(name)) throw new Error("Nom de journal invalide");
  return join(logsDir(), name);
}

export function readLog(name: string, offset: number, length: number): { base64: string; size: number } {
  const path = logPath(name);
  const size = statSync(path).size;
  const len = Math.max(0, Math.min(length, size - offset, 4 * 1024 * 1024));
  const buf = Buffer.alloc(len);
  if (len > 0) {
    const fd = openSync(path, "r");
    try {
      readSync(fd, buf, 0, len, offset);
    } finally {
      closeSync(fd);
    }
  }
  return { base64: buf.toString("base64"), size };
}

export function deleteLog(name: string): void {
  for (const s of logs.values()) if (s.name === name) throw new Error("Ce journal est en cours d'enregistrement");
  rmSync(logPath(name), { force: true });
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export interface WatchConfig {
  /** Alert when one of these words appears (case-insensitive). */
  keywords: string[];
  /** Alert when the output stops for this many seconds after real activity (0: off). */
  idleSec: number;
  /** Alert when output comes back after this many seconds of silence (0: off). */
  activitySec: number;
  /** Remove the alert after its first notification. */
  once: boolean;
}

export interface AlertEvent {
  seq: number;
  at: number;
  terminalId: string;
  kind: "keyword" | "idle" | "activity";
  message: string;
}

/** A shell prompt followed by the typed command ("user@host:~$ make", "root@srv:/# ..."). */
const PROMPT = /^\S+@\S+:[^$#]*[$#]\s/;

interface WatchState {
  config: WatchConfig;
  label: string;
  tail: string;
  lastOutput: number;
  burstStart: number;
  burstBytes: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const watches = new Map<string, WatchState>();
const events: AlertEvent[] = [];
let seq = 0;
const eventWaiters = new Set<() => void>();

function emit(terminalId: string, kind: AlertEvent["kind"], message: string): void {
  seq += 1;
  events.push({ seq, at: Date.now(), terminalId, kind, message });
  if (events.length > 200) events.splice(0, events.length - 200);
  for (const w of eventWaiters) w();
  eventWaiters.clear();
  const w = watches.get(terminalId);
  if (w?.config.once) clearWatch(terminalId);
}

export function setWatch(terminalId: string, label: string, config: WatchConfig): void {
  const keywords = config.keywords.map((k) => k.trim()).filter(Boolean);
  if (!keywords.length && !config.idleSec && !config.activitySec) {
    clearWatch(terminalId);
    return;
  }
  const prev = watches.get(terminalId);
  if (prev?.idleTimer) clearTimeout(prev.idleTimer);
  watches.set(terminalId, {
    config: { ...config, keywords },
    label,
    tail: "",
    lastOutput: Date.now(),
    burstStart: 0,
    burstBytes: 0,
    idleTimer: null,
  });
}

export function clearWatch(terminalId: string): void {
  const w = watches.get(terminalId);
  if (w?.idleTimer) clearTimeout(w.idleTimer);
  watches.delete(terminalId);
}

export function activeWatches(): Record<string, WatchConfig> {
  const out: Record<string, WatchConfig> = {};
  for (const [id, w] of watches) out[id] = w.config;
  return out;
}

export async function pollAlerts(since: number, waitMs: number): Promise<{ events: AlertEvent[]; last: number }> {
  if (seq <= since && waitMs > 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        eventWaiters.delete(done);
        resolve();
      }, Math.min(waitMs, 20_000));
      eventWaiters.add(done);
    });
  }
  return { events: events.filter((e) => e.seq > since), last: seq };
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

/** Whether this terminal needs its mirror even without a viewer. */
export function isPinned(terminalId: string): boolean {
  return logs.has(terminalId) || watches.has(terminalId);
}

/** Live output of a terminal (never the replay of its past screen). */
export function onOutput(terminalId: string, raw: string): void {
  const log = logs.get(terminalId);
  const watch = watches.get(terminalId);
  if (!log && !watch) return;
  const text = plainText(raw);
  if (log && text) writeLog(log, text);
  if (!watch) return;
  const now = Date.now();
  const cfg = watch.config;

  if (cfg.activitySec && now - watch.lastOutput >= cfg.activitySec * 1000 && text.trim()) {
    emit(terminalId, "activity", `${watch.label} : nouvelle activité après ${Math.round((now - watch.lastOutput) / 1000)} s de silence`);
    if (!watches.has(terminalId)) return;
  }

  if (cfg.keywords.length && text) {
    // Line by line (a word split over two chunks is still found), skipping prompt lines: the echo
    // of a command typed by the user is not an alert.
    const lines = (watch.tail + text).split("\n");
    watch.tail = (lines.pop() ?? "").slice(-500);
    for (const line of lines) {
      if (PROMPT.test(line)) continue;
      const lower = line.toLowerCase();
      const k = cfg.keywords.find((kw) => lower.includes(kw.toLowerCase()));
      if (k) {
        emit(terminalId, "keyword", `${watch.label} : « ${k} » - ${line.trim().slice(0, 160)}`);
        if (!watches.has(terminalId)) return;
        break;
      }
    }
  }

  // End of a command: the output stops after a real burst (not a few typed characters).
  if (!watch.burstStart || now - watch.lastOutput > 2000) {
    watch.burstStart = now;
    watch.burstBytes = 0;
  }
  watch.burstBytes += text.length;
  watch.lastOutput = now;
  if (cfg.idleSec) {
    if (watch.idleTimer) clearTimeout(watch.idleTimer);
    const busy = watch.burstBytes > 400 || now - watch.burstStart > 3000;
    if (busy) {
      const started = watch.burstStart;
      watch.idleTimer = setTimeout(() => {
        const w = watches.get(terminalId);
        if (!w) return;
        w.idleTimer = null;
        emit(terminalId, "idle", `${w.label} : plus de sortie depuis ${cfg.idleSec} s (commande terminée ?) - active pendant ${Math.round((w.lastOutput - started) / 1000)} s`);
      }, cfg.idleSec * 1000);
    }
  }
}

/** The terminal ended: close its log, forget its alerts. */
export function onExit(terminalId: string): void {
  stopLog(terminalId, "session terminée");
  if (watches.has(terminalId)) emit(terminalId, "activity", `${watches.get(terminalId)!.label} : session terminée`);
  clearWatch(terminalId);
}
