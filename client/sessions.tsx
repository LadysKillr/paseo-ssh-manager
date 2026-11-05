import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { serversDeleteRpc, serversDisconnectRpc, type Server, type ServerStatus } from "../shared/rpc";
import { serverLabel, useRefreshServers } from "./data";
import { MobaImportModal } from "./moba-import";
import { ImportModal, ServerFormModal } from "./server-form";
import { afterMenu, createDoublePress, errorMessage, isHovered, pressProps, useLinger, useStore, webProps, type Styles } from "./util";
import { confirmAction } from "./web";
import { Dot, Empty, IconBtn } from "./widgets";

/* ------------------------------------------------------------------ */
/* Dialogs shared by the whole app (new session, edit, imports)        */
/* ------------------------------------------------------------------ */

export { dialogStore, type Dialog } from "./dialog-store";
import { dialogStore } from "./dialog-store";

export function Dialogs({ s, servers }: { s: Styles; servers: readonly Server[] }) {
  const current = useStore(dialogStore);
  const { shown: dialog, open } = useLinger(current);
  const close = () => dialogStore.set(null);
  if (!dialog) return null;
  const groups = Array.from(new Set(servers.map((x) => x.group).filter((g): g is string => !!g))).sort();
  if (dialog.kind === "import-ssh") return <ImportModal s={s} open={open} onClose={close} />;
  if (dialog.kind === "import-moba") return <MobaImportModal s={s} open={open} onClose={close} />;
  if (dialog.kind === "new") return <ServerFormModal s={s} open={open} server={null} groups={groups} defaultGroup={dialog.group} onClose={close} />;
  return (
    <ServerFormModal
      key={`${dialog.kind}-${dialog.server.id}`}
      s={s}
      open={open}
      server={dialog.server}
      groups={groups}
      duplicate={dialog.kind === "duplicate"}
      onClose={close}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  servers: Server[];
}

function buildTree(servers: readonly Server[], filter: string): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], servers: [] };
  const needle = filter.trim().toLowerCase();
  for (const server of servers) {
    const hay = `${server.name} ${server.host} ${server.user ?? ""} ${server.group ?? ""}`.toLowerCase();
    if (needle && !hay.includes(needle)) continue;
    let node = root;
    const parts = (server.group ?? "").split("/").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      let child = node.folders.find((f) => f.name === part);
      if (!child) {
        child = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], servers: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.servers.push(server);
  }
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.servers.sort((a, b) => a.name.localeCompare(b.name));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function allServers(node: FolderNode): Server[] {
  return [...node.servers, ...node.folders.flatMap(allServers)];
}

export interface SessionsProps {
  s: Styles;
  servers: readonly Server[];
  statuses: Record<string, ServerStatus>;
  selectedId: string | null;
  filter: string;
  onSelect(id: string): void;
  onTerminal(target: { id?: string; quick?: string }): void;
  onFiles(id: string): void;
  onMonitor(id: string): void;
  /** Finger input: taller rows, a tap opens the session. */
  touch?: boolean;
}

function statusColor(s: Styles, st: ServerStatus | undefined): string {
  if (!st) return s.c.foregroundMuted;
  if (st.connected) return s.x.green;
  if (st.reachable) return s.x.blue;
  return s.x.red;
}

function statusText(st: ServerStatus | undefined): string {
  if (!st) return "statut inconnu";
  if (st.connected) return "connecté";
  if (st.reachable) return st.latencyMs !== null ? `joignable, ${st.latencyMs} ms` : "joignable";
  return `injoignable${st.error ? ` (${st.error})` : ""}`;
}

type Menu = { kind: "server"; server: Server } | { kind: "folder"; node: FolderNode } | null;

export function Sessions(props: SessionsProps) {
  const { s, servers, statuses, selectedId, filter } = props;
  const touch = !!props.touch;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<Menu>(null);
  const menuL = useLinger(menu);
  const press = useRef(createDoublePress());
  const del = useRpc(serversDeleteRpc);
  const disconnect = useRpc(serversDisconnectRpc);
  const refresh = useRefreshServers();
  const toast = useToast();
  const tree = buildTree(servers, filter);
  const filtering = filter.trim().length > 0;

  const remove = async (server: Server) => {
    if (!(await confirmAction("Supprimer la session", `Supprimer la session "${server.name}" ?`, "Supprimer"))) return;
    try {
      await del({ id: server.id });
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const contextMenu = (m: Menu) =>
    webProps({
      onContextMenu: (e: { preventDefault(): void }) => {
        e.preventDefault();
        setMenu(m);
      },
    });

  const renderFolder = (node: FolderNode, depth: number) => {
    const key = node.path || "__root__";
    const isRoot = depth === 0;
    const closed = !filtering && collapsed[key];
    return (
      <View key={key}>
        <Pressable
          onPress={() => setCollapsed({ ...collapsed, [key]: !collapsed[key] })}
          onLongPress={() => !isRoot && setMenu({ kind: "folder", node })}
          {...(isRoot ? {} : contextMenu({ kind: "folder", node }))}
          style={(state) => [
            s.row,
            {
              gap: touch ? 8 : 4,
              paddingVertical: touch ? 10 : 3,
              paddingLeft: 4 + depth * (touch ? 16 : 14),
              borderRadius: 2,
              backgroundColor: isHovered(state) ? s.c.surface2 : "transparent",
            },
          ]}
        >
          <Icon name={closed ? "ChevronRight" : "ChevronDown"} size={touch ? 16 : 12} color={s.c.foregroundMuted} />
          {isRoot ? (
            <Icon name="Star" size={touch ? 18 : 14} color={s.x.star} />
          ) : (
            <Icon name={closed ? "Folder" : "FolderOpen"} size={touch ? 18 : 14} color={s.x.folder} />
          )}
          <Text selectable={false} style={[s.text, { fontSize: touch ? 15 : 12, fontWeight: isRoot ? "600" : "400" }]} numberOfLines={1}>
            {isRoot ? "User sessions" : node.name}
          </Text>
          {isRoot ? null : <Text selectable={false} style={s.small}>({allServers(node).length})</Text>}
        </Pressable>
        {closed ? null : (
          <>
            {node.folders.map((f) => renderFolder(f, depth + 1))}
            {node.servers.map((server) => renderServer(server, depth + 1))}
          </>
        )}
      </View>
    );
  };

  const renderServer = (server: Server, depth: number) => {
    const st = statuses[server.id];
    const active = server.id === selectedId;
    return (
      <Pressable
        key={server.id}
        {...(touch
          ? {
              // Touch: a tap opens the session (the ... button gives the menu).
              onPress: () => {
                props.onSelect(server.id);
                props.onTerminal({ id: server.id });
              },
            }
          : pressProps(() =>
              press.current(
                server.id,
                () => props.onSelect(server.id),
                () => props.onTerminal({ id: server.id }),
              ),
            ))}
        onLongPress={() => setMenu({ kind: "server", server })}
        {...contextMenu({ kind: "server", server })}
        // @ts-expect-error title is a react-native-web prop (tooltip)
        title={`${serverLabel(server)}\n${statusText(st)}\nDouble-clic : ouvrir, clic droit : menu`}
        style={(state) => [
          s.row,
          {
            gap: touch ? 10 : 6,
            paddingVertical: touch ? 8 : 3,
            minHeight: touch ? 48 : undefined,
            paddingLeft: 4 + depth * (touch ? 16 : 14) + (touch ? 20 : 16),
            paddingRight: 4,
            borderRadius: 2,
            backgroundColor: active ? s.x.selection : isHovered(state) ? s.c.surface2 : "transparent",
          },
        ]}
      >
        <View>
          <Icon name="SquareTerminal" size={touch ? 20 : 14} color={server.color || s.x.ssh} />
          <View style={{ position: "absolute", right: -2, bottom: -2 }}>
            <Dot color={statusColor(s, st)} size={touch ? 8 : 6} />
          </View>
        </View>
        {touch ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text selectable={false} style={[s.text, { fontSize: 15 }]} numberOfLines={1}>
              {server.name}
            </Text>
            <Text selectable={false} style={s.small} numberOfLines={1}>
              {serverLabel(server)}
            </Text>
          </View>
        ) : (
          <Text selectable={false} style={[s.text, { fontSize: 12, flex: 1 }]} numberOfLines={1}>
            {server.name}
          </Text>
        )}
        {touch ? (
          <IconBtn s={s} icon="EllipsisVertical" label="Menu de la session" size={20} onPress={() => setMenu({ kind: "server", server })} />
        ) : active ? (
          <View style={[s.row, { gap: 0 }]}>
            <IconBtn s={s} icon="Play" label="Ouvrir la session" size={13} color={s.x.green} onPress={() => props.onTerminal({ id: server.id })} />
            <IconBtn s={s} icon="EllipsisVertical" label="Menu" size={13} onPress={() => setMenu({ kind: "server", server })} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  const menuItems = (m: NonNullable<Menu>): { icon: string; label: string; color?: string; fn(): void }[] => {
    if (m.kind === "folder") {
      const list = allServers(m.node);
      return [
        { icon: "Play", label: `Ouvrir toutes les sessions du dossier (${list.length})`, color: s.x.green, fn: () => list.forEach((x) => props.onTerminal({ id: x.id })) },
        { icon: "Plus", label: "Nouvelle session dans ce dossier", fn: () => dialogStore.set({ kind: "new", group: m.node.path }) },
      ];
    }
    const server = m.server;
    const st = statuses[server.id];
    const items = [
      { icon: "Play", label: "Exécuter (ouvrir la session)", color: s.x.green, fn: () => props.onTerminal({ id: server.id }) },
      { icon: "FolderTree", label: "Explorer les fichiers (SFTP)", color: s.x.orange, fn: () => props.onFiles(server.id) },
      { icon: "Activity", label: "Monitoring", fn: () => props.onMonitor(server.id) },
      { icon: "Pencil", label: "Modifier la session", fn: () => dialogStore.set({ kind: "edit", server }) },
      { icon: "CopyPlus", label: "Dupliquer la session", fn: () => dialogStore.set({ kind: "duplicate", server }) },
      {
        icon: "Clipboard",
        label: "Copier la commande ssh",
        fn: () => void copyText(`ssh ${server.port ? `-p ${server.port} ` : ""}${server.user ? `${server.user}@` : ""}${server.host}`).then(() => toast.show("Copié")),
      },
    ];
    if (st?.connected) {
      items.push({ icon: "Unplug", label: "Fermer la connexion partagée", fn: () => void disconnect({ id: server.id }).then(refresh) });
    }
    items.push({ icon: "Trash2", label: "Supprimer la session", color: s.x.red, fn: () => void remove(server) });
    return items;
  };

  return (
    <View>
      {servers.length === 0 ? (
        <Empty s={s} icon="Star" text="Aucune session. Créez-en une ou importez vos sessions MobaXterm." />
      ) : (
        renderFolder(tree, 0)
      )}
      {menuL.shown ? (
        <Modal
          title={menuL.shown.kind === "server" ? menuL.shown.server.name : menuL.shown.node.path}
          open={menuL.open}
          onOpenChange={(o) => !o && setMenu(null)}
        >
          <Modal.Content>
            {menuL.shown.kind === "server" ? (
              <Text style={s.modal.small}>{`${serverLabel(menuL.shown.server)}  -  ${statusText(statuses[menuL.shown.server.id])}`}</Text>
            ) : null}
            {menuItems(menuL.shown).map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setMenu(null);
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
      ) : null}
    </View>
  );
}
