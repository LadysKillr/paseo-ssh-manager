import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  CHUNK_SIZE,
  filesArchiveChunkRpc,
  filesArchiveRpc,
  filesCopyServerRpc,
  filesActionRpc,
  filesDownloadChunkRpc,
  filesListRpc,
  filesReadTextRpc,
  filesTransferRpc,
  filesUploadChunkRpc,
  filesWriteTextRpc,
  type FileEntry,
  type Server,
} from "../shared/rpc";
import {
  errorMessage,
  formatBytes,
  formatDate,
  joinPath,
  MONO,
  parentPath,
  selectionStore,
  afterMenu,
  createDoublePress,
  MONO_SURFACE,
  isHovered,
  useLinger,
  pressProps,
  useStore,
  webProps,
  type Styles,
} from "./util";
import { base64ToBytes, bytesToBase64, confirmAction, isWeb, pickFiles, saveDownload, type PickedFile } from "./web";
import { useServers } from "./data";
import { Btn, Empty, ErrorBox, IconBtn } from "./widgets";

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

interface PromptState {
  title: string;
  label: string;
  value: string;
  confirm: string;
  resolve(value: string | null): void;
}

function PromptModal({ s, state, open, onDone }: { s: Styles; state: PromptState; open: boolean; onDone(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const [value, setValue] = useState(state.value);
  const finish = (v: string | null) => {
    state.resolve(v);
    onDone();
  };
  return (
    <Modal title={state.title} open={open} onOpenChange={(o) => !o && finish(null)}>
      <Modal.Content>
        <Text style={s.modal.muted}>{state.label}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => finish(value)}
          style={[s.modal.input, { fontFamily: MONO }]}
        />
        <View style={[s.modal.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s.modal} label="Annuler" onPress={() => finish(null)} />
          <Btn s={s.modal} primary label={state.confirm} onPress={() => finish(value)} disabled={!value.trim()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function EditorModal({ s, server, path, open, onClose }: { s: Styles; server: Server; path: string; open: boolean; onClose(): void }) {
  s = s.modal; // dialogs keep the Paseo theme
  const read = useRpc(filesReadTextRpc);
  const write = useRpc(filesWriteTextRpc);
  const toast = useToast();
  const query = useQuery({
    queryKey: ["ssh-manager", "read", server.id, path],
    queryFn: () => read({ id: server.id, path }),
    gcTime: 0,
  });
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = text ?? query.data?.text ?? "";
  const dirty = text !== null && text !== query.data?.text;
  const save = async () => {
    setSaving(true);
    try {
      await write({ id: server.id, path, text: value });
      toast.show("Fichier enregistré", { variant: "success" });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={path.split("/").pop() || path} open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content scrollable={false} style={{ minHeight: 420 }}>
        <Text style={s.modal.small} selectable>
          {server.name}:{path}
          {query.data ? `  -  ${formatBytes(query.data.size)}` : ""}
        </Text>
        {query.isLoading ? <ActivityIndicator color={s.modal.c.accent} /> : null}
        {query.error ? <ErrorBox s={s.modal} message={errorMessage(query.error)} /> : null}
        {query.data?.binary ? <ErrorBox s={s.modal} message="Fichier binaire : édition impossible, utilisez Télécharger." /> : null}
        {query.data && !query.data.binary ? (
          <TextInput
            {...MONO_SURFACE}
            multiline
            value={value}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            style={[s.modal.input, { flex: 1, minHeight: 360, fontFamily: MONO, fontSize: 12 }]}
          />
        ) : null}
        <View style={[s.modal.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s.modal} label="Fermer" onPress={onClose} />
          <Btn s={s.modal} primary icon="Save" label="Enregistrer" disabled={!dirty} busy={saving} onPress={() => void save()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* File browser                                                        */
/* ------------------------------------------------------------------ */

function entryIcon(e: FileEntry): { name: string; color: (s: Styles) => string } {
  if (e.type === "dir") return { name: "Folder", color: (s) => s.c.statusWarning };
  if (e.type === "link") return { name: e.linkDir ? "FolderSymlink" : "FileSymlink", color: (s) => s.c.accent };
  const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return { name: "FileImage", color: (s) => s.c.foregroundMuted };
  if (["zip", "gz", "tgz", "xz", "bz2", "7z", "rar", "tar", "zst"].includes(ext)) return { name: "FileArchive", color: (s) => s.c.foregroundMuted };
  if (["sh", "js", "ts", "tsx", "py", "go", "rs", "c", "h", "java", "rb", "php", "json", "yml", "yaml", "toml"].includes(ext))
    return { name: "FileCode", color: (s) => s.c.foregroundMuted };
  if (["log", "txt", "md", "conf", "cfg", "ini"].includes(ext) || e.name.startsWith(".")) return { name: "FileText", color: (s) => s.c.foregroundMuted };
  return { name: "File", color: (s) => s.c.foregroundMuted };
}

export interface FileBrowserProps {
  s: Styles;
  server: Server;
  /** Hide the permissions column. */
  compact: boolean;
  /** Also hide the date column (very narrow panels). */
  tiny?: boolean;
  /** Finger input: taller rows, size / date under the name, a tap opens. */
  touch?: boolean;
  /** Directory of the Paseo workspace on the daemon host, for transfers. */
  localDir: string | null;
  onOpenTerminalHere(dir: string): void;
}

type SortKey = "name" | "size" | "mtime";

export function FileBrowser({ s, server, compact, tiny, touch = false, localDir, onOpenTerminalHere }: FileBrowserProps) {
  const list = useRpc(filesListRpc);
  const action = useRpc(filesActionRpc);
  const downloadChunk = useRpc(filesDownloadChunkRpc);
  const uploadChunk = useRpc(filesUploadChunkRpc);
  const transfer = useRpc(filesTransferRpc);
  const archive = useRpc(filesArchiveRpc);
  const archiveChunk = useRpc(filesArchiveChunkRpc);
  const copyServer = useRpc(filesCopyServerRpc);
  const allServers = useServers();
  const toast = useToast();
  const qc = useQueryClient();
  const selection = useStore(selectionStore);
  const requested = selection.filePaths[server.id] ?? server.startDir ?? "~";
  const [pathInput, setPathInput] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [menu, setMenu] = useState<FileEntry | null>(null);
  /** Selected entries (multi-selection: Ctrl+click, Shift+click, select all). */
  const [picked, setPicked] = useState<string[]>([]);
  const selected = picked[picked.length - 1] ?? null;
  const setSelected = (name: string | null) => setPicked(name ? [name] : []);
  const anchor = useRef<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<{ names: string[] } | null>(null);
  const copyL = useLinger(copyTarget);
  const [dragOver, setDragOver] = useState(false);
  const dropZone = useRef<View>(null);
  const press = useRef(createDoublePress());
  const [editing, setEditing] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const menuL = useLinger(menu);
  const editL = useLinger(editing);
  const promptL = useLinger(prompt);

  const queryKey = ["ssh-manager", "files", server.id, requested];
  const query = useQuery({ queryKey, queryFn: () => list({ id: server.id, path: requested }), retry: false });
  const cwd = query.data?.path ?? requested;

  const go = (path: string) => {
    setPathInput(null);
    setSelected(null);
    selectionStore.set((prev) => ({ ...prev, filePaths: { ...prev.filePaths, [server.id]: path } }));
  };
  const reload = () => void qc.invalidateQueries({ queryKey: ["ssh-manager", "files", server.id] });

  const ask = (title: string, label: string, value: string, confirm: string) =>
    new Promise<string | null>((resolve) => setPrompt({ title, label, value, confirm, resolve }));

  const run = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await fn();
      if (success) toast.show(success, { variant: "success" });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const entries = (query.data?.entries ?? [])
    .filter((e) => showHidden || !e.name.startsWith("."))
    .slice()
    .sort((a, b) => {
      const ad = a.type === "dir" || a.linkDir ? 0 : 1;
      const bd = b.type === "dir" || b.linkDir ? 0 : 1;
      if (ad !== bd) return ad - bd;
      let r = 0;
      if (sort.key === "size") r = a.size - b.size;
      else if (sort.key === "mtime") r = a.mtime - b.mtime;
      else r = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return sort.desc ? -r : r;
    });

  const isDir = (e: FileEntry) => e.type === "dir" || e.linkDir;

  const download = async (e: FileEntry) => {
    const path = joinPath(cwd, e.name);
    await run(`Téléchargement de ${e.name}`, async () => {
      const parts: Uint8Array[] = [];
      let offset = 0;
      let size = e.size;
      do {
        const res = await downloadChunk({ id: server.id, path, offset, length: CHUNK_SIZE });
        size = res.size;
        const bytes = base64ToBytes(res.base64);
        if (bytes.length === 0) break;
        parts.push(bytes);
        offset += bytes.length;
        setBusy(`Téléchargement de ${e.name} : ${Math.round((offset / Math.max(1, size)) * 100)} %`);
      } while (offset < size);
      saveDownload(e.name, parts);
    });
  };

  const upload = async () => uploadFiles(await pickFiles());

  const uploadFiles = async (files: PickedFile[]) => {
    if (!files.length) return;
    await run(
      "Envoi",
      async () => {
        for (const file of files) {
          const target = joinPath(cwd, file.name);
          let offset = 0;
          do {
            const chunk = file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE));
            const bytes = new Uint8Array(await chunk.arrayBuffer());
            await uploadChunk({ id: server.id, path: target, base64: bytesToBase64(bytes), append: offset > 0 });
            offset += bytes.length;
            setBusy(`Envoi de ${file.name} : ${Math.round((offset / Math.max(1, file.size)) * 100)} %`);
          } while (offset < file.size);
        }
      },
      `${files.length} fichier(s) envoyé(s)`,
    );
  };

  /* ---------------- multi-selection ---------------- */
  const pickedEntries = entries.filter((e) => picked.includes(e.name));

  /** Download: a single file as is, folders or several entries as one .tar.gz. */
  const downloadSelection = async (list: FileEntry[] = pickedEntries) => {
    if (!list.length) return;
    if (list.length === 1 && !isDir(list[0]!)) {
      await download(list[0]!);
      return;
    }
    await run("Archive", async () => {
      setBusy(`Compression de ${list.length} élément(s)...`);
      const arc = await archive({ id: server.id, dir: cwd, names: list.map((e) => e.name) });
      const parts: Uint8Array[] = [];
      let offset = 0;
      let done = false;
      while (!done) {
        const res = await archiveChunk({ token: arc.token, offset, length: CHUNK_SIZE });
        const bytes = base64ToBytes(res.base64);
        parts.push(bytes);
        offset += bytes.length;
        done = res.done || !bytes.length;
        setBusy(`Téléchargement de ${arc.name} : ${Math.round((offset / Math.max(1, res.size)) * 100)} %`);
      }
      saveDownload(arc.name, parts);
    });
  };

  const removeSelection = async () => {
    if (pickedEntries.length <= 1) {
      if (pickedEntries[0]) await remove(pickedEntries[0]);
      return;
    }
    const ok = await confirmAction(
      "Supprimer",
      `Supprimer définitivement ${pickedEntries.length} éléments de ${cwd} ?\n\n${pickedEntries.map((e) => e.name).slice(0, 12).join(", ")}${pickedEntries.length > 12 ? "..." : ""}`,
      "Supprimer",
    );
    if (!ok) return;
    await run("Suppression", () => action({ action: "delete", id: server.id, paths: pickedEntries.map((e) => joinPath(cwd, e.name)) }), "Supprimé");
    setPicked([]);
  };

  const toLocalSelection = async () => {
    if (pickedEntries.length <= 1) {
      if (pickedEntries[0]) await toLocal(pickedEntries[0]);
      return;
    }
    const dir = await ask("Copier vers l'hôte Paseo", `${pickedEntries.length} éléments, dossier de destination (machine Paseo)`, localDir ?? "~", "Copier");
    if (!dir) return;
    await run("Copie", async () => {
      for (const e of pickedEntries) {
        setBusy(`Copie de ${e.name}...`);
        await transfer({ id: server.id, direction: "to-local", source: joinPath(cwd, e.name), targetDir: dir });
      }
    }, `${pickedEntries.length} élément(s) copié(s)`);
  };

  const toLocal = async (e: FileEntry) => {
    const dir = await ask("Copier vers l'hôte Paseo", "Dossier de destination (sur la machine Paseo)", localDir ?? "~", "Copier");
    if (!dir) return;
    await run(`Copie de ${e.name}`, async () => {
      const res = await transfer({ id: server.id, direction: "to-local", source: joinPath(cwd, e.name), targetDir: dir });
      toast.show(`Copié : ${res.target}`, { variant: "success" });
    });
  };

  const fromLocal = async () => {
    const src = await ask(
      "Envoyer depuis l'hôte Paseo",
      `Fichier ou dossier sur la machine Paseo, copié dans ${cwd}`,
      localDir ? `${localDir.replace(/\/+$/, "")}/` : "",
      "Envoyer",
    );
    if (!src) return;
    await run(`Envoi de ${src}`, () => transfer({ id: server.id, direction: "to-remote", source: src, targetDir: cwd }), "Envoi terminé");
  };

  const rename = async (e: FileEntry) => {
    const name = await ask("Renommer", "Nouveau nom (ou chemin absolu pour déplacer)", e.name, "Renommer");
    if (!name || name === e.name) return;
    const to = name.startsWith("/") ? name : joinPath(cwd, name);
    await run("Renommage", () => action({ action: "rename", id: server.id, from: joinPath(cwd, e.name), to }));
  };

  const duplicate = async (e: FileEntry) => {
    const name = await ask("Dupliquer", "Nom de la copie", `${e.name}.copie`, "Dupliquer");
    if (!name) return;
    const to = name.startsWith("/") ? name : joinPath(cwd, name);
    await run("Copie", () => action({ action: "copy", id: server.id, from: joinPath(cwd, e.name), to }));
  };

  const chmod = async (e: FileEntry) => {
    const mode = await ask("Permissions", "Mode octal (ex. 644, 755) ou symbolique (u+x)", e.mode, "Appliquer");
    if (!mode) return;
    await run("chmod", () => action({ action: "chmod", id: server.id, path: joinPath(cwd, e.name), mode: mode.trim() }));
  };

  const remove = async (e: FileEntry) => {
    const ok = await confirmAction(
      "Supprimer",
      `Supprimer définitivement ${isDir(e) ? "le dossier" : "le fichier"} "${joinPath(cwd, e.name)}" ?`,
      "Supprimer",
    );
    if (!ok) return;
    await run("Suppression", () => action({ action: "delete", id: server.id, paths: [joinPath(cwd, e.name)] }), "Supprimé");
  };

  const mkdir = async () => {
    const name = await ask("Nouveau dossier", `Dans ${cwd}`, "", "Créer");
    if (!name) return;
    await run("Création", () => action({ action: "mkdir", id: server.id, path: name.startsWith("/") ? name : joinPath(cwd, name) }));
  };

  const newFile = async () => {
    const name = await ask("Nouveau fichier", `Dans ${cwd}`, "", "Créer");
    if (!name) return;
    const path = name.startsWith("/") ? name : joinPath(cwd, name);
    await run("Création", () => action({ action: "touch", id: server.id, path }));
    setEditing(path);
  };

  const header = (key: SortKey, label: string, style: object) => (
    <Pressable
      onPress={() => setSort({ key, desc: sort.key === key ? !sort.desc : false })}
      style={[s.row, { gap: 2, paddingHorizontal: 4, paddingVertical: 3, borderRightWidth: 1, borderRightColor: s.c.border }, style]}
    >
      {sort.key === key ? <Icon name={sort.desc ? "ChevronDown" : "ChevronUp"} size={11} color={s.c.foreground} /> : null}
      <Text selectable={false} style={[s.small, { color: s.c.foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  const sel = entries.find((e) => e.name === selected) ?? null;
  const open = (e: FileEntry) => (isDir(e) ? go(joinPath(cwd, e.name)) : setEditing(joinPath(cwd, e.name)));
  const tool = (icon: string, label: string, color: string, onPress: () => void, disabled = false) => (
    <IconBtn key={label} s={s} icon={icon} label={label} color={color} size={touch ? 22 : 15} disabled={disabled} onPress={onPress} />
  );

  // Drag and drop from the computer (web / desktop): files dropped on the browser are uploaded to the
  // current folder. react-native-web does not forward drag events, so DOM listeners are used.
  const uploadRef = useRef(uploadFiles);
  uploadRef.current = uploadFiles;
  useEffect(() => {
    if (!isWeb) return;
    type DragEv = { preventDefault(): void; dataTransfer?: { files?: { length: number; [i: number]: PickedFile }; types?: readonly string[] } };
    const el = dropZone.current as unknown as {
      addEventListener?: (t: string, f: (e: DragEv) => void) => void;
      removeEventListener?: (t: string, f: (e: DragEv) => void) => void;
    } | null;
    if (!el?.addEventListener) return;
    const hasFiles = (e: DragEv) => !!e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files");
    const over = (e: DragEv) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = () => setDragOver(false);
    const drop = (e: DragEv) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      const list = e.dataTransfer?.files;
      const files: PickedFile[] = [];
      if (list) for (let i = 0; i < list.length; i += 1) if (list[i]) files.push(list[i]!);
      void uploadRef.current(files);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener?.("dragover", over);
      el.removeEventListener?.("dragleave", leave);
      el.removeEventListener?.("drop", drop);
    };
  }, []);

  return (
    <View
      ref={dropZone}
      style={{ gap: 0, flex: 1, borderWidth: dragOver ? 2 : 0, borderStyle: "dashed", borderColor: s.c.accent, backgroundColor: dragOver ? s.x.selection : "transparent" }}
    >
      {dragOver ? (
        <View style={[s.row, { gap: 6, padding: 6, justifyContent: "center" }]}>
          <Icon name="Upload" size={14} color={s.c.accent} />
          <Text style={[s.text, { fontWeight: "600" }]}>Déposez pour envoyer dans {cwd}</Text>
        </View>
      ) : null}
      {touch ? (
        // Touch: one scrollable row of folder actions; actions on a file are in its menu (tap it).
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, backgroundColor: s.x.toolbar, borderBottomWidth: 1, borderBottomColor: s.c.border }}
          contentContainerStyle={{ paddingHorizontal: 4, gap: 4, alignItems: "center" }}
        >
          {tool("FolderUp", "Dossier parent", s.x.folder, () => go(parentPath(cwd)))}
          {tool("House", "Dossier personnel", s.c.foreground, () => go("~"))}
          {tool("RefreshCw", "Rafraîchir le dossier", s.x.green, reload)}
          {isWeb ? tool("ArrowUpFromLine", "Envoyer des fichiers depuis ce téléphone", s.x.green, () => void upload()) : null}
          {tool("FolderPlus", "Créer un dossier", s.x.folder, () => void mkdir())}
          {tool("FilePlus", "Créer un fichier", s.c.foreground, () => void newFile())}
          {tool("SquareTerminal", "Ouvrir un terminal dans ce dossier", s.x.ssh, () => onOpenTerminalHere(cwd))}
          {tool("HardDriveUpload", "Envoyer depuis l'hôte Paseo", s.x.orange, () => void fromLocal())}
          {tool(showHidden ? "Eye" : "EyeOff", showHidden ? "Masquer les fichiers cachés" : "Afficher les fichiers cachés", s.c.foregroundMuted, () => setShowHidden(!showHidden))}
        </ScrollView>
      ) : (
        <View style={[s.row, { gap: 0, flexWrap: "wrap", backgroundColor: s.x.toolbar, borderBottomWidth: 1, borderBottomColor: s.c.border, paddingHorizontal: 2 }]}>
        {tool("FolderUp", "Dossier parent", s.x.folder, () => go(parentPath(cwd)))}
        {isWeb
          ? tool("ArrowDownToLine", "Télécharger la sélection (dossiers et sélection multiple en .tar.gz)", s.x.blue, () => void downloadSelection(), !picked.length)
          : null}
        {isWeb ? tool("ArrowUpFromLine", "Envoyer des fichiers vers le dossier courant", s.x.green, () => void upload()) : null}
        {tool("RefreshCw", "Rafraîchir le dossier", s.x.green, reload)}
        {tool("FolderPlus", "Créer un dossier", s.x.folder, () => void mkdir())}
        {tool("FilePlus", "Créer un fichier", s.c.foreground, () => void newFile())}
        {tool("CircleX", "Supprimer la sélection", s.x.red, () => void removeSelection(), !picked.length)}
        {tool("ListChecks", picked.length === entries.length && entries.length ? "Tout désélectionner" : "Tout sélectionner", s.c.foregroundMuted, () =>
          setPicked(picked.length === entries.length ? [] : entries.map((e) => e.name)),
        )}
        {tool("TextCursorInput", "Renommer la sélection", s.x.blue, () => sel && void rename(sel), !sel)}
        {tool("FilePen", "Éditer le fichier sélectionné", s.x.blue, () => sel && setEditing(joinPath(cwd, sel.name)), !sel || isDir(sel))}
        {tool("Wrench", "Permissions de la sélection", s.c.foregroundMuted, () => sel && void chmod(sel), !sel)}
        {tool("HardDriveDownload", "Copier la sélection vers l'hôte Paseo", s.x.orange, () => void toLocalSelection(), !picked.length)}
        {tool("ArrowRightLeft", "Copier la sélection vers un autre serveur", s.x.ssh, () => setCopyTarget({ names: [...picked] }), !picked.length)}
        {tool("HardDriveUpload", "Envoyer depuis l'hôte Paseo", s.x.orange, () => void fromLocal())}
        {tool("SquareTerminal", "Ouvrir un terminal dans ce dossier", s.x.ssh, () => onOpenTerminalHere(sel && isDir(sel) ? joinPath(cwd, sel.name) : cwd))}
        {tool(showHidden ? "Eye" : "EyeOff", showHidden ? "Masquer les fichiers cachés" : "Afficher les fichiers cachés", s.c.foregroundMuted, () => setShowHidden(!showHidden))}
      </View>
      )}
      <View style={[s.row, { margin: 3, borderWidth: 1, borderColor: s.c.border, backgroundColor: s.c.surface1 }]}>
        <TextInput
          value={pathInput ?? cwd}
          onChangeText={setPathInput}
          onSubmitEditing={() => pathInput !== null && go(pathInput.trim() || "~")}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, color: s.c.foreground, fontSize: 12, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 0 }}
        />
        <IconBtn s={s} icon="House" label="Dossier personnel" size={13} onPress={() => go("~")} />
        <IconBtn s={s} icon="Copy" label="Copier le chemin" size={13} onPress={() => void copyText(cwd).then(() => toast.show("Chemin copié"))} />
      </View>
      {busy ? (
        <View style={[s.row, { gap: 8, padding: 4 }]}>
          <ActivityIndicator size="small" color={s.c.accent} />
          <Text style={s.small}>{busy}</Text>
        </View>
      ) : null}
      {query.error ? (
        <View style={{ padding: 4 }}>
          <ErrorBox s={s} message={errorMessage(query.error)} />
        </View>
      ) : null}
      {touch ? null : (
      <View style={[s.row, { backgroundColor: s.c.surface2, borderBottomWidth: 1, borderBottomColor: s.c.border }]}>
        {header("name", "Name", { flex: 1 })}
        {header("size", "Size (KB)", { width: 70 })}
        {tiny ? null : header("mtime", "Last modified", { width: 118 })}
        {compact ? null : <Text style={[s.small, { width: 44, paddingHorizontal: 4, color: s.c.foreground }]}>Perm.</Text>}
      </View>
      )}
      {query.isLoading ? <ActivityIndicator color={s.c.accent} style={{ marginTop: 16 }} /> : null}
      <View>
        {cwd !== "/" && query.data ? (
          <Pressable
            {...(touch
              ? { onPress: () => go(parentPath(cwd)) }
              : pressProps(() => press.current("..", () => (isWeb ? setSelected(null) : go(parentPath(cwd))), () => go(parentPath(cwd)))))}
            style={[s.row, { gap: touch ? 10 : 6, paddingVertical: touch ? 10 : 1, paddingHorizontal: touch ? 10 : 4 }]}
          >
            <Icon name="FolderUp" size={touch ? 20 : 14} color={s.x.green} />
            <Text selectable={false} style={[s.text, { fontSize: touch ? 15 : 12 }]}>..</Text>
          </Pressable>
        ) : null}
        {entries.map((e) => {
          const icon = entryIcon(e);
          const isSel = picked.includes(e.name);
          return (
            <Pressable
              key={e.name}
              {...(touch
                ? {
                    // Touch: a folder opens, a file shows its actions (edit, download...).
                    onPress: () => (isDir(e) ? go(joinPath(cwd, e.name)) : (setSelected(e.name), setMenu(e))),
                  }
                : {})}
              {...(touch ? {} : pressProps((mods) => {
                if (mods.ctrl) {
                  // Ctrl+click: add / remove from the selection.
                  setPicked((p) => (p.includes(e.name) ? p.filter((x) => x !== e.name) : [...p, e.name]));
                  anchor.current = e.name;
                  return;
                }
                if (mods.shift && anchor.current) {
                  // Shift+click: range from the last clicked entry.
                  const names = entries.map((x) => x.name);
                  const a = names.indexOf(anchor.current);
                  const b = names.indexOf(e.name);
                  if (a >= 0 && b >= 0) {
                    setPicked(names.slice(Math.min(a, b), Math.max(a, b) + 1));
                    return;
                  }
                }
                anchor.current = e.name;
                press.current(
                  `${cwd}/${e.name}`,
                  () => {
                    // Touch screens: a single tap enters a folder; files are opened with a double tap.
                    if (!isWeb && isDir(e)) go(joinPath(cwd, e.name));
                    else setSelected(e.name);
                  },
                  () => open(e),
                );
              }))}
              {...webProps({
                onContextMenu: (ev: { preventDefault(): void }) => {
                  ev.preventDefault();
                  setSelected(e.name);
                  setMenu(e);
                },
              })}
              onLongPress={() => setMenu(e)}
              style={(state) => [
                s.row,
                {
                  gap: touch ? 10 : 6,
                  paddingVertical: touch ? 8 : 1,
                  minHeight: touch ? 44 : undefined,
                  paddingHorizontal: touch ? 10 : 4,
                  backgroundColor: isSel ? s.x.selection : isHovered(state) ? s.c.surface2 : "transparent",
                },
              ]}
            >
              <Icon name={icon.name} size={touch ? 20 : 14} color={icon.color(s)} />
              {touch ? (
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text selectable={false} style={[s.text, { fontSize: 15 }]} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <Text selectable={false} style={s.small} numberOfLines={1}>
                    {isDir(e) ? "" : `${formatBytes(e.size)}  -  `}
                    {formatDate(e.mtime)}
                    {e.type === "link" && e.linkTarget ? `  ->  ${e.linkTarget}` : ""}
                  </Text>
                </View>
              ) : (
                <>
                  <Text selectable={false} style={[s.text, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
                    {e.name}
                    {e.type === "link" && e.linkTarget ? <Text selectable={false} style={s.small}>{`  ->  ${e.linkTarget}`}</Text> : null}
                  </Text>
                  <Text selectable={false} style={[s.small, { width: 70, textAlign: "right", paddingRight: 8 }]}>{isDir(e) ? "" : Math.ceil(e.size / 1024)}</Text>
                  {tiny ? null : <Text selectable={false} style={[s.small, { width: 118 }]}>{formatDate(e.mtime)}</Text>}
                  {compact ? null : <Text selectable={false} style={[s.small, { width: 44, fontFamily: MONO }]}>{e.mode}</Text>}
                </>
              )}
              {touch ? <Icon name={isDir(e) ? "ChevronRight" : "EllipsisVertical"} size={18} color={s.c.foregroundMuted} /> : null}
            </Pressable>
          );
        })}
        {query.data && entries.length === 0 ? <Empty s={s} icon="FolderOpen" text="Dossier vide" /> : null}
      </View>
      {/* Below the list: showing / hiding it never moves the rows under the pointer. */}
      {picked.length > 1 ? (
        <View style={[s.row, { gap: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: s.x.selection }]}>
          <Text style={[s.small, { color: s.c.foreground, flex: 1 }]}>{picked.length} éléments sélectionnés (Ctrl+clic, Maj+clic)</Text>
          <Text onPress={() => setPicked([])} style={[s.small, { color: s.c.foreground, textDecorationLine: "underline" }]}>
            Désélectionner
          </Text>
        </View>
      ) : null}
      {menuL.shown ? ((menuEntry) => (
        <Modal title={menuEntry.name} open={menuL.open} onOpenChange={(o) => !o && setMenu(null)}>
          <Modal.Content>
            <Text style={s.modal.small} selectable>
              {joinPath(cwd, menuEntry.name)}  -  {formatBytes(menuEntry.size)}  -  {menuEntry.mode}  -  {menuEntry.owner}  -  {formatDate(menuEntry.mtime)}
            </Text>
            {(
              [
                isDir(menuEntry)
                  ? { icon: "FolderOpen", label: "Ouvrir", fn: () => go(joinPath(cwd, menuEntry.name)) }
                  : { icon: "FilePen", label: "Éditer", fn: () => setEditing(joinPath(cwd, menuEntry.name)) },
                isWeb
                  ? {
                      icon: "Download",
                      label: isDir(menuEntry) ? "Télécharger le dossier (.tar.gz)" : "Télécharger sur cet ordinateur",
                      fn: () => void downloadSelection([menuEntry]),
                    }
                  : null,
                { icon: "HardDriveDownload", label: "Copier vers l'hôte Paseo (workspace)", fn: () => void toLocal(menuEntry) },
                isDir(menuEntry)
                  ? { icon: "SquareTerminal", label: "Ouvrir un terminal ici", fn: () => onOpenTerminalHere(joinPath(cwd, menuEntry.name)) }
                  : null,
                { icon: "TextCursorInput", label: "Renommer / déplacer", fn: () => void rename(menuEntry) },
                { icon: "CopyPlus", label: "Dupliquer", fn: () => void duplicate(menuEntry) },
                { icon: "Lock", label: "Permissions (chmod)", fn: () => void chmod(menuEntry) },
                {
                  icon: "Copy",
                  label: "Copier le chemin",
                  fn: () => void copyText(joinPath(cwd, menuEntry.name)).then(() => toast.show("Chemin copié")),
                },
                { icon: "Trash2", label: "Supprimer", fn: () => void remove(menuEntry), danger: true },
              ] as ({ icon: string; label: string; fn(): void; danger?: boolean } | null)[]
            )
              .filter((x): x is { icon: string; label: string; fn(): void; danger?: boolean } => x !== null)
              .map((item) => (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    setMenu(null);
                    afterMenu(item.fn);
                  }}
                  style={({ pressed }) => [s.modal.row, { gap: 10, paddingVertical: 8, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Icon name={item.icon} size={16} color={item.danger ? s.modal.c.statusDanger : s.modal.c.foreground} />
                  <Text style={[s.modal.text, item.danger ? { color: s.modal.c.statusDanger } : null]}>{item.label}</Text>
                </Pressable>
              ))}
          </Modal.Content>
        </Modal>
      ))(menuL.shown) : null}
      {editL.shown ? (
        <EditorModal
          key={editL.shown}
          s={s}
          server={server}
          path={editL.shown}
          open={editL.open}
          onClose={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {copyL.shown ? (
        <CopyToServerModal
          s={s.modal}
          open={copyL.open}
          names={copyL.shown.names}
          from={server}
          dir={cwd}
          servers={allServers.data?.servers ?? []}
          onClose={() => setCopyTarget(null)}
          onCopy={(to, targetDir) =>
            void run(
              "Copie entre serveurs",
              async () => {
                setBusy(`Copie de ${copyL.shown?.names.length} élément(s) vers ${to.name}...`);
                await copyServer({ fromId: server.id, dir: cwd, names: copyL.shown?.names ?? [], toId: to.id, targetDir });
              },
              `Copié vers ${to.name}:${targetDir}`,
            )
          }
        />
      ) : null}
      {promptL.shown ? <PromptModal key={promptL.shown.title + promptL.shown.value} s={s} state={promptL.shown} open={promptL.open} onDone={() => setPrompt(null)} /> : null}
    </View>
  );
}

/** Copy the selection straight to another server (tar piped through the Paseo host, nothing stored). */
function CopyToServerModal({
  s,
  open,
  names,
  from,
  dir,
  servers,
  onClose,
  onCopy,
}: {
  s: Styles;
  open: boolean;
  names: string[];
  from: Server;
  dir: string;
  servers: readonly Server[];
  onClose(): void;
  onCopy(to: Server, targetDir: string): void;
}) {
  const [target, setTarget] = useState<Server | null>(servers.find((x) => x.id !== from.id) ?? null);
  const [targetDir, setTargetDir] = useState(dir);
  return (
    <Modal title="Copier vers un autre serveur" open={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        <Text style={s.muted}>
          {names.length} élément(s) de {from.name}:{dir}
        </Text>
        <Text style={s.small}>{names.slice(0, 10).join(", ") + (names.length > 10 ? "..." : "")}</Text>
        <Text style={s.text}>Serveur de destination</Text>
        <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
          {servers.map((x) => (
            <Pressable
              key={x.id}
              onPress={() => setTarget(x)}
              style={[s.row, s.button, { paddingVertical: 4, borderColor: target?.id === x.id ? s.c.accent : s.c.border }]}
            >
              <Icon name="SquareTerminal" size={12} color={x.color || s.x.ssh} />
              <Text style={s.small}>{x.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.text}>Dossier de destination</Text>
        <TextInput value={targetDir} onChangeText={setTargetDir} autoCapitalize="none" autoCorrect={false} style={[s.input, { fontFamily: MONO }]} />
        <Text style={s.small}>Les dossiers sont copiés avec leur contenu ; un fichier du même nom est remplacé.</Text>
        <View style={[s.row, { gap: 8, justifyContent: "flex-end" }]}>
          <Btn s={s} label="Annuler" onPress={onClose} />
          <Btn
            s={s}
            primary
            icon="ArrowRightLeft"
            label="Copier"
            disabled={!target || !targetDir.trim()}
            onPress={() => {
              if (!target) return;
              onClose();
              onCopy(target, targetDir.trim());
            }}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
