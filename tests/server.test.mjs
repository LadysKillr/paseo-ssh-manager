// Daemon-side tests against the isolated test environment (tests/setup.sh).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { check, connect, sleep, summary, testServers, PASEO_HOME, WORK } from "./lib.mjs";

const { client, paseo, rpc } = await connect();
const { a, b } = await testServers(rpc);
const ws = await paseo.workspaces.open(WORK);
const terms = [];
const newTerminal = async (opts) => {
  const t = await paseo.terminals.create({ workspaceId: ws.id, ...opts });
  terms.push(t);
  await sleep(700);
  return t;
};
const text = (sc) => sc.lines.map((l) => l.map((r) => r[0]).join(""));

try {
  console.log("Sessions et fichiers");
  const st = await rpc("servers.status", { ids: [a.id] });
  check("statut : sshd joignable", st.statuses[0]?.reachable === true);
  const src = join(WORK, "src");
  rmSync(src, { recursive: true, force: true });
  mkdirSync(join(src, "dossier", "sous"), { recursive: true });
  writeFileSync(join(src, "dossier", "sous", "b.txt"), "contenu B\n");
  await rpc("files.write-text", { id: a.id, path: join(src, "é t.txt"), text: "accentué\n" });
  check("écriture / lecture (accents, espaces)", (await rpc("files.read-text", { id: a.id, path: join(src, "é t.txt") })).text === "accentué\n");
  const listing = await rpc("files.list", { id: a.id, path: src });
  check("listage", listing.entries.some((e) => e.name === "dossier" && e.type === "dir"));
  const arc = await rpc("files.archive", { id: a.id, dir: src, names: ["dossier"] });
  let off = 0;
  const parts = [];
  for (let done = false; !done; ) {
    const r = await rpc("files.archive-chunk", { token: arc.token, offset: off, length: 1 << 20 });
    const buf = Buffer.from(r.base64, "base64");
    parts.push(buf);
    off += buf.length;
    done = r.done;
  }
  writeFileSync(join(WORK, "a.tar.gz"), Buffer.concat(parts));
  check("archive .tar.gz", execSync(`tar tzf ${join(WORK, "a.tar.gz")}`).toString().includes("dossier/sous/b.txt"));
  rmSync(join(WORK, "dst"), { recursive: true, force: true });
  await rpc("files.copy-server", { fromId: a.id, dir: src, names: ["dossier"], toId: b.id, targetDir: join(WORK, "dst") });
  check("copie serveur -> serveur", existsSync(join(WORK, "dst", "dossier", "sous", "b.txt")));

  console.log("Terminal (émulation xterm)");
  const t = await newTerminal({ name: "ssh: tests", command: "bash", args: ["--norc"], size: { rows: 20, cols: 80 } });
  await rpc("terminal.screen", { terminalId: t.id, rows: 15, cols: 70 });
  t.write("printf '\\033[1;31mROUGE\\033[0m \\033[42mFOND\\033[0m\\n'\r");
  await sleep(500);
  t.write("echo abcdef\x1b[D\x1b[D\x1b[D");
  await sleep(600);
  let sc = await rpc("terminal.screen", { terminalId: t.id });
  const colorLine = sc.lines.find((l) => l[0]?.[0]?.startsWith("ROUGE"));
  check("couleurs (rouge gras, fond vert)", colorLine?.[0]?.[1] === "#e04343" && colorLine?.[0]?.[3] === 1 && colorLine?.[2]?.[2] === "#3dbb4a");
  check("curseur réel après les flèches", sc.cursor.ch === "d", JSON.stringify(sc.cursor));
  check("redimensionnement du PTY", sc.rows === 15 && sc.cols === 70);
  const t0 = Date.now();
  const idle = await rpc("terminal.screen", { terminalId: t.id, since: sc.version, waitMs: 1500 });
  check("long poll (attente sans changement)", idle.unchanged === true && Date.now() - t0 >= 1400);
  t.write("\x03");
  await sleep(300);
  t.write("seq 1 200 | sed 's/^/ligne-/'\r");
  await sleep(800);
  const found = await rpc("terminal.search", { terminalId: t.id, query: "LIGNE-42" });
  check("recherche dans l'historique", found.matches.some((m) => m.col === 0));
  sc = await rpc("terminal.screen", { terminalId: t.id, scroll: 30 });
  check("défilement dans l'historique", sc.scroll === 30 && !sc.cursor.visible);
  t.write("printf '\\033[?1000h\\033[?1006h'; stty -echo -icanon; od -c\r");
  await sleep(700);
  // od -c prints a line per 16 bytes: send press, release and wheel (> 16 bytes).
  for (const action of ["down", "up", "wheel-up"]) await rpc("terminal.mouse", { terminalId: t.id, x: 4, y: 2, button: 0, action });
  await sleep(400);
  t.write("\x04\x04");
  await sleep(500);
  const cap = await t.capture({ stripAnsi: true });
  check("souris SGR transmise au programme", cap.lines.join("\n").includes("[   <   0   ;   5   ;   3   M"));

  console.log("Journal et alertes");
  const t2 = await newTerminal({ name: "ssh: journal", command: "bash", args: ["--norc"] });
  const log = await rpc("terminal.log", { terminalId: t2.id, enabled: true, label: "tests" });
  await rpc("terminal.watch", { terminalId: t2.id, label: "tests", watch: { keywords: ["ALERTE"], idleSec: 2, activitySec: 0, once: false } });
  let since = (await rpc("alerts.poll", { since: 0 })).last;
  t2.write("export PS1='u@h:~$ '\r");
  await sleep(300);
  t2.write("for i in 1 2 3 4; do echo etape $i; sleep 1; done; echo une ALERTE ici\r");
  const kinds = [];
  for (const end = Date.now() + 8000; Date.now() < end; ) {
    const r = await rpc("alerts.poll", { since, waitMs: 2000 });
    since = r.last;
    kinds.push(...r.events.map((e) => `${e.kind}:${e.message}`));
  }
  check("alerte mot-clé (sortie seulement, pas la commande tapée)", kinds.filter((k) => k.startsWith("keyword")).length === 1, kinds.join(" | "));
  check("alerte fin de commande", kinds.some((k) => k.startsWith("idle")));
  await rpc("terminal.log", { terminalId: t2.id, enabled: false, label: "tests" });
  const content = readFileSync(join(PASEO_HOME, "plugin-data", "ssh-manager", "logs", log.name), "utf8");
  check("journal en texte brut", content.includes("une ALERTE ici") && !/\x1b/.test(content));
  await rpc("terminal.watch", { terminalId: t2.id, label: "tests", watch: null });

  console.log("Suivi du dossier (Follow terminal folder)");
  const launch = await rpc("terminal.command", { id: a.id });
  const t3 = await newTerminal({ name: launch.name, command: launch.command, args: launch.args });
  await rpc("terminal.register", { terminalId: t3.id, serverId: a.id, tag: launch.tag });
  await sleep(2000);
  t3.write(`cd ${WORK}\r`);
  await sleep(800);
  check("dossier du shell distant", (await rpc("terminal.cwd", { terminalId: t3.id })).cwd === WORK);

  console.log("Tunnels");
  const tun = (await rpc("tunnels.save", { name: "test", serverId: a.id, type: "local", bindAddress: "127.0.0.1", bindPort: 18080, destHost: "127.0.0.1", destPort: 2222, autoStart: false })).tunnel;
  await rpc("tunnels.action", { id: tun.id, action: "start" });
  await sleep(3000);
  const banner = await new Promise((res) => {
    const so = net.connect(18080, "127.0.0.1");
    so.once("data", (d) => (res(d.toString()), so.destroy()));
    so.once("error", (e) => res(`ERR ${e.message}`));
    setTimeout(() => (res("timeout"), so.destroy()), 3000);
  });
  check("tunnel local (bannière SSH reçue)", String(banner).startsWith("SSH-2.0"));
  await rpc("tunnels.action", { id: tun.id, action: "delete" });
} catch (err) {
  check("exception", false, err.message);
} finally {
  for (const t of terms) await t.kill().catch(() => {});
  await client.close();
}
process.exit(summary("Tests serveur") ? 1 : 0);
