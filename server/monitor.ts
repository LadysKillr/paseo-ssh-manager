import type { MonitorData } from "../shared/rpc";
import { runScript, sshError } from "./ssh";
import type { StoredServer } from "./store";

const SCRIPT = `
cpu() { awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat 2>/dev/null; }
net() { awk -F'[: ]+' 'NR>2 { i=$2; if (i!="lo" && i !~ /^(veth|br-|docker|virbr|cni|flannel)/) { rx+=$3; tx+=$11 } } END { print rx+0, tx+0 }' /proc/net/dev 2>/dev/null; }
c1=$(cpu); n1=$(net); t1=$(date +%s%N 2>/dev/null)
sleep 1
c2=$(cpu); n2=$(net); t2=$(date +%s%N 2>/dev/null)
echo "host=$(hostname 2>/dev/null || uname -n)"
os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") ); [ -n "$os" ] || os=$(uname -sr)
echo "os=$os"
echo "cpu1=$c1"; echo "cpu2=$c2"; echo "net1=$n1"; echo "net2=$n2"; echo "t1=$t1"; echo "t2=$t2"
echo "ncpu=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)"
[ -r /proc/loadavg ] && echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
[ -r /proc/meminfo ] && awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}/^SwapTotal:/{st=$2}/^SwapFree:/{sf=$2} END{print "mem="t*1024" "(t-a)*1024; print "swap="st*1024" "(st-sf)*1024}' /proc/meminfo
[ -r /proc/uptime ] && echo "uptime=$(cut -d' ' -f1 /proc/uptime)"
echo "usercount=$(who 2>/dev/null | wc -l)"
echo "users=$(who 2>/dev/null | awk '{print $1}' | sort | uniq -c | awk '{printf "%s (x%s) ", $2, $1}')"
df -P -k 2>/dev/null | awk 'NR>1 && $6 ~ /^\\// && $6 !~ /^\\/(snap|run|sys|dev|proc|var\\/lib\\/docker)/ && $1 !~ /^(tmpfs|devtmpfs|overlay|shm|udev|none)$/ {print "disk="$6"|"$2*1024"|"$3*1024"|"$5}'
exit 0
`;

export async function readMonitor(server: StoredServer): Promise<MonitorData> {
  const res = await runScript(server, SCRIPT, [], { timeoutMs: 20_000 });
  if (res.code !== 0) throw sshError(res, "Monitoring indisponible");
  const values = new Map<string, string>();
  const disks: MonitorData["disks"] = [];
  for (const line of res.stdout.toString("utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1).trim();
    if (key === "disk") {
      const [mount, size, used, pct] = value.split("|");
      disks.push({ mount: mount ?? "?", size: Number(size) || 0, used: Number(used) || 0, usedPct: Number((pct ?? "").replace("%", "")) || 0 });
    } else values.set(key, value);
  }
  const pair = (k: string) => (values.get(k) ?? "").split(" ").map(Number);
  const [ct1, ci1] = pair("cpu1");
  const [ct2, ci2] = pair("cpu2");
  let cpuPct: number | null = null;
  if (ct1 && ct2 && ct2 > ct1) cpuPct = Math.max(0, Math.min(100, (1 - ((ci2 ?? 0) - (ci1 ?? 0)) / (ct2 - ct1)) * 100));
  const [rx1, tx1] = pair("net1");
  const [rx2, tx2] = pair("net2");
  const t1 = Number(values.get("t1"));
  const t2 = Number(values.get("t2"));
  const seconds = t1 && t2 && t2 > t1 ? (t2 - t1) / 1e9 : 1;
  const rate = (a?: number, b?: number) => (a !== undefined && b !== undefined && !Number.isNaN(a) && !Number.isNaN(b) && values.has("net1") ? Math.max(0, (b - a) / seconds) : null);
  const [memTotal, memUsed] = pair("mem");
  const [swapTotal, swapUsed] = pair("swap");
  disks.sort((a, b) => a.mount.localeCompare(b.mount));
  return {
    hostname: values.get("host") ?? "",
    os: values.get("os") ?? "",
    cpuPct,
    cpuCount: Number(values.get("ncpu")) || null,
    load: values.get("load") ?? "",
    memTotal: memTotal || 0,
    memUsed: memUsed || 0,
    swapTotal: swapTotal || 0,
    swapUsed: swapUsed || 0,
    uptimeSec: Math.floor(Number(values.get("uptime")) || 0),
    users: Number(values.get("usercount")) || 0,
    userNames: values.get("users") ?? "",
    rxRate: rate(rx1, rx2),
    txRate: rate(tx1, tx2),
    disks,
  };
}
