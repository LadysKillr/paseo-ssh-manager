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

type SideTab = AppTab;

export function ToolPage({ s, icon, color, title, onClose, children }: { s: Styles; icon: string; color: string; title: string; onClose(): void; children: ReactElement }) {
  return (
    <View style={{ flex: 1, backgroundColor: s.c.surface0 }}>
      <View style={[s.row, { gap: 8, paddingHorizontal: 10, height: 34, borderBottomWidth: 1, borderBottomColor: s.c.border, backgroundColor: s.c.surface1 }]}>
        <Icon name={icon} size={16} color={color} />
        <Text style={[s.text, { fontWeight: "600", flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        <IconBtn s={s} icon="X" label="Fermer et revenir aux sessions" onPress={onClose} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "stretch" }}>
        {children}
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export const STRIP: { value: SideTab; label: string; icon: string; color: (s: Styles) => string }[] = [
  { value: "sessions", label: "Sessions", icon: "Star", color: (s) => s.x.star },
  { value: "files", label: "Sftp", icon: "FolderTree", color: (s) => s.x.orange },
];

/** MobaXterm-like top toolbar: big icon, label underneath. */
export function ToolButton({ s, icon, label, color, active, onPress }: { s: Styles; icon: string; label: string; color: string; active?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => [
        {
          minWidth: 64,
          height: 50,
          paddingHorizontal: 6,
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: active ? s.c.accent : "transparent",
          backgroundColor: active ? s.x.selection : isHovered(state) ? s.c.surface2 : "transparent",
        },
      ]}
    >
      <Icon name={icon} size={22} color={color} />
      <Text style={{ color: s.c.foreground, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
