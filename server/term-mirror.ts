import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Run as RunData, Screen as ScreenData } from "../shared/rpc";
import { isPinned, onExit, onOutput } from "./term-features";

/**
 * A faithful copy of each Paseo terminal shown in the SSH page, like the one MobaXterm draws:
 * the plugin process subscribes to the daemon's raw terminal stream (the same bytes the Paseo app
 * renders) and feeds it to @xterm/headless, the engine of xterm.js. The client then receives the
 * screen with colours, attributes and the real cursor position, so vim, htop or line editing with
 * the arrows render correctly.
 *
 * The daemon client and xterm come from the Paseo installation running this plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export type Run = RunData;

export type Screen = ScreenData;

const FLAG_BOLD = 1;
const FLAG_ITALIC = 2;
const FLAG_UNDERLINE = 4;
const FLAG_DIM = 8;
const FLAG_STRIKE = 16;

/** MobaXterm-like 16 colour palette. */
const PALETTE16 = [
  "#000000", "#e04343", "#3dbb4a", "#d7ba3c", "#3b8eea", "#c74ded", "#2fb5c8", "#d0d0d0",
  "#7a7a7a", "#ff6b6b", "#5fe073", "#f5e15d", "#6cb2ff", "#ff6bff", "#5ce1f2", "#ffffff",
];

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function color256(i: number): string {
  if (i < 16) return PALETTE16[i]!;
  if (i >= 232) {
    const v = 8 + (i - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const n = i - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return `rgb(${steps[Math.floor(n / 36)]},${steps[Math.floor(n / 6) % 6]},${steps[n % 6]})`;
}

/* ------------------------------------------------------------------ */
/* Host modules                                                        */
/* ------------------------------------------------------------------ */

interface Host {
  client: Any;
  Terminal: Any;
}

let hostPromise: Promise<Host> | null = null;

function hostRequire(): NodeJS.Require {
  const candidates = [process.argv[1], process.env.PASEO_CLI, "/usr/lib/node_modules/@getpaseo/cli/package.json"].filter(
    (x): x is string => !!x,
  );
  let lastError: unknown = null;
  for (const entry of candidates) {
    try {
      const req = createRequire(entry);
      req.resolve("@xterm/headless");
      req.resolve("@getpaseo/client/internal/daemon-client");
      return req;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Modules Paseo introuvables pour l'émulation du terminal (${String(lastError)})`);
}

async function connectHost(): Promise<Host> {
  const req = hostRequire();
  const load = (id: string) => import(pathToFileURL(req.resolve(id)).href);
  const [clientModule, control, ws] = await Promise.all([
    load("@getpaseo/client/internal/daemon-client"),
    load("@getpaseo/server/daemon-control"),
    load("ws"),
  ]);
  const xterm = req("@xterm/headless");
  const Terminal = xterm.Terminal ?? xterm.default?.Terminal;
  const home: string = process.env.PASEO_HOME || control.resolvePaseoHome(process.env);
  const listen: string | undefined = (await control.readDaemonInstance(home))?.listen;
  if (!listen) throw new Error("Adresse du daemon Paseo introuvable");
  let url: string;
  let socketPath: string | undefined;
  if (listen.startsWith("unix://") || listen.startsWith("/")) {
    socketPath = listen.replace(/^unix:\/\//, "");
    url = `ws+unix://${socketPath}:/ws`;
  } else url = `ws://${listen}/ws`;
  const WebSocket = ws.default ?? ws.WebSocket;
  const client = new clientModule.DaemonClient({
    url,
    clientId: "cid_ssh_manager_mirror",
    clientType: "cli",
    localCredential: () => control.readLocalCredentialForTarget(home, listen) ?? undefined,
    connectTimeoutMs: 10_000,
    webSocketFactory: (u: string, config?: { headers?: Record<string, string>; protocols?: string | string[] }) =>
      new WebSocket(u, config?.protocols, { headers: config?.headers, ...(socketPath ? { socketPath } : {}) }),
    reconnect: { enabled: true },
  });
  await client.connect();
  // After a reconnection the daemon forgets our stream subscriptions: rebuild every mirror.
  let wasConnected = true;
  client.subscribeConnectionStatus?.((state: { status: string }) => {
    if (state.status === "connected") {
      if (!wasConnected) {
        const ids = [...mirrors.keys()];
        for (const m of [...mirrors.values()]) dropMirror(m);
        // Terminals with a log or alerts must keep being followed.
        for (const id of ids) if (isPinned(id)) void ensureMirror(id).catch(() => undefined);
      }
      wasConnected = true;
    } else if (state.status === "disconnected") wasConnected = false;
  });
  return { client, Terminal };
}

function host(): Promise<Host> {
  if (!hostPromise) {
    hostPromise = connectHost().catch((err) => {
      hostPromise = null;
      throw err;
    });
  }
  return hostPromise;
}

/* ------------------------------------------------------------------ */
/* Mirrors                                                             */
/* ------------------------------------------------------------------ */

interface Mirror {
  id: string;
  term: Any;
  sub: Any;
  version: number;
  lastAccess: number;
  waiters: Set<() => void>;
  /** DEC private modes not exposed by the headless API, tracked from the stream. */
  cursorVisible: boolean;
  /**
   * SGR (1006) mouse encoding. Null: not seen in the stream (the program enabled it before the
   * mirror existed, and the daemon replay does not restore it): assume SGR, used by every
   * current curses program (htop, vim, mc, tmux).
   */
  sgrMouse: boolean | null;
  /** Between replay begin and end: modes come from the daemon snapshot, not from the program. */
  replaying: boolean;
  /** The PTY exited (session ended). */
  exited: boolean;
  /** Subscription refused (terminal not found). */
  failed: string | null;
}

const mirrors = new Map<string, Mirror>();
const pending = new Map<string, Promise<Mirror>>();

function bump(m: Mirror): void {
  m.version += 1;
  for (const w of m.waiters) w();
  m.waiters.clear();
}

function trackModes(m: Mirror): void {
  const set = (on: boolean) => (params: Any) => {
    const list: number[] = Array.from(params as ArrayLike<number>);
    if (list.includes(25)) m.cursorVisible = on;
    if (list.includes(1006)) m.sgrMouse = on;
    // Mouse tracking switched on live without SGR seen yet: legacy X10 coordinates.
    else if (on && !m.replaying && m.sgrMouse === null && list.some((p) => p === 9 || p === 1000 || p === 1002 || p === 1003)) {
      m.sgrMouse = false;
    }
    return false; // let xterm handle the mode too
  };
  try {
    m.term.parser.registerCsiHandler({ prefix: "?", final: "h" }, set(true));
    m.term.parser.registerCsiHandler({ prefix: "?", final: "l" }, set(false));
  } catch {
    /* parser hooks unavailable */
  }
}

async function createMirror(terminalId: string): Promise<Mirror> {
  const { client, Terminal } = await host();
  const term = new Terminal({ rows: 24, cols: 80, scrollback: 2000, allowProposedApi: true });
  const m: Mirror = {
    id: terminalId,
    term,
    sub: null,
    version: 1,
    lastAccess: Date.now(),
    waiters: new Set(),
    cursorVisible: true,
    sgrMouse: null,
    replaying: false,
    exited: false,
    failed: null,
  };
  trackModes(m);
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => (resolveReady = r));
  const write = (data: Uint8Array) => term.write(data, () => bump(m));
  const decoder = new TextDecoder();
  m.sub = client.observeTerminal(
    terminalId,
    (ev: Any) => {
      if (ev.type === "output") {
        write(ev.data);
        // Logs and alerts see the live output only (never the replayed screen).
        if (isPinned(terminalId)) onOutput(terminalId, decoder.decode(ev.data, { stream: true }));
      }
      else if (ev.type === "replay") {
        const r = ev.replay;
        if (r.type === "begin") {
          term.reset();
          m.cursorVisible = true;
          m.sgrMouse = null;
          m.replaying = true;
          if (r.rows && r.cols) term.resize(r.cols, r.rows);
        } else if (r.type === "data") write(r.data);
        else if (r.type === "end") {
          term.write("", () => {
            m.replaying = false;
            bump(m);
            resolveReady();
          });
        }
      }
    },
    // Full snapshot: the history is available for scrolling back with the wheel.
    { restore: { mode: "full-snapshot", scrollbackLines: 2000 } },
  );
  // Stream lifecycle: the PTY exit and refused subscriptions (terminal not found).
  const lifecycle = new Proxy(
    {},
    {
      get: (_t, name) =>
        name === "then"
          ? undefined
          : (payload: Any) => {
              if (name === "update" && payload?.type === "terminal_stream_exit") {
                m.exited = true;
                onExit(terminalId);
                bump(m);
                resolveReady();
              } else if (name === "error") {
                m.failed = String(payload?.userMessage ?? payload?.message ?? "Terminal introuvable");
                bump(m);
                resolveReady();
              }
            },
    },
  );
  try {
    m.sub?.subscribe?.(lifecycle);
  } catch {
    /* older client: no lifecycle notifications */
  }
  setTimeout(resolveReady, 2500);
  await ready;
  if (m.failed) {
    dropMirror(m);
    throw new Error(m.failed);
  }
  mirrors.set(terminalId, m);
  return m;
}

/** One mirror per terminal, even when several calls arrive before the first one is ready. */
async function ensureMirror(terminalId: string): Promise<Mirror> {
  const existing = mirrors.get(terminalId);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }
  let p = pending.get(terminalId);
  if (!p) {
    p = createMirror(terminalId).finally(() => pending.delete(terminalId));
    pending.set(terminalId, p);
  }
  return p;
}

function dropMirror(m: Mirror): void {
  mirrors.delete(m.id);
  try {
    m.sub?.release?.();
  } catch {
    /* ignore */
  }
  try {
    m.term.dispose();
  } catch {
    /* ignore */
  }
  for (const w of m.waiters) w();
  m.waiters.clear();
}

const idleTimer = setInterval(() => {
  const now = Date.now();
  // Kept 10 minutes: switching tabs is instant and the terminal modes stay known.
  for (const m of mirrors.values()) {
    if (now - m.lastAccess > 600_000 && m.waiters.size === 0 && !isPinned(m.id)) dropMirror(m);
  }
}, 15_000);
idleTimer.unref?.();

export function disposeMirrors(): void {
  clearInterval(idleTimer);
  for (const m of [...mirrors.values()]) dropMirror(m);
  void hostPromise?.then((h) => h.client.close?.()).catch(() => {});
  hostPromise = null;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

function cellColor(cell: Any, which: "fg" | "bg"): string {
  if (which === "fg") {
    if (cell.isFgDefault()) return "";
    if (cell.isFgRGB()) return hex(cell.getFgColor());
    return color256(cell.getFgColor());
  }
  if (cell.isBgDefault()) return "";
  if (cell.isBgRGB()) return hex(cell.getBgColor());
  return color256(cell.getBgColor());
}

function lineRuns(line: Any, cols: number, nullCell: Any): Run[] {
  const runs: Run[] = [];
  if (!line) return runs;
  let key = "";
  let cur: Run | null = null;
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x, nullCell);
    if (!cell || cell.getWidth() === 0) continue;
    let fg = cellColor(cell, "fg");
    let bg = cellColor(cell, "bg");
    if (cell.isInverse()) {
      const f = fg;
      fg = bg || "*";
      bg = f || "*";
    }
    if (cell.isInvisible()) fg = bg || "*";
    let flags = 0;
    if (cell.isBold()) flags |= FLAG_BOLD;
    if (cell.isItalic()) flags |= FLAG_ITALIC;
    if (cell.isUnderline()) flags |= FLAG_UNDERLINE;
    if (cell.isDim()) flags |= FLAG_DIM;
    if (cell.isStrikethrough?.()) flags |= FLAG_STRIKE;
    const k = `${fg}|${bg}|${flags}`;
    const ch = cell.getChars() || " ";
    if (cur && k === key) cur[0] += ch;
    else {
      cur = [ch, fg, bg, flags];
      runs.push(cur);
      key = k;
    }
  }
  const last = runs[runs.length - 1];
  if (last && !last[2] && !(last[3] & (FLAG_UNDERLINE | FLAG_STRIKE))) {
    last[0] = last[0].replace(/\s+$/, "");
    if (!last[0]) runs.pop();
  }
  return runs;
}

function snapshot(m: Mirror, scroll: number): Screen {
  const term = m.term;
  const buf = term.buffer.active;
  const rows: number = term.rows;
  const cols: number = term.cols;
  const alternate = buf.type === "alternate";
  const maxScroll: number = alternate ? 0 : buf.baseY;
  const applied = Math.max(0, Math.min(maxScroll, Math.floor(scroll)));
  const top = buf.baseY - applied;
  const nullCell = buf.getNullCell();
  const lines: Run[][] = [];
  for (let y = 0; y < rows; y += 1) lines.push(lineRuns(buf.getLine(top + y), cols, nullCell));
  const cx: number = buf.cursorX;
  const cy: number = buf.cursorY + applied;
  const cursorCell = buf.getLine(buf.baseY + buf.cursorY)?.getCell(Math.min(cx, cols - 1));
  const modes = term.modes ?? {};
  return {
    version: m.version,
    rows,
    cols,
    lines,
    cursor: { x: cx, y: cy, visible: m.cursorVisible && cy < rows, ch: cursorCell?.getChars() || " " },
    appCursor: !!modes.applicationCursorKeysMode,
    bracketedPaste: !!modes.bracketedPasteMode,
    alternate,
    exited: false,
    mouse: (modes.mouseTrackingMode as Screen["mouse"]) ?? "none",
    scroll: applied,
    maxScroll,
  };
}

/**
 * Screen of a terminal. With `since` equal to the current version, waits (up to `waitMs`) for the
 * next change, so the client can loop on this call and still see output immediately. Bursts of
 * output are grouped (one answer per ~frame) to keep the client fluid during `cat` or builds.
 */
export async function readScreen(input: {
  terminalId: string;
  since?: number;
  waitMs?: number;
  rows?: number;
  cols?: number;
  scroll?: number;
}): Promise<Screen | { version: number; unchanged: true }> {
  const m = await ensureMirror(input.terminalId);
  m.lastAccess = Date.now();

  if (input.rows && input.cols && (input.rows !== m.term.rows || input.cols !== m.term.cols)) {
    const rows = Math.max(4, Math.min(300, Math.floor(input.rows)));
    const cols = Math.max(20, Math.min(500, Math.floor(input.cols)));
    try {
      const { client } = await host();
      client.sendTerminalInput(input.terminalId, { type: "resize", rows, cols });
      m.term.resize(cols, rows);
      bump(m);
    } catch {
      /* resize is best effort */
    }
  }

  if (input.since !== undefined && input.since === m.version) {
    const wait = Math.min(Math.max(input.waitMs ?? 0, 0), 20_000);
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          m.waiters.delete(done);
          resolve();
        }, wait);
        m.waiters.add(done);
      });
      // Let the rest of a burst arrive: one screen per frame instead of one per chunk.
      if (input.since !== m.version) await new Promise((r) => setTimeout(r, 16));
    }
    if (input.since === m.version) return { version: m.version, unchanged: true };
  }
  if (m.failed) {
    dropMirror(m);
    throw new Error(m.failed);
  }
  const screen = snapshot(m, input.scroll ?? 0);
  if (m.exited) {
    screen.exited = true;
    // Keep the last screen a moment for late readers, then free it.
    setTimeout(() => mirrors.get(m.id) === m && dropMirror(m), 30_000);
  }
  return screen;
}

/* ------------------------------------------------------------------ */
/* Mouse, rename                                                       */
/* ------------------------------------------------------------------ */

export interface MouseInput {
  terminalId: string;
  x: number;
  y: number;
  /** 0 left, 1 middle, 2 right. */
  button: number;
  action: "down" | "up" | "move" | "wheel-up" | "wheel-down";
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

/**
 * Encode a mouse event the way xterm does, for the tracking mode the program asked for
 * (X10, normal, button-event or any-event; SGR 1006 or legacy coordinates). The daemon does not
 * do it (it ignores mouse messages), so the bytes are written as terminal input.
 */
export async function sendMouse(ev: MouseInput): Promise<{ sent: boolean }> {
  const m = await ensureMirror(ev.terminalId);
  const mode: string = m.term.modes?.mouseTrackingMode ?? "none";
  if (mode === "none") return { sent: false };
  if (ev.action === "move" && mode !== "drag" && mode !== "any") return { sent: false };
  if (mode === "x10" && ev.action !== "down") return { sent: false };
  let b: number;
  if (ev.action === "wheel-up") b = 64;
  else if (ev.action === "wheel-down") b = 65;
  else b = Math.max(0, Math.min(2, ev.button));
  if (ev.action === "move") b += 32;
  if (mode !== "x10") {
    if (ev.shift) b += 4;
    if (ev.alt) b += 8;
    if (ev.ctrl) b += 16;
  }
  const x = Math.max(0, Math.floor(ev.x)) + 1;
  const y = Math.max(0, Math.floor(ev.y)) + 1;
  let data: string;
  if (m.sgrMouse !== false) {
    data = `\x1b[<${b};${x};${y}${ev.action === "up" ? "m" : "M"}`;
  } else {
    if (ev.action === "up") b = 3 + (b & ~3);
    if (x > 223 || y > 223) return { sent: false };
    data = `\x1b[M${String.fromCharCode(32 + b)}${String.fromCharCode(32 + x)}${String.fromCharCode(32 + y)}`;
  }
  const { client } = await host();
  client.sendTerminalInput(ev.terminalId, { type: "input", data });
  return { sent: true };
}

export async function renameTerminal(terminalId: string, title: string): Promise<{ ok: boolean }> {
  const { client } = await host();
  await client.renameTerminal({ terminalId, title });
  return { ok: true };
}

export { FLAG_BOLD, FLAG_DIM, FLAG_ITALIC, FLAG_STRIKE, FLAG_UNDERLINE };

/* ------------------------------------------------------------------ */
/* Search (whole history)                                              */
/* ------------------------------------------------------------------ */

export interface SearchMatch {
  /** Absolute buffer line. */
  line: number;
  col: number;
  len: number;
}

export async function searchTerminal(input: { terminalId: string; query: string; caseSensitive?: boolean }) {
  const m = await ensureMirror(input.terminalId);
  m.lastAccess = Date.now();
  const buf = m.term.buffer.active;
  const matches: SearchMatch[] = [];
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase();
  if (needle) {
    for (let y = 0; y < buf.length && matches.length < 1000; y += 1) {
      const raw: string = buf.getLine(y)?.translateToString(true) ?? "";
      const text = input.caseSensitive ? raw : raw.toLowerCase();
      let from = 0;
      for (;;) {
        const i = text.indexOf(needle, from);
        if (i < 0) break;
        matches.push({ line: y, col: i, len: needle.length });
        from = i + Math.max(1, needle.length);
      }
    }
  }
  return { matches, baseY: buf.baseY as number, rows: m.term.rows as number, alternate: buf.type === "alternate" };
}

/** Keep following a terminal without a viewer (log or alerts on it). */
export async function pinMirror(terminalId: string): Promise<void> {
  const m = await ensureMirror(terminalId);
  m.lastAccess = Date.now();
}

/** Whole history as plain text (export). */
export async function exportTerminal(terminalId: string): Promise<string> {
  const m = await ensureMirror(terminalId);
  // The normal buffer holds the history (the alternate one is vim/htop's screen).
  const buf = m.term.buffer.normal;
  const lines: string[] = [];
  for (let y = 0; y < buf.length; y += 1) lines.push(buf.getLine(y)?.translateToString(true) ?? "");
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.join("\n") + "\n";
}
