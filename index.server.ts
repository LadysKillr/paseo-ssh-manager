import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import {
  filesActionRpc,
  filesDownloadChunkRpc,
  filesListRpc,
  filesReadTextRpc,
  filesTransferRpc,
  filesUploadChunkRpc,
  filesWriteTextRpc,
  monitorRpc,
  serversDeleteRpc,
  serversDisconnectRpc,
  serversListRpc,
  serversSaveRpc,
  serversStatusRpc,
  keysDeleteRpc,
  keysDeployRpc,
  keysGenerateRpc,
  keysImportRpc,
  keysListRpc,
  keysPassphraseRpc,
  mobaImportRpc,
  mobaParseRpc,
  sshConfigImportRpc,
  sshConfigScanRpc,
  terminalCommandRpc,
  terminalCwdRpc,
  terminalRegisterRpc,
  terminalRegistryRpc,
  terminalScreenRpc,
  terminalMouseRpc,
  terminalSearchRpc,
  terminalLogRpc,
  terminalWatchRpc,
  terminalFeaturesRpc,
  terminalExportRpc,
  alertsPollRpc,
  filesArchiveRpc,
  filesArchiveChunkRpc,
  filesCopyServerRpc,
  logsListRpc,
  logsReadRpc,
  logsDeleteRpc,
  tunnelsActionRpc,
  tunnelsListRpc,
  tunnelsSaveRpc,
  terminalRenameRpc,
} from "./shared/rpc";
import { disposeMirrors, exportTerminal, pinMirror, readScreen, renameTerminal, searchTerminal, sendMouse } from "./server/term-mirror";
import { activeLogs, activeWatches, clearWatch, deleteLog, listLogs, pollAlerts, readLog, setWatch, startLog, stopLog } from "./server/term-features";
import { deleteTunnel, readTunnels, saveTunnel, startAutoTunnels, startTunnel, stopAllTunnels, stopTunnel, tunnelStates } from "./server/tunnels";
import { prefsSettings } from "./shared/settings";
import {
  copyBetweenServers,
  downloadChunk,
  fileAction,
  listDir,
  makeArchive,
  readArchive,
  readText,
  transfer,
  uploadChunk,
  writeText,
} from "./server/files";
import { readMonitor } from "./server/monitor";
import { parseMoba, readMobaSource } from "./server/mobaxterm";
import { checkKey, deleteKey, generateKey, hasPuttygen, importKey, listKeys, publishKey, revokeKey, setPassphrase } from "./server/keys";
import { closeMaster, parseQuick, readSshConfig, serverStatus, terminalCwd, terminalLaunch } from "./server/ssh";
import { randomBytes } from "node:crypto";
import {
  addServers,
  dataDir,
  deleteServer,
  getServer,
  readServers,
  readTerminals,
  registerTerminal,
  saveServer,
  setTerminalLabel,
  toPublic,
  touchServer,
} from "./server/store";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(prefsSettings);

  server.handle(serversListRpc, () => ({ servers: readServers().map(toPublic), dataDir: dataDir() }));
  server.handle(serversSaveRpc, (input) => ({ server: toPublic(saveServer(input)) }));
  server.handle(serversDeleteRpc, async ({ id }) => {
    try {
      await closeMaster(getServer(id));
    } catch {
      /* ignore */
    }
    deleteServer(id);
    return { ok: true };
  });

  server.handle(sshConfigScanRpc, () => {
    const existing = new Set(readServers().map((s) => s.host));
    return {
      candidates: readSshConfig().map((h) => ({ ...h, alreadyImported: existing.has(h.alias) })),
    };
  });
  server.handle(sshConfigImportRpc, ({ aliases, group }) => {
    const wanted = new Set(aliases);
    const hosts = readSshConfig().filter((h) => wanted.has(h.alias));
    // Keep only the alias: ssh reads the rest (HostName, User, keys, ProxyJump) from ~/.ssh/config.
    const imported = addServers(hosts.map((h) => ({ name: h.alias, host: h.alias, group: group || "ssh config" })));
    return { imported };
  });

  server.handle(mobaParseRpc, (input) => parseMoba(readMobaSource(input), readServers()));
  server.handle(mobaImportRpc, ({ sessions, groupPrefix }) => {
    const prefix = (groupPrefix ?? "").trim().replace(/\/+$/, "");
    const imported = addServers(
      sessions.map((m) => ({
        name: m.name,
        host: m.host,
        port: m.port,
        user: m.user,
        identityFile: m.identityFile,
        jumpHost: m.jumpHost,
        group: [prefix, m.group].filter(Boolean).join("/") || undefined,
      })),
    );
    return { imported };
  });

  server.handle(serversStatusRpc, async ({ ids }) => {
    const servers = readServers().filter((s) => !ids || ids.includes(s.id));
    const statuses = await Promise.all(servers.map((s) => serverStatus(s)));
    return { statuses };
  });
  server.handle(serversDisconnectRpc, async ({ id }) => {
    await closeMaster(getServer(id));
    return { ok: true };
  });

  server.handle(terminalCommandRpc, ({ id, quick, startDir }) => {
    const target = id ? getServer(id) : parseQuick(quick ?? "");
    if (id) touchServer(id);
    const tag = randomBytes(8).toString("hex");
    const launch = terminalLaunch(target, startDir, id ? tag : undefined);
    return { ...launch, name: `ssh: ${target.name}`, sessionsDir: homedir(), tag };
  });
  server.handle(terminalScreenRpc, (input) => readScreen(input));
  server.handle(terminalMouseRpc, (input) => sendMouse(input));
  server.handle(terminalSearchRpc, (input) => searchTerminal(input));

  server.handle(terminalLogRpc, async ({ terminalId, enabled, label }) => {
    if (!enabled) {
      stopLog(terminalId);
      return { name: null };
    }
    await pinMirror(terminalId);
    return { name: startLog(terminalId, label).name };
  });
  server.handle(terminalWatchRpc, async ({ terminalId, label, watch }) => {
    if (!watch) clearWatch(terminalId);
    else {
      await pinMirror(terminalId);
      setWatch(terminalId, label, watch);
    }
    return { ok: true };
  });
  server.handle(terminalFeaturesRpc, () => ({ logs: activeLogs(), watches: activeWatches() }));
  server.handle(terminalExportRpc, async ({ terminalId }) => ({ text: await exportTerminal(terminalId) }));
  server.handle(alertsPollRpc, ({ since, waitMs }) => pollAlerts(since, waitMs ?? 0));
  server.handle(logsListRpc, () => ({ files: listLogs(), active: Object.values(activeLogs()) }));
  server.handle(logsReadRpc, ({ name, offset, length }) => readLog(name, offset, length));
  server.handle(logsDeleteRpc, ({ name }) => {
    deleteLog(name);
    return { ok: true };
  });

  server.handle(tunnelsListRpc, () => ({ tunnels: readTunnels(), states: tunnelStates() }));
  server.handle(tunnelsSaveRpc, (input) => ({ tunnel: saveTunnel(input) }));
  server.handle(tunnelsActionRpc, ({ id, action }) => {
    if (action === "start") startTunnel(id);
    else if (action === "stop") stopTunnel(id);
    else deleteTunnel(id);
    return { ok: true };
  });
  startAutoTunnels();
  server.handle(terminalRenameRpc, async ({ terminalId, title }) => {
    setTerminalLabel(terminalId, title);
    // Also rename the tab in Paseo's own terminal list (best effort).
    await renameTerminal(terminalId, title).catch(() => undefined);
    return { ok: true };
  });
  server.handle(terminalRegisterRpc, ({ terminalId, serverId, tag }) => {
    registerTerminal(terminalId, serverId, tag);
    return { ok: true };
  });
  server.handle(terminalRegistryRpc, () => {
    const out: Record<string, string> = {};
    const labels: Record<string, string> = {};
    for (const [tid, e] of Object.entries(readTerminals())) {
      out[tid] = e.serverId;
      if (e.label) labels[tid] = e.label;
    }
    return { terminals: out, labels };
  });
  server.handle(terminalCwdRpc, async ({ terminalId }) => {
    const entry = readTerminals()[terminalId];
    if (!entry) return { cwd: null };
    const target = readServers().find((s) => s.id === entry.serverId);
    if (!target) return { cwd: null };
    return { cwd: await terminalCwd(target, entry.tag) };
  });

  server.handle(filesListRpc, ({ id, path }) => listDir(getServer(id), path));
  server.handle(filesReadTextRpc, ({ id, path }) => readText(getServer(id), path));
  server.handle(filesWriteTextRpc, ({ id, path, text }) => writeText(getServer(id), path, text));
  server.handle(filesActionRpc, (input) => fileAction(getServer(input.id), input));
  server.handle(filesDownloadChunkRpc, ({ id, path, offset, length }) =>
    downloadChunk(getServer(id), path, offset, Math.min(length, 8 * 1024 * 1024)),
  );
  server.handle(filesUploadChunkRpc, ({ id, path, base64, append }) => uploadChunk(getServer(id), path, base64, append));
  server.handle(filesArchiveRpc, ({ id, dir, names }) => makeArchive(getServer(id), dir, names));
  server.handle(filesArchiveChunkRpc, ({ token, offset, length }) => readArchive(token, offset, length));
  server.handle(filesCopyServerRpc, ({ fromId, dir, names, toId, targetDir }) =>
    copyBetweenServers(getServer(fromId), dir, names, getServer(toId), targetDir),
  );
  server.handle(filesTransferRpc, ({ id, direction, source, targetDir }) =>
    transfer(getServer(id), direction, source, targetDir),
  );

  server.handle(keysListRpc, () => ({ keys: listKeys(), puttygen: hasPuttygen() }));
  server.handle(keysImportRpc, async (input) => ({ key: await importKey(input) }));
  server.handle(keysGenerateRpc, async (input) => ({ key: await generateKey(input) }));
  server.handle(keysDeleteRpc, ({ id, detach }) => deleteKey(id, !!detach));
  server.handle(keysPassphraseRpc, ({ id, passphrase }) => setPassphrase(id, passphrase));
  server.handle(keysDeployRpc, async ({ id, serverIds, action, setAsIdentity }) => ({
    results:
      action === "publish"
        ? await publishKey(id, serverIds, !!setAsIdentity)
        : action === "revoke"
          ? await revokeKey(id, serverIds)
          : await checkKey(id, serverIds),
  }));

  server.handle(monitorRpc, ({ id }) => readMonitor(getServer(id)));

  return () => {
    disposeMirrors();
    stopAllTunnels();
  };
}
