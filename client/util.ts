import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(digits)} ${units[unit]}`;
}

export function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return "-";
  return `${formatBytes(bytesPerSec, 2)}/s`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(epochSec: number): string {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function joinPath(dir: string, name: string): string {
  if (!dir || dir === "/") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** react-native-web extras (hover state, double click) that the native typings do not declare. */
export function isHovered(state: unknown): boolean {
  return !!(state as { hovered?: boolean }).hovered;
}

export function webProps(props: Record<string, unknown>): object {
  return props;
}

/**
 * Paseo forces its UI font on every node that is not inside an element carrying `data-pmono`
 * (its own opt-out for code). Terminal text must be monospace to line up columns and the cursor.
 */
export const MONO_SURFACE = { dataSet: { pmono: "" } } as unknown as object;

/** Web-only style keys (cursor, userSelect...) that the native typings do not declare. */
export function webStyle(style: Record<string, string>): object {
  return Platform.OS === "web" ? style : {};
}

/**
 * Keep a dialog mounted while it closes. Paseo's modal sheets register a global overlay layer:
 * unmounting one while it is still open can leave that layer (and its backdrop) behind, which
 * blocks every click and keyboard input in the app until it is reloaded. So a dialog is always
 * closed first (`open` false) and only unmounted once its closing animation is over.
 */
export function useLinger<T>(value: T | null, ms = 450): { shown: T | null; open: boolean } {
  const [shown, setShown] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setShown(value);
      return;
    }
    const timer = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(timer);
  }, [value]);
  return { shown: value ?? shown, open: value !== null };
}

/** Run an action chosen in a menu once the menu sheet has closed (never two sheets at once). */
export function afterMenu(fn: () => void): void {
  setTimeout(fn, 350);
}

/**
 * Double click / double tap detection that works everywhere (react-native-web does not forward
 * onDoubleClick from Pressable). Two presses on the same key within `delay` ms = double.
 */
export function createDoublePress(delay = 400) {
  let lastKey = "";
  let lastTime = 0;
  return (key: string, onSingle: () => void, onDouble: () => void) => {
    const now = Date.now();
    if (key === lastKey && now - lastTime < delay) {
      lastKey = "";
      onDouble();
      return;
    }
    lastKey = key;
    lastTime = now;
    onSingle();
  };
}

/**
 * Web: react on the raw mouse down. react-native-web's press events drop fast clicks (released
 * before its press delay) and both clicks of a quick double click; the DOM event never does.
 */
export interface PressMods {
  ctrl: boolean;
  shift: boolean;
}

export function pressProps(handler: (mods: PressMods) => void): object {
  if (Platform.OS !== "web") return { onPress: () => handler({ ctrl: false, shift: false }) };
  return {
    onMouseDown: (e: { button: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault(): void }) => {
      if (e.button !== 0) return;
      // Shift+click selects a range: keep the browser from also selecting text.
      if (e.shiftKey) e.preventDefault();
      handler({ ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey });
    },
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Tiny shared store (no classes: Hermes-friendly)                     */
/* ------------------------------------------------------------------ */

export interface SharedStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): SharedStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: SharedStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Left strip: session tree, Sftp browser; "terminals" only exists on narrow layouts. */
export type AppTab = "sessions" | "files" | "terminals" | "monitor";

/** Main area: session tabs, or a tool opened from the top toolbar. */
export type MainView = "tabs" | "keys" | "monitor" | "multiexec" | "split" | "tunnels" | "logs";

/** The server and tab every SSH view shows; shared so the page and panels stay in step. */
export const selectionStore = createStore<{
  serverId: string | null;
  tab: AppTab;
  filePaths: Record<string, string>;
  /** Terminal shown in the main area; null: the Home tab. */
  activeTerminal: string | null;
  mainView: MainView;
  /** Terminals excluded from the multi-execution grid. */
  multiExcluded: Record<string, boolean>;
}>({
  serverId: null,
  tab: "sessions",
  filePaths: {},
  activeTerminal: null,
  mainView: "tabs",
  multiExcluded: {},
});

/** "1,5 Go" style decimals, as MobaXterm shows them in a French locale. */
export function frNumber(text: string): string {
  return text.replace(/(\d)\.(\d)/g, "$1,$2");
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Monospace font. iOS / Android take a single family name (a CSS list is not understood and the
 * text falls back to a proportional font: columns and the cursor no longer line up).
 */
export const MONO: string =
  Platform.OS === "ios" ? "Menlo" : Platform.OS === "android" ? "monospace" : "Menlo, Consolas, 'DejaVu Sans Mono', monospace";

export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** MobaXterm's dark look (Personal Edition, default dark theme). */
export const MOBA_THEME: PluginTheme = {
  colors: {
    surface0: "#1e1e1e",
    surface1: "#252526",
    surface2: "#333337",
    border: "#3c3c3c",
    foreground: "#dcdcdc",
    foregroundMuted: "#9d9d9d",
    accent: "#2f7ed8",
    accentForeground: "#ffffff",
    statusSuccess: "#3dbb4a",
    statusWarning: "#e8b33a",
    statusDanger: "#e04343",
  },
};

function makeStyles(theme: PluginTheme, moba: boolean) {
  {
    const c = theme.colors;
    /** Extra colours: fixed MobaXterm values, or derived from the Paseo theme. */
    const x = moba
      ? {
          folder: "#e9b949",
          ssh: "#5ea7f0",
          star: "#f2c230",
          termBg: "#1e1e1e",
          termFg: "#ececec",
          selection: "#264f78",
          strip: "#2b2b2b",
          tabBar: "#2b2b2b",
          tabActive: "#1e1e1e",
          statusBar: "#2d2d30",
          toolbar: "#252526",
          green: "#3dbb4a",
          blue: "#3b8eea",
          red: "#e04343",
          orange: "#f08a24",
        }
      : {
          folder: c.statusWarning,
          ssh: c.accent,
          star: c.statusWarning,
          termBg: c.surface0,
          termFg: c.foreground,
          selection: withAlpha(c.accent, 0.3),
          strip: c.surface1,
          tabBar: c.surface1,
          tabActive: c.surface0,
          statusBar: c.surface1,
          toolbar: c.surface1,
          green: c.statusSuccess,
          blue: c.accent,
          red: c.statusDanger,
          orange: c.statusWarning,
        };
    return {
      c,
      x,
      moba,
      text: { color: c.foreground, fontSize: 13 },
      muted: { color: c.foregroundMuted, fontSize: 12 },
      small: { color: c.foregroundMuted, fontSize: 11 },
      title: { color: c.foreground, fontSize: 15, fontWeight: "600" as const },
      mono: { color: c.foreground, fontSize: 12, fontFamily: MONO },
      row: { flexDirection: "row" as const, alignItems: "center" as const },
      input: {
        color: c.foreground,
        backgroundColor: c.surface1,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        fontSize: 13,
        minHeight: 32,
      },
      card: {
        backgroundColor: c.surface1,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 8,
      },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: c.surface2,
        borderColor: c.border,
        borderWidth: 1,
      },
      buttonPrimary: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: c.accent,
      },
      iconButton: {
        padding: 6,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      separator: { height: 1, backgroundColor: c.border },
    };
  }
}

type BaseStyles = ReturnType<typeof makeStyles>;

/**
 * Styles of the SSH views. `modal` holds the styles for content shown in Paseo dialogs: those
 * sheets keep the Paseo theme, so their content must too (MobaXterm colours would be unreadable).
 */
export function useStyles(theme: PluginTheme, moba = false, hostTheme?: PluginTheme) {
  return useMemo(() => {
    const base = makeStyles(theme, moba) as Styles;
    if (moba && hostTheme) {
      const host = makeStyles(hostTheme, false) as Styles;
      host.modal = host;
      base.modal = host;
    } else base.modal = base;
    return base;
  }, [theme, moba, hostTheme]);
}

export type Styles = BaseStyles & { modal: Styles };
