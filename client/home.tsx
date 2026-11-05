import type { PaseoApi, PaseoTerminal } from "./paseo-types";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactElement } from "react";
import { ActivityIndicator, Pressable, Text, View, type TextInput as NativeTextInput } from "react-native";
import type { Server } from "../shared/rpc";
import { prefsSettings } from "../shared/settings";
import { serverLabel } from "./data";
import { dialogStore } from "./dialog-store";
import { lastScreens, ScreenLines } from "./terminal-view";
import { errorMessage, isHovered, MONO, MONO_SURFACE, webProps, type AppTab, type Styles } from "./util";
import { Btn, ErrorBox, IconBtn } from "./widgets";

/** Home tab (MobaXterm welcome screen) and the workspace picker of the SSH page. */

/* ------------------------------------------------------------------ */
/* Workspace picker                                                    */
/* ------------------------------------------------------------------ */

export function WorkspacePicker({ s, paseo, open, onClose }: { s: Styles; paseo: PaseoApi; open: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const settings = useSettings(prefsSettings);
  const query = useQuery({ queryKey: ["ssh-manager", "workspaces"], queryFn: () => paseo.workspaces.list(), enabled: open });
  const current = settings.status === "ready" ? settings.values.workspaceId : "";
  const choose = (id: string) => {
    if (settings.status === "ready") void settings.save({ ...settings.values, workspaceId: id }, settings.revision);
    onClose();
  };
  return (
    <Modal title="Workspace des terminaux SSH" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Text style={s.modal.muted}>Les terminaux ouverts depuis cette page sont créés dans ce workspace Paseo (et visibles dans ses onglets).</Text>
        <Pressable onPress={() => choose("")} style={[s.modal.row, { gap: 8, paddingVertical: 6 }]}>
          <Icon name={current === "" ? "CircleCheck" : "Circle"} size={16} color={s.modal.c.accent} />
          <Text style={s.modal.text}>Dossier personnel de l'hôte Paseo (par défaut)</Text>
        </Pressable>
        {query.isLoading ? <ActivityIndicator color={s.modal.c.accent} /> : null}
        {query.error ? <ErrorBox s={s.modal} message={errorMessage(query.error)} /> : null}
        {(query.data?.entries ?? []).map((w) => (
          <Pressable key={w.id} onPress={() => choose(w.id)} style={[s.modal.row, { gap: 8, paddingVertical: 6 }]}>
            <Icon name={current === w.id ? "CircleCheck" : "Circle"} size={16} color={s.modal.c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={s.modal.text}>{w.name || w.projectDisplayName}</Text>
              <Text style={s.modal.small}>{w.workspaceDirectory ?? w.projectRootPath}</Text>
            </View>
          </Pressable>
        ))}
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Home tab (MobaXterm welcome screen)                                 */
/* ------------------------------------------------------------------ */

function BigButton({ s, icon, label, color, onPress }: { s: Styles; icon: string; label: string; color: string; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      style={(state) => [
        {
          width: 120,
          height: 96,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: isHovered(state) ? s.c.accent : s.c.border,
          backgroundColor: isHovered(state) ? s.c.surface2 : s.c.surface1,
        },
      ]}
    >
      <Icon name={icon} size={34} color={color} />
      <Text style={[s.text, { fontSize: 12, textAlign: "center" }]}>{label}</Text>
    </Pressable>
  );
}

export function Home({ s, servers, onOpen }: { s: Styles; servers: readonly Server[]; onOpen(id: string): void }) {
  const recent = servers
    .filter((x) => x.lastUsed)
    .slice()
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
    .slice(0, 10);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: s.x.termBg }} contentContainerStyle={{ alignItems: "center", padding: 32, gap: 28 }}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <View style={[s.row, { gap: 10 }]}>
          <Icon name="SquareTerminal" size={40} color={s.x.ssh} />
          <Text style={{ color: s.c.foreground, fontSize: 30, fontWeight: "300" }}>SSH Manager</Text>
        </View>
        <Text style={s.muted}>Client SSH, navigateur SFTP et outils réseau pour Paseo</Text>
      </View>
      <View style={[s.row, { gap: 16, flexWrap: "wrap", justifyContent: "center" }]}>
        <BigButton s={s} icon="MonitorCog" label="Nouvelle session" color={s.x.ssh} onPress={() => dialogStore.set({ kind: "new" })} />
        <BigButton s={s} icon="FileDown" label="Importer MobaXterm" color={s.x.orange} onPress={() => dialogStore.set({ kind: "import-moba" })} />
        <BigButton s={s} icon="FileKey" label="Importer ~/.ssh/config" color={s.x.green} onPress={() => dialogStore.set({ kind: "import-ssh" })} />
      </View>
      <View style={{ width: "100%", maxWidth: 520, gap: 6 }}>
        <Text style={[s.text, { fontWeight: "600" }]}>Sessions récentes</Text>
        <View style={{ height: 1, backgroundColor: s.c.border }} />
        {recent.length === 0 ? <Text style={s.muted}>Aucune session récente. Double-cliquez une session dans "User sessions".</Text> : null}
        {recent.map((x) => (
          <Pressable
            key={x.id}
            onPress={() => onOpen(x.id)}
            style={(state) => [s.row, { gap: 8, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 3, backgroundColor: isHovered(state) ? s.c.surface2 : "transparent" }]}
          >
            <Icon name="SquareTerminal" size={15} color={x.color || s.x.ssh} />
            <Text selectable={false} style={[s.text, { color: s.x.blue }]}>{x.name}</Text>
            <Text selectable={false} style={s.small}>{serverLabel(x)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.small, { textAlign: "center", maxWidth: 520 }]}>
        Astuce : tapez user@hote dans "Quick connect" puis Entrée pour une connexion rapide. Clic droit (ou appui long) sur une session pour
        son menu.
      </Text>
    </ScrollView>
  );
}
