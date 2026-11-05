import type { PaseoApi, PaseoTerminal } from "./paseo-types";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { terminalCwdRpc } from "../shared/rpc";
import { selectionStore } from "./util";

/** "user@server:~/projects$ " -> "~/projects" (Debian / Ubuntu default prompt). */
export function promptPath(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trimEnd();
    if (!line) continue;
    const m = line.match(/^(?:\([^)]*\)\s*)?[^\s@]+@[^\s:]+:(~[^$#]*|\/[^$#]*?)\s*[$#]/);
    return m ? m[1]!.trim() : null;
  }
  return null;
}

export type FollowState = "off" | "proc" | "prompt" | "unknown";

/**
 * MobaXterm's "Follow terminal folder": while enabled, the Sftp browser of `serverId` moves to the
 * directory of the active terminal's shell. The daemon finds the shell through the marker variable
 * the terminal was opened with; when the server refuses it, the prompt is read instead.
 */
export function useFollowTerminal(paseo: PaseoApi, terminal: PaseoTerminal | null, serverId: string | null, enabled: boolean): FollowState {
  const cwdRpc = useRpc(terminalCwdRpc);
  const [state, setState] = useState<FollowState>("off");
  useEffect(() => {
    if (!enabled || !terminal || !serverId) {
      setState("off");
      return;
    }
    let stopped = false;
    let busy = false;
    let last = "";
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        let cwd: string | null = null;
        let how: FollowState = "unknown";
        try {
          cwd = (await cwdRpc({ terminalId: terminal.id })).cwd;
          if (cwd) how = "proc";
        } catch {
          /* fall back to the prompt */
        }
        if (!cwd) {
          try {
            const cap = await paseo.terminals.ref(terminal).capture({ start: -6, stripAnsi: true });
            cwd = promptPath(cap.lines);
            if (cwd) how = "prompt";
          } catch {
            /* terminal gone */
          }
        }
        if (stopped) return;
        setState(how);
        if (!cwd || cwd === last) return;
        last = cwd;
        const path = cwd;
        selectionStore.set((p) => (p.filePaths[serverId] === path ? p : { ...p, filePaths: { ...p.filePaths, [serverId]: path } }));
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, terminal?.id, serverId]);
  return state;
}
