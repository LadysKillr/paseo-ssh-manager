import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Styles } from "./util";

export function Btn({
  s,
  label,
  icon,
  onPress,
  primary,
  danger,
  disabled,
  busy,
  compact,
}: {
  s: Styles;
  label?: string;
  icon?: string;
  onPress(): void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}) {
  const color = primary ? s.c.accentForeground : danger ? s.c.statusDanger : s.c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        primary ? s.buttonPrimary : s.button,
        compact ? { paddingHorizontal: 8, paddingVertical: 4 } : null,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} size={14} color={color} /> : null}
      {label ? <Text style={{ color, fontSize: 12, fontWeight: "500" }}>{label}</Text> : null}
    </Pressable>
  );
}

export function IconBtn({
  s,
  icon,
  label,
  onPress,
  color,
  disabled,
  size = 16,
}: {
  s: Styles;
  icon: string;
  label: string;
  onPress(): void;
  color?: string;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // @ts-expect-error title is a react-native-web prop (tooltip)
      title={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={size} color={color ?? s.c.foreground} />
    </Pressable>
  );
}

export function Check({ s, checked, onToggle, label }: { s: Styles; checked: boolean; onToggle(): void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={[s.row, { gap: 6, paddingVertical: 2 }]}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: checked ? s.c.accent : s.c.border,
          backgroundColor: checked ? s.c.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="Check" size={12} color={s.c.accentForeground} /> : null}
      </View>
      {label ? <Text style={s.text}>{label}</Text> : null}
    </Pressable>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Tabs<T extends string>({
  s,
  value,
  options,
  onChange,
}: {
  s: Styles;
  value: T;
  options: readonly { value: T; label: string; icon: string }[];
  onChange(v: T): void;
}) {
  return (
    <View style={[s.row, { borderBottomWidth: 1, borderBottomColor: s.c.border }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderBottomWidth: 2,
              borderBottomColor: active ? s.c.accent : "transparent",
            }}
          >
            <Icon name={o.icon} size={14} color={active ? s.c.foreground : s.c.foregroundMuted} />
            <Text style={{ color: active ? s.c.foreground : s.c.foregroundMuted, fontSize: 12, fontWeight: "500" }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ s, icon, text, children }: { s: Styles; icon: string; text: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
      <Icon name={icon} size={28} color={s.c.foregroundMuted} />
      <Text style={[s.muted, { textAlign: "center" }]}>{text}</Text>
      {children}
    </View>
  );
}

export function ErrorBox({ s, message }: { s: Styles; message: string }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: s.c.statusDanger,
        borderRadius: 6,
        padding: 8,
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <Icon name="TriangleAlert" size={14} color={s.c.statusDanger} />
      <Text style={[s.text, { flex: 1, color: s.c.statusDanger }]} selectable>
        {message}
      </Text>
    </View>
  );
}
