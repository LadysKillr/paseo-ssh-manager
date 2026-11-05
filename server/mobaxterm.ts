import { existsSync, readFileSync } from "node:fs";
import { expandHome } from "./ssh";
import type { StoredServer } from "./store";

/**
 * MobaXterm stores sessions in MobaXterm.ini ([Bookmarks], [Bookmarks_1]...) and in exported
 * .mxtsessions files, with the same format:
 *
 *   [Bookmarks_1]
 *   SubRep=Prod\Web
 *   ImgNum=41
 *   web-01=#109#0%192.168.1.10%22%admin%%-1%-1%%%22%%0%0%0%_ProfileDir_\.ssh\id_rsa%%-1%...#MobaFont%...
 *
 * After "#<icon>#", the first "#"-separated block holds "%"-separated connection fields:
 * 0 type (0 SSH, 7 SFTP...), 1 host, 2 port, 3 user, 8/9/10 SSH gateway host/port/user, 14 private key.
 */

const TYPES: Record<string, string> = {
  "0": "SSH",
  "1": "Telnet",
  "2": "Rsh",
  "3": "Xdmcp",
  "4": "RDP",
  "5": "VNC",
  "6": "FTP",
  "7": "SFTP",
  "8": "Serial",
  "9": "File",
  "10": "Shell",
  "11": "Browser",
  "12": "Mosh",
  "13": "AWS S3",
  "14": "WSL",
};

export interface MobaSession {
  key: string;
  name: string;
  group: string;
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  jumpHost?: string;
  kind: string;
  warning?: string;
  alreadyImported: boolean;
}

function decode(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  // MobaXterm.ini is usually ANSI (Windows-1252): fall back when the bytes are not valid UTF-8.
  if (text.includes("�")) text = buffer.toString("latin1");
  return text.replace(/^﻿/, "");
}

function convertKey(raw: string): { path?: string; warning?: string } {
  const value = raw.trim();
  if (!value || !/[\\/]/.test(value)) return {};
  if (/\.ppk$/i.test(value)) {
    return { warning: `Clé PuTTY non reprise (${value}) : importez le fichier .ppk dans l'onglet Clés, il sera converti puis associable à la session.` };
  }
  let path = value.replace(/_ProfileDir_/g, "~").replace(/_CurrentDrive_:/g, "");
  if (path.startsWith("~")) return { path: path.replace(/\\/g, "/") };
  if (/^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
    return { warning: `Clé Windows non reprise (${value}) : importez-la dans l'onglet Clés puis associez-la à la session.` };
  }
  return { path: expandHome(path) };
}

export function parseMoba(buffer: Buffer, existing: StoredServer[]) {
  const text = decode(buffer);
  const sessions: MobaSession[] = [];
  const skipped: Record<string, number> = {};
  let inBookmarks = false;
  let group = "";
  const seen = new Set(existing.map((s) => `${s.user ?? ""}@${s.host}:${s.port ?? 22}`));

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/i.test(section[1]!);
      group = "";
      continue;
    }
    if (!inBookmarks) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key === "SubRep") {
      group = value
        .split("\\")
        .map((p) => p.trim())
        .filter(Boolean)
        .join("/");
      continue;
    }
    if (key === "ImgNum") continue;
    const m = value.match(/^#(\d+)#(.*)$/);
    if (!m) continue;
    const fields = m[2]!.split("#")[0]!.split("%");
    const type = fields[0] ?? "";
    if (type !== "0" && type !== "7") {
      const label = TYPES[type] ?? `type ${type}`;
      skipped[label] = (skipped[label] ?? 0) + 1;
      continue;
    }
    const host = (fields[1] ?? "").trim();
    if (!host) continue;
    const port = Number(fields[2]) || undefined;
    const user = (fields[3] ?? "").trim() || undefined;
    const gwHost = (fields[8] ?? "").trim();
    const gwPort = Number(fields[9]) || 22;
    const gwUser = (fields[10] ?? "").trim();
    const jumpHost = gwHost ? `${gwUser ? `${gwUser}@` : ""}${gwHost}${gwPort !== 22 ? `:${gwPort}` : ""}` : undefined;
    const keyInfo = convertKey(fields[14] ?? "");
    sessions.push({
      key: `${group}/${key}/${sessions.length}`,
      name: key,
      group,
      host,
      port: port && port !== 22 ? port : undefined,
      user,
      identityFile: keyInfo.path,
      jumpHost,
      kind: TYPES[type]!,
      warning: keyInfo.warning,
      alreadyImported: seen.has(`${user ?? ""}@${host}:${port ?? 22}`),
    });
  }
  return {
    sessions,
    skipped: Object.entries(skipped).map(([kind, count]) => ({ kind, count })),
  };
}

export function readMobaSource(input: { base64?: string; path?: string; text?: string }): Buffer {
  if (input.base64) return Buffer.from(input.base64, "base64");
  if (input.text) return Buffer.from(input.text, "utf8");
  if (input.path) {
    const path = expandHome(input.path.trim());
    if (!existsSync(path)) throw new Error(`Fichier introuvable sur l'hôte Paseo : ${path}`);
    return readFileSync(path);
  }
  throw new Error("Aucun fichier fourni");
}
