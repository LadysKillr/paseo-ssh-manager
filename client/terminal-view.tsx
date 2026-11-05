import type { PaseoApi, PaseoTerminal } from "@getpaseo/client";
import { copyText, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { memo, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type TextInput as NativeTextInput } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { terminalMouseRpc, terminalScreenRpc, terminalSearchRpc, type Run, type Screen } from "../shared/rpc";
import { Icon } from "@getpaseo/plugin/client/ui";
import { keyToData, type KeyEventLike } from "./keys";
import { useVisible } from "./visibility";
import { errorMessage, MONO, MONO_SURFACE, webProps, type Styles } from "./util";
import { hasTextSelection, readClipboard, selectionText } from "./web";

export const TERM_FONT = 13;
export const TERM_LINE = 17;
const PAD = 6;

/**
 * Read the screen: the terminal may be taller than this view (its PTY size is set by whoever opened
 * it), and its last lines are then blank. Read a wider window, drop the trailing blank lines, keep
 * the last `rows` lines that hold content.
 */
export async function readScreen(handle: { capture(o: { start?: number; stripAnsi?: boolean }): Promise<{ lines: string[] }> }, rows: number) {
  const res = await handle.capture({ start: -Math.max(rows, 200), stripAnsi: true });
  const lines = res.lines.slice();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.slice(-rows);
}

export interface TermSize {
  rows: number;
  cols: number;
}

/** Measures the monospace cell and turns the available area into rows / columns. */
export function useTermMetrics() {
  const [charWidth, setCharWidth] = useState(7.8);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const size: TermSize = {
    cols: Math.max(20, Math.floor((area.width - 12) / charWidth)),
    rows: Math.max(5, Math.floor((area.height - 12) / TERM_LINE)),
  };
  const probe = (
    <Text
      style={{ position: "absolute", opacity: 0, fontFamily: MONO, fontSize: TERM_FONT }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width / 40;
        if (w > 3 && Math.abs(w - charWidth) > 0.05) setCharWidth(w);
      }}
    >
      {"M".repeat(40)}
    </Text>
  );
  return { size, setArea, probe, ready: area.width > 0 };
}

const CURSOR = "#f2f2f2";
/** Invisible marker kept in the mobile typing field (see the touch input). */
const MARK = "\u200b";

/** Row of keys a phone keyboard lacks (Termius-like). */
function MobileKeys({
  s,
  keyboardOpen,
  onToggleKeyboard,
  ctrl,
  alt,
  appCursor,
  onKey,
  onToggleCtrl,
  onToggleAlt,
  onPaste,
  onZoom,
  onSearch,
}: {
  s: Styles;
  keyboardOpen: boolean;
  onToggleKeyboard(): void;
  ctrl: boolean;
  alt: boolean;
  appCursor: boolean;
  onKey(data: string): void;
  onToggleCtrl(): void;
  onToggleAlt(): void;
  onPaste(): void;
  onZoom?: (delta: number) => void;
  onSearch(): void;
}) {
  const arrow = (c: string) => (appCursor ? `\x1bO${c}` : `\x1b[${c}`);
  const keys: { label: string; icon?: string; active?: boolean; press(): void }[] = [
    { label: "", icon: keyboardOpen ? "KeyboardOff" : "Keyboard", active: keyboardOpen, press: onToggleKeyboard },
    { label: "Échap", press: () => onKey("\x1b") },
    { label: "Tab", press: () => onKey("\t") },
    { label: "Ctrl", active: ctrl, press: onToggleCtrl },
    { label: "Alt", active: alt, press: onToggleAlt },
    { label: "", icon: "ArrowLeft", press: () => onKey(arrow("D")) },
    { label: "", icon: "ArrowUp", press: () => onKey(arrow("A")) },
    { label: "", icon: "ArrowDown", press: () => onKey(arrow("B")) },
    { label: "", icon: "ArrowRight", press: () => onKey(arrow("C")) },
    { label: "^C", press: () => onKey("\x03") },
    { label: "|", press: () => onKey("|") },
    { label: "/", press: () => onKey("/") },
    { label: "-", press: () => onKey("-") },
    { label: "~", press: () => onKey("~") },
    { label: "", icon: "ClipboardPaste", press: onPaste },
    { label: "", icon: "Search", press: onSearch },
    ...(onZoom
      ? [
          { label: "A-", press: () => onZoom(-1) },
          { label: "A+", press: () => onZoom(1) },
        ]
      : []),
  ];
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, backgroundColor: s.x.toolbar, borderTopWidth: 1, borderTopColor: s.c.border }}
      contentContainerStyle={{ paddingHorizontal: 4, paddingVertical: 4, gap: 4 }}
    >
      {keys.map((k, i) => (
        <Pressable
          key={i}
          accessibilityRole="button"
          accessibilityLabel={k.label || k.icon}
          onPress={k.press}
          // Keep the focus (and the soft keyboard) on the typing field.
          {...webProps({ onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() })}
          style={({ pressed }) => ({
            minWidth: 42,
            height: 36,
            paddingHorizontal: 8,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: k.active ? s.c.accent : s.c.border,
            backgroundColor: k.active ? s.x.selection : pressed ? s.c.surface2 : s.c.surface1,
          })}
        >
          {k.icon ? <Icon name={k.icon} size={16} color={s.c.foreground} /> : <Text style={{ color: s.c.foreground, fontSize: 14, fontWeight: "600" }}>{k.label}</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Last screen of every terminal shown, so a finished session keeps its content (MobaXterm-like). */
export const lastScreens = new Map<string, Screen>();

export function lineHeightFor(fontSize: number): number {
  return Math.round(fontSize * 1.32);
}

/** Fallback screen built from the plain capture (no colours, cursor guessed after the last line). */
function plainScreen(lines: string[], rows: number, cols: number): Screen {
  const last = lines[lines.length - 1] ?? "";
  return {
    version: 0,
    rows,
    cols,
    lines: lines.map((l): Run[] => [[l, "", "", 0]]),
    cursor: { x: last.length + (/[$#>%]$/.test(last) ? 1 : 0), y: Math.max(0, lines.length - 1), visible: true, ch: " " },
    appCursor: false,
    bracketedPaste: false,
    alternate: false,
    exited: false,
    mouse: "none",
    scroll: 0,
    maxScroll: 0,
  };
}

function nbsp(text: string): string {
  return text.replace(/ /g, " ");
}

interface LineProps {
  runs: Run[];
  /** Stable content key: the line re-renders only when it changes. */
  k: string;
  fontSize: number;
  lineHeight: number;
  fg: string;
  bg: string;
}

function LineImpl({ runs, fontSize, lineHeight, fg, bg }: LineProps) {
  const fgOf = (v: string) => (v === "" ? fg : v === "*" ? bg : v);
  const bgOf = (v: string) => (v === "" ? undefined : v === "*" ? fg : v);
  return (
    <Text selectable numberOfLines={1} style={{ fontFamily: MONO, fontSize, lineHeight, height: lineHeight, color: fg }}>
      {runs.length === 0
        ? " "
        : runs.map((r, i) => (
            <Text
              key={i}
              style={{
                color: fgOf(r[1]),
                backgroundColor: bgOf(r[2]),
                fontWeight: r[3] & 1 ? "bold" : "normal",
                fontStyle: r[3] & 2 ? "italic" : "normal",
                textDecorationLine: r[3] & 4 ? (r[3] & 16 ? "underline line-through" : "underline") : r[3] & 16 ? "line-through" : "none",
                opacity: r[3] & 8 ? 0.6 : 1,
              }}
            >
              {nbsp(r[0])}
            </Text>
          ))}
    </Text>
  );
}

const Line = memo(LineImpl, (a, b) => a.k === b.k && a.fontSize === b.fontSize && a.fg === b.fg && a.bg === b.bg);

/** Draw a screen (used by the live view and by finished sessions). */
export function ScreenLines({ s, screen, fontSize }: { s: Styles; screen: Screen; fontSize: number }) {
  const lh = lineHeightFor(fontSize);
  return (
    <>
      {screen.lines.map((runs, y) => (
        <Line key={y} k={JSON.stringify(runs)} runs={runs} fontSize={fontSize} lineHeight={lh} fg={s.x.termFg} bg={s.x.termBg} />
      ))}
    </>
  );
}

interface DomRect {
  left: number;
  top: number;
}
interface MouseLike {
  clientX: number;
  clientY: number;
  button: number;
  buttons?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  deltaY?: number;
  preventDefault(): void;
  stopPropagation?(): void;
}

/**
 * A live view of a Paseo terminal, drawn like MobaXterm: the daemon host runs an xterm emulator on
 * the terminal stream and sends the screen (colours, attributes, real cursor); keys typed here are
 * written to the terminal, and the PTY follows the size of the view.
 *
 * Mouse, as in MobaXterm: selecting copies, right or middle click pastes, the wheel scrolls back in
 * the history (or scrolls full-screen programs), Ctrl + wheel zooms. When a program asks for the
 * mouse (htop, mc, vim with mouse=a), clicks and the wheel go to it; hold Shift to select text.
 */
export function TerminalView({
  s,
  paseo,
  terminal,
  active,
  interactive = true,
  refreshSignal = 0,
  onPressArea,
  fontSize = TERM_FONT,
  copyOnSelect = true,
  rightClickPaste = true,
  onZoom,
  onGone,
  searchRequest = 0,
  touch = false,
}: {
  s: Styles;
  paseo: PaseoApi;
  terminal: PaseoTerminal;
  active: boolean;
  /** Kept for callers; the view sizes itself. */
  rows?: number;
  /** false: display only (the multi-exec grid owns the keyboard). */
  interactive?: boolean;
  pollMs?: number;
  /** Changes when input was sent elsewhere (capture fallback: read again right away). */
  refreshSignal?: number;
  onPressArea?: () => void;
  fontSize?: number;
  copyOnSelect?: boolean;
  rightClickPaste?: boolean;
  /** Ctrl + wheel / Ctrl + / Ctrl -: +1 or -1. */
  onZoom?: (delta: number) => void;
  /** The terminal no longer answers (session ended or killed). */
  onGone?: () => void;
  /** Touch layout: visible typing bar with a row of special keys, swipe to scroll. */
  touch?: boolean;
  /** Changes when the app asks to open the search bar (toolbar button). */
  searchRequest?: number;
}) {
  const screenRpc = useRpc(terminalScreenRpc);
  // Off screen (another Paseo page, window minimised): stop the long poll.
  const onScreen = useVisible();
  const live = active && onScreen;
  const mouseRpc = useRpc(terminalMouseRpc);
  const toast = useToast();
  const [screen, setScreen] = useState<Screen | null>(() => lastScreens.get(terminal.id) ?? null);
  const [mode, setMode] = useState<"emulated" | "capture">("emulated");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [charWidth, setCharWidth] = useState(fontSize * 0.6);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState(0);
  const input = useRef<NativeTextInput>(null);
  const box = useRef<View>(null);
  const handle = paseo.terminals.ref(terminal);
  const lh = lineHeightFor(fontSize);
  const size = {
    cols: Math.max(20, Math.floor((area.width - PAD * 2) / charWidth)),
    rows: Math.max(4, Math.floor((area.height - PAD * 2) / lh)),
  };
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const scrollRef = useRef(0);
  scrollRef.current = scroll;
  const screenRef = useRef<Screen | null>(null);
  screenRef.current = screen;
  const lastCell = useRef("");
  /* Touch mode: visible input with a marker, sticky Ctrl / Alt, swipe to scroll. */
  const mobileInput = useRef<NativeTextInput>(null);
  const [mobileBuf, setMobileBuf] = useState(MARK);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [altOn, setAltOn] = useState(false);
  const swipe = useRef({ y: 0, acc: 0, moved: false });
  const sendTyped = (text: string) => {
    let data = text.replace(/\r?\n/g, "\r");
    if (data.length === 1 && ctrlOn) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
      setCtrlOn(false);
    }
    if (altOn) {
      data = `\x1b${data}`;
      setAltOn(false);
    }
    send(data);
  };
  /** Finger moving down shows older lines (positive), like any scrollable list. */
  const scrollBy = (lines: number) => {
    const sc = screenRef.current;
    if (!sc) return;
    if (sc.alternate) {
      const key = lines > 0 ? (sc.appCursor ? "\x1bOA" : "\x1b[A") : sc.appCursor ? "\x1bOB" : "\x1b[B";
      handle.write(key.repeat(Math.min(10, Math.abs(lines))));
      return;
    }
    setScroll((cur) => Math.max(0, Math.min(sc.maxScroll, cur + lines)));
  };

  /* ---------------- search (Ctrl+Shift+F) ---------------- */
  const searchRpc = useRpc(terminalSearchRpc);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState<{ matches: { line: number; col: number; len: number }[]; baseY: number } | null>(null);
  const [current, setCurrent] = useState(-1);
  const searchInput = useRef<NativeTextInput>(null);
  const jumpTo = (i: number, res = found) => {
    if (!res || !res.matches.length) return;
    const n = res.matches.length;
    const idx = ((i % n) + n) % n;
    setCurrent(idx);
    const m = res.matches[idx]!;
    const rows = sizeRef.current.rows;
    // Bring the match to the middle of the view (0: it is on the live screen).
    const target = m.line >= res.baseY ? 0 : Math.max(0, Math.min(res.baseY, res.baseY - m.line + Math.floor(rows / 2)));
    setScroll(target);
  };
  useEffect(() => {
    if (!searchOpen) return;
    if (!query) {
      setFound(null);
      setCurrent(-1);
      return;
    }
    const timer = setTimeout(() => {
      void searchRpc({ terminalId: terminal.id, query, caseSensitive })
        .then((res) => {
          setFound(res);
          // Start from the most recent match, like MobaXterm.
          if (res.matches.length) jumpTo(res.matches.length - 1, res);
          else setCurrent(-1);
        })
        .catch(() => setFound(null));
    }, 220);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, searchOpen]);
  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => searchInput.current?.focus(), 30);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setFound(null);
    setCurrent(-1);
    setScroll(0);
    setTimeout(() => input.current?.focus(), 30);
  };
  useEffect(() => {
    if (searchRequest) openSearch();
  }, [searchRequest]);
  const ready = area.width > 0 && area.height > 0;

  const show = (sc: Screen) => {
    lastScreens.set(terminal.id, sc);
    setScreen(sc);
  };

  /* Emulated screen: long poll, each answer arrives as soon as the terminal changes. */
  useEffect(() => {
    if (!live || !ready || mode !== "emulated") return;
    let stopped = false;
    let version: number | undefined;
    const loop = async () => {
      let failures = 0;
      while (!stopped) {
        try {
          const res = await screenRpc({
            terminalId: terminal.id,
            since: version,
            waitMs: 10_000,
            rows: sizeRef.current.rows,
            cols: sizeRef.current.cols,
            scroll: scrollRef.current,
          });
          if (stopped) return;
          failures = 0;
          version = res.version;
          if (!("unchanged" in res)) {
            show(res);
            setError(null);
            if (res.exited) {
              // Session ended: the app turns this tab into "Session terminée".
              onGone?.();
              return;
            }
          }
        } catch (err) {
          if (stopped) return;
          if (/not found|introuvable/i.test(errorMessage(err))) {
            onGone?.();
            return;
          }
          failures += 1;
          if (version === undefined && failures >= 2) {
            // No emulator on this host: plain capture instead.
            setError(errorMessage(err));
            setMode("capture");
            return;
          }
          if (failures >= 3) onGone?.();
          await new Promise((r) => setTimeout(r, 400 * failures));
        }
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }, [live, ready, mode, terminal.id]);

  /* Size or scroll position changed: ask now (this also wakes the long poll). */
  useEffect(() => {
    if (!live || !ready || mode !== "emulated" || !screenRef.current) return;
    const timer = setTimeout(() => {
      void screenRpc({ terminalId: terminal.id, rows: size.rows, cols: size.cols, scroll })
        .then((res) => {
          if (!("unchanged" in res)) show(res);
        })
        .catch(() => undefined);
    }, scroll ? 0 : 120);
    return () => clearTimeout(timer);
  }, [size.rows, size.cols, scroll]);

  /* Fallback: plain capture polling. */
  useEffect(() => {
    if (!live || !ready || mode !== "capture") return;
    let stopped = false;
    const tick = async () => {
      try {
        const lines = await readScreen(handle, sizeRef.current.rows);
        if (!stopped) show(plainScreen(lines, sizeRef.current.rows, sizeRef.current.cols));
      } catch (err) {
        if (!stopped) setError(errorMessage(err));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 400);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [live, ready, mode, terminal.id, refreshSignal]);

  useEffect(() => {
    if (active && interactive) setTimeout(() => input.current?.focus(), 50);
  }, [active, interactive, terminal.id]);

  const send = (data: string) => {
    if (scrollRef.current) setScroll(0);
    try {
      handle.write(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const paste = (text: string) => {
    if (!text) return;
    const data = text.replace(/\r?\n/g, "\r");
    send(screenRef.current?.bracketedPaste ? `\x1b[200~${data}\x1b[201~` : data);
  };

  const pasteClipboard = async () => {
    const text = await readClipboard();
    if (text === null) toast.show("Le navigateur bloque la lecture du presse-papiers : utilisez Ctrl+V.", { variant: "warning" });
    else paste(text);
    input.current?.focus();
  };

  /* ---------------- mouse ---------------- */
  const cellAt = (e: MouseLike): { x: number; y: number } | null => {
    const el = box.current as unknown as { getBoundingClientRect?: () => DomRect } | null;
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return null;
    const x = Math.floor((e.clientX - rect.left - PAD) / charWidth);
    const y = Math.floor((e.clientY - rect.top - PAD) / lh);
    const sc = screenRef.current;
    if (!sc) return null;
    return { x: Math.max(0, Math.min(sc.cols - 1, x)), y: Math.max(0, Math.min(sc.rows - 1, y)) };
  };
  /** The program wants the mouse, and Shift is not held (Shift = local selection, as in xterm). */
  const reporting = (e: MouseLike) => interactive && !!screenRef.current && screenRef.current.mouse !== "none" && !e.shiftKey;
  const sendMouse = (e: MouseLike, action: "down" | "up" | "move" | "wheel-up" | "wheel-down") => {
    const cell = cellAt(e);
    if (!cell) return;
    if (action === "move") {
      const key = `${cell.x},${cell.y}`;
      if (key === lastCell.current) return;
      lastCell.current = key;
    }
    void mouseRpc({ terminalId: terminal.id, ...cell, button: e.button, action, alt: e.altKey, ctrl: e.ctrlKey }).catch(() => undefined);
  };

  const mouseHandlers = webProps({
    onMouseDown: (e: MouseLike) => {
      if (reporting(e)) {
        e.preventDefault();
        sendMouse(e, "down");
        input.current?.focus();
      }
    },
    onMouseUp: (e: MouseLike) => {
      if (reporting(e)) {
        e.preventDefault();
        sendMouse(e, "up");
        return;
      }
      if (e.button === 0 && copyOnSelect) {
        setTimeout(() => {
          const text = selectionText();
          if (text.trim()) void copyText(text).catch(() => undefined);
        }, 0);
      }
    },
    onMouseMove: (e: MouseLike) => {
      if (!reporting(e)) return;
      const mode = screenRef.current?.mouse;
      if (mode === "any" || (mode === "drag" && (e.buttons ?? 0) > 0)) sendMouse(e, "move");
    },
    onContextMenu: (e: MouseLike) => {
      if (reporting(e)) {
        e.preventDefault();
        return;
      }
      if (rightClickPaste && interactive) {
        e.preventDefault();
        void pasteClipboard();
      }
    },
    onAuxClick: (e: MouseLike) => {
      if (e.button === 1 && interactive && !reporting(e)) {
        e.preventDefault();
        void pasteClipboard();
      }
    },
    onWheel: (e: MouseLike) => {
      const dy = e.deltaY ?? 0;
      if (!dy) return;
      if (e.ctrlKey && onZoom) {
        onZoom(dy < 0 ? 1 : -1);
        return;
      }
      const sc = screenRef.current;
      if (!sc || !interactive) return;
      if (reporting(e)) {
        sendMouse(e, dy < 0 ? "wheel-up" : "wheel-down");
        return;
      }
      const lines = Math.max(1, Math.min(10, Math.round(Math.abs(dy) / 40))) * 1;
      if (sc.alternate) {
        // Full-screen program without mouse support: the wheel moves like the arrows (less, man...).
        const key = dy < 0 ? (sc.appCursor ? "\x1bOA" : "\x1b[A") : sc.appCursor ? "\x1bOB" : "\x1b[B";
        handle.write(key.repeat(lines));
        return;
      }
      setScroll((cur) => Math.max(0, Math.min(sc.maxScroll, cur + (dy < 0 ? lines * 3 : -lines * 3))));
    },
    onClick: () => {
      if (hasTextSelection()) return;
      if (onPressArea) onPressArea();
      else input.current?.focus();
    },
  });

  const cur = screen?.cursor;
  const cursorSolid = !interactive || focused;

  const screenView = (
    <View
      ref={box}
      {...MONO_SURFACE}
      style={{ flex: 1, backgroundColor: s.x.termBg, padding: PAD, overflow: "hidden" }}
      onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      {...(touch
        ? webProps({
            // Mobile browsers: a tap arrives as a click; it opens the keyboard (unless it was a swipe).
            onClick: () => {
              if (swipe.current.moved || hasTextSelection()) return;
              if (onPressArea) onPressArea();
              else mobileInput.current?.focus();
            },
          })
        : mouseHandlers)}
      onStartShouldSetResponder={() => touch || Platform.OS !== "web"}
      onResponderGrant={(e) => {
        swipe.current = { y: e.nativeEvent.pageY, acc: 0, moved: false };
      }}
      onResponderMove={(e) => {
        if (!touch) return;
        const sw = swipe.current;
        const dy = e.nativeEvent.pageY - sw.y;
        sw.y = e.nativeEvent.pageY;
        sw.acc += dy;
        if (Math.abs(sw.acc) > 6) sw.moved = true;
        const lines = Math.trunc(sw.acc / lh);
        if (!lines) return;
        sw.acc -= lines * lh;
        scrollBy(lines);
      }}
      onResponderRelease={() => {
        if (touch && swipe.current.moved) return;
        if (onPressArea) onPressArea();
        else (touch ? mobileInput : input).current?.focus();
      }}
    >
      <Text
        style={{ position: "absolute", opacity: 0, fontFamily: MONO, fontSize }}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width / 40;
          if (w > 3 && Math.abs(w - charWidth) > 0.05) setCharWidth(w);
        }}
      >
        {"M".repeat(40)}
      </Text>
      {screen ? <ScreenLines s={s} screen={screen} fontSize={fontSize} /> : null}
      {cur && cur.visible && !scroll ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: PAD + cur.x * charWidth,
            top: PAD + cur.y * lh + 1,
            width: Math.max(5, charWidth),
            height: lh - 2,
            backgroundColor: cursorSolid ? CURSOR : "transparent",
            borderWidth: 1,
            borderColor: CURSOR,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cursorSolid && cur.ch.trim() ? (
            <Text style={{ fontFamily: MONO, fontSize, lineHeight: lh - 2, color: s.x.termBg }}>{cur.ch}</Text>
          ) : null}
        </View>
      ) : null}
      {found && screen && !screen.alternate
        ? found.matches.map((m, i) => {
            const top = screen.maxScroll - screen.scroll;
            const y = m.line - top;
            if (y < 0 || y >= screen.rows) return null;
            return (
              <View
                key={`${m.line}:${m.col}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: PAD + m.col * charWidth,
                  top: PAD + y * lh,
                  width: Math.max(4, m.len * charWidth),
                  height: lh,
                  backgroundColor: i === current ? "rgba(255, 150, 0, 0.55)" : "rgba(255, 230, 0, 0.28)",
                  borderWidth: i === current ? 1 : 0,
                  borderColor: "#ff9600",
                }}
              />
            );
          })
        : null}
      {searchOpen ? (
        <View
          {...webProps({
            // Clicks here belong to the search bar, not to the terminal below.
            onClick: (e: MouseLike) => e.stopPropagation?.(),
            onMouseDown: (e: MouseLike) => e.stopPropagation?.(),
            onMouseUp: (e: MouseLike) => e.stopPropagation?.(),
            onContextMenu: (e: MouseLike) => e.stopPropagation?.(),
          })}
          style={{
            position: "absolute",
            top: 34,
            right: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 6,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: s.c.border,
            backgroundColor: s.c.surface1,
          }}
        >
          <Icon name="Search" size={14} color={s.c.foregroundMuted} />
          <TextInput
            ref={searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher..."
            placeholderTextColor={s.c.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            onKeyPress={(e) => {
              const ev = e as unknown as KeyEventLike;
              const { key, shiftKey } = ev.nativeEvent;
              if (key === "Escape") {
                ev.preventDefault?.();
                closeSearch();
              } else if (key === "Enter") {
                ev.preventDefault?.();
                // Enter: previous (older) match, Shift+Enter: next, as in a terminal history.
                jumpTo(shiftKey ? current + 1 : current - 1);
              }
            }}
            style={{ width: 180, color: s.c.foreground, fontSize: 12, paddingVertical: 2, paddingHorizontal: 4, borderWidth: 0 }}
          />
          <Text style={{ color: s.c.foregroundMuted, fontSize: 11, minWidth: 44, textAlign: "center" }}>
            {query ? (found?.matches.length ? `${current + 1}/${found.matches.length}` : "0") : ""}
          </Text>
          <Text
            onPress={() => setCaseSensitive(!caseSensitive)}
            style={{ color: caseSensitive ? s.c.accent : s.c.foregroundMuted, fontSize: 12, fontWeight: "700", paddingHorizontal: 4 }}
          >
            Aa
          </Text>
          <Text onPress={() => jumpTo(current - 1)} style={{ color: s.c.foreground, fontSize: 13, paddingHorizontal: 3 }}>
            {"↑"}
          </Text>
          <Text onPress={() => jumpTo(current + 1)} style={{ color: s.c.foreground, fontSize: 13, paddingHorizontal: 3 }}>
            {"↓"}
          </Text>
          <Text onPress={closeSearch} style={{ color: s.c.foregroundMuted, fontSize: 13, paddingHorizontal: 3 }}>
            {"✕"}
          </Text>
        </View>
      ) : null}
      {scroll && screen && !searchOpen ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", right: 10, bottom: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: s.c.surface2, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: s.c.border }}
        >
          <Text style={{ color: s.c.foreground, fontSize: 11 }}>
            Historique : -{screen.scroll} / {screen.maxScroll} lignes
          </Text>
          <Text onPress={() => setScroll(0)} style={{ color: s.x.blue, fontSize: 11, fontWeight: "600" }}>
            Revenir en bas
          </Text>
        </View>
      ) : null}
      {error && mode === "capture" && !screen ? <Text style={{ color: s.x.red, fontFamily: MONO, fontSize: 12 }}>{error}</Text> : null}
      {interactive && !touch ? (
        <TextInput
          ref={input}
          value={buffer}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyPress={(e) => {
            const ev = e as unknown as KeyEventLike;
            const { key, ctrlKey, shiftKey } = ev.nativeEvent;
            // Local shortcuts: search, zoom and history, as in MobaXterm.
            if (ctrlKey && shiftKey && (key === "F" || key === "f")) {
              ev.preventDefault?.();
              openSearch();
              return;
            }
            if (ctrlKey && onZoom && (key === "+" || key === "=" || key === "-")) {
              ev.preventDefault?.();
              onZoom(key === "-" ? -1 : 1);
              return;
            }
            if (shiftKey && (key === "PageUp" || key === "PageDown") && screenRef.current && !screenRef.current.alternate) {
              ev.preventDefault?.();
              const page = Math.max(1, sizeRef.current.rows - 1);
              const max = screenRef.current.maxScroll;
              setScroll((c) => Math.max(0, Math.min(max, c + (key === "PageUp" ? page : -page))));
              return;
            }
            const data = keyToData(ev, { appCursor: screenRef.current?.appCursor });
            if (data !== null) {
              ev.preventDefault?.();
              send(data);
            }
          }}
          onChangeText={(value) => {
            // Web: only pastes reach here (keys are sent by onKeyPress). Native: typed text.
            if (value) {
              if (Platform.OS === "web" || value.length > 1) paste(value);
              else send(value);
            }
            setBuffer("");
          }}
          onSubmitEditing={() => Platform.OS !== "web" && send("\r")}
          submitBehavior="submit"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Saisie du terminal"
          style={
            Platform.OS === "web"
              ? { position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0 }
              : {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 36,
                  color: s.x.termFg,
                  backgroundColor: s.c.surface2,
                  paddingHorizontal: 8,
                }
          }
        />
      ) : null}
    </View>
  );

  if (!touch || !interactive) return screenView;
  return (
    <View style={{ flex: 1 }}>
      {screenView}
      <MobileKeys
        s={s}
        keyboardOpen={focused}
        onToggleKeyboard={() => (focused ? mobileInput.current?.blur() : mobileInput.current?.focus())}
        ctrl={ctrlOn}
        alt={altOn}
        appCursor={!!screen?.appCursor}
        onKey={(data) => {
          send(data);
          if (focused) mobileInput.current?.focus();
        }}
        onToggleCtrl={() => setCtrlOn(!ctrlOn)}
        onToggleAlt={() => setAltOn(!altOn)}
        onPaste={() => void pasteClipboard()}
        onZoom={onZoom}
        onSearch={openSearch}
      />
      <TextInput
        ref={mobileInput}
        value={mobileBuf}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(v) => {
          // The field always holds an invisible marker: removing it is a Backspace (soft keyboards
          // often send no usable key event), anything after it is typed text.
          if (!v.startsWith(MARK)) send("\x7f");
          else {
            const typed = v.slice(MARK.length);
            if (typed) sendTyped(typed);
          }
          setMobileBuf(MARK);
        }}
        onKeyPress={(e) => {
          // Hardware keyboard on a tablet: arrows, Esc, Tab... (letters and Backspace come through onChangeText).
          const ev = e as unknown as KeyEventLike;
          const { key } = ev.nativeEvent;
          if (key === "Backspace" || key === "Enter" || key.length === 1 || key === "Unidentified") return;
          const data = keyToData(ev, { appCursor: screenRef.current?.appCursor });
          if (data !== null) {
            ev.preventDefault?.();
            send(data);
          }
        }}
        onSubmitEditing={() => send("\r")}
        submitBehavior="submit"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        placeholder="Toucher ici pour taper"
        placeholderTextColor={s.c.foregroundMuted}
        accessibilityLabel="Saisie du terminal"
        // Invisible: it only receives the keyboard (a tap on the terminal or the keyboard key focuses it).
        // fontSize 16 keeps iOS from zooming the page when it gets the focus.
        style={{ position: "absolute", left: 0, bottom: 0, width: 2, height: 2, opacity: 0, fontSize: 16, color: "transparent" }}
      />
    </View>
  );
}
