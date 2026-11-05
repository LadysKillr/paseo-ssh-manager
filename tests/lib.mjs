// Helpers shared by the tests: a client of the TEST daemon (never the real one), assertions.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TMP = join(ROOT, "tests", ".tmp");
export const PASEO_HOME = join(TMP, "paseo");
export const SSH_KEY = join(TMP, "sshd", "testkey");
export const WORK = join(TMP, "work");

const cliPkg = process.env.PASEO_CLI_PACKAGE ?? "/usr/lib/node_modules/@getpaseo/cli/package.json";
const require = createRequire(cliPkg);
const load = (id) => import(pathToFileURL(require.resolve(id)).href);

export async function connect() {
  const [cm, control, ws, api] = await Promise.all([
    load("@getpaseo/client/internal/daemon-client"),
    load("@getpaseo/server/daemon-control"),
    load("ws"),
    load("@getpaseo/client"),
  ]);
  const listen = (await control.readDaemonInstance(PASEO_HOME))?.listen;
  if (listen !== "127.0.0.1:6790") throw new Error(`Daemon de test introuvable (listen=${listen}) : lancez tests/setup.sh`);
  const W = ws.default ?? ws.WebSocket;
  const client = new cm.DaemonClient({
    url: `ws://${listen}/ws`,
    clientId: "cid_ssh_manager_tests",
    clientType: "cli",
    localCredential: () => control.readLocalCredentialForTarget(PASEO_HOME, listen) ?? undefined,
    connectTimeoutMs: 10000,
    reconnect: { enabled: false },
    webSocketFactory: (u, cfg) => new W(u, cfg?.protocols, { headers: cfg?.headers }),
  });
  await client.connect();
  const paseo = api.createPaseoApi(client);
  const rpc = (method, input) => client.invokePluginRpc("ssh-manager", method, input);
  return { client, paseo, rpc };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let passes = 0;
export function check(label, ok, detail = "") {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ok  " : "  ÉCHEC"} ${label}${detail ? `  (${detail})` : ""}`);
}
export function summary(name) {
  console.log(`${name} : ${passes} ok, ${failures} échec(s)`);
  return failures;
}

/** The two test sessions (same sshd), created once. */
export async function testServers(rpc) {
  const list = (await rpc("servers.list", {})).servers;
  const ensure = async (name) =>
    list.find((x) => x.name === name) ??
    (
      await rpc("servers.save", {
        name,
        host: "127.0.0.1",
        port: 2222,
        user: process.env.USER ?? "ubuntu",
        identityFile: SSH_KEY,
        group: "Test",
        // Own known_hosts: the tests never touch ~/.ssh/known_hosts.
        extraArgs: `-o UserKnownHostsFile=${join(TMP, "known_hosts")}`,
      })
    ).server;
  return { a: await ensure("TEST_SSH"), b: await ensure("TEST_SSH_2") };
}
