import type { PaseoApi, PaseoTerminal } from "./paseo-types";
import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { alertsPollRpc, terminalExportRpc, terminalFeaturesRpc, terminalLogRpc, terminalRegisterRpc, terminalRegistryRpc, terminalRenameRpc } from "../shared/rpc";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, PanResponder, Pressable, Text, View, type TextInput as NativeTextInput } from "react-native";
import type { Server } from "../shared/rpc";
import { prefsSettings } from "../shared/settings";
import {
  serverLabel,
  SSH_TERMINALS_KEY,
  STATUS_KEY,
  TERMINAL_PREFIX,
  useServers,
  useSshTerminals,
  useStatuses,
  useTerminalCommand,
} from "./data";
import { FileBrowser } from "./files";
import { useFollowTerminal } from "./follow";
import { MultiExecGrid } from "./multi-exec-grid";
import { Logs } from "./logs";
import { AlertModal } from "./alerts";
import { Home, WorkspacePicker } from "./home";
import { DeadSession, TabBar, type TabModel } from "./tabs";
import { STRIP, ToolButton, ToolPage } from "./toolbar";
import { SplitView, type SplitLayout } from "./split-view";
import { Tunnels } from "./tunnels";
import { KeyManager } from "./keys-manager";
import { MonitorBar, MonitorView } from "./monitor";
import { dialogStore, Dialogs, Sessions } from "./sessions";
import { lastScreens, ScreenLines, TerminalView, useTermMetrics, type TermSize } from "./terminal-view";
import { afterMenu, createDoublePress, errorMessage, MONO_SURFACE, useLinger, isHovered, MONO, MOBA_THEME, webProps, webStyle, selectionStore, useStore, useStyles, type AppTab, type MainView, type Styles } from "./util";
import { confirmAction, isTouchDevice, isWeb, notify, saveDownload } from "./web";
import { askConfirm, ConfirmHost } from "./confirm";
import { useKeyboardOverlap, useRootVisibility, VisibleContext } from "./visibility";
import { Btn, Check, Empty, ErrorBox, IconBtn } from "./widgets";

export interface SshAppProps {
  theme: PluginTheme;
  paseo: PaseoApi;
  /** Workspace that receives terminals; null on the global page (uses the preference). */
  workspaceId: string | null;
  /** Workspace directory on the daemon host, used for file transfers. */
  localDir: string | null;
  openWorkspace?: (workspaceId: string) => void;
  /** Global page: offers the workspace picker. */
  page?: boolean;
}

type SideTab = AppTab;


export type { TabModel };

export function SshApp({ theme, paseo, workspaceId, localDir, openWorkspace, page }: SshAppProps) {
  const settings = useSettings(prefsSettings);
  const prefs = settings.status === "ready" ? settings.values : null;
  const moba = (prefs?.appearance ?? "paseo") === "mobaxterm";
  const s = useStyles(moba ? MOBA_THEME : theme, moba, theme);
  const toast = useToast();
  const qc = useQueryClient();
  const servers = useServers();
  /* Pause every periodic task while the SSH view is off screen (Paseo keeps it mounted). */
  const rootRef = useRef<View>(null);
  const visible = useRootVisibility(rootRef);
  /** Part of the view under the on-screen keyboard (phones): kept free so typing stays visible. */
  const keyboard = useKeyboardOverlap(rootRef);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const statuses = useStatuses(visible);
  const terminalCommand = useTerminalCommand();
  const selection = useStore(selectionStore);
  const metrics = useTermMetrics();
  const lastSize = useRef<TermSize | null>(null);
  const [width, setWidth] = useState(0);
  const [quick, setQuick] = useState("");
  const [pickWorkspace, setPickWorkspace] = useState(false);
  /** Live width while the splitter is dragged; null: the saved width. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const sideRef = useRef({ width: 360, max: 800 });
  const splitterPress = useRef(createDoublePress());
  const dragStart = useRef(0);
  const saveSideRef = useRef<(w: number) => void>(() => {});
  saveSideRef.current = (w: number) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, sidebarWidth: Math.round(w) }, settings.revision);
  };
  const splitter = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStart.current = sideRef.current.width;
        setDragWidth(sideRef.current.width);
      },
      onPanResponderMove: (_, g) => setDragWidth(Math.min(sideRef.current.max, Math.max(220, dragStart.current + g.dx))),
      onPanResponderRelease: (_, g) => {
        const w = Math.min(sideRef.current.max, Math.max(220, dragStart.current + g.dx));
        saveSideRef.current(w);
        setTimeout(() => setDragWidth(null), 400);
      },
      onPanResponderTerminate: () => setDragWidth(null),
    }),
  ).current;
  const wide = width >= 900;
  const autoHide = !!prefs?.sidebarAutoHide;
  /** Auto-hide: the panel is currently slid in because the mouse is on the left edge / over it. */
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPeekSoon = (v: boolean) => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    if (v) setPeek(true);
    else peekTimer.current = setTimeout(() => setPeek(false), 350);
  };
  const toggleAutoHide = () => {
    if (settings.status === "ready") void settings.save({ ...settings.values, sidebarAutoHide: !settings.values.sidebarAutoHide }, settings.revision);
    setPeek(false);
  };
  /** Phone-sized layout: bottom tab bar, tools in a sheet. */
  const mobile = width > 0 && width < 640;
  /** Finger input: bigger rows, terminal keys bar, swipe to scroll. */
  const touch = useMemo(() => isTouchDevice(), []);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsL = useLinger(toolsOpen ? true : null);
  if (metrics.ready) lastSize.current = metrics.size;

  const targetWorkspace = workspaceId ?? (prefs?.workspaceId ? prefs.workspaceId : null);
  // Off screen, keep watching the terminals only if a session must reconnect by itself.
  const watchTerminals = visible || (servers.data?.servers ?? []).some((x) => x.autoReconnect);
  const terminals = useSshTerminals(paseo, targetWorkspace, watchTerminals);
  const registerTerminal = useRpc(terminalRegisterRpc);
  const registryRpc = useRpc(terminalRegistryRpc);
  const registry = useQuery({ queryKey: ["ssh-manager", "registry"], queryFn: () => registryRpc({}), staleTime: 5_000 });
  const termList = terminals.data ?? [];
  const list: readonly Server[] = servers.data?.servers ?? [];

  const activeTerminal = termList.find((t) => t.id === selection.activeTerminal) ?? null;
  const renameRpc = useRpc(terminalRenameRpc);

  /* ---------------- tabs (live and finished sessions, in opening order) ---------------- */
  const tabOrder = useRef<string[]>([]);
  const knownIds = useRef(new Set<string>());
  const closing = useRef(new Set<string>());
  const [deadTabs, setDeadTabs] = useState<TabModel[]>([]);
  const tabInfo = useRef(new Map<string, TabModel>());
  /* Auto reconnection: planned time per finished tab, backoff per session. */
  const [reconnects, setReconnects] = useState<Record<string, number>>({});
  const reconnectInfo = useRef(new Map<string, { attempt: number; lastStart: number }>());
  const cancelReconnect = (id: string) =>
    setReconnects((r) => {
      if (!(id in r)) return r;
      const next = { ...r };
      delete next[id];
      return next;
    });
  /* Logs and alerts of the open terminals. */
  const logRpc = useRpc(terminalLogRpc);
  const exportRpc = useRpc(terminalExportRpc);
  const featuresRpc = useRpc(terminalFeaturesRpc);
  const features = useQuery({ queryKey: ["ssh-manager", "features"], queryFn: () => featuresRpc({}), refetchInterval: 10_000, enabled: visible });
  const [alertedTabs, setAlertedTabs] = useState<Set<string>>(() => new Set());
  const [alertEdit, setAlertEdit] = useState<TabModel | null>(null);
  const [tabMenu, setTabMenu] = useState<TabModel | null>(null);
  const [renaming, setRenaming] = useState<{ tab: TabModel; value: string } | null>(null);
  const tabMenuL = useLinger(tabMenu);
  const [searchRequest, setSearchRequest] = useState(0);
  /* Split (MobaXterm "Split"): 2 or 4 independent terminals side by side. */
  const [splitPicker, setSplitPicker] = useState(false);
  const splitPickerL = useLinger(splitPicker ? true : null);
  const [splitLayout, setSplitLayout] = useState<SplitLayout>("2v");
  const [splitPanes, setSplitPanes] = useState<(string | null)[]>([]);
  const startSplit = (layout: SplitLayout) => {
    const n = layout === "4" ? 4 : 2;
    const live = tabs.filter((t) => !t.dead).map((t) => t.id);
    // Keep the panes already chosen, fill the others with the open sessions, active one first.
    const first = activeTab && !activeTab.dead ? [activeTab.id] : [];
    const pool = [...first, ...live.filter((id) => !first.includes(id))];
    const next: (string | null)[] = [];
    for (let i = 0; i < n; i += 1) {
      const kept = splitPanes[i];
      next.push(kept && live.includes(kept) ? kept : pool.find((id) => !next.includes(id) && !splitPanes.slice(0, n).includes(id)) ?? null);
    }
    setSplitLayout(layout);
    setSplitPanes(next);
    selectionStore.set((p) => ({ ...p, mainView: "split", tab: wide ? p.tab : "terminals" }));
  };
  const renameL = useLinger(renaming);
  const labelOf = (t: PaseoTerminal) => registry.data?.labels[t.id] ?? t.name.slice(TERMINAL_PREFIX.length);
  const serverOf = (t: PaseoTerminal) =>
    list.find((x) => x.id === registry.data?.terminals[t.id]) ?? list.find((x) => `${TERMINAL_PREFIX}${x.name}` === t.name) ?? null;

  // A terminal that disappears without being closed here has ended (ssh exited, network lost):
  // keep its tab with its last screen, like MobaXterm's "Session stopped".
  useEffect(() => {
    if (!terminals.isSuccess) return;
    const live = new Set(termList.map((t) => t.id));
    for (const t of termList) {
      if (!knownIds.current.has(t.id)) {
        knownIds.current.add(t.id);
        if (!tabOrder.current.includes(t.id)) tabOrder.current = [...tabOrder.current, t.id];
      }
    }
    const ended: TabModel[] = [];
    for (const id of [...knownIds.current]) {
      if (live.has(id)) continue;
      knownIds.current.delete(id);
      if (closing.current.has(id)) {
        closing.current.delete(id);
        continue;
      }
      if (!tabOrder.current.includes(id)) continue;
      const known = tabInfo.current.get(id);
      ended.push({ id, label: known?.label ?? "session", serverId: known?.serverId, color: known?.color, dead: true });
    }
    if (ended.length) {
      setDeadTabs((d) => [...d, ...ended.filter((e) => !d.some((x) => x.id === e.id))]);
      // Reconnexion automatique (option de la session), with a growing delay if it keeps dropping.
      const planned: Record<string, number> = {};
      for (const e of ended) {
        const server = list.find((x) => x.id === e.serverId);
        if (!server?.autoReconnect) continue;
        const info = reconnectInfo.current.get(server.id) ?? { attempt: 0, lastStart: 0 };
        info.attempt = Date.now() - info.lastStart < 30_000 ? info.attempt + 1 : 0;
        reconnectInfo.current.set(server.id, info);
        planned[e.id] = Date.now() + Math.min(60, 3 * 2 ** info.attempt) * 1000;
      }
      if (Object.keys(planned).length) setReconnects((r) => ({ ...r, ...planned }));
    }
  }, [terminals.dataUpdatedAt]);

  const tabs: TabModel[] = tabOrder.current
    .map((id): TabModel | null => {
      const t = termList.find((x) => x.id === id);
      if (t) {
        const server = serverOf(t);
        return {
          id,
          label: labelOf(t),
          color: server?.color,
          serverId: server?.id,
          dead: false,
          terminal: t,
          logging: !!features.data?.logs[id],
          watching: !!features.data?.watches[id],
          alerted: alertedTabs.has(id),
        };
      }
      const dead = deadTabs.find((x) => x.id === id);
      return dead ? { ...dead, reconnectAt: reconnects[id] } : null;
    })
    .filter((x): x is TabModel => x !== null);
  const lastTabs = useRef<TabModel[]>([]);
  lastTabs.current = tabs;
  // Name / session / colour of every tab seen, kept after its terminal disappears (finished tab).
  for (const t of tabs) if (!t.dead) tabInfo.current.set(t.id, t);
  const activeTab = tabs.find((t) => t.id === selection.activeTerminal) ?? null;

  // Run the planned reconnections.
  useEffect(() => {
    const ids = Object.keys(reconnects);
    if (!ids.length) return;
    const timer = setInterval(() => {
      for (const id of ids) {
        const at = reconnects[id];
        if (at && at <= Date.now()) {
          const tab = lastTabs.current.find((t) => t.id === id);
          if (tab) restartTab(tab);
          else cancelReconnect(id);
        }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [reconnects]);

  // A tab shown again clears its "alert fired" mark.
  useEffect(() => {
    if (activeTab && alertedTabs.has(activeTab.id)) {
      setAlertedTabs((prev) => {
        const next = new Set(prev);
        next.delete(activeTab.id);
        return next;
      });
    }
  }, [activeTab?.id]);

  // Alerts: one long poll, kept while the page is mounted (even off screen: that is when they matter).
  const alertsRpc = useRpc(alertsPollRpc);
  useEffect(() => {
    let stopped = false;
    let since = -1;
    const loop = async () => {
      while (!stopped) {
        try {
          const res = await alertsRpc({ since: since < 0 ? Number.MAX_SAFE_INTEGER : since, waitMs: since < 0 ? 0 : 15_000 });
          if (stopped) return;
          if (since < 0) {
            since = res.last;
            continue;
          }
          since = res.last;
          for (const ev of res.events) {
            toast.show(ev.message, { variant: ev.kind === "keyword" ? "warning" : "info", durationMs: 8000 });
            notify("SSH Manager", ev.message);
            if (selectionStore.get().activeTerminal !== ev.terminalId || !visibleRef.current) {
              setAlertedTabs((prev) => new Set(prev).add(ev.terminalId));
            }
          }
          if (res.events.length) void features.refetch();
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }, []);

  /* ---------------- terminal font zoom (Ctrl + wheel, Ctrl + / Ctrl -) ---------------- */
  const [zoomed, setZoomed] = useState<number | null>(null);
  const fontSize = zoomed ?? prefs?.terminalFontSize ?? 13;
  const zoomSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoom = (delta: number) => {
    const next = Math.max(8, Math.min(28, fontSize + delta));
    setZoomed(next);
    if (zoomSave.current) clearTimeout(zoomSave.current);
    zoomSave.current = setTimeout(() => {
      if (settings.status === "ready") void settings.save({ ...settings.values, terminalFontSize: next }, settings.revision);
    }, 600);
  };
  const activeTermServer = activeTerminal
    ? list.find((x) => x.id === registry.data?.terminals[activeTerminal.id]) ??
      list.find((x) => `${TERMINAL_PREFIX}${x.name}` === activeTerminal.name) ??
      null
    : null;
  const selected = list.find((x) => x.id === selection.serverId) ?? null;
  /** Server shown by Sftp / monitoring / status bar: the active tab's, else the tree selection. */
  const current = activeTermServer ?? selected;
  const followTerminal = prefs?.followTerminal ?? false;
  const followState = useFollowTerminal(paseo, activeTerminal, activeTermServer?.id ?? null, visible && followTerminal && !!activeTermServer);
  const setFollowTerminal = (on: boolean) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, followTerminal: on }, settings.revision);
  };

  const sideTab: SideTab = !wide ? selection.tab : selection.tab === "terminals" ? "sessions" : selection.tab;
  const setTab = (next: SideTab) => selectionStore.set((p) => ({ ...p, tab: next }));
  const select = (id: string, next?: SideTab) => selectionStore.set((p) => ({ ...p, serverId: id, tab: next ?? p.tab }));
  const activate = (id: string | null) => selectionStore.set((p) => ({ ...p, activeTerminal: id, mainView: "tabs" }));
  /** Open a tool in the main area (toggle: a second click goes back to the session tabs). */
  const showView = (view: MainView) =>
    selectionStore.set((p) => ({
      ...p,
      mainView: p.mainView === view && view !== "tabs" ? "tabs" : view,
      tab: wide ? p.tab : "terminals",
    }));

  const remoteMonitoring = prefs?.remoteMonitoring ?? true;
  const setRemoteMonitoring = (on: boolean) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, remoteMonitoring: on }, settings.revision);
  };

  const openTerminal = async (target: { id?: string; quick?: string; startDir?: string }, replaceTab?: string): Promise<string | null> => {
    try {
      const size = lastSize.current ?? undefined;
      const launch = await terminalCommand(target);
      let wsId = targetWorkspace;
      if (!wsId) wsId = (await paseo.workspaces.open(launch.sessionsDir)).id;
      const handle = await paseo.terminals.create({ workspaceId: wsId, name: launch.name, command: launch.command, args: launch.args, size });
      if (target.id) {
        await registerTerminal({ terminalId: handle.id, serverId: target.id, tag: launch.tag }).catch(() => undefined);
        const server = list.find((x) => x.id === target.id);
        if (server?.logSession) {
          await logRpc({ terminalId: handle.id, enabled: true, label: server.name }).catch(() => undefined);
          void features.refetch();
        }
        void qc.invalidateQueries({ queryKey: ["ssh-manager", "registry"] });
      }
      // Keep the tab order: a restarted session takes the place of its finished tab.
      if (replaceTab) {
        tabOrder.current = tabOrder.current.map((x) => (x === replaceTab ? handle.id : x));
        setDeadTabs((d) => d.filter((x) => x.id !== replaceTab));
      } else tabOrder.current = [...tabOrder.current, handle.id];
      knownIds.current.add(handle.id);
      await qc.invalidateQueries({ queryKey: SSH_TERMINALS_KEY });
      setTimeout(() => void qc.invalidateQueries({ queryKey: STATUS_KEY }), 4000);
      selectionStore.set((p) => ({ ...p, activeTerminal: handle.id, mainView: "tabs", serverId: target.id ?? p.serverId, tab: wide ? p.tab : "terminals" }));
      void qc.invalidateQueries({ queryKey: ["ssh-manager", "servers"] });
      return handle.id;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  };

  const forgetTab = (id: string) => {
    cancelReconnect(id);
    tabOrder.current = tabOrder.current.filter((x) => x !== id);
    setDeadTabs((d) => d.filter((x) => x.id !== id));
    lastScreens.delete(id);
    if (selectionStore.get().activeTerminal === id) {
      const next = tabOrder.current[tabOrder.current.length - 1] ?? null;
      selectionStore.set((p) => ({ ...p, activeTerminal: next }));
    }
  };

  const closeTab = async (tab: TabModel, ask = true) => {
    if (tab.dead) {
      forgetTab(tab.id);
      return;
    }
    if (
      ask &&
      (prefs?.confirmClose ?? true) &&
      !(await askConfirm("Fermer la session", `Fermer "${tab.label}" ?`, "Fermer", () => {
        if (settings.status === "ready") void settings.save({ ...settings.values, confirmClose: false }, settings.revision);
      }))
    )
      return;
    closing.current.add(tab.id);
    try {
      await paseo.terminals.ref(tab.terminal ?? tab.id).kill();
    } catch (err) {
      toast.error(errorMessage(err));
    }
    forgetTab(tab.id);
    void qc.invalidateQueries({ queryKey: SSH_TERMINALS_KEY });
  };

  const restartTab = (tab: TabModel) => {
    cancelReconnect(tab.id);
    if (!tab.serverId) return;
    const info = reconnectInfo.current.get(tab.serverId) ?? { attempt: 0, lastStart: 0 };
    info.lastStart = Date.now();
    reconnectInfo.current.set(tab.serverId, info);
    void openTerminal({ id: tab.serverId }, tab.id);
  };

  /* ---------------- session log, alerts, export ---------------- */
  const toggleLog = async (tab: TabModel) => {
    try {
      const res = await logRpc({ terminalId: tab.id, enabled: !tab.logging, label: tab.label });
      toast.show(res.name ? `Enregistrement : ${res.name}` : "Enregistrement arrêté", { variant: "success" });
      void features.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const exportHistory = async (tab: TabModel) => {
    try {
      const { text } = await exportRpc({ terminalId: tab.id });
      if (isWeb) saveDownload(`${tab.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.txt`, [new TextEncoder().encode(text)]);
      else await copyText(text);
      toast.show(isWeb ? "Historique exporté" : "Historique copié", { variant: "success" });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const renameTab = async (tab: TabModel, title: string) => {
    try {
      await renameRpc({ terminalId: tab.id, title });
      void qc.invalidateQueries({ queryKey: ["ssh-manager", "registry"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const quickConnect = () => {
    const text = quick.trim();
    if (!text) return;
    const needle = text.toLowerCase();
    const exact = list.find((x) => x.name.toLowerCase() === needle || x.host === text);
    const matches = list.filter((x) => `${x.name} ${x.host}`.toLowerCase().includes(needle));
    if (exact) void openTerminal({ id: exact.id });
    else if (matches.length === 1) void openTerminal({ id: matches[0]!.id });
    else void openTerminal({ quick: text });
    setQuick("");
  };

  const needServer = (content: (server: Server) => ReactElement) =>
    current ? (
      content(current)
    ) : (
      <Empty s={s} icon="MousePointerClick" text="Sélectionnez une session dans User sessions (ou activez un onglet de session)." />
    );

  /* ---------------- sidebar content ---------------- */
  const maxSide = Math.max(240, width - 38 - 320);
  const savedSide = prefs?.sidebarWidth ?? 360;
  const sidebarWidth = wide ? Math.min(maxSide, Math.max(220, dragWidth ?? savedSide)) : Math.max(0, width - 38);
  sideRef.current = { width: sidebarWidth, max: maxSide };
  const sessionsSide = (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 4 }}>
        <Sessions
          s={s}
          servers={list}
          statuses={statuses.data ?? {}}
          selectedId={selection.serverId}
          filter={quick}
          touch={touch}
          onSelect={(id) => select(id)}
          onTerminal={(t) => void openTerminal(t)}
          onFiles={(id) => {
            activate(null);
            select(id, "files");
          }}
          onMonitor={(id) => {
            selectionStore.set((p) => ({ ...p, serverId: id, mainView: "monitor", tab: wide ? p.tab : "terminals" }));
          }}
        />
      </ScrollView>
    </View>
  );

  const filesSide = needServer((server) => (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        <FileBrowser
          key={server.id}
          s={s}
          server={server}
          compact={sidebarWidth < 520}
          tiny={sidebarWidth < 330}
          touch={touch}
          localDir={localDir}
          onOpenTerminalHere={(dir) => void openTerminal({ id: server.id, startDir: dir })}
        />
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: s.c.border, padding: 6, gap: 4 }}>
        {mobile ? null : (
          <Pressable onPress={() => setRemoteMonitoring(!remoteMonitoring)} style={[s.row, { gap: 6, justifyContent: "center" }]}>
            <Icon name="MonitorDot" size={16} color={remoteMonitoring ? s.x.green : s.c.foregroundMuted} />
            <Text style={[s.text, { fontSize: 12 }]}>Remote monitoring</Text>
          </Pressable>
        )}
        <Check s={s} checked={followTerminal} onToggle={() => setFollowTerminal(!followTerminal)} label="Follow terminal folder" />
        {followTerminal ? (
          <Text style={s.small}>
            {!activeTermServer
              ? "Activez l'onglet d'une session pour suivre son dossier."
              : followState === "proc"
                ? "Suit le dossier du shell du terminal actif."
                : followState === "prompt"
                  ? "Suit le dossier affiché dans le prompt (le serveur refuse LC_*)."
                  : followState === "unknown"
                    ? "Dossier du terminal introuvable (terminal ouvert avant cette version ou prompt personnalisé)."
                    : ""}
          </Text>
        ) : null}
      </View>
    </View>
  ));

  const sideContent =
    sideTab === "sessions" ? (
      sessionsSide
    ) : sideTab === "files" ? (
      filesSide
    ) : null;

  /* ---------------- main area (tabs) ---------------- */
  const mainArea = (
    <View style={{ flex: 1 }}>
      <TabBar
        s={s}
        tabs={tabs}
        active={selection.mainView === "tabs" ? activeTab?.id ?? null : "__tool__"}
        onActivate={activate}
        onClose={(t) => void closeTab(t)}
        onMenu={setTabMenu}
      />
      <View
        style={{ flex: 1, backgroundColor: s.x.termBg }}
        onLayout={(e) => metrics.setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {metrics.probe}
        {selection.mainView === "multiexec" ? (
          <MultiExecGrid s={s} paseo={paseo} terminals={termList} narrow={mobile} />
        ) : selection.mainView === "keys" ? (
          <ToolPage s={s} icon="KeyRound" color={s.x.star} title="Clés SSH (MobaKeyGen)" onClose={() => showView("tabs")}>
            <KeyManager s={s} servers={list} />
          </ToolPage>
        ) : selection.mainView === "logs" ? (
          <ToolPage s={s} icon="ScrollText" color={s.x.green} title="Journaux de session" onClose={() => showView("tabs")}>
            <Logs s={s} />
          </ToolPage>
        ) : selection.mainView === "tunnels" ? (
          <ToolPage s={s} icon="Cable" color={s.x.orange} title="Tunnels SSH (MobaSSHTunnel)" onClose={() => showView("tabs")}>
            <Tunnels s={s} servers={list} />
          </ToolPage>
        ) : selection.mainView === "split" ? (
          <SplitView
            s={s}
            paseo={paseo}
            layout={splitLayout}
            panes={splitPanes}
            tabs={tabs.filter((t) => !t.dead)}
            fontSize={fontSize}
            onChangePane={(i, id) => setSplitPanes((p) => p.map((x, j) => (j === i ? id : x)))}
            onExit={() => showView("tabs")}
            onZoom={zoom}
          />
        ) : selection.mainView === "monitor" ? (
          <ToolPage s={s} icon="Activity" color={s.x.green} title={current ? `Monitoring : ${current.name}` : "Monitoring"} onClose={() => showView("tabs")}>
            <View style={{ padding: 12, maxWidth: 760, width: "100%" }}>
              {needServer((server) => <MonitorView key={server.id} s={s} server={server} />)}
            </View>
          </ToolPage>
        ) : activeTab?.dead ? (
          <DeadSession
            key={activeTab.id}
            s={s}
            tab={activeTab}
            fontSize={fontSize}
            onRestart={() => restartTab(activeTab)}
            onClose={() => forgetTab(activeTab.id)}
            onCancelReconnect={() => cancelReconnect(activeTab.id)}
          />
        ) : activeTerminal ? (
          <View style={{ flex: 1 }}>
            <TerminalView
              key={activeTerminal.id}
              s={s}
              paseo={paseo}
              terminal={activeTerminal}
              active
              fontSize={fontSize}
              copyOnSelect={prefs?.copyOnSelect ?? true}
              rightClickPaste={prefs?.rightClickPaste ?? true}
              onZoom={zoom}
              onGone={() => void qc.invalidateQueries({ queryKey: SSH_TERMINALS_KEY })}
              searchRequest={searchRequest}
              touch={touch}
            />
            {touch ? null : (
            <View style={[s.row, { position: "absolute", top: 4, right: 8, gap: 2, opacity: 0.85 }]}>
              {current ? (
                <IconBtn s={s} icon="FolderTree" label="Fichiers de cette session (Sftp)" color={s.x.orange} size={14} onPress={() => setTab("files")} />
              ) : null}
              <IconBtn s={s} icon="Search" label="Rechercher dans le terminal (Ctrl+Shift+F)" size={14} onPress={() => setSearchRequest((n) => n + 1)} />
              {openWorkspace && targetWorkspace ? (
                <IconBtn
                  s={s}
                  icon="ExternalLink"
                  label="Ouvrir dans un terminal Paseo complet (couleurs, souris)"
                  size={14}
                  onPress={() => openWorkspace(targetWorkspace)}
                />
              ) : null}
            </View>
            )}
          </View>
        ) : (
          <Home s={s} servers={list} onOpen={(id) => void openTerminal({ id })} />
        )}
      </View>
    </View>
  );

  /* ---------------- layout ---------------- */
  const strip = (
    <View style={{ width: 38, backgroundColor: s.x.strip, borderRightWidth: 1, borderRightColor: s.c.border, paddingTop: 4, gap: 2 }}>
      {[...STRIP, ...(wide ? [] : [{ value: "terminals" as const, label: "Terminaux", icon: "SquareTerminal", color: (st: Styles) => st.x.ssh }])].map((item) => {
        const isActive = sideTab === item.value;
        return (
          <Pressable
            key={item.value}
            accessibilityLabel={item.label}
            {...{ title: item.label }}
            onPress={() => setTab(item.value)}
            style={(state) => [
              {
                height: 38,
                alignItems: "center",
                justifyContent: "center",
                borderLeftWidth: 3,
                borderLeftColor: isActive ? s.c.accent : "transparent",
                backgroundColor: isActive ? s.c.surface0 : isHovered(state) ? s.c.surface2 : "transparent",
              },
            ]}
          >
            <Icon name={item.icon} size={18} color={isActive ? item.color(s) : s.c.foregroundMuted} />
          </Pressable>
        );
      })}
    </View>
  );

  const toolbar = (
    <View style={[s.row, { gap: 2, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: s.x.toolbar, borderBottomWidth: 1, borderBottomColor: s.c.border, flexWrap: "wrap" }]}>
      <ToolButton s={s} icon="MonitorCog" label="Session" color={s.x.ssh} onPress={() => dialogStore.set({ kind: "new" })} />
      <ToolButton s={s} icon="FileDown" label="Importer" color={s.x.orange} onPress={() => dialogStore.set({ kind: "import-moba" })} />
      <View style={{ width: 1, height: 36, backgroundColor: s.c.border, marginHorizontal: 4 }} />
      <ToolButton s={s} icon="KeyRound" label="Clés" color={s.x.star} active={selection.mainView === "keys"} onPress={() => showView("keys")} />
      <ToolButton s={s} icon="Activity" label="Monitoring" color={s.x.green} active={selection.mainView === "monitor"} onPress={() => showView("monitor")} />
      <ToolButton s={s} icon="Layers" label="MultiExec" color={s.x.blue} active={selection.mainView === "multiexec"} onPress={() => showView("multiexec")} />
      <ToolButton s={s} icon="Columns2" label="Split" color={s.x.ssh} active={selection.mainView === "split"} onPress={() => setSplitPicker(true)} />
      <ToolButton s={s} icon="Cable" label="Tunnels" color={s.x.orange} active={selection.mainView === "tunnels"} onPress={() => showView("tunnels")} />
      <ToolButton s={s} icon="ScrollText" label="Journaux" color={s.x.green} active={selection.mainView === "logs"} onPress={() => showView("logs")} />
      <View style={{ flex: 1 }} />
      {wide ? <ToolButton s={s} icon={autoHide ? "PanelLeftOpen" : "PanelLeftClose"} label={autoHide ? "Barre fixe" : "Masquer barre"} color={s.c.foregroundMuted} active={autoHide} onPress={toggleAutoHide} /> : null}
      {page ? <ToolButton s={s} icon="Settings" label="Workspace" color={s.c.foregroundMuted} onPress={() => setPickWorkspace(true)} /> : null}
    </View>
  );

  const quickBar = (
    <View style={[s.row, { height: 30, paddingHorizontal: 4, gap: 4, backgroundColor: s.x.tabBar, borderBottomWidth: 1, borderBottomColor: s.c.border }]}>
      <TextInput
        value={quick}
        onChangeText={setQuick}
        onSubmitEditing={quickConnect}
        placeholder="Quick connect..."
        placeholderTextColor={s.c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          flex: 1,
          height: 22,
          color: s.c.foreground,
          fontSize: 12,
          paddingHorizontal: 6,
          backgroundColor: s.c.surface0,
          borderWidth: 1,
          borderColor: s.c.border,
          borderRadius: 2,
        }}
      />
    </View>
  );

  /* ---------------- phone layout ---------------- */
  const mobileHeader = (
    <View style={[s.row, { gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: s.x.tabBar, borderBottomWidth: 1, borderBottomColor: s.c.border }]}>
      <View style={[s.row, { flex: 1, gap: 6, paddingHorizontal: 8, height: 38, borderRadius: 8, borderWidth: 1, borderColor: s.c.border, backgroundColor: s.c.surface0 }]}>
        <Icon name="Search" size={16} color={s.c.foregroundMuted} />
        <TextInput
          value={quick}
          onChangeText={(v) => {
            setQuick(v);
            if (v && sideTab !== "sessions") selectionStore.set((p) => ({ ...p, tab: "sessions", mainView: "tabs" }));
          }}
          onSubmitEditing={quickConnect}
          placeholder="Rechercher ou user@hôte"
          placeholderTextColor={s.c.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, color: s.c.foreground, fontSize: 16, paddingVertical: 0, borderWidth: 0 }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Outils"
        onPress={() => setToolsOpen(true)}
        style={{ width: 42, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: s.c.border, backgroundColor: s.c.surface1 }}
      >
        <Icon name="Menu" size={20} color={s.c.foreground} />
      </Pressable>
    </View>
  );

  const liveCount = tabs.filter((t) => !t.dead).length;
  const navItems: { value: AppTab; label: string; icon: string; badge?: number }[] = [
    { value: "sessions", label: "Sessions", icon: "Star" },
    { value: "files", label: "Fichiers", icon: "FolderTree" },
    { value: "terminals", label: "Terminaux", icon: "SquareTerminal", badge: liveCount },
    { value: "monitor", label: "Monitoring", icon: "Activity" },
  ];
  const mobileNav = (
    <View style={[s.row, { backgroundColor: s.x.tabBar, borderTopWidth: 1, borderTopColor: s.c.border, paddingBottom: 2 }]}>
      {navItems.map((item) => {
        const active = selection.mainView === "tabs" && sideTab === item.value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => selectionStore.set((p) => ({ ...p, tab: item.value, mainView: "tabs" }))}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 2 }}
          >
            <View>
              <Icon name={item.icon} size={22} color={active ? s.c.accent : s.c.foregroundMuted} />
              {item.badge ? (
                <View style={{ position: "absolute", top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: s.c.accent }}>
                  <Text style={{ color: s.c.accentForeground, fontSize: 10, fontWeight: "700" }}>{item.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: active ? s.c.foreground : s.c.foregroundMuted, fontSize: 11 }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const tools: { icon: string; label: string; color: string; run(): void }[] = [
    { icon: "MonitorCog", label: "Nouvelle session", color: s.modal.x.ssh, run: () => dialogStore.set({ kind: "new" }) },
    { icon: "FileDown", label: "Importer", color: s.modal.x.orange, run: () => dialogStore.set({ kind: "import-moba" }) },
    { icon: "KeyRound", label: "Clés SSH", color: s.modal.x.star, run: () => showView("keys") },
    { icon: "Layers", label: "MultiExec", color: s.modal.x.blue, run: () => showView("multiexec") },
    { icon: "Cable", label: "Tunnels", color: s.modal.x.orange, run: () => showView("tunnels") },
    { icon: "ScrollText", label: "Journaux", color: s.modal.x.green, run: () => showView("logs") },
    ...(page ? [{ icon: "Settings", label: "Workspace", color: s.modal.c.foregroundMuted, run: () => setPickWorkspace(true) }] : []),
  ];
  const toolsSheet = toolsL.shown ? (
    <Modal title="Outils SSH" open={toolsL.open} onOpenChange={(o) => !o && setToolsOpen(false)}>
      <Modal.Content>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {tools.map((t) => (
            <Pressable
              key={t.label}
              onPress={() => {
                setToolsOpen(false);
                afterMenu(t.run);
              }}
              style={({ pressed }) => ({
                width: "31%",
                height: 84,
                paddingHorizontal: 4,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: s.modal.c.border,
                backgroundColor: pressed ? s.modal.c.surface2 : s.modal.c.surface1,
              })}
            >
              <Icon name={t.icon} size={26} color={t.color} />
              <Text style={[s.modal.text, { fontSize: 13, textAlign: "center" }]} numberOfLines={2}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal.Content>
    </Modal>
  ) : null;

  const statusBar =
    remoteMonitoring && current && !mobile ? (
      <View style={{ borderTopWidth: 1, borderTopColor: s.c.border }}>
        <MonitorBar key={current.id} s={s} server={current} />
      </View>
    ) : null;

  return (
    <VisibleContext.Provider value={visible}>
    <View ref={rootRef} style={{ flex: 1, backgroundColor: s.c.surface0 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {servers.error ? (
        <View style={{ padding: 8 }}>
          <ErrorBox s={s} message={errorMessage(servers.error)} />
        </View>
      ) : null}
      {width > 0 && !mobile ? toolbar : null}
      {width === 0 || servers.isLoading ? (
        <ActivityIndicator color={s.c.accent} style={{ marginTop: 24 }} />
      ) : mobile ? (
        <View style={{ flex: 1 }}>
          {mobileHeader}
          <View style={{ flex: 1 }}>
            {selection.mainView !== "tabs" || sideTab === "terminals"
              ? mainArea
              : sideTab === "files"
                ? filesSide
                : sideTab === "monitor"
                  ? (
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
                      {needServer((server) => <MonitorView key={server.id} s={s} server={server} />)}
                    </ScrollView>
                  )
                  : sessionsSide}
          </View>
          {/* Keyboard open: the tab bar gives way, the terminal and its keys sit right above the keyboard. */}
          {keyboard > 0 ? null : mobileNav}
        </View>
      ) : wide ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          {autoHide ? (
            <View style={{ width: 6, backgroundColor: s.c.border, zIndex: 20 }} {...webProps({ onMouseEnter: () => setPeekSoon(true), onMouseLeave: () => setPeekSoon(false) })}>
              {peek ? (
                <View
                  style={[
                    { position: "absolute", top: 0, bottom: 0, left: 0, width: 38 + sidebarWidth, backgroundColor: s.c.surface0, borderRightWidth: 1, borderRightColor: s.c.border, zIndex: 30 },
                    webStyle({ boxShadow: "4px 0 12px rgba(0,0,0,0.35)" }),
                  ]}
                >
                  {quickBar}
                  <View style={{ flex: 1, flexDirection: "row" }}>
                    {strip}
                    <View style={{ flex: 1, backgroundColor: s.c.surface0 }}>{sideContent}</View>
                  </View>
                </View>
              ) : null}
            </View>
          ) : (
          <View style={{ width: 38 + sidebarWidth }}>
            {quickBar}
            <View style={{ flex: 1, flexDirection: "row" }}>
              {strip}
              <View style={{ flex: 1, backgroundColor: s.c.surface0 }}>{sideContent}</View>
            </View>
          </View>
          )}
          {/* Drag to resize the left panel (double-click: default width). */}
          {autoHide ? null : (<View
            {...splitter.panHandlers}
            accessibilityLabel="Redimensionner la barre latérale"
            {...webProps({ onMouseDown: () => splitterPress.current("splitter", () => undefined, () => saveSideRef.current(360)) })}
            style={[
              {
                width: 5,
                backgroundColor: dragWidth !== null ? s.c.accent : s.c.border,
                borderLeftWidth: 2,
                borderRightWidth: 2,
                borderColor: dragWidth !== null ? s.c.accent : s.c.surface0,
              },
              webStyle({ cursor: "col-resize" }),
            ]}
          />)}
          {mainArea}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {quickBar}
          <View style={{ flex: 1, flexDirection: "row" }}>
            {strip}
            <View style={{ flex: 1 }}>{sideTab === "terminals" ? mainArea : sideContent}</View>
          </View>
        </View>
      )}
      {keyboard > 0 ? null : statusBar}
      {keyboard > 0 ? <View style={{ height: keyboard }} /> : null}
      {tabMenuL.shown ? ((tm) => (
        <Modal title={tm.label} open={tabMenuL.open} onOpenChange={(o) => !o && setTabMenu(null)}>
          <Modal.Content>
            {(
              [
                tm.dead && tm.serverId ? { icon: "RotateCcw", label: "Relancer la session", color: s.modal.x.green, fn: () => restartTab(tm) } : null,
                tm.serverId ? { icon: "CopyPlus", label: "Dupliquer la session (nouvel onglet)", color: s.modal.x.ssh, fn: () => void openTerminal({ id: tm.serverId }) } : null,
                !tm.dead
                  ? { icon: "CircleDot", label: tm.logging ? "Arrêter l'enregistrement (journal)" : "Enregistrer la session dans un journal", color: s.modal.x.red, fn: () => void toggleLog(tm) }
                  : null,
                !tm.dead ? { icon: "Bell", label: tm.watching ? "Modifier les alertes" : "Alertes (mot-clé, fin de commande...)", fn: () => setAlertEdit(tm) } : null,
                !tm.dead ? { icon: "FileDown", label: "Exporter l'historique (.txt)", fn: () => void exportHistory(tm) } : null,
                !tm.dead ? { icon: "TextCursorInput", label: "Renommer l'onglet", fn: () => setRenaming({ tab: tm, value: tm.label }) } : null,
                tm.serverId
                  ? {
                      icon: "FolderTree",
                      label: "Explorer les fichiers (Sftp)",
                      color: s.modal.x.orange,
                      fn: () => selectionStore.set((p) => ({ ...p, serverId: tm.serverId ?? p.serverId, tab: "files" })),
                    }
                  : null,
                !tm.dead && openWorkspace && targetWorkspace
                  ? { icon: "ExternalLink", label: "Ouvrir dans un terminal Paseo", fn: () => openWorkspace(targetWorkspace) }
                  : null,
                { icon: "X", label: "Fermer l'onglet", color: s.modal.x.red, fn: () => void closeTab(tm) },
                tabs.length > 1
                  ? {
                      icon: "ListX",
                      label: "Fermer les autres onglets",
                      color: s.modal.x.red,
                      fn: () =>
                        void (async () => {
                          const others = tabs.filter((t) => t.id !== tm.id);
                          if (!(await confirmAction("Fermer les autres onglets", `Fermer ${others.length} onglet(s) ?`, "Fermer"))) return;
                          for (const t of others) await closeTab(t, false);
                        })(),
                    }
                  : null,
              ] as ({ icon: string; label: string; color?: string; fn(): void } | null)[]
            )
              .filter((x): x is { icon: string; label: string; color?: string; fn(): void } => x !== null)
              .map((item) => (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    setTabMenu(null);
                    afterMenu(item.fn);
                  }}
                  style={(state) => [s.modal.row, { gap: 10, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 4, backgroundColor: isHovered(state) ? s.modal.c.surface2 : "transparent" }]}
                >
                  <Icon name={item.icon} size={16} color={item.color ?? s.modal.c.foreground} />
                  <Text style={s.modal.text}>{item.label}</Text>
                </Pressable>
              ))}
          </Modal.Content>
        </Modal>
      ))(tabMenuL.shown) : null}
      {renameL.shown ? (
        <Modal title="Renommer l'onglet" open={renameL.open} onOpenChange={(o) => !o && setRenaming(null)}>
          <Modal.Content>
            <TextInput
              value={renameL.shown.value}
              onChangeText={(value) => renaming && setRenaming({ ...renaming, value })}
              autoFocus
              onSubmitEditing={() => {
                if (renaming && renaming.value.trim()) void renameTab(renaming.tab, renaming.value.trim());
                setRenaming(null);
              }}
              style={s.modal.input}
            />
            <View style={[s.modal.row, { gap: 8, justifyContent: "flex-end" }]}>
              <Btn s={s.modal} label="Annuler" onPress={() => setRenaming(null)} />
              <Btn
                s={s.modal}
                primary
                label="Renommer"
                disabled={!renameL.shown.value.trim()}
                onPress={() => {
                  if (renaming) void renameTab(renaming.tab, renaming.value.trim());
                  setRenaming(null);
                }}
              />
            </View>
          </Modal.Content>
        </Modal>
      ) : null}
      {splitPickerL.shown ? (
        <Modal title="Split : plusieurs terminaux côte à côte" open={splitPickerL.open} onOpenChange={(o) => !o && setSplitPicker(false)}>
          <Modal.Content>
            <Text style={s.modal.muted}>Chaque terminal reste indépendant (cliquez dans un panneau pour y taper). Pour taper dans tous à la fois, utilisez MultiExec.</Text>
            {(
              [
                { layout: "2v" as const, icon: "Columns2", label: "2 terminaux côte à côte" },
                { layout: "2h" as const, icon: "Rows2", label: "2 terminaux l'un sous l'autre" },
                { layout: "4" as const, icon: "Grid2x2", label: "4 terminaux (2 x 2)" },
              ]
            ).map((o) => (
              <Pressable
                key={o.layout}
                onPress={() => {
                  setSplitPicker(false);
                  afterMenu(() => startSplit(o.layout));
                }}
                style={(state) => [s.modal.row, { gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 4, backgroundColor: isHovered(state) ? s.modal.c.surface2 : "transparent" }]}
              >
                <Icon name={o.icon} size={18} color={s.modal.x.ssh} />
                <Text style={s.modal.text}>{o.label}</Text>
              </Pressable>
            ))}
            {selection.mainView === "split" ? (
              <Btn
                s={s.modal}
                icon="X"
                label="Quitter le split"
                onPress={() => {
                  setSplitPicker(false);
                  showView("tabs");
                }}
              />
            ) : null}
          </Modal.Content>
        </Modal>
      ) : null}
      <Dialogs s={s} servers={list} />
      <ConfirmHost s={s} />
      {toolsSheet}
      <AlertModal s={s.modal} tab={alertEdit} current={alertEdit ? features.data?.watches[alertEdit.id] ?? null : null} onClose={() => setAlertEdit(null)} onSaved={() => void features.refetch()} />
      {page ? <WorkspacePicker s={s} paseo={paseo} open={pickWorkspace} onClose={() => setPickWorkspace(false)} /> : null}
    </View>
    </VisibleContext.Provider>
  );
}
