import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { AppState, Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";

/**
 * Whether the SSH view is on screen. Paseo keeps a plugin screen mounted (detached from the page)
 * after you navigate elsewhere, so its polling would go on forever: monitoring scripts on the
 * servers, terminal long polls, status checks. Every periodic task reads this and pauses.
 */
export const VisibleContext = createContext(true);

export function useVisible(): boolean {
  return useContext(VisibleContext);
}

interface DomLike {
  isConnected?: boolean;
  checkVisibility?: () => boolean;
  offsetParent?: unknown;
}
declare const document: { visibilityState?: string; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } | undefined;

function webVisible(el: DomLike | null): boolean {
  if (!el) return true;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (el.isConnected === false) return false;
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  return el.offsetParent !== null;
}

/** Visibility of the element behind `ref` (web), or of the app (native). */
export function useRootVisibility(ref: RefObject<unknown>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS !== "web") {
      const sub = AppState.addEventListener("change", (state) => setVisible(state === "active"));
      return () => sub.remove();
    }
    const check = () => setVisible(webVisible(ref.current as DomLike | null));
    check();
    const timer = setInterval(check, 1000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return visible;
}

/* ------------------------------------------------------------------ */
/* Soft keyboard                                                       */
/* ------------------------------------------------------------------ */

interface MeasurableView {
  measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  getBoundingClientRect?: () => { bottom: number };
}
declare const window:
  | { innerHeight: number; visualViewport?: { height: number; offsetTop: number; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void } }
  | undefined;

/**
 * Height of the bottom of the view hidden by the on-screen keyboard. Paseo does not move plugin
 * screens out of the keyboard's way, so the SSH view adds this much space at its bottom (the
 * typing bar and the keys row then stay visible above the keyboard).
 */
export function useKeyboardOverlap(ref: RefObject<unknown>): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") {
      const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
      if (!vv) return;
      const update = () => {
        const el = ref.current as MeasurableView | null;
        const bottom = el?.getBoundingClientRect?.().bottom ?? 0;
        // Only a real keyboard (more than a toolbar's worth of hidden page).
        const hidden = bottom - (vv.offsetTop + vv.height);
        setOverlap(hidden > 80 ? Math.round(hidden) : 0);
      };
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
      return () => {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      };
    }
    const show = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY || Dimensions.get("window").height - e.endCoordinates.height;
      const el = ref.current as MeasurableView | null;
      if (el?.measureInWindow) {
        el.measureInWindow((_x, y, _w, h) => setOverlap(Math.max(0, Math.round(y + h - top))));
      } else setOverlap(e.endCoordinates.height);
    };
    const hide = () => setOverlap(0);
    const subs = [
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", show),
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame", show),
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", hide),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  return overlap;
}
