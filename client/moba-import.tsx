import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mobaImportRpc, mobaParseRpc, type MobaSession } from "../shared/rpc";
import { useRefreshServers } from "./data";
import { dialogStore } from "./dialog-store";
import { afterMenu, errorMessage, MONO, type Styles } from "./util";
import { bytesToBase64, isWeb, pickFiles } from "./web";
import { Btn, Check, ErrorBox, Tabs } from "./widgets";

type Source = "file" | "path" | "paste";

export function MobaImportModal({ s, open, onClose }: { s: Styles; open: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const parse = useRpc(mobaParseRpc);
  const doImport = useRpc(mobaImportRpc);
  const refresh = useRefreshServers();
  const toast = useToast();
  const [source, setSource] = useState<Source>(isWeb ? "file" : "path");
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ sessions: MobaSession[]; skipped: { kind: string; count: number }[] } | null>(null);

  const parsed = useMutation({
    mutationFn: (input: { base64?: string; path?: string; text?: string }) => parse(input),
    onSuccess: (res) => {
      setResult(res);
      const next: Record<string, boolean> = {};
      res.sessions.forEach((m) => (next[m.key] = !m.alreadyImported));
      setSelected(next);
    },
  });

  const imported = useMutation({
    mutationFn: () =>
      doImport({ sessions: (result?.sessions ?? []).filter((m) => selected[m.key]), groupPrefix: prefix.trim() || undefined }),
    onSuccess: (res) => {
      toast.show(`${res.imported} session(s) MobaXterm importée(s)`, { variant: "success" });
      refresh();
      onClose();
    },
  });

  const chooseFile = async () => {
    const files = await pickFiles();
    const file = files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Fichier trop volumineux");
      return;
    }
    setFileName(file.name);
    const bytes = new Uint8Array(await file.slice(0, file.size).arrayBuffer());
    parsed.mutate({ base64: bytesToBase64(bytes) });
  };

  const sessions = result?.sessions ?? [];
  const groups = Array.from(new Set(sessions.map((m) => m.group || "(racine)")));
  const count = sessions.filter((m) => selected[m.key]).length;

  return (
    <Modal title="Importer les sessions MobaXterm" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <View style={[s.card, { padding: 10, gap: 4 }]}>
          <Text style={s.text}>Dans MobaXterm, deux possibilités :</Text>
          <Text style={s.muted}>
            1. Clic droit sur "User sessions" puis "Export all sessions to file" : vous obtenez un fichier .mxtsessions.
          </Text>
          <Text style={s.muted}>
            2. Ou prenez directement MobaXterm.ini (%APPDATA%\MobaXterm\MobaXterm.ini, ou à côté de MobaXterm.exe en version portable).
          </Text>
          <Text style={s.small}>
            Les sessions SSH et SFTP sont importées avec leurs dossiers, port, utilisateur, rebond (SSH gateway) et clé. Les mots de passe
            MobaXterm sont chiffrés et ne peuvent pas être repris. RDP, VNC, Telnet, etc. sont ignorés.
          </Text>
        </View>

        <Tabs<Source>
          s={s}
          value={source}
          onChange={setSource}
          options={[
            ...(isWeb ? [{ value: "file" as const, label: "Fichier de cet ordinateur", icon: "Upload" }] : []),
            { value: "path" as const, label: "Chemin sur l'hôte Paseo", icon: "HardDrive" },
            { value: "paste" as const, label: "Coller le contenu", icon: "ClipboardPaste" },
          ]}
        />
        {source === "file" ? (
          <View style={[s.row, { gap: 8 }]}>
            <Btn s={s} primary icon="FileUp" label="Choisir MobaXterm.ini ou .mxtsessions" busy={parsed.isPending} onPress={() => void chooseFile()} />
            {fileName ? <Text style={s.muted}>{fileName}</Text> : null}
          </View>
        ) : null}
        {source === "path" ? (
          <View style={[s.row, { gap: 8 }]}>
            <TextInput
              value={path}
              onChangeText={setPath}
              placeholder="~/MobaXterm.ini"
              placeholderTextColor={s.c.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[s.input, { flex: 1, fontFamily: MONO }]}
            />
            <Btn s={s} primary label="Lire" disabled={!path.trim()} busy={parsed.isPending} onPress={() => parsed.mutate({ path })} />
          </View>
        ) : null}
        {source === "paste" ? (
          <View style={{ gap: 8 }}>
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              placeholder={"[Bookmarks]\nSubRep=\nImgNum=42\nMonServeur=#109#0%10.0.0.1%22%root%..."}
              placeholderTextColor={s.c.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              style={[s.input, { minHeight: 120, fontFamily: MONO, fontSize: 11 }]}
            />
            <Btn s={s} primary label="Analyser" disabled={!text.trim()} busy={parsed.isPending} onPress={() => parsed.mutate({ text })} />
          </View>
        ) : null}

        {parsed.error ? <ErrorBox s={s} message={errorMessage(parsed.error)} /> : null}

        {result ? (
          <View style={{ gap: 8 }}>
            <View style={[s.row, { justifyContent: "space-between" }]}>
              <Text style={[s.text, { fontWeight: "600" }]}>
                {sessions.length} session(s) SSH trouvée(s)
                {result.skipped.length ? `  -  ignorées : ${result.skipped.map((k) => `${k.count} ${k.kind}`).join(", ")}` : ""}
              </Text>
              <View style={[s.row, { gap: 4 }]}>
                <Btn
                  s={s}
                  compact
                  label="Tout"
                  onPress={() => {
                    const next: Record<string, boolean> = {};
                    sessions.forEach((m) => (next[m.key] = true));
                    setSelected(next);
                  }}
                />
                <Btn s={s} compact label="Rien" onPress={() => setSelected({})} />
              </View>
            </View>
            {groups.map((g) => (
              <View key={g} style={{ gap: 2 }}>
                <View style={[s.row, { gap: 6, marginTop: 4 }]}>
                  <Icon name="Folder" size={14} color={s.x.folder} />
                  <Text style={[s.muted, { fontWeight: "600" }]}>{g}</Text>
                </View>
                {sessions
                  .filter((m) => (m.group || "(racine)") === g)
                  .map((m) => (
                    <View key={m.key} style={[s.row, { gap: 8, paddingLeft: 18, opacity: m.alreadyImported ? 0.55 : 1 }]}>
                      <Check s={s} checked={!!selected[m.key]} onToggle={() => setSelected({ ...selected, [m.key]: !selected[m.key] })} />
                      <Icon name="SquareTerminal" size={14} color={s.x.ssh} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.text}>
                          {m.name}
                          {m.kind !== "SSH" ? <Text style={s.small}>{`  (${m.kind})`}</Text> : null}
                          {m.alreadyImported ? <Text style={s.small}>{"  déjà présente"}</Text> : null}
                        </Text>
                        <Text style={s.small}>
                          {m.user ? `${m.user}@` : ""}
                          {m.host}
                          {m.port ? `:${m.port}` : ""}
                          {m.jumpHost ? `  via ${m.jumpHost}` : ""}
                          {m.identityFile ? `  clé ${m.identityFile}` : ""}
                        </Text>
                        {m.warning ? <Text style={[s.small, { color: s.c.statusWarning }]}>{m.warning}</Text> : null}
                      </View>
                    </View>
                  ))}
              </View>
            ))}
            <View style={{ gap: 4 }}>
              <Text style={s.muted}>Ranger dans un dossier (optionnel)</Text>
              <TextInput
                value={prefix}
                onChangeText={setPrefix}
                placeholder="MobaXterm"
                placeholderTextColor={s.c.foregroundMuted}
                style={s.input}
              />
            </View>
          </View>
        ) : null}

        {imported.error ? <ErrorBox s={s} message={errorMessage(imported.error)} /> : null}
        <Pressable
          onPress={() => {
            // Close this sheet first, then open the other one.
            dialogStore.set(null);
            afterMenu(() => dialogStore.set({ kind: "import-ssh" }));
          }}
          style={[s.row, { gap: 6 }]}
        >
          <Icon name="FileKey" size={13} color={s.x.blue} />
          <Text style={[s.small, { color: s.x.blue }]}>Importer plutôt depuis ~/.ssh/config de l'hôte Paseo</Text>
        </Pressable>
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn s={s} primary icon="Download" label={`Importer ${count} session(s)`} disabled={!count} busy={imported.isPending} onPress={() => imported.mutate()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
