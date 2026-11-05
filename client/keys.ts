import { Platform } from "react-native";

const KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

const APP_KEYS: Record<string, string> = {
  ArrowUp: "\x1bOA",
  ArrowDown: "\x1bOB",
  ArrowRight: "\x1bOC",
  ArrowLeft: "\x1bOD",
  Home: "\x1bOH",
  End: "\x1bOF",
};

export interface KeyEventLike {
  nativeEvent: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  preventDefault?: () => void;
}

/**
 * Translate a key press into terminal bytes. Returns null when the key must be left to the input
 * (paste shortcuts). On native, only Backspace is handled here: typed text arrives via onChangeText.
 */
export function keyToData(e: KeyEventLike, opts: { appCursor?: boolean } = {}): string | null {
  const { key, ctrlKey, altKey, metaKey, shiftKey } = e.nativeEvent;
  if (Platform.OS !== "web") return key === "Backspace" ? "\x7f" : null;
  if (metaKey) return null;
  if (ctrlKey && shiftKey && (key === "V" || key === "v" || key === "C" || key === "c")) return null;
  if (ctrlKey && key.length === 1) {
    if (key.toLowerCase() === "v") return null;
    const code = key.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    if (key === " ") return "\x00";
    return null;
  }
  // Shift+Insert / Ctrl+Shift+Insert: paste (as in MobaXterm), handled by the input.
  if (key === "Insert" && shiftKey) return null;
  // Application cursor mode (vim, htop, less...): arrows and Home/End use SS3 sequences.
  if (opts.appCursor && APP_KEYS[key]) return APP_KEYS[key]!;
  if (KEYS[key]) return shiftKey && key === "Tab" ? "\x1b[Z" : KEYS[key]!;
  if (key.length === 1) return altKey ? `\x1b${key}` : key;
  return null;
}
