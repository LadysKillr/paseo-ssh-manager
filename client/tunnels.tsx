import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { tunnelsActionRpc, tunnelsListRpc, tunnelsSaveRpc, type Server, type Tunnel, type TunnelState } from "../shared/rpc";
import { errorMessage, MONO, useLinger, type Styles } from "./util";
import { confirmAction } from "./web";
import { useVisible } from "./visibility";
import { Btn, Check, Dot, Empty, ErrorBox, IconBtn, Tabs } from "./widgets";

const KEY = ["ssh-manager", "tunnels"];

type Draft = Omit<Tunnel, "id"> & { id?: string };

const TYPE_HELP: Record<Tunnel["type"], string> = {
  local:
    "Redirection locale (-L) : un port de l'hôte Paseo mène à une machine joignable depuis le serveur (ex. une base de données privée).",
  remote: "Redirection distante (-R) : un port du serveur mène à une machine joignable depuis l'hôte Paseo.",
  dynamic: "Proxy SOCKS (-D) : un port de l'hôte Paseo sert de proxy SOCKS5 qui sort par le serveur.",
};

function describe(t: Tunnel, servers: readonly Server[]): string {
  const via = servers.find((x) => x.id === t.serverId)?.name ?? "?";
  const bind = `${t.bindAddress || "127.0.0.1"}:${t.bindPort}`;
  if (t.type === "dynamic") return `SOCKS ${bind}  via ${via}`;
  if (t.type === "local") return `${bind}  ->  ${t.destHost}:${t.destPort}  via ${via}`;
  return `${via}:${bind}  ->  ${t.destHost}:${t.destPort} (hôte Paseo)`;
}

function stateColor(s: Styles, st: TunnelState | undefined): string {
  if (!st) return s.c.foregroundMuted;
  if (st.status === "running") return s.x.green;
  if (st.status === "starting") return s.x.blue;
  if (st.status === "error") return s.x.red;
  return s.c.foregroundMuted;
}

function TunnelForm({ s, open, draft, servers, onClose }: { s: Styles; open: boolean; draft: Draft; servers: readonly Server[]; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const save = useRpc(tunnelsSaveRpc);
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(draft);
  const [bindPort, setBindPort] = useState(draft.bindPort ? String(draft.bindPort) : "");
  const [destPort, setDestPort] = useState(draft.destPort ? String(draft.destPort) : "");
  const mutation = useMutation({
    mutationFn: () => {
      const bp = Number(bindPort);
      const dp = d.type === "dynamic" ? 0 : Number(destPort);
      if (!Number.isInteger(bp) || bp < 1 || bp > 65535) throw new Error("Port d'écoute invalide");
      if (d.type !== "dynamic" && (!Number.isInteger(dp) || dp < 1 || dp > 65535)) throw new Error("Port de destination invalide");
      if (d.type !== "dynamic" && !d.destHost.trim()) throw new Error("Hôte de destination manquant");
      if (!d.serverId) throw new Error("Choisissez la session SSH qui porte le tunnel");
      return save({ ...d, bindPort: bp, destPort: dp, destHost: d.type === "dynamic" ? "" : d.destHost.trim() });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string, width?: number) => (
    <View style={{ gap: 4, flexGrow: width ? 0 : 1, width, flexBasis: width ?? 180 }}>
      <Text style={s.muted}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={s.c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, { fontFamily: MONO }]}
      />
    </View>
  );
  return (
    <Modal title={draft.id ? `Modifier ${draft.name}` : "Nouveau tunnel SSH"} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Tabs<Tunnel["type"]>
          s={s}
          value={d.type}
          onChange={(type) => setD({ ...d, type })}
          options={[
            { value: "local", label: "Local (-L)", icon: "ArrowRightToLine" },
            { value: "remote", label: "Distant (-R)", icon: "ArrowLeftToLine" },
            { value: "dynamic", label: "SOCKS (-D)", icon: "Globe" },
          ]}
        />
        <Text style={s.small}>{TYPE_HELP[d.type]}</Text>
        {field("Nom", d.name, (name) => setD({ ...d, name }), "Postgres prod")}
        <View style={{ gap: 4 }}>
          <Text style={s.muted}>Session SSH</Text>
          <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
            {servers.map((x) => (
              <Pressable
                key={x.id}
                onPress={() => setD({ ...d, serverId: x.id })}
                style={[s.row, s.button, { paddingVertical: 4, borderColor: d.serverId === x.id ? s.c.accent : s.c.border }]}
              >
                <Icon name="SquareTerminal" size={12} color={x.color || s.x.ssh} />
                <Text style={s.small}>{x.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={[s.row, { gap: 10, flexWrap: "wrap", alignItems: "flex-end" }]}>
          {field(
            d.type === "remote" ? "Adresse d'écoute (serveur)" : "Adresse d'écoute (hôte Paseo)",
            d.bindAddress,
            (bindAddress) => setD({ ...d, bindAddress }),
            "127.0.0.1",
          )}
          {field("Port d'écoute", bindPort, setBindPort, d.type === "dynamic" ? "1080" : "8080", 110)}
        </View>
        {d.type !== "dynamic" ? (
          <View style={[s.row, { gap: 10, flexWrap: "wrap", alignItems: "flex-end" }]}>
            {field(
              d.type === "local" ? "Destination (vue depuis le serveur)" : "Destination (vue depuis l'hôte Paseo)",
              d.destHost,
              (destHost) => setD({ ...d, destHost }),
              "localhost",
            )}
            {field("Port", destPort, setDestPort, "5432", 110)}
          </View>
        ) : null}
        <Check s={s} checked={d.autoStart} onToggle={() => setD({ ...d, autoStart: !d.autoStart })} label="Démarrer automatiquement (au lancement de Paseo) et relancer s'il tombe" />
        <Text style={s.small}>
          Écouter sur 127.0.0.1 réserve le tunnel à la machine Paseo (agents, outils). 0.0.0.0 ou l'adresse Tailscale le rend accessible depuis le réseau : à
          réserver aux réseaux de confiance.
        </Text>
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="Check" label="Enregistrer" busy={mutation.isPending} onPress={() => mutation.mutate()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** MobaSSHTunnel-like page: saved tunnels with their live state. */
export function Tunnels({ s, servers }: { s: Styles; servers: readonly Server[] }) {
  const list = useRpc(tunnelsListRpc);
  const action = useRpc(tunnelsActionRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const visible = useVisible();
  const query = useQuery({ queryKey: KEY, queryFn: () => list({}), refetchInterval: 2000, enabled: visible });
  const [draft, setDraft] = useState<Draft | null>(null);
  const form = useLinger(draft);
  const tunnels = query.data?.tunnels ?? [];
  const states = query.data?.states ?? {};

  const run = async (id: string, a: "start" | "stop" | "delete") => {
    try {
      await action({ id, action: a });
      void qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const blank: Draft = {
    name: "",
    serverId: servers[0]?.id ?? "",
    type: "local",
    bindAddress: "127.0.0.1",
    bindPort: 0,
    destHost: "localhost",
    destPort: 0,
    autoStart: false,
  };

  return (
    <View style={{ padding: 12, gap: 10, maxWidth: 900, width: "100%" }}>
      <View style={[s.row, { gap: 8 }]}>
        <Text style={[s.muted, { flex: 1 }]}>
          Redirections de ports par SSH, comme MobaSSHTunnel. Chaque tunnel a sa propre connexion : l'arrêter ne coupe pas les terminaux.
        </Text>
        <Btn s={s} primary icon="Plus" label="Nouveau tunnel" onPress={() => setDraft(blank)} />
      </View>
      {query.error ? <ErrorBox s={s} message={errorMessage(query.error)} /> : null}
      {query.data && tunnels.length === 0 ? <Empty s={s} icon="Cable" text="Aucun tunnel. Exemple : accéder à une base de données privée d'un serveur depuis la machine Paseo." /> : null}
      {tunnels.map((t) => {
        const st = states[t.id];
        // Started (running, connecting, or failing and retrying): offer to stop it.
        const on = !!st && st.status !== "stopped";
        return (
          <View key={t.id} style={[s.card, { padding: 10, gap: 4 }]}>
            <View style={[s.row, { gap: 8 }]}>
              <Dot color={stateColor(s, st)} size={10} />
              <Text style={[s.text, { fontWeight: "600" }]}>{t.name}</Text>
              <Text style={s.small}>{t.type === "local" ? "-L" : t.type === "remote" ? "-R" : "-D"}</Text>
              {t.autoStart ? <Text style={[s.small, { color: s.x.green }]}>auto</Text> : null}
              <View style={{ flex: 1 }} />
              {on ? (
                <Btn s={s} compact icon="Square" label="Arrêter" onPress={() => void run(t.id, "stop")} />
              ) : (
                <Btn s={s} compact primary icon="Play" label="Démarrer" onPress={() => void run(t.id, "start")} />
              )}
              <IconBtn s={s} icon="Pencil" label="Modifier" onPress={() => setDraft(t)} />
              <IconBtn
                s={s}
                icon="Trash2"
                label="Supprimer"
                color={s.x.red}
                onPress={() =>
                  void confirmAction("Supprimer le tunnel", `Supprimer "${t.name}" ?`, "Supprimer").then((ok) => {
                    if (ok) void run(t.id, "delete");
                  })
                }
              />
            </View>
            <Text style={[s.small, { fontFamily: MONO }]}>{describe(t, servers)}</Text>
            <Text style={[s.small, { color: stateColor(s, st) }]}>
              {st?.status === "running"
                ? `Actif${st.since ? ` depuis ${new Date(st.since).toLocaleTimeString()}` : ""}`
                : st?.status === "starting"
                  ? "Connexion..."
                  : st?.status === "error"
                    ? `Erreur : ${st.error ?? "?"} (nouvel essai dans 10 s)`
                    : "Arrêté"}
            </Text>
          </View>
        );
      })}
      {form.shown ? <TunnelForm key={form.shown.id ?? "new"} s={s} open={form.open} draft={form.shown} servers={servers} onClose={() => setDraft(null)} /> : null}
    </View>
  );
}
