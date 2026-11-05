import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { monitorRpc, type MonitorData, type Server } from "../shared/rpc";
import { prefsSettings } from "../shared/settings";
import { useVisible } from "./visibility";
import { errorMessage, formatBytes, formatRate, formatUptime, frNumber, withAlpha, type Styles } from "./util";
import { ErrorBox } from "./widgets";

function useMonitor(server: Server) {
  const read = useRpc(monitorRpc);
  const settings = useSettings(prefsSettings);
  const interval = settings.status === "ready" ? settings.values.monitorInterval : 5;
  const visible = useVisible();
  return useQuery({
    queryKey: ["ssh-manager", "monitor", server.id],
    queryFn: () => read({ id: server.id }),
    refetchInterval: interval * 1000,
    enabled: visible,
    retry: false,
  });
}

function levelColor(s: Styles, pct: number): string {
  if (pct >= 90) return s.c.statusDanger;
  if (pct >= 75) return s.c.statusWarning;
  return s.c.statusSuccess;
}

function Segment({ s, icon, text, color, children }: { s: Styles; icon: string; text?: string; color?: string; children?: ReactNode }) {
  return (
    <View style={[s.row, { gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRightWidth: 1, borderRightColor: s.c.border }]}>
      <Icon name={icon} size={13} color={color ?? s.c.foregroundMuted} />
      {children}
      {text ? (
        <Text style={{ color: s.c.foreground, fontSize: 11 }} numberOfLines={1}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/** Small CPU history graph, like the green one in MobaXterm's status bar. */
function Spark({ s, values }: { s: Styles; values: number[] }) {
  const bars = values.slice(-24);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 14, width: 48, backgroundColor: "#0a0a0a" }}>
      {Array.from({ length: 24 - bars.length }).map((_, i) => (
        <View key={`e${i}`} style={{ width: 2 }} />
      ))}
      {bars.map((v, i) => (
        <View key={i} style={{ width: 2, height: Math.max(1, (Math.min(100, v) / 100) * 14), backgroundColor: s.x.green }} />
      ))}
    </View>
  );
}

const cpuHistory: Record<string, number[]> = {};

function hours(sec: number): string {
  const h = Math.floor(sec / 3600);
  if (h >= 48) return `${Math.floor(h / 24)} jours`;
  if (h >= 1) return `${h} heure${h > 1 ? "s" : ""}`;
  return `${Math.floor(sec / 60)} min`;
}

function formatRateMb(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return "-";
  return `${((bytesPerSec * 8) / 1e6).toFixed(2)} Mb/s`;
}

/** One-line status bar, like MobaXterm's bottom bar ("Remote monitoring"). */
export function MonitorBar({ s, server }: { s: Styles; server: Server }) {
  const query = useMonitor(server);
  const m = query.data;
  const history = cpuHistory[server.id] ?? (cpuHistory[server.id] = []);
  const lastStamp = useRef(0);
  if (m && m.cpuPct !== null && query.dataUpdatedAt !== lastStamp.current) {
    lastStamp.current = query.dataUpdatedAt;
    history.push(m.cpuPct);
    if (history.length > 60) history.shift();
  }
  const bar = { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, backgroundColor: s.x.statusBar, minHeight: 24 };
  if (query.error) {
    return (
      <View style={bar}>
        <Segment s={s} icon="SquareTerminal" text={server.name} color={s.x.ssh} />
        <Segment s={s} icon="TriangleAlert" color={s.x.red} text={errorMessage(query.error)} />
      </View>
    );
  }
  if (!m) {
    return (
      <View style={bar}>
        <Segment s={s} icon="SquareTerminal" text={server.name} color={s.x.ssh} />
        <Segment s={s} icon="Loader" text="Remote monitoring..." />
      </View>
    );
  }
  const memPct = m.memTotal ? (m.memUsed / m.memTotal) * 100 : 0;
  return (
    <View style={bar}>
      <Segment s={s} icon="SquareTerminal" text={m.hostname || server.name} color={s.x.ssh} />
      {m.cpuPct !== null ? <Segment s={s} icon="Cog" color={levelColor(s, m.cpuPct)} text={`${Math.round(m.cpuPct)}%`} /> : null}
      {history.length ? (
        <View style={{ paddingHorizontal: 6, borderRightWidth: 1, borderRightColor: s.c.border, height: 24, justifyContent: "center" }}>
          <Spark s={s} values={history} />
        </View>
      ) : null}
      {m.memTotal ? (
        <Segment
          s={s}
          icon="MemoryStick"
          color={levelColor(s, memPct)}
          text={frNumber(`${(m.memUsed / 1073741824).toFixed(2)} GB / ${(m.memTotal / 1073741824).toFixed(2)} GB`)}
        />
      ) : null}
      <Segment s={s} icon="ArrowUp" color={s.x.green} text={frNumber(formatRateMb(m.txRate))} />
      <Segment s={s} icon="ArrowDown" color={s.x.blue} text={frNumber(formatRateMb(m.rxRate))} />
      {m.uptimeSec ? <Segment s={s} icon="Clock" text={hours(m.uptimeSec)} /> : null}
      <Segment s={s} icon="User" text={m.userNames.trim().replace(/ \(x1\)/g, "") || `${m.users} user(s)`} />
      <Segment s={s} icon="HardDrive">
        <View style={[s.row, { gap: 10 }]}>
          {m.disks.map((d) => (
            <Text key={d.mount} style={{ fontSize: 11, color: d.usedPct >= 90 ? s.x.red : d.usedPct >= 75 ? s.c.statusWarning : s.c.foreground }}>
              {d.mount}: {d.usedPct}%
            </Text>
          ))}
        </View>
      </Segment>
    </View>
  );
}

function Gauge({ s, label, pct, detail }: { s: Styles; label: string; pct: number; detail: string }) {
  const color = levelColor(s, pct);
  return (
    <View style={{ gap: 4 }}>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Text style={[s.text, { fontWeight: "500" }]}>{label}</Text>
        <Text style={s.muted}>{detail}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: withAlpha(s.c.foregroundMuted, 0.2), overflow: "hidden" }}>
        <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 8, backgroundColor: color }} />
      </View>
    </View>
  );
}

function Details({ s, m }: { s: Styles; m: MonitorData }) {
  return (
    <View style={{ gap: 14 }}>
      <View style={[s.card, { padding: 12, gap: 4 }]}>
        <Text style={s.title}>{m.hostname}</Text>
        <Text style={s.muted}>{m.os}</Text>
        <Text style={s.muted}>
          Uptime {formatUptime(m.uptimeSec)}  -  charge {m.load || "-"}  -  {m.cpuCount ?? "?"} CPU
        </Text>
        <Text style={s.muted}>Utilisateurs : {m.userNames.trim() || "aucun"}</Text>
      </View>
      <View style={[s.card, { padding: 12, gap: 12 }]}>
        {m.cpuPct !== null ? <Gauge s={s} label="CPU" pct={m.cpuPct} detail={`${m.cpuPct.toFixed(1)} %`} /> : null}
        {m.memTotal ? (
          <Gauge
            s={s}
            label="Mémoire"
            pct={(m.memUsed / m.memTotal) * 100}
            detail={`${formatBytes(m.memUsed, 2)} / ${formatBytes(m.memTotal, 2)}`}
          />
        ) : null}
        {m.swapTotal ? (
          <Gauge s={s} label="Swap" pct={(m.swapUsed / m.swapTotal) * 100} detail={`${formatBytes(m.swapUsed, 2)} / ${formatBytes(m.swapTotal, 2)}`} />
        ) : null}
        <View style={[s.row, { gap: 16 }]}>
          <Text style={s.text}>Envoi : {formatRate(m.txRate)}</Text>
          <Text style={s.text}>Réception : {formatRate(m.rxRate)}</Text>
        </View>
      </View>
      <View style={[s.card, { padding: 12, gap: 12 }]}>
        <Text style={[s.text, { fontWeight: "600" }]}>Disques</Text>
        {m.disks.map((d) => (
          <Gauge key={d.mount} s={s} label={d.mount} pct={d.usedPct} detail={`${formatBytes(d.used)} / ${formatBytes(d.size)} (${d.usedPct} %)`} />
        ))}
      </View>
    </View>
  );
}

export function MonitorView({ s, server }: { s: Styles; server: Server }) {
  const query = useMonitor(server);
  if (query.error) return <ErrorBox s={s} message={errorMessage(query.error)} />;
  if (!query.data) return <ActivityIndicator color={s.c.accent} style={{ marginTop: 24 }} />;
  return <Details s={s} m={query.data} />;
}
