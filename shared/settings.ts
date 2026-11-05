import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-scoped preferences shared by every client of this daemon. */
export const prefsSettings = defineSettings({
  id: "prefs",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Workspace that receives terminals opened from the SSH page. Empty: the home directory workspace. */
    workspaceId: z.string().default(""),
    /** Seconds between two monitoring refreshes. */
    monitorInterval: z.number().int().min(2).max(120).default(5),
    /** "mobaxterm": MobaXterm dark look. "paseo": follow the Paseo theme. */
    appearance: z.enum(["mobaxterm", "paseo"]).default("mobaxterm"),
    /** MobaXterm's "Remote monitoring" checkbox: show the status bar. */
    remoteMonitoring: z.boolean().default(true),
    /** MobaXterm's "Follow terminal folder": the Sftp browser follows the active terminal's directory. */
    followTerminal: z.boolean().default(false),
    /** Width of the left panel (sessions / Sftp), in pixels. */
    sidebarWidth: z.number().int().min(200).max(1600).default(360),
    /** Terminal font size (Ctrl + wheel, Ctrl + / Ctrl -). */
    terminalFontSize: z.number().int().min(8).max(28).default(13),
    /** MobaXterm defaults: copy on select, right click pastes. */
    copyOnSelect: z.boolean().default(true),
    rightClickPaste: z.boolean().default(true),
    /** Ask "Close this session?" before closing a terminal tab. */
    confirmClose: z.boolean().default(true),
  }),
});
