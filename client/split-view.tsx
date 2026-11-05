import type { PaseoApi } from "./paseo-types";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { TabModel } from "./tabs";
import { TerminalView } from "./terminal-view";
import { afterMenu, isHovered, useLinger, type Styles } from "./util";
import { IconBtn } from "./widgets";

export type SplitLayout = "2v" | "2h" | "4";

/**
 * MobaXterm "Split": 2 or 4 terminals tiled in the main area. Unlike MultiExec, each pane is
 * independent: click a pane to type in it. Each terminal is resized to its pane.
 */
export function SplitView({
  s,
  paseo,
  layout,
  panes,
  tabs,
  fontSize,
  onChangePane,
  onExit,
  onZoom,
}: {
  s: Styles;
  paseo: PaseoApi;
  layout: SplitLayout;
  panes: (string | null)[];
  tabs: readonly TabModel[];
  fontSize: number;
  onChangePane(index: number, terminalId: string | null): void;
  onExit(): void;
  onZoom(delta: number): void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const picker = useLinger(picking);
  const [focusedPane, setFocusedPane] = useState(0);

  const pane = (i: number) => {
    const tab = tabs.find((t) => t.id === panes[i]) ?? null;
    return (
      <View
        key={i}
        style={{ flex: 1, borderWidth: 1, borderColor: focusedPane === i ? s.c.accent : s.c.border, minWidth: 0, minHeight: 0 }}
      >
        <View style={[s.row, { height: 24, gap: 6, paddingHorizontal: 6, backgroundColor: s.x.tabBar }]}>
          <Icon name="SquareTerminal" size={12} color={tab?.color || s.x.ssh} />
          <Pressable onPress={() => setPicking(i)} style={[s.row, { gap: 4, flex: 1 }]}>
            <Text selectable={false} numberOfLines={1} style={{ color: s.c.foreground, fontSize: 12 }}>
              {tab ? tab.label : "Choisir un terminal"}
            </Text>
            <Icon name="ChevronDown" size={12} color={s.c.foregroundMuted} />
          </Pressable>
          {i === 0 ? <IconBtn s={s} icon="X" label="Quitter le split" size={12} onPress={onExit} /> : null}
        </View>
        <View style={{ flex: 1 }} {...{ onFocus: () => setFocusedPane(i) }}>
          {tab?.terminal ? (
            <TerminalView
              key={tab.id}
              s={s}
              paseo={paseo}
              terminal={tab.terminal}
              active
              fontSize={fontSize}
              onZoom={onZoom}
              onPressArea={undefined}
            />
          ) : (
            <Pressable onPress={() => setPicking(i)} style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: s.x.termBg }}>
              <Text style={s.muted}>Cliquez pour choisir une session ouverte</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: s.x.termBg }}>
      {layout === "4" ? (
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, flexDirection: "row" }}>
            {pane(0)}
            {pane(1)}
          </View>
          <View style={{ flex: 1, flexDirection: "row" }}>
            {pane(2)}
            {pane(3)}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, flexDirection: layout === "2v" ? "row" : "column" }}>
          {pane(0)}
          {pane(1)}
        </View>
      )}
      {picker.shown !== null ? (
        <Modal title={`Panneau ${picker.shown + 1}`} open={picker.open} onOpenChange={(o) => !o && setPicking(null)}>
          <Modal.Content>
            {tabs.length === 0 ? <Text style={s.modal.muted}>Aucune session ouverte.</Text> : null}
            {tabs.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  const index = picker.shown ?? 0;
                  setPicking(null);
                  afterMenu(() => onChangePane(index, t.id));
                }}
                style={(state) => [s.modal.row, { gap: 8, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 4, backgroundColor: isHovered(state) ? s.modal.c.surface2 : "transparent" }]}
              >
                <Icon name="SquareTerminal" size={14} color={t.color || s.modal.x.ssh} />
                <Text style={s.modal.text}>{t.label}</Text>
                {panes.includes(t.id) ? <Text style={s.modal.small}>(déjà affiché)</Text> : null}
              </Pressable>
            ))}
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}
