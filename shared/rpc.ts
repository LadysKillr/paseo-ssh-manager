import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Servers                                                             */
/* ------------------------------------------------------------------ */

export const ServerInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().optional(),
  group: z.string().optional(),
  identityFile: z.string().optional(),
  jumpHost: z.string().optional(),
  startDir: z.string().optional(),
  /** Command run once logged in, then the shell (MobaXterm "Execute command"). */
  startCommand: z.string().optional(),
  extraArgs: z.string().optional(),
  color: z.string().optional(),
  /** Record every terminal of this session in a log file. */
  logSession: z.boolean().optional(),
  /** Restart the session by itself when it drops (MobaXterm-like). */
  autoReconnect: z.boolean().optional(),
  /** undefined: keep the stored password, "": remove it, other: replace it. */
  password: z.string().optional(),
});
export type ServerInput = z.infer<typeof ServerInputSchema>;

export const ServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().optional(),
  user: z.string().optional(),
  group: z.string().optional(),
  identityFile: z.string().optional(),
  jumpHost: z.string().optional(),
  startDir: z.string().optional(),
  startCommand: z.string().optional(),
  extraArgs: z.string().optional(),
  color: z.string().optional(),
  /** Record every terminal of this session in a log file. */
  logSession: z.boolean().optional(),
  /** Restart the session by itself when it drops (MobaXterm-like). */
  autoReconnect: z.boolean().optional(),
  lastUsed: z.number().optional(),
  hasPassword: z.boolean(),
});
export type Server = z.infer<typeof ServerSchema>;

export const serversListRpc = defineRpc({
  name: "servers.list",
  input: z.object({}),
  output: z.object({ servers: z.array(ServerSchema), dataDir: z.string() }),
});

export const serversSaveRpc = defineRpc({
  name: "servers.save",
  input: ServerInputSchema,
  output: z.object({ server: ServerSchema }),
});

export const serversDeleteRpc = defineRpc({
  name: "servers.delete",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

export const ImportCandidateSchema = z.object({
  alias: z.string(),
  hostName: z.string().optional(),
  user: z.string().optional(),
  port: z.number().optional(),
  identityFile: z.string().optional(),
  jumpHost: z.string().optional(),
  alreadyImported: z.boolean(),
});
export type ImportCandidate = z.infer<typeof ImportCandidateSchema>;

export const sshConfigScanRpc = defineRpc({
  name: "servers.scan-ssh-config",
  input: z.object({}),
  output: z.object({ candidates: z.array(ImportCandidateSchema) }),
});

export const sshConfigImportRpc = defineRpc({
  name: "servers.import-ssh-config",
  input: z.object({ aliases: z.array(z.string()), group: z.string().optional() }),
  output: z.object({ imported: z.number() }),
});

export const MobaSessionSchema = z.object({
  key: z.string(),
  name: z.string(),
  group: z.string(),
  host: z.string(),
  port: z.number().optional(),
  user: z.string().optional(),
  identityFile: z.string().optional(),
  jumpHost: z.string().optional(),
  kind: z.string(),
  warning: z.string().optional(),
  alreadyImported: z.boolean(),
});
export type MobaSession = z.infer<typeof MobaSessionSchema>;

/** Read MobaXterm.ini or an exported .mxtsessions file (uploaded, pasted, or a path on the Paseo host). */
export const mobaParseRpc = defineRpc({
  name: "servers.moba-parse",
  input: z.object({ base64: z.string().optional(), text: z.string().optional(), path: z.string().optional() }),
  output: z.object({
    sessions: z.array(MobaSessionSchema),
    skipped: z.array(z.object({ kind: z.string(), count: z.number() })),
  }),
});

export const mobaImportRpc = defineRpc({
  name: "servers.moba-import",
  input: z.object({ sessions: z.array(MobaSessionSchema), groupPrefix: z.string().optional() }),
  output: z.object({ imported: z.number() }),
});

export const StatusSchema = z.object({
  id: z.string(),
  reachable: z.boolean(),
  latencyMs: z.number().nullable(),
  connected: z.boolean(),
  error: z.string().nullable(),
});
export type ServerStatus = z.infer<typeof StatusSchema>;

export const serversStatusRpc = defineRpc({
  name: "servers.status",
  input: z.object({ ids: z.array(z.string()).optional() }),
  output: z.object({ statuses: z.array(StatusSchema) }),
});

export const serversDisconnectRpc = defineRpc({
  name: "servers.disconnect",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

export const terminalCommandRpc = defineRpc({
  name: "terminal.command",
  input: z.object({
    id: z.string().optional(),
    /** Quick connect: "user@host:port" when no id is given. */
    quick: z.string().optional(),
    startDir: z.string().optional(),
  }),
  output: z.object({
    command: z.string(),
    args: z.array(z.string()),
    name: z.string(),
    sessionsDir: z.string(),
    /** Marker of the remote shell; send it back with terminal.register once the terminal exists. */
    tag: z.string(),
  }),
});

export const terminalRegisterRpc = defineRpc({
  name: "terminal.register",
  input: z.object({ terminalId: z.string(), serverId: z.string(), tag: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

/** Terminal id -> session id, for terminals opened by the plugin. */
export const terminalRegistryRpc = defineRpc({
  name: "terminal.registry",
  input: z.object({}),
  output: z.object({ terminals: z.record(z.string(), z.string()), labels: z.record(z.string(), z.string()) }),
});

/** Current directory of the remote shell of a terminal ("Follow terminal folder"). */
export const terminalCwdRpc = defineRpc({
  name: "terminal.cwd",
  input: z.object({ terminalId: z.string() }),
  output: z.object({ cwd: z.string().nullable() }),
});

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export const FileEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "dir", "link", "other"]),
  /** For links: true when the target is a directory. */
  linkDir: z.boolean(),
  linkTarget: z.string(),
  size: z.number(),
  mtime: z.number(),
  mode: z.string(),
  owner: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const filesListRpc = defineRpc({
  name: "files.list",
  input: z.object({ id: z.string(), path: z.string() }),
  output: z.object({ path: z.string(), entries: z.array(FileEntrySchema) }),
});

export const filesReadTextRpc = defineRpc({
  name: "files.read-text",
  input: z.object({ id: z.string(), path: z.string() }),
  output: z.object({ text: z.string(), size: z.number(), binary: z.boolean() }),
});

export const filesWriteTextRpc = defineRpc({
  name: "files.write-text",
  input: z.object({ id: z.string(), path: z.string(), text: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

export const filesActionRpc = defineRpc({
  name: "files.action",
  input: z.discriminatedUnion("action", [
    z.object({ action: z.literal("mkdir"), id: z.string(), path: z.string() }),
    z.object({ action: z.literal("touch"), id: z.string(), path: z.string() }),
    z.object({ action: z.literal("delete"), id: z.string(), paths: z.array(z.string()) }),
    z.object({ action: z.literal("rename"), id: z.string(), from: z.string(), to: z.string() }),
    z.object({ action: z.literal("chmod"), id: z.string(), path: z.string(), mode: z.string() }),
    z.object({ action: z.literal("copy"), id: z.string(), from: z.string(), to: z.string() }),
  ]),
  output: z.object({ ok: z.boolean() }),
});

export const CHUNK_SIZE = 2 * 1024 * 1024;

export const filesDownloadChunkRpc = defineRpc({
  name: "files.download-chunk",
  input: z.object({ id: z.string(), path: z.string(), offset: z.number(), length: z.number() }),
  output: z.object({ base64: z.string(), size: z.number() }),
});

export const filesUploadChunkRpc = defineRpc({
  name: "files.upload-chunk",
  input: z.object({ id: z.string(), path: z.string(), base64: z.string(), append: z.boolean() }),
  output: z.object({ ok: z.boolean() }),
});

/** Transfers between the Paseo host (local workspace) and the remote server, files or folders. */
export const filesTransferRpc = defineRpc({
  name: "files.transfer",
  input: z.object({
    id: z.string(),
    direction: z.enum(["to-local", "to-remote"]),
    /** Absolute path of the source (local or remote depending on direction). */
    source: z.string(),
    /** Destination directory (local or remote). */
    targetDir: z.string(),
  }),
  output: z.object({ ok: z.boolean(), target: z.string() }),
});

/* ------------------------------------------------------------------ */
/* Exec / monitoring                                                   */
/* ------------------------------------------------------------------ */

export const DiskSchema = z.object({ mount: z.string(), usedPct: z.number(), size: z.number(), used: z.number() });

export const MonitorSchema = z.object({
  hostname: z.string(),
  os: z.string(),
  cpuPct: z.number().nullable(),
  cpuCount: z.number().nullable(),
  load: z.string(),
  memTotal: z.number(),
  memUsed: z.number(),
  swapTotal: z.number(),
  swapUsed: z.number(),
  uptimeSec: z.number(),
  users: z.number(),
  userNames: z.string(),
  rxRate: z.number().nullable(),
  txRate: z.number().nullable(),
  disks: z.array(DiskSchema),
});
export type MonitorData = z.infer<typeof MonitorSchema>;

export const monitorRpc = defineRpc({
  name: "monitor.read",
  input: z.object({ id: z.string() }),
  output: MonitorSchema,
});

/* ------------------------------------------------------------------ */
/* SSH keys (MobaKeyGen-like). Private keys never travel back.         */
/* ------------------------------------------------------------------ */

export const KeyInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  source: z.enum(["plugin", "ssh-dir"]),
  type: z.string(),
  bits: z.number(),
  fingerprint: z.string(),
  comment: z.string(),
  publicKey: z.string(),
  encrypted: z.boolean(),
  passphraseStored: z.boolean(),
  usedBy: z.array(z.string()),
  createdAt: z.number().nullable(),
});
export type KeyInfo = z.infer<typeof KeyInfoSchema>;

export const keysListRpc = defineRpc({
  name: "keys.list",
  input: z.object({}),
  output: z.object({ keys: z.array(KeyInfoSchema), puttygen: z.boolean() }),
});

export const keysImportRpc = defineRpc({
  name: "keys.import",
  input: z.object({
    name: z.string().min(1).max(64),
    /** Key text sent by the client, or... */
    privateKey: z.string().max(65536).optional(),
    /** ...a path on the Paseo host (the key then never travels). */
    path: z.string().optional(),
    passphrase: z.string().optional(),
    rememberPassphrase: z.boolean().optional(),
    comment: z.string().optional(),
  }),
  output: z.object({ key: KeyInfoSchema }),
});

export const keysGenerateRpc = defineRpc({
  name: "keys.generate",
  input: z.object({
    name: z.string().min(1).max(64),
    type: z.enum(["ed25519", "rsa", "ecdsa"]),
    comment: z.string().optional(),
    passphrase: z.string().optional(),
    rememberPassphrase: z.boolean().optional(),
  }),
  output: z.object({ key: KeyInfoSchema }),
});

export const keysDeleteRpc = defineRpc({
  name: "keys.delete",
  /** detach: also clear the key from the sessions that use it. */
  input: z.object({ id: z.string(), detach: z.boolean().optional() }),
  output: z.object({ ok: z.boolean(), detached: z.array(z.string()) }),
});

/** Remember (validated) or forget the passphrase of a key. */
export const keysPassphraseRpc = defineRpc({
  name: "keys.passphrase",
  input: z.object({ id: z.string(), passphrase: z.string().nullable() }),
  output: z.object({ ok: z.boolean() }),
});

export const KeyOpResultSchema = z.object({ id: z.string(), name: z.string(), ok: z.boolean(), message: z.string() });
export type KeyOpResult = z.infer<typeof KeyOpResultSchema>;

export const keysDeployRpc = defineRpc({
  name: "keys.deploy",
  input: z.object({
    id: z.string(),
    serverIds: z.array(z.string()).min(1),
    action: z.enum(["publish", "revoke", "check"]),
    /** publish: use this key for the sessions once it is verified. */
    setAsIdentity: z.boolean().optional(),
  }),
  output: z.object({ results: z.array(KeyOpResultSchema) }),
});

/* ------------------------------------------------------------------ */
/* Terminal screen (xterm emulation on the daemon host)                */
/* ------------------------------------------------------------------ */

/** [text, fg, bg, flags]: fg/bg "" = default, "*" = the other default (inverse video). */
export const RunSchema = z.tuple([z.string(), z.string(), z.string(), z.number()]);
export type Run = z.infer<typeof RunSchema>;

export const ScreenSchema = z.object({
  version: z.number(),
  rows: z.number(),
  cols: z.number(),
  lines: z.array(z.array(RunSchema)),
  cursor: z.object({ x: z.number(), y: z.number(), visible: z.boolean(), ch: z.string() }),
  appCursor: z.boolean(),
  bracketedPaste: z.boolean(),
  alternate: z.boolean(),
  exited: z.boolean(),
  /** Mouse tracking requested by the program (htop, mc, vim with mouse=a...). */
  mouse: z.enum(["none", "x10", "vt200", "drag", "any"]),
  /** Lines scrolled back into the history (0: bottom), and the maximum. */
  scroll: z.number(),
  maxScroll: z.number(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const terminalScreenRpc = defineRpc({
  name: "terminal.screen",
  input: z.object({
    terminalId: z.string(),
    /** Version already shown: the call then waits for the next change (long poll). */
    since: z.number().optional(),
    waitMs: z.number().optional(),
    /** Size of the view: the PTY is resized to it. */
    rows: z.number().optional(),
    cols: z.number().optional(),
    /** Lines to scroll back into the history (mouse wheel, Shift+PageUp). */
    scroll: z.number().optional(),
  }),
  output: z.union([ScreenSchema, z.object({ version: z.number(), unchanged: z.literal(true) })]),
});

export const terminalMouseRpc = defineRpc({
  name: "terminal.mouse",
  input: z.object({
    terminalId: z.string(),
    x: z.number(),
    y: z.number(),
    button: z.number(),
    action: z.enum(["down", "up", "move", "wheel-up", "wheel-down"]),
    shift: z.boolean().optional(),
    alt: z.boolean().optional(),
    ctrl: z.boolean().optional(),
  }),
  output: z.object({ sent: z.boolean() }),
});

export const terminalRenameRpc = defineRpc({
  name: "terminal.rename",
  input: z.object({ terminalId: z.string(), title: z.string().min(1).max(120) }),
  output: z.object({ ok: z.boolean() }),
});

export const terminalSearchRpc = defineRpc({
  name: "terminal.search",
  input: z.object({ terminalId: z.string(), query: z.string().max(500), caseSensitive: z.boolean().optional() }),
  output: z.object({
    matches: z.array(z.object({ line: z.number(), col: z.number(), len: z.number() })),
    baseY: z.number(),
    rows: z.number(),
    alternate: z.boolean(),
  }),
});

/* ------------------------------------------------------------------ */
/* SSH tunnels (MobaSSHTunnel-like)                                    */
/* ------------------------------------------------------------------ */

export const TunnelSchema = z.object({
  id: z.string(),
  name: z.string(),
  serverId: z.string(),
  type: z.enum(["local", "remote", "dynamic"]),
  bindAddress: z.string(),
  bindPort: z.number().int().min(1).max(65535),
  destHost: z.string(),
  destPort: z.number().int().min(0).max(65535),
  autoStart: z.boolean(),
});
export type Tunnel = z.infer<typeof TunnelSchema>;

export const TunnelStateSchema = z.object({
  status: z.enum(["stopped", "starting", "running", "error"]),
  error: z.string().nullable(),
  since: z.number().nullable(),
});
export type TunnelState = z.infer<typeof TunnelStateSchema>;

export const tunnelsListRpc = defineRpc({
  name: "tunnels.list",
  input: z.object({}),
  output: z.object({ tunnels: z.array(TunnelSchema), states: z.record(z.string(), TunnelStateSchema) }),
});

export const tunnelsSaveRpc = defineRpc({
  name: "tunnels.save",
  input: TunnelSchema.extend({ id: z.string().optional() }),
  output: z.object({ tunnel: TunnelSchema }),
});

export const tunnelsActionRpc = defineRpc({
  name: "tunnels.action",
  input: z.object({ id: z.string(), action: z.enum(["start", "stop", "delete"]) }),
  output: z.object({ ok: z.boolean() }),
});

/* ------------------------------------------------------------------ */
/* Session logs and alerts                                             */
/* ------------------------------------------------------------------ */

export const WatchSchema = z.object({
  keywords: z.array(z.string()),
  idleSec: z.number().min(0).max(86400),
  activitySec: z.number().min(0).max(86400),
  once: z.boolean(),
});
export type Watch = z.infer<typeof WatchSchema>;

export const terminalLogRpc = defineRpc({
  name: "terminal.log",
  input: z.object({ terminalId: z.string(), enabled: z.boolean(), label: z.string() }),
  output: z.object({ name: z.string().nullable() }),
});

export const terminalWatchRpc = defineRpc({
  name: "terminal.watch",
  input: z.object({ terminalId: z.string(), label: z.string(), watch: WatchSchema.nullable() }),
  output: z.object({ ok: z.boolean() }),
});

export const terminalFeaturesRpc = defineRpc({
  name: "terminal.features",
  input: z.object({}),
  output: z.object({ logs: z.record(z.string(), z.string()), watches: z.record(z.string(), WatchSchema) }),
});

export const terminalExportRpc = defineRpc({
  name: "terminal.export",
  input: z.object({ terminalId: z.string() }),
  output: z.object({ text: z.string() }),
});

export const AlertEventSchema = z.object({
  seq: z.number(),
  at: z.number(),
  terminalId: z.string(),
  kind: z.enum(["keyword", "idle", "activity"]),
  message: z.string(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

export const alertsPollRpc = defineRpc({
  name: "alerts.poll",
  input: z.object({ since: z.number(), waitMs: z.number().optional() }),
  output: z.object({ events: z.array(AlertEventSchema), last: z.number() }),
});

export const logsListRpc = defineRpc({
  name: "logs.list",
  input: z.object({}),
  output: z.object({ files: z.array(z.object({ name: z.string(), size: z.number(), mtime: z.number() })), active: z.array(z.string()) }),
});

export const logsReadRpc = defineRpc({
  name: "logs.read",
  input: z.object({ name: z.string(), offset: z.number(), length: z.number() }),
  output: z.object({ base64: z.string(), size: z.number() }),
});

export const logsDeleteRpc = defineRpc({
  name: "logs.delete",
  input: z.object({ name: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

/* ------------------------------------------------------------------ */
/* Sftp: archives and server-to-server copy                            */
/* ------------------------------------------------------------------ */

export const filesArchiveRpc = defineRpc({
  name: "files.archive",
  input: z.object({ id: z.string(), dir: z.string(), names: z.array(z.string()).min(1) }),
  output: z.object({ token: z.string(), name: z.string(), size: z.number() }),
});

export const filesArchiveChunkRpc = defineRpc({
  name: "files.archive-chunk",
  input: z.object({ token: z.string(), offset: z.number(), length: z.number() }),
  output: z.object({ base64: z.string(), size: z.number(), done: z.boolean() }),
});

export const filesCopyServerRpc = defineRpc({
  name: "files.copy-server",
  input: z.object({ fromId: z.string(), dir: z.string(), names: z.array(z.string()).min(1), toId: z.string(), targetDir: z.string() }),
  output: z.object({ ok: z.boolean() }),
});
