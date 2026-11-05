import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { usePaseo, useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch, SidebarRow } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { prefsSettings } from "./shared/settings";
import { SshApp } from "./client/app";

const SCREEN_ID = "sessions";
const PANEL_ID = "ssh";

function SshScreen({ theme, navigation }: PluginScreenProps) {
  const paseo = usePaseo();
  return (
    <SshApp
      page
      theme={theme}
      paseo={paseo}
      workspaceId={null}
      localDir={null}
      openWorkspace={navigation ? (workspaceId) => navigation.openWorkspace({ workspaceId }) : undefined}
    />
  );
}

function SshPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  return <SshApp theme={theme} paseo={paseo} workspaceId={workspaceId} localDir={directory} />;
}

function SshSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="SquareTerminal"
      label="SSH"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
    />
  );
}

const INTERVALS = ["2", "5", "10", "30", "60"] as const;

function SshSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(prefsSettings);
  if (settings.status !== "ready") return null;
  const values = settings.values;
  const current = String(values.monitorInterval);
  return (
    <View style={{ gap: 16, backgroundColor: theme.colors.surface0 }}>
      <SettingsSection title="Apparence">
        <SettingsCard>
          <SettingsSelect
            label="Thème"
            hint="MobaXterm : reprend les couleurs sombres de MobaXterm. Paseo : suit le thème de l'application."
            value={values.appearance}
            options={[
              { label: "MobaXterm", value: "mobaxterm" },
              { label: "Paseo", value: "paseo" },
            ]}
            onValueChange={(v) => void settings.save({ ...values, appearance: v as "mobaxterm" | "paseo" }, settings.revision)}
          />
          <SettingsSwitch
            label="Remote monitoring"
            hint="Barre d'état en bas (CPU, RAM, réseau, uptime, utilisateurs, disques)."
            value={values.remoteMonitoring}
            onValueChange={(v) => void settings.save({ ...values, remoteMonitoring: v }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Terminal">
        <SettingsCard>
          <SettingsSelect
            label="Taille de police"
            hint="Aussi : Ctrl + molette, Ctrl + / Ctrl - dans le terminal."
            value={String(values.terminalFontSize)}
            options={["10", "11", "12", "13", "14", "15", "16", "18", "20", "22", "24"].map((v) => ({ label: `${v} px`, value: v }))}
            onValueChange={(v) => void settings.save({ ...values, terminalFontSize: Number(v) }, settings.revision)}
          />
          <SettingsSwitch
            label="Confirmer la fermeture d'une session"
            hint="Demande « Fermer la session ? » avant de fermer un onglet de terminal."
            value={values.confirmClose}
            onValueChange={(v) => void settings.save({ ...values, confirmClose: v }, settings.revision)}
          />
          <SettingsSwitch
            label="Copier à la sélection"
            hint="Comme MobaXterm : sélectionner du texte le copie dans le presse-papiers."
            value={values.copyOnSelect}
            onValueChange={(v) => void settings.save({ ...values, copyOnSelect: v }, settings.revision)}
          />
          <SettingsSwitch
            label="Clic droit pour coller"
            hint="Comme MobaXterm : le clic droit (et le clic molette) colle le presse-papiers."
            value={values.rightClickPaste}
            onValueChange={(v) => void settings.save({ ...values, rightClickPaste: v }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Monitoring">
        <SettingsCard>
          <SettingsSelect
            label="Rafraîchissement"
            hint="Intervalle entre deux mesures CPU / RAM / réseau / disques du serveur sélectionné."
            value={(INTERVALS as readonly string[]).includes(current) ? current : "5"}
            options={INTERVALS.map((v) => ({ label: `${v} s`, value: v }))}
            onValueChange={(v) => void settings.save({ ...values, monitorInterval: Number(v) }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: SCREEN_ID, title: "SSH", Component: SshScreen }),
    client.addSidebarHeaderItem({ id: "ssh-sidebar", title: "SSH", Component: SshSidebarItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "SSH",
      icon: "SquareTerminal",
      locations: ["workspace", "explorer"],
      Component: SshPanel,
    }),
    client.addSettingsScreen({ id: "ssh-settings", title: "SSH Manager", icon: "SquareTerminal", Component: SshSettings }),
    client.addCommandCenterItem({
      id: "ssh-open-page",
      title: "SSH : toutes mes sessions",
      icon: "SquareTerminal",
      keywords: ["ssh", "serveur", "server", "mobaxterm", "sftp", "terminal"],
      context: "global",
      onSelect: (ctx) => ctx.openScreen({ screenId: SCREEN_ID }),
    }),
    client.addCommandCenterItem({
      id: "ssh-open-panel",
      title: "SSH : ouvrir le panneau dans ce workspace",
      icon: "SquareTerminal",
      keywords: ["ssh", "sftp", "fichiers", "multi-exec"],
      context: "workspace",
      onSelect: (ctx) => ctx.openPanel(PANEL_ID, { location: "explorer" }),
    }),
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
