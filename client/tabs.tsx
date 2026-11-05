import type { PaseoApi, PaseoTerminal } from "./paseo-types";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, Text, View, type TextInput as NativeTextInput } from "react-native";
import type { Server } from "../shared/rpc";
import { prefsSettings } from "../shared/settings";
import { serverLabel } from "./data";
import { dialogStore } from "./dialog-store";
import { lastScreens, ScreenLines } from "./terminal-view";
import { errorMessage, isHovered, MONO, MONO_SURFACE, webProps, type AppTab, type Styles } from "./util";
import { Btn, ErrorBox, IconBtn } from "./widgets";

/* ------------------------------------------------------------------ */
/* Tab bar                                                             */
/* ------------------------------------------------------------------ */

export interface TabModel {
  id: string;
  label: string;
  color?: string;
  serverId?: string;
  /** Session ended (ssh exited): kept like MobaXterm, can be restarted. */
  dead: boolean;
  terminal?: PaseoTerminal;
  /** Recorded in a log file. */
  logging?: boolean;
  /** Has alerts set; `alerted`: one fired since the tab was last shown. */
  watching?: boolean;
  alerted?: boolean;
  /** Auto reconnection planned at this time (ms). */
  reconnectAt?: number;
}

export function TabBar({
  s,
  tabs,
  active,
  onActivate,
  onClose,
  onMenu,
}: {
  s: Styles;
  tabs: readonly TabModel[];
  active: string | null;
  onActivate(id: string | null): void;
  onClose(tab: TabModel): void;
  onMenu(tab: TabModel): void;
}) {
  const tabStyle = (isActive: boolean, color?: string) => (state: unknown) => [
    s.row,
    {
      gap: 6,
      height: 28,
      paddingHorizontal: 10,
      marginRight: 2,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: isActive ? s.c.border : "transparent",
      borderTopColor: color ?? (isActive ? s.c.border : "transparent"),
      borderTopWidth: color ? 2 : 1,
      backgroundColor: isActive ? s.x.tabActive : isHovered(state) ? s.c.surface2 : "transparent",
    },
  ];
  return (
    <View style={{ height: 30, backgroundColor: s.x.tabBar, borderBottomWidth: 1, borderBottomColor: s.c.border, justifyContent: "flex-end" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "flex-end", paddingLeft: 4 }}>
        <Pressable onPress={() => onActivate(null)} style={tabStyle(active === null)}>
          <Icon name="House" size={14} color={s.x.orange} />
        </Pressable>
        {tabs.map((t, i) => {
          const isActive = active === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => onActivate(t.id)}
              onLongPress={() => onMenu(t)}
              {...webProps({
                // Right click: tab menu. Middle click: close (as in MobaXterm).
                onContextMenu: (e: { preventDefault(): void }) => {
                  e.preventDefault();
                  onMenu(t);
                },
                onAuxClick: (e: { button: number; preventDefault(): void }) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(t);
                  }
                },
              })}
              style={tabStyle(isActive, t.color)}
            >
              <Icon name={t.dead ? "SquareX" : "SquareTerminal"} size={13} color={t.dead ? s.x.red : t.color || s.x.ssh} />
              <Text
                selectable={false}
                style={{ color: isActive ? s.c.foreground : s.c.foregroundMuted, fontSize: 12, fontStyle: t.dead ? "italic" : "normal" }}
                numberOfLines={1}
              >
                {`${i + 1}. ${t.label}`}
              </Text>
              {t.logging ? <View accessibilityLabel="Enregistrement en cours" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.x.red }} /> : null}
              {t.watching || t.alerted ? <Icon name={t.alerted ? "BellRing" : "Bell"} size={12} color={t.alerted ? s.x.star : s.c.foregroundMuted} /> : null}
              <Pressable accessibilityLabel="Fermer l'onglet" onPress={() => onClose(t)} style={{ padding: 2 }}>
                <Icon name="X" size={12} color={s.c.foregroundMuted} />
              </Pressable>
            </Pressable>
          );
        })}
        <Pressable onPress={() => dialogStore.set({ kind: "new" })} style={tabStyle(false)}>
          <Icon name="Plus" size={14} color={s.c.foregroundMuted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** MobaXterm's "Session stopped" screen: last content, Enter/R restarts, Esc closes. */
export function DeadSession({
  s,
  tab,
  fontSize,
  onRestart,
  onClose,
  onCancelReconnect,
}: {
  s: Styles;
  tab: TabModel;
  fontSize: number;
  onRestart(): void;
  onClose(): void;
  onCancelReconnect(): void;
}) {
  const input = useRef<NativeTextInput>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!tab.reconnectAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [tab.reconnectAt]);
  const remaining = tab.reconnectAt ? Math.max(0, Math.ceil((tab.reconnectAt - now) / 1000)) : null;
  const last = lastScreens.get(tab.id);
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [tab.id]);
  return (
    <Pressable style={{ flex: 1, backgroundColor: s.x.termBg }} onPress={() => input.current?.focus()}>
      <View {...MONO_SURFACE} style={{ flex: 1, padding: 6, opacity: 0.55, overflow: "hidden" }}>{last ? <ScreenLines s={s} screen={last} fontSize={fontSize} /> : null}</View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, gap: 4, backgroundColor: "rgba(0,0,0,0.75)", borderTopWidth: 1, borderTopColor: s.x.red }}>
        <Text style={{ color: s.x.red, fontFamily: MONO, fontSize: 13, fontWeight: "bold" }}>Session terminée</Text>
        {remaining !== null ? (
          <Text style={{ color: s.x.star, fontFamily: MONO, fontSize: 12 }}>{`  -  Reconnexion automatique dans ${remaining} s`}</Text>
        ) : null}
        <Text style={{ color: s.x.termFg, fontFamily: MONO, fontSize: 12 }}>
          {tab.serverId ? "  -  Appuyez sur <Entrée> ou <R> pour relancer la session" : "  -  Session rapide : relancez-la depuis Quick connect"}
        </Text>
        <Text style={{ color: s.x.termFg, fontFamily: MONO, fontSize: 12 }}>{"  -  Appuyez sur <Échap> pour fermer l'onglet"}</Text>
        <View style={[s.row, { gap: 8, marginTop: 6 }]}>
          {tab.serverId ? <Btn s={s} primary icon="RotateCcw" label="Relancer" onPress={onRestart} /> : null}
          {remaining !== null ? <Btn s={s} icon="TimerOff" label="Annuler la reconnexion" onPress={onCancelReconnect} /> : null}
          <Btn s={s} icon="X" label="Fermer l'onglet" onPress={onClose} />
        </View>
      </View>
      <TextInput
        ref={input}
        value=""
        onKeyPress={(e) => {
          const key = (e as unknown as { nativeEvent: { key: string } }).nativeEvent.key;
          if ((key === "Enter" || key === "r" || key === "R") && tab.serverId) onRestart();
          else if (key === "Escape") onClose();
        }}
        onChangeText={() => undefined}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, left: 0, top: 0 }}
      />
    </Pressable>
  );
}
