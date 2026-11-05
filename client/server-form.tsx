import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { serversSaveRpc, sshConfigImportRpc, sshConfigScanRpc, type Server } from "../shared/rpc";
import { useRefreshServers } from "./data";
import { useKeys } from "./keys-manager";
import { errorMessage, type Styles } from "./util";
import { Btn, Check, ErrorBox, Tabs } from "./widgets";

const COLORS = ["", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#14b8a6", "#64748b"];

function Field({
  s,
  label,
  value,
  onChange,
  placeholder,
  secure,
  hint,
  keyboard,
}: {
  s: Styles;
  label: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  secure?: boolean;
  hint?: string;
  keyboard?: "numeric";
}) {
  return (
    <View style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
      <Text style={s.muted}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={s.c.foregroundMuted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboard === "numeric" ? "numeric" : "default"}
        style={s.input}
      />
      {hint ? <Text style={s.small}>{hint}</Text> : null}
    </View>
  );
}

type FormTab = "basic" | "advanced" | "network" | "bookmark";

export function ServerFormModal({
  s,
  open,
  server,
  groups,
  defaultGroup,
  duplicate,
  onClose,
}: {
  s: Styles;
  open: boolean;
  server: Server | null;
  groups: string[];
  defaultGroup?: string;
  /** Save the form as a new session pre-filled from `server`. */
  duplicate?: boolean;
  onClose(): void;
}) {
  s = s.modal; // dialogs keep the Paseo theme
  const save = useRpc(serversSaveRpc);
  const refresh = useRefreshServers();
  const toast = useToast();
  const [tab, setTab] = useState<FormTab>("basic");
  const [name, setName] = useState(server ? (duplicate ? `${server.name} (copie)` : server.name) : "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(server?.port ? String(server.port) : "22");
  const [specifyUser, setSpecifyUser] = useState(!!server?.user || !server);
  const [user, setUser] = useState(server?.user ?? "");
  const [group, setGroup] = useState(server?.group ?? defaultGroup ?? "");
  const [identityFile, setIdentityFile] = useState(server?.identityFile ?? "");
  const [jumpHost, setJumpHost] = useState(server?.jumpHost ?? "");
  const [startDir, setStartDir] = useState(server?.startDir ?? "");
  const [startCommand, setStartCommand] = useState(server?.startCommand ?? "");
  const [logSession, setLogSession] = useState(!!server?.logSession);
  const [autoReconnect, setAutoReconnect] = useState(!!server?.autoReconnect);
  const [extraArgs, setExtraArgs] = useState(server?.extraArgs ?? "");
  const [color, setColor] = useState(server?.color ?? "");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const editing = server && !duplicate ? server : null;
  const keys = useKeys();

  const mutation = useMutation({
    mutationFn: () => {
      const p = port.trim() ? Number(port) : undefined;
      if (p !== undefined && (!Number.isInteger(p) || p < 1 || p > 65535)) throw new Error("Port invalide");
      return save({
        id: editing?.id,
        name: name.trim() || (specifyUser && user.trim() ? `${user.trim()}@${host.trim()}` : host.trim()),
        host: host.trim(),
        port: p,
        user: specifyUser ? user : "",
        group,
        identityFile,
        jumpHost,
        startDir,
        startCommand,
        logSession,
        autoReconnect,
        extraArgs,
        color,
        password: removePassword ? "" : password ? password : undefined,
      });
    },
    onSuccess: () => {
      toast.show(editing ? "Session modifiée" : "Session créée", { variant: "success" });
      refresh();
      onClose();
    },
  });

  const title = editing ? `Paramètres de la session : ${editing.name}` : "Paramètres de la session";

  return (
    <Modal title={title} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={{
              width: 64,
              alignItems: "center",
              gap: 4,
              paddingVertical: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: s.c.accent,
              backgroundColor: s.x.selection,
            }}
          >
            <Icon name="SquareTerminal" size={26} color={s.x.ssh} />
            <Text style={[s.text, { fontWeight: "600" }]}>SSH</Text>
          </View>
          <Text style={[s.muted, { flex: 1 }]}>
            Session SSH ouverte dans un terminal Paseo. Le navigateur de fichiers (SFTP), le monitoring et le multi-exec partagent la
            même connexion.
          </Text>
        </View>

        <Tabs<FormTab>
          s={s}
          value={tab}
          onChange={setTab}
          options={[
            { value: "basic", label: "Paramètres SSH de base", icon: "Settings" },
            { value: "advanced", label: "Paramètres SSH avancés", icon: "Wrench" },
            { value: "network", label: "Réseau", icon: "Network" },
            { value: "bookmark", label: "Favori", icon: "Star" },
          ]}
        />

        {tab === "basic" ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
              <Field s={s} label="Hôte distant *" value={host} onChange={setHost} placeholder="192.168.1.10 ou alias ~/.ssh/config" />
              <View style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
                <Check s={s} checked={specifyUser} onToggle={() => setSpecifyUser(!specifyUser)} label="Spécifier l'utilisateur" />
                <TextInput
                  value={user}
                  onChangeText={setUser}
                  editable={specifyUser}
                  placeholder="ubuntu"
                  placeholderTextColor={s.c.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[s.input, { opacity: specifyUser ? 1 : 0.5 }]}
                />
              </View>
              <View style={{ gap: 4, width: 90 }}>
                <Text style={s.muted}>Port</Text>
                <TextInput value={port} onChangeText={setPort} keyboardType="numeric" style={s.input} />
              </View>
            </View>
          </View>
        ) : null}

        {tab === "advanced" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ gap: 6, flexBasis: "100%" }}>
              <Field s={s} label="Clé privée (chemin sur l'hôte Paseo)" value={identityFile} onChange={setIdentityFile} placeholder="~/.ssh/id_ed25519" />
              {(keys.data?.keys ?? []).length ? (
                <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
                  <Text style={s.small}>Coffre de clés :</Text>
                  {(keys.data?.keys ?? []).map((k) => (
                    <Pressable
                      key={k.id}
                      onPress={() => setIdentityFile(k.path)}
                      style={[s.row, s.button, { paddingVertical: 3, gap: 4, borderColor: identityFile === k.path ? s.c.accent : s.c.border }]}
                    >
                      <Icon name={k.encrypted ? "KeySquare" : "KeyRound"} size={12} color={s.x.star} />
                      <Text style={s.small}>{k.name}</Text>
                    </Pressable>
                  ))}
                  {identityFile ? <Btn s={s} compact label="Aucune" onPress={() => setIdentityFile("")} /> : null}
                </View>
              ) : (
                <Text style={s.small}>Ajoutez vos clés dans l'onglet Clés (icône clé de la barre de gauche).</Text>
              )}
            </View>
            <Field
              s={s}
              label={editing?.hasPassword ? "Mot de passe (enregistré, vide = inchangé)" : "Mot de passe (optionnel)"}
              value={password}
              onChange={setPassword}
              secure
              hint="Stocké sur l'hôte Paseo (fichier 0600) et passé à ssh via SSH_ASKPASS. Une clé reste préférable."
            />
            <Field s={s} label="Dossier de départ (cd à la connexion)" value={startDir} onChange={setStartDir} placeholder="~/projets" />
            <Field
              s={s}
              label="Commande au démarrage (Execute command)"
              value={startCommand}
              onChange={setStartCommand}
              placeholder="htop   ou   tmux attach || tmux"
              hint="Exécutée après la connexion, puis le shell reste ouvert."
            />
            <Field s={s} label="Options ssh supplémentaires" value={extraArgs} onChange={setExtraArgs} placeholder="-C -X -o ServerAliveCountMax=5" />
            <View style={{ gap: 6, flexBasis: "100%" }}>
              <Check
                s={s}
                checked={autoReconnect}
                onToggle={() => setAutoReconnect(!autoReconnect)}
                label="Reconnexion automatique si la session est coupée (réseau, redémarrage du serveur)"
              />
              <Check
                s={s}
                checked={logSession}
                onToggle={() => setLogSession(!logSession)}
                label="Enregistrer automatiquement chaque session dans un journal (.log)"
              />
            </View>
            {editing?.hasPassword ? (
              <Check s={s} checked={removePassword} onToggle={() => setRemovePassword(!removePassword)} label="Supprimer le mot de passe enregistré" />
            ) : null}
          </View>
        ) : null}

        {tab === "network" ? (
          <View style={{ gap: 8 }}>
            <Field s={s} label="Passerelle SSH (jump host)" value={jumpHost} onChange={setJumpHost} placeholder="user@bastion:22" />
            <Text style={s.small}>Équivalent du "Connect through SSH gateway" de MobaXterm (ssh -J).</Text>
          </View>
        ) : null}

        {tab === "bookmark" ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <Field s={s} label="Nom de la session" value={name} onChange={setName} placeholder={host || "web-01 (Prod)"} />
              <Field s={s} label="Dossier (sous-dossiers avec /)" value={group} onChange={setGroup} placeholder={groups[0] ?? "Prod/Web"} />
            </View>
            {groups.length ? (
              <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
                {groups.map((g) => (
                  <Pressable key={g} onPress={() => setGroup(g)} style={[s.row, s.button, { paddingVertical: 3, gap: 4 }]}>
                    <Icon name="Folder" size={12} color={s.x.folder} />
                    <Text style={s.small}>{g}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ gap: 6 }}>
              <Text style={s.muted}>Couleur de l'onglet</Text>
              <View style={[s.row, { gap: 8 }]}>
                {COLORS.map((c) => (
                  <Pressable
                    key={c || "none"}
                    accessibilityLabel={c || "Aucune couleur"}
                    onPress={() => setColor(c)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: c || s.c.surface2,
                      borderWidth: color === c ? 2 : 1,
                      borderColor: color === c ? s.c.foreground : s.c.border,
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" icon="X" onPress={onClose} />
          <Btn s={s} primary icon="Check" label="OK" disabled={!host.trim()} busy={mutation.isPending} onPress={() => mutation.mutate()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

export function ImportModal({ s, open, onClose }: { s: Styles; open: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const scan = useRpc(sshConfigScanRpc);
  const doImport = useRpc(sshConfigImportRpc);
  const refresh = useRefreshServers();
  const toast = useToast();
  const query = useQuery({ queryKey: ["ssh-manager", "scan"], queryFn: () => scan({}), enabled: open });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const mutation = useMutation({
    mutationFn: () => doImport({ aliases: Object.keys(selected).filter((k) => selected[k]) }),
    onSuccess: (res) => {
      toast.show(`${res.imported} session(s) importée(s)`, { variant: "success" });
      refresh();
      onClose();
    },
  });
  const candidates = query.data?.candidates ?? [];
  return (
    <Modal title="Importer depuis ~/.ssh/config" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        {query.isLoading ? <Text style={s.muted}>Lecture...</Text> : null}
        {query.error ? <ErrorBox s={s} message={errorMessage(query.error)} /> : null}
        {!query.isLoading && candidates.length === 0 ? (
          <Text style={s.muted}>Aucun hôte trouvé dans ~/.ssh/config sur l'hôte Paseo.</Text>
        ) : null}
        {candidates.map((c) => (
          <View key={c.alias} style={[s.row, { gap: 8, opacity: c.alreadyImported ? 0.5 : 1 }]}>
            <Check
              s={s}
              checked={!!selected[c.alias]}
              onToggle={() => setSelected({ ...selected, [c.alias]: !selected[c.alias] })}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.text}>{c.alias}</Text>
              <Text style={s.small}>
                {[c.user ? `${c.user}@` : "", c.hostName ?? c.alias, c.port ? `:${c.port}` : "", c.jumpHost ? `  via ${c.jumpHost}` : ""].join("")}
                {c.alreadyImported ? "  (déjà importé)" : ""}
              </Text>
            </View>
          </View>
        ))}
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn
            s={s}
            primary
            icon="Download"
            label="Importer"
            disabled={!Object.values(selected).some(Boolean)}
            busy={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
