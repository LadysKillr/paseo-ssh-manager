import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  keysDeleteRpc,
  keysDeployRpc,
  keysGenerateRpc,
  keysImportRpc,
  keysListRpc,
  keysPassphraseRpc,
  type KeyInfo,
  type KeyOpResult,
  type Server,
} from "../shared/rpc";
import { useRefreshServers } from "./data";
import { errorMessage, isHovered, MONO, useLinger, type Styles } from "./util";
import { confirmAction, isWeb, pickFiles } from "./web";
import { Btn, Check, Dot, Empty, ErrorBox, IconBtn, Tabs } from "./widgets";

export const KEYS_KEY = ["ssh-manager", "keys"];

export function useKeys() {
  const list = useRpc(keysListRpc);
  return useQuery({ queryKey: KEYS_KEY, queryFn: () => list({}), staleTime: 15_000 });
}

function Label({ s, children }: { s: Styles; children: string }) {
  return <Text style={s.muted}>{children}</Text>;
}

function Input(props: {
  s: Styles;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  secure?: boolean;
  mono?: boolean;
  multiline?: boolean;
}) {
  const { s } = props;
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      placeholder={props.placeholder}
      placeholderTextColor={s.c.foregroundMuted}
      secureTextEntry={props.secure}
      multiline={props.multiline}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      textAlignVertical={props.multiline ? "top" : undefined}
      style={[s.input, props.mono ? { fontFamily: MONO, fontSize: 11 } : null, props.multiline ? { minHeight: 140 } : null]}
    />
  );
}

function SecurityNote({ s, children }: { s: Styles; children: string }) {
  return (
    <View style={[s.row, { gap: 8, alignItems: "flex-start", padding: 8, borderRadius: 4, borderWidth: 1, borderColor: s.c.border, backgroundColor: s.c.surface1 }]}>
      <Icon name="ShieldCheck" size={16} color={s.x.green} />
      <Text style={[s.small, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Generate (MobaKeyGen)                                               */
/* ------------------------------------------------------------------ */

function GenerateModal({ s, open, onClose }: { s: Styles; open: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const generate = useRpc(keysGenerateRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"ed25519" | "rsa" | "ecdsa">("ed25519");
  const [comment, setComment] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [remember, setRemember] = useState(true);
  const mismatch = pass !== pass2;
  const mutation = useMutation({
    mutationFn: () => generate({ name: name.trim(), type, comment: comment.trim() || undefined, passphrase: pass || undefined, rememberPassphrase: remember }),
    onSuccess: (res) => {
      toast.show(`Clé "${res.key.name}" générée`, { variant: "success" });
      void qc.invalidateQueries({ queryKey: KEYS_KEY });
      onClose();
    },
  });
  return (
    <Modal title="Générer une paire de clés (MobaKeyGen)" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Label s={s}>Nom</Label>
        <Input s={s} value={name} onChange={setName} placeholder="cle-prod" />
        <Label s={s}>Type</Label>
        <Tabs<"ed25519" | "rsa" | "ecdsa">
          s={s}
          value={type}
          onChange={setType}
          options={[
            { value: "ed25519", label: "Ed25519 (recommandé)", icon: "Sparkles" },
            { value: "rsa", label: "RSA 4096", icon: "KeyRound" },
            { value: "ecdsa", label: "ECDSA 521", icon: "KeyRound" },
          ]}
        />
        <Label s={s}>Commentaire (visible dans authorized_keys)</Label>
        <Input s={s} value={comment} onChange={setComment} placeholder={`${name || "cle"}@paseo`} />
        <Label s={s}>Phrase de passe (fortement conseillée)</Label>
        <Input s={s} value={pass} onChange={setPass} secure />
        <Label s={s}>Confirmer la phrase de passe</Label>
        <Input s={s} value={pass2} onChange={setPass2} secure />
        {mismatch && pass2 ? <Text style={[s.small, { color: s.x.red }]}>Les phrases de passe diffèrent.</Text> : null}
        {pass ? (
          <Check s={s} checked={remember} onToggle={() => setRemember(!remember)} label="Mémoriser la phrase de passe sur l'hôte Paseo (pour le Sftp, le monitoring et le multi-exec)" />
        ) : null}
        <SecurityNote s={s}>
          La clé est générée directement sur l'hôte Paseo par ssh-keygen et stockée dans un dossier 0700 (fichier 0600). La clé privée n'est
          jamais renvoyée à l'application : seule la clé publique est affichée et publiée. La phrase de passe est transmise à ssh-keygen par
          SSH_ASKPASS, jamais en argument de commande.
        </SecurityNote>
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="KeyRound" label="Générer" disabled={!name.trim() || mismatch} busy={mutation.isPending} onPress={() => mutation.mutate()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

type ImportSource = "path" | "file" | "paste";

function ImportKeyModal({ s, open, puttygen, onClose }: { s: Styles; open: boolean; puttygen: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const doImport = useRpc(keysImportRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const [source, setSource] = useState<ImportSource>("path");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const mutation = useMutation({
    mutationFn: () =>
      doImport({
        name: name.trim() || (fileName ?? path.split("/").pop() ?? "cle").replace(/\.(ppk|pem|key)$/i, ""),
        privateKey: source === "path" ? undefined : text,
        path: source === "path" ? path.trim() : undefined,
        passphrase: pass || undefined,
        rememberPassphrase: remember,
      }),
    onSuccess: (res) => {
      setText("");
      toast.show(`Clé "${res.key.name}" importée (${res.key.type})`, { variant: "success" });
      void qc.invalidateQueries({ queryKey: KEYS_KEY });
      onClose();
    },
  });
  const choose = async () => {
    const files = await pickFiles();
    const f = files[0];
    if (!f) return;
    if (f.size > 64 * 1024) {
      toast.error("Ce fichier est trop gros pour être une clé privée.");
      return;
    }
    const bytes = new Uint8Array(await f.slice(0, f.size).arrayBuffer());
    let str = "";
    for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]!);
    setText(str);
    setFileName(f.name);
    if (!name) setName(f.name.replace(/\.(ppk|pem|key)$/i, ""));
  };
  const ready = source === "path" ? !!path.trim() : !!text.trim();
  return (
    <Modal title="Importer une clé privée" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Tabs<ImportSource>
          s={s}
          value={source}
          onChange={setSource}
          options={[
            { value: "path", label: "Chemin sur l'hôte Paseo", icon: "HardDrive" },
            ...(isWeb ? [{ value: "file" as const, label: "Fichier de cet ordinateur", icon: "FileUp" }] : []),
            { value: "paste", label: "Coller", icon: "ClipboardPaste" },
          ]}
        />
        {source === "path" ? (
          <>
            <Label s={s}>Fichier de clé privée présent sur la machine Paseo</Label>
            <Input s={s} value={path} onChange={setPath} placeholder="~/cles/id_rsa ou ~/cles/srv.ppk" mono />
            <SecurityNote s={s}>
              Méthode la plus sûre : la clé ne transite pas par l'application. Copiez-la d'abord sur l'hôte (ex. scp depuis votre PC), elle
              est ensuite recopiée dans le coffre du plugin (0600) ; vous pouvez alors supprimer la copie d'origine.
            </SecurityNote>
          </>
        ) : null}
        {source === "file" ? (
          <View style={[s.row, { gap: 8 }]}>
            <Btn s={s} primary icon="FileUp" label="Choisir la clé (id_rsa, .pem, .ppk)" onPress={() => void choose()} />
            {fileName ? <Text style={s.muted}>{fileName}</Text> : null}
          </View>
        ) : null}
        {source === "paste" ? (
          <Input s={s} value={text} onChange={setText} multiline mono placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"} />
        ) : null}
        {source !== "path" ? (
          <SecurityNote s={s}>
            La clé est envoyée une seule fois au daemon par la connexion Paseo déjà authentifiée, validée puis stockée en 0600. Elle n'est
            jamais renvoyée ni affichée. Gardez une phrase de passe sur la clé si elle doit transiter.
          </SecurityNote>
        ) : null}
        <Label s={s}>Nom dans le gestionnaire</Label>
        <Input s={s} value={name} onChange={setName} placeholder="cle-mobaxterm" />
        <Label s={s}>Phrase de passe de la clé (si elle en a une)</Label>
        <Input s={s} value={pass} onChange={setPass} secure />
        {pass ? (
          <Check s={s} checked={remember} onToggle={() => setRemember(!remember)} label="Mémoriser la phrase de passe sur l'hôte Paseo" />
        ) : null}
        {!puttygen ? (
          <Text style={s.small}>Clés PuTTY (.ppk) : installez puttygen sur l'hôte (sudo apt install putty-tools) pour la conversion automatique.</Text>
        ) : (
          <Text style={s.small}>Les clés PuTTY (.ppk) sont converties automatiquement au format OpenSSH.</Text>
        )}
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="Import" label="Importer" disabled={!ready} busy={mutation.isPending} onPress={() => mutation.mutate()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Deploy to servers                                                   */
/* ------------------------------------------------------------------ */

type DeployAction = "publish" | "check" | "revoke";

function DeployModal({ s, open, keyInfo, servers, initial, onClose }: { s: Styles; open: boolean; keyInfo: KeyInfo; servers: readonly Server[]; initial: DeployAction; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const deploy = useRpc(keysDeployRpc);
  const qc = useQueryClient();
  const refreshServers = useRefreshServers();
  const [action, setAction] = useState<DeployAction>(initial);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [setIdentity, setSetIdentity] = useState(true);
  const [results, setResults] = useState<KeyOpResult[] | null>(null);
  const ids = servers.filter((x) => selected[x.id]).map((x) => x.id);
  const mutation = useMutation({
    mutationFn: () => deploy({ id: keyInfo.id, serverIds: ids, action, setAsIdentity: action === "publish" ? setIdentity : undefined }),
    onSuccess: (res) => {
      setResults(res.results);
      void qc.invalidateQueries({ queryKey: KEYS_KEY });
      refreshServers();
    },
  });
  const go = async () => {
    if (action === "revoke") {
      const ok = await confirmAction(
        "Révoquer la clé",
        `Retirer "${keyInfo.name}" du fichier ~/.ssh/authorized_keys de ${ids.length} serveur(s) ? Les autres clés ne sont pas touchées.`,
        "Révoquer",
      );
      if (!ok) return;
    }
    mutation.mutate();
  };
  return (
    <Modal title={`Clé ${keyInfo.name} sur les serveurs`} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Tabs<DeployAction>
          s={s}
          value={action}
          onChange={(a) => {
            setAction(a);
            setResults(null);
          }}
          options={[
            { value: "publish", label: "Publier", icon: "Upload" },
            { value: "check", label: "Vérifier", icon: "ShieldQuestion" },
            { value: "revoke", label: "Révoquer", icon: "ShieldX" },
          ]}
        />
        <Text style={s.muted}>
          {action === "publish"
            ? "Ajoute la clé PUBLIQUE dans ~/.ssh/authorized_keys (crée ~/.ssh en 700 et le fichier en 600, sans doublon), puis teste une connexion avec cette clé seule. La session doit déjà pouvoir se connecter (mot de passe, autre clé ou terminal ouvert)."
            : action === "check"
              ? "Teste une connexion avec cette clé uniquement (sans mot de passe ni connexion partagée)."
              : "Retire uniquement les lignes contenant cette clé publique. Refusé pour les sessions qui se connectent avec cette clé."}
        </Text>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Text style={[s.muted, { fontWeight: "600" }]}>
            Sessions : {ids.length}/{servers.length}
          </Text>
          <View style={[s.row, { gap: 4 }]}>
            <Btn
              s={s}
              compact
              label="Toutes"
              onPress={() => {
                const next: Record<string, boolean> = {};
                servers.forEach((x) => (next[x.id] = true));
                setSelected(next);
              }}
            />
            <Btn s={s} compact label="Aucune" onPress={() => setSelected({})} />
          </View>
        </View>
        <View style={{ gap: 2 }}>
          {servers.map((x) => {
            const r = results?.find((y) => y.id === x.id);
            return (
              <View key={x.id} style={{ gap: 2 }}>
                <View style={[s.row, { gap: 8 }]}>
                  <Check s={s} checked={!!selected[x.id]} onToggle={() => setSelected({ ...selected, [x.id]: !selected[x.id] })} />
                  <Icon name="SquareTerminal" size={13} color={x.color || s.x.ssh} />
                  <Text style={[s.text, { flex: 1 }]}>{x.name}</Text>
                  {r ? <Dot color={r.ok ? s.x.green : s.x.red} /> : null}
                </View>
                {r ? <Text style={[s.small, { paddingLeft: 46, color: r.ok ? s.c.foregroundMuted : s.x.red }]}>{r.message}</Text> : null}
              </View>
            );
          })}
        </View>
        {action === "publish" ? (
          <Check s={s} checked={setIdentity} onToggle={() => setSetIdentity(!setIdentity)} label="Utiliser cette clé pour ces sessions une fois la connexion vérifiée" />
        ) : null}
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Fermer" onPress={onClose} />
          <Btn
            s={s}
            primary
            danger={action === "revoke"}
            icon={action === "publish" ? "Upload" : action === "check" ? "ShieldQuestion" : "ShieldX"}
            label={action === "publish" ? "Publier" : action === "check" ? "Vérifier" : "Révoquer"}
            disabled={!ids.length}
            busy={mutation.isPending}
            onPress={() => void go()}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Passphrase memory                                                   */
/* ------------------------------------------------------------------ */

function PassphraseModal({ s, open, keyInfo, onClose }: { s: Styles; open: boolean; keyInfo: KeyInfo; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const set = useRpc(keysPassphraseRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const [pass, setPass] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string | null) => set({ id: keyInfo.id, passphrase: value }),
    onSuccess: (_, value) => {
      toast.show(value ? "Phrase de passe mémorisée" : "Phrase de passe oubliée", { variant: "success" });
      void qc.invalidateQueries({ queryKey: KEYS_KEY });
      onClose();
    },
  });
  return (
    <Modal title={`Phrase de passe de ${keyInfo.name}`} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Text style={s.muted}>
          Mémorisée, elle permet au Sftp, au monitoring et au multi-exec d'utiliser la clé sans terminal ouvert. Elle est vérifiée puis stockée
          en 0600 sur l'hôte Paseo et passée à ssh par SSH_ASKPASS.
        </Text>
        <Input s={s} value={pass} onChange={setPass} secure placeholder="Phrase de passe" />
        {mutation.error ? <ErrorBox s={s} message={errorMessage(mutation.error)} /> : null}
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          {keyInfo.passphraseStored ? <Btn s={s} danger icon="Trash2" label="Oublier" onPress={() => mutation.mutate(null)} /> : null}
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="Save" label="Vérifier et mémoriser" disabled={!pass} busy={mutation.isPending} onPress={() => mutation.mutate(pass)} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

type KeyDialog =
  | { kind: "generate" }
  | { kind: "import" }
  | { kind: "deploy"; key: KeyInfo; action: DeployAction }
  | { kind: "passphrase"; key: KeyInfo }
  | null;

export function KeyManager({ s, servers }: { s: Styles; servers: readonly Server[] }) {
  const keys = useKeys();
  const del = useRpc(keysDeleteRpc);
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<KeyDialog>(null);
  const dlg = useLinger(dialog);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = keys.data?.keys ?? [];

  const remove = async (k: KeyInfo) => {
    const lines = [
      `Supprimer définitivement la clé privée "${k.name}" (${k.type}, ${k.fingerprint}) et sa clé publique ?`,
      k.source === "ssh-dir"
        ? `ATTENTION : ce fichier est dans ~/.ssh de l'hôte Paseo (${k.path}). D'autres outils de cette machine (git, scripts, autres connexions) peuvent l'utiliser.`
        : "",
      k.usedBy.length ? `Sessions qui l'utilisent (la clé leur sera retirée) : ${k.usedBy.join(", ")}.` : "",
      "Conseil : révoquez-la d'abord sur les serveurs (bouton Révoquer), sinon elle restera autorisée dans leurs authorized_keys.",
      "Cette action est irréversible.",
    ].filter(Boolean);
    if (!(await confirmAction("Supprimer la clé", lines.join("\n\n"), "Supprimer"))) return;
    if (k.source === "ssh-dir" && !(await confirmAction("Confirmer", `Vraiment supprimer ${k.path} ?`, "Oui, supprimer"))) return;
    try {
      const res = await del({ id: k.id, detach: true });
      toast.show(res.detached.length ? `Clé supprimée et retirée de : ${res.detached.join(", ")}` : "Clé supprimée", { variant: "success" });
      if (openId === k.id) setOpenId(null);
      void qc.invalidateQueries({ queryKey: KEYS_KEY });
      void qc.invalidateQueries({ queryKey: ["ssh-manager", "servers"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.row, { gap: 0, paddingHorizontal: 2, backgroundColor: s.x.toolbar, borderBottomWidth: 1, borderBottomColor: s.c.border }]}>
        <IconBtn s={s} icon="KeyRound" label="Générer une paire de clés" color={s.x.star} size={15} onPress={() => setDialog({ kind: "generate" })} />
        <IconBtn s={s} icon="Import" label="Importer une clé privée" color={s.x.green} size={15} onPress={() => setDialog({ kind: "import" })} />
        <IconBtn s={s} icon="RefreshCw" label="Rafraîchir" color={s.x.green} size={15} onPress={() => void qc.invalidateQueries({ queryKey: KEYS_KEY })} />
      </View>
      <View style={{ padding: 8, gap: 6 }}>
        {keys.isLoading ? <ActivityIndicator color={s.c.accent} /> : null}
        {keys.error ? <ErrorBox s={s} message={errorMessage(keys.error)} /> : null}
        {keys.data && list.length === 0 ? (
          <Empty s={s} icon="KeyRound" text="Aucune clé. Générez une paire de clés ou importez votre clé privée MobaXterm / PuTTY.">
            <View style={[s.row, { gap: 8 }]}>
              <Btn s={s} primary icon="KeyRound" label="Générer" onPress={() => setDialog({ kind: "generate" })} />
              <Btn s={s} icon="Import" label="Importer" onPress={() => setDialog({ kind: "import" })} />
            </View>
          </Empty>
        ) : null}
        {list.map((k) => {
          const open = openId === k.id;
          return (
            <View key={k.id} style={{ borderWidth: 1, borderColor: open ? s.c.accent : s.c.border, borderRadius: 4, backgroundColor: s.c.surface1 }}>
              <Pressable
                onPress={() => setOpenId(open ? null : k.id)}
                style={(state) => [s.row, { gap: 8, padding: 8, backgroundColor: isHovered(state) ? s.c.surface2 : "transparent" }]}
              >
                <Icon name={k.encrypted ? "KeySquare" : "KeyRound"} size={18} color={k.encrypted ? s.x.green : s.x.star} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.text, { fontWeight: "600" }]} numberOfLines={1}>
                    {k.name}
                  </Text>
                  <Text style={s.small} numberOfLines={1}>
                    {k.type} {k.bits ? `${k.bits} bits` : ""}
                    {k.source === "ssh-dir" ? "  -  ~/.ssh" : ""}
                    {k.encrypted ? (k.passphraseStored ? "  -  phrase mémorisée" : "  -  protégée") : "  -  sans phrase de passe"}
                    {k.usedBy.length ? `  -  ${k.usedBy.length} session(s)` : ""}
                  </Text>
                </View>
                <IconBtn s={s} icon="Trash2" label={`Supprimer la clé ${k.name}`} color={s.x.red} size={14} onPress={() => void remove(k)} />
                <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={s.c.foregroundMuted} />
              </Pressable>
              {open ? (
                <View style={{ padding: 8, paddingTop: 0, gap: 6 }}>
                  <Text style={[s.small, { fontFamily: MONO }]} selectable>
                    {k.fingerprint}
                  </Text>
                  <Text style={[s.small, { fontFamily: MONO, color: s.c.foreground }]} selectable numberOfLines={3}>
                    {k.publicKey}
                  </Text>
                  {k.usedBy.length ? <Text style={s.small}>Utilisée par : {k.usedBy.join(", ")}</Text> : null}
                  {!k.encrypted ? (
                    <Text style={[s.small, { color: s.c.statusWarning }]}>
                      Clé sans phrase de passe : quiconque lit ce fichier peut se connecter. Préférez une clé protégée.
                    </Text>
                  ) : null}
                  <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
                    <Btn s={s} compact primary icon="Upload" label="Publier" onPress={() => setDialog({ kind: "deploy", key: k, action: "publish" })} />
                    <Btn s={s} compact icon="ShieldQuestion" label="Vérifier" onPress={() => setDialog({ kind: "deploy", key: k, action: "check" })} />
                    <Btn s={s} compact icon="ShieldX" label="Révoquer" onPress={() => setDialog({ kind: "deploy", key: k, action: "revoke" })} />
                    <Btn
                      s={s}
                      compact
                      icon="Copy"
                      label="Copier la clé publique"
                      onPress={() => void copyText(k.publicKey).then(() => toast.show("Clé publique copiée"))}
                    />
                    {k.encrypted ? (
                      <Btn s={s} compact icon="LockKeyhole" label={k.passphraseStored ? "Phrase mémorisée" : "Mémoriser la phrase"} onPress={() => setDialog({ kind: "passphrase", key: k })} />
                    ) : null}
                    <Btn s={s} compact danger icon="Trash2" label="Supprimer" onPress={() => void remove(k)} />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        <SecurityNote s={s}>
          Les clés privées restent sur l'hôte Paseo (coffre 0700, fichiers 0600) et ne sont jamais renvoyées à l'application. Seule la clé
          publique est affichée et publiée sur les serveurs.
        </SecurityNote>
      </View>
      {dlg.shown?.kind === "generate" ? <GenerateModal s={s} open={dlg.open} onClose={() => setDialog(null)} /> : null}
      {dlg.shown?.kind === "import" ? (
        <ImportKeyModal s={s} open={dlg.open} puttygen={keys.data?.puttygen ?? false} onClose={() => setDialog(null)} />
      ) : null}
      {dlg.shown?.kind === "deploy" ? (
        <DeployModal
          s={s}
          open={dlg.open}
          keyInfo={dlg.shown.key}
          servers={servers}
          initial={dlg.shown.action}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dlg.shown?.kind === "passphrase" ? <PassphraseModal s={s} open={dlg.open} keyInfo={dlg.shown.key} onClose={() => setDialog(null)} /> : null}
    </View>
  );
}
