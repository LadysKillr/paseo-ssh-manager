import type { PaseoApi } from "@getpaseo/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { serversListRpc, serversStatusRpc, terminalCommandRpc, type Server, type ServerStatus } from "../shared/rpc";

export const SERVERS_KEY = ["ssh-manager", "servers"];
export const STATUS_KEY = ["ssh-manager", "status"];

export function useServers() {
  const list = useRpc(serversListRpc);
  return useQuery({ queryKey: SERVERS_KEY, queryFn: () => list({}), staleTime: 10_000 });
}

export function useStatuses(enabled = true) {
  const status = useRpc(serversStatusRpc);
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      const res = await status({});
      const map: Record<string, ServerStatus> = {};
      for (const s of res.statuses) map[s.id] = s;
      return map;
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useRefreshServers() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: SERVERS_KEY });
    void qc.invalidateQueries({ queryKey: STATUS_KEY });
  }, [qc]);
}

export function groupServers(servers: readonly Server[], filter: string): { group: string; servers: Server[] }[] {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, Server[]>();
  for (const s of servers) {
    const hay = `${s.name} ${s.host} ${s.user ?? ""} ${s.group ?? ""}`.toLowerCase();
    if (needle && !hay.includes(needle)) continue;
    const g = s.group || "Serveurs";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, list]) => ({ group, servers: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function serverLabel(s: Server): string {
  const user = s.user ? `${s.user}@` : "";
  const port = s.port ? `:${s.port}` : "";
  return `${user}${s.host}${port}`;
}

export const TERMINAL_PREFIX = "ssh: ";

type TerminalCommand = (input: { id?: string; quick?: string; startDir?: string }) => Promise<{
  command: string;
  args: string[];
  name: string;
  sessionsDir: string;
}>;

/**
 * Open a native Paseo terminal running ssh. Without a workspace, the preferred workspace is used,
 * else the workspace of the daemon user's home directory.
 */
export async function openSshTerminal(
  paseo: PaseoApi,
  terminalCommand: TerminalCommand,
  target: { id?: string; quick?: string; startDir?: string },
  workspaceId: string | null,
): Promise<{ workspaceId: string; terminalId: string }> {
  const launch = await terminalCommand(target);
  let wsId = workspaceId;
  if (!wsId) {
    const ws = await paseo.workspaces.open(launch.sessionsDir);
    wsId = ws.id;
  }
  const handle = await paseo.terminals.create({
    workspaceId: wsId,
    name: launch.name,
    command: launch.command,
    args: launch.args,
  });
  return { workspaceId: wsId, terminalId: handle.id };
}

export function useTerminalCommand() {
  return useRpc(terminalCommandRpc);
}

export const SSH_TERMINALS_KEY = ["ssh-manager", "terminals"];

/** SSH terminals opened by this plugin (named "ssh: <server>"). */
export function useSshTerminals(paseo: PaseoApi, workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...SSH_TERMINALS_KEY, workspaceId ?? "all"],
    queryFn: async () => {
      const res = await paseo.terminals.list(workspaceId ? { workspaceId } : {});
      return res.entries.filter((t) => t.name.startsWith(TERMINAL_PREFIX));
    },
    enabled,
    refetchInterval: 5_000,
  });
}
