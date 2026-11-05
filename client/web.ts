import { Platform } from "react-native";
import { askConfirm } from "./confirm";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface DomBlob {
  readonly size: number;
}
interface DomFile extends DomBlob {
  readonly name: string;
  slice(start: number, end: number): DomBlob & { arrayBuffer(): Promise<ArrayBuffer> };
}
interface DomElement {
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  click(): void;
  remove(): void;
  href?: string;
  download?: string;
  type?: string;
  multiple?: boolean;
  files?: { length: number; [index: number]: DomFile } | null;
  onchange?: (() => void) | null;
}
declare const window: {
  open(url: string, target: string, features: string): unknown;
  setTimeout(fn: () => void, ms: number): unknown;
  getSelection?: () => { toString(): string } | null;
  matchMedia?: (query: string) => { matches: boolean };
};
declare const document: {
  createElement(tag: string): DomElement;
  body: { appendChild(el: DomElement): void };
};
declare const URL: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
declare const Blob: new (parts: unknown[], options?: { type?: string }) => DomBlob;
declare const Notification:
  | (new (title: string, options?: { body?: string; tag?: string }) => unknown) & {
      permission?: string;
      requestPermission?: () => Promise<string>;
    }
  | undefined;
declare const navigator: { clipboard?: { readText?: () => Promise<string> } } | undefined;
declare function atob(data: string): string;
declare function btoa(data: string): string;

export type PickedFile = DomFile;

export const isWeb = Platform.OS === "web";

/** True when the user has selected text on the page (so a click must not steal it). */
export function hasTextSelection(): boolean {
  if (!isWeb || typeof window.getSelection !== "function") return false;
  const sel = window.getSelection();
  return !!sel && sel.toString().length > 0;
}

/** Selected text on the page (web), with non-breaking spaces turned back into spaces. */
export function selectionText(): string {
  if (!isWeb || typeof window.getSelection !== "function") return "";
  return (window.getSelection()?.toString() ?? "").replace(/\u00a0/g, " ");
}

/** Clipboard text (web). Null when the browser refuses (permission, insecure context). */
export async function readClipboard(): Promise<string | null> {
  try {
    if (!isWeb || typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** Confirmation through the plugin's own dialog (never window.confirm: it breaks text input in Paseo desktop). */
/** Desktop notification (Paseo desktop / browser), when allowed. */
export function notify(title: string, body: string): void {
  try {
    if (!isWeb || typeof Notification === "undefined") return;
    if (Notification.permission === "granted") new Notification(title, { body, tag: "ssh-manager" });
  } catch {
    /* notifications unavailable */
  }
}

/** Ask for the notification permission (call it from a user action). */
export function askNotificationPermission(): void {
  try {
    if (isWeb && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission?.();
  } catch {
    /* ignore */
  }
}

/** Phone / tablet (native app, or a browser whose main pointer is a finger). */
export function isTouchDevice(): boolean {
  if (!isWeb) return true;
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function confirmAction(title: string, message: string, destructiveLabel = "Confirmer"): Promise<boolean> {
  return askConfirm(title, message, destructiveLabel);
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(bin);
}

/** Save bytes as a browser download. Web only. */
export function saveDownload(name: string, parts: Uint8Array[]): void {
  const blob = new Blob(parts, { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}

/** Open the browser file picker. Web only. */
export function pickFiles(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.onchange = () => {
      const list = input.files;
      const files: PickedFile[] = [];
      if (list) for (let i = 0; i < list.length; i += 1) files.push(list[i]!);
      input.remove();
      resolve(files);
    };
    document.body.appendChild(input);
    input.click();
  });
}
