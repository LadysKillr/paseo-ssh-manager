import type { PaseoApi, PaseoTerminal } from "./paseo-types";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, View, type TextInput as NativeTextInput } from "react-native";
import { TERMINAL_PREFIX } from "./data";
import { keyToData, type KeyEventLike } from "./keys";
import { TERM_LINE, TerminalView } from "./terminal-view";
import { errorMessage, MONO, selectionStore, useLinger, useStore, type Styles } from "./util";
import { Btn, Check } from "./widgets";

/**
 * MobaXterm's "multi-execution mode": every open SSH terminal is shown in a grid and every key
 * typed goes to all of them, except the ones excluded with the checkbox under each terminal.
 */
export function MultiExecGrid({
  s,
  paseo,
  terminals,
  narrow = false,
}: {
  s: Styles;
  paseo: PaseoApi;
  terminals: readonly PaseoTerminal[];
  /** Phone: one column that scrolls, each terminal keeps a readable height. */
  narrow?: boolean;
}) {
  const toast = useToast();
  const selection = useStore(selectionStore);
  const excluded = selection.multiExcluded;
  const input = useRef<NativeTextInput>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [buffer, setBuffer] = useState("");
  const [signal, setSignal] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const pasteL = useLinger(pasteOpen ? true : null);
  const [pasteText, setPasteText] = useState("");
  const [pasteEnter, setPasteEnter] = useState(false);
  const [focused, setFocused] = useState(false);

  const targets = terminals.filter((t) => !excluded[t.id]);
  const focus = () => input.current?.focus();
  useEffect(() => {
    const timer = setTimeout(focus, 80);
    return () => clearTimeout(timer);
  }, []);

  const send = (data: string) => {
    for (const t of targets) {
      try {
        paseo.terminals.ref(t).write(data);
      } catch (err) {
        toast.error(`${t.name.slice(TERMINAL_PREFIX.length)} : ${errorMessage(err)}`);
      }
    }
    setSignal((n) => n + 1);
  };

  const toggle = (id: string) =>
    selectionStore.set((p) => ({ ...p, multiExcluded: { ...p.multiExcluded, [id]: !p.multiExcluded[id] } }));

  const exit = () => selectionStore.set((p) => ({ ...p, mainView: "tabs" }));

  const n = terminals.length;
  const cols = narrow || n <= 1 ? 1 : n <= 6 ? 2 : 3;
  const gridRows = Math.max(1, Math.ceil(n / cols));
  const cellHeight = narrow ? Math.max(220, area.height > 0 ? area.height / Math.min(gridRows, 2) : 260) : area.height > 0 ? area.height / gridRows : 300;
  const footer = 24;
  const termRows = Math.max(3, Math.floor((cellHeight - footer - 14) / TERM_LINE));

  return (
    <View style={{ flex: 1, backgroundColor: s.x.termBg }}>
      <View
        style={[
          s.row,
          { gap: 8, paddingHorizontal: 8, height: 34, backgroundColor: s.x.toolbar, borderBottomWidth: 1, borderBottomColor: s.c.border },
        ]}
      >
        <Icon name="Layers" size={16} color={focused ? s.x.green : s.c.foregroundMuted} />
        <Text style={[s.text, { fontWeight: "600", flex: 1 }]} numberOfLines={1}>
          {focused
            ? `Multi-exécution : ce que vous tapez part dans ${targets.length}/${n} terminal(aux) (Ctrl+V ou Shift+Insert pour coller)`
            : "Multi-exécution en pause : cliquez dans la grille pour reprendre la saisie"}
        </Text>
        <Btn s={s} compact icon="ClipboardPaste" label="Multi-paste" onPress={() => setPasteOpen(true)} />
        <Btn s={s} compact danger icon="X" label="Quitter le mode multi-exécution" onPress={exit} />
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        {n === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Icon name="SquareTerminal" size={32} color={s.c.foregroundMuted} />
            <Text style={s.muted}>Aucun terminal SSH ouvert. Ouvrez des sessions (clic droit sur un dossier : ouvrir toutes les sessions).</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap" }} scrollEnabled={narrow}>
            {terminals.map((t) => {
              const isExcluded = !!excluded[t.id];
              const name = t.name.slice(TERMINAL_PREFIX.length);
              return (
                <View
                  key={t.id}
                  style={{
                    width: `${100 / cols}%`,
                    height: cellHeight,
                    borderWidth: 1,
                    borderColor: isExcluded ? s.c.border : focused ? s.x.green : s.c.border,
                    opacity: isExcluded ? 0.45 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <TerminalView
                      s={s}
                      paseo={paseo}
                      terminal={t}
                      active
                      rows={termRows}
                      interactive={false}
                      pollMs={700}
                      refreshSignal={isExcluded ? 0 : signal}
                      onPressArea={focus}
                    />
                  </View>
                  <View style={[s.row, { height: footer, paddingHorizontal: 6, backgroundColor: s.c.surface1 }]}>
                    <Check s={s} checked={isExcluded} onToggle={() => toggle(t.id)} label={`Exclure "${name}" du mode MultiExec`} />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <TextInput
        ref={input}
        value={buffer}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyPress={(e) => {
          const ev = e as unknown as KeyEventLike;
          const data = keyToData(ev);
          if (data !== null) {
            ev.preventDefault?.();
            send(data);
          }
        }}
        onChangeText={(value) => {
          if (value) send(value.replace(/\r?\n/g, "\r"));
          setBuffer("");
        }}
        onSubmitEditing={() => Platform.OS !== "web" && send("\r")}
        submitBehavior="submit"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel="Saisie multi-exécution"
        placeholder={Platform.OS === "web" && !narrow ? undefined : "Saisie envoyée à tous les terminaux"}
        placeholderTextColor={s.c.foregroundMuted}
        style={
          Platform.OS === "web" && !narrow
            ? { position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0 }
            : { height: 38, color: s.x.termFg, backgroundColor: s.c.surface2, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: s.x.green }
        }
      />

      {pasteL.shown ? (
        <Modal title="Multi-paste" open={pasteL.open} onOpenChange={(o) => !o && setPasteOpen(false)}>
          <Modal.Content>
            <Text style={s.modal.muted}>Le texte est collé tel quel dans les {targets.length} terminal(aux) non exclus.</Text>
            <TextInput
              multiline
              value={pasteText}
              onChangeText={setPasteText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              style={[s.modal.input, { minHeight: 140, fontFamily: MONO, fontSize: 12 }]}
            />
            <Check s={s.modal} checked={pasteEnter} onToggle={() => setPasteEnter(!pasteEnter)} label="Appuyer sur Entrée après le collage" />
            <View style={[s.modal.row, { gap: 8, justifyContent: "flex-end" }]}>
              <Btn s={s.modal} label="Annuler" onPress={() => setPasteOpen(false)} />
              <Btn
                s={s.modal}
                primary
                icon="ClipboardPaste"
                label="Coller partout"
                disabled={!pasteText}
                onPress={() => {
                  send(pasteText.replace(/\r?\n/g, "\r") + (pasteEnter ? "\r" : ""));
                  setPasteOpen(false);
                  setPasteText("");
                  setTimeout(focus, 80);
                }}
              />
            </View>
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}
