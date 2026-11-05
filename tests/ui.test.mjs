// UI tests in the real Paseo web app (test daemon), driven by Chromium. Each check matches a bug
// fixed or a feature added; see tests/README.md.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { check, connect, summary, testServers, TMP, WORK } from "./lib.mjs";

const { chromium } = createRequire(join(TMP, "package.json"))("playwright-core");
const CHROME = process.env.CHROME ?? join(homedir(), ".cache/ms-playwright/chromium-1223/chrome-linux/chrome");

// Seed: test sessions (auto reconnect on), no leftover terminals.
const { client, paseo, rpc } = await connect();
const { a } = await testServers(rpc);
await rpc("servers.save", { ...a, hasPassword: undefined, autoReconnect: true });
for (const t of (await paseo.terminals.list({})).entries) await paseo.terminals.ref(t).kill().catch(() => {});
const src = join(WORK, "ui");
rmSync(src, { recursive: true, force: true });
mkdirSync(join(src, "dossier"), { recursive: true });
writeFileSync(join(src, "dossier", "a.txt"), "A\n");
writeFileSync(join(src, "seul.txt"), "seul\n");
await client.close();

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
let nativeDialogs = 0;
page.on("dialog", async (d) => {
  nativeDialogs += 1;
  await d.dismiss();
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const has = async (re) => (await page.getByText(re).count()) > 0;
const openSsh = async () => {
  await page.getByText("SSH", { exact: true }).first().click();
  await page.getByText("User sessions").first().waitFor({ timeout: 10000 });
};
const quick = async (name) => {
  await page.getByPlaceholder("Quick connect...").click();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
};
const typeInComposer = async () => {
  await page.getByText("Nouvel espace de travail").first().click();
  await page.waitForTimeout(2000);
  await page.mouse.click(900, 440);
  await page.keyboard.type("bonjour", { delay: 15 });
  const v = await page.evaluate(() => document.activeElement?.value ?? null);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  return v;
};

try {
  await page.goto("http://127.0.0.1:6790/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log("Terminal");
  await openSsh();
  await quick("TEST_SSH");
  check("onglet de session ouvert", await has(/^1\. TEST_SSH$/));
  await page.mouse.click(1000, 400);
  await page.keyboard.type("echo abcdef", { delay: 10 });
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1000);
  const font = await page.evaluate(() => {
    // Terminal lines use non-breaking spaces.
    const el = [...document.querySelectorAll("div[dir=auto], span")].find((e) => /echo[\s\u00a0]abcdef/.test(e.textContent ?? "") && (e.textContent ?? "").length < 60);
    return el ? getComputedStyle(el).fontFamily : "";
  });
  check("texte du terminal en chasse fixe", /Menlo|DejaVu Sans Mono|monospace/.test(font), font);
  await page.keyboard.press("Control+U");

  console.log("Saisie dans Paseo après usage du SSH (bug Electron / confirm natif)");
  await page.getByLabel("Fermer l'onglet").last().click();
  await page.waitForTimeout(800);
  check("confirmation dans le plugin, pas de boîte native", (await has(/^Fermer la session$/)) && nativeDialogs === 0);
  await page.getByText("Fermer", { exact: true }).last().click();
  await page.waitForTimeout(1000);
  check("saisie possible dans un workspace ensuite", (await typeInComposer()) === "bonjour");

  console.log("Sélection, Sftp avancé");
  await openSsh();
  await page.getByText("TEST_SSH", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByLabel("Sftp").first().click();
  await page.waitForTimeout(1500);
  check("un clic rapide sélectionne la session", !(await has(/Sélectionnez une session/)));
  const pathBox = page.locator("input").nth(1);
  await pathBox.fill(src);
  await pathBox.press("Enter");
  await page.waitForTimeout(1500);
  await page.getByText("dossier", { exact: true }).first().click();
  await page.keyboard.down("Control");
  await page.getByText("seul.txt", { exact: true }).first().click();
  await page.keyboard.up("Control");
  check("multi-sélection Ctrl+clic", await has(/2 éléments sélectionnés/));
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByLabel(/Télécharger la sélection/).first().click()]);
  await dl.saveAs(join(TMP, "dl.tar.gz"));
  check("téléchargement en .tar.gz", execSync(`tar tzf ${join(TMP, "dl.tar.gz")}`).toString().includes("dossier/a.txt"));
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["depose\n"], "depose.txt", { type: "text/plain" }));
    return d;
  });
  const zone = page.getByText("seul.txt", { exact: true }).first();
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await page.waitForTimeout(2500);
  check("glisser-déposer depuis l'ordinateur", existsSync(join(src, "depose.txt")));
  // Wait for the list to settle after the upload (a new row shifts the others), then double-click.
  await page.getByText("depose.txt", { exact: true }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  const row = await page.getByText("seul.txt", { exact: true }).first().boundingBox();
  await page.mouse.dblclick(row.x + 10, row.y + 5);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(TMP, "ui-editor.png") });
  const ta = await page.evaluate(() => {
    const t = [...document.querySelectorAll("textarea")].find((x) => x.getBoundingClientRect().height > 50);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 15 };
  });
  if (ta) {
    await page.mouse.click(ta.x, ta.y);
    await page.keyboard.type("X");
  }
  check("double-clic ouvre l'éditeur, qui accepte la saisie", !!ta && (await page.evaluate(() => (document.activeElement?.value ?? "").includes("X"))));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  console.log("Journal, alertes, export, reconnexion");
  await page.getByLabel("Sessions").first().click().catch(() => {});
  await quick("TEST_SSH");
  const tab = page.getByText(/^\d\. TEST_SSH$/).last();
  await tab.click({ button: "right" });
  await page.waitForTimeout(700);
  await page.getByText("Enregistrer la session dans un journal").first().click();
  await page.waitForTimeout(1500);
  check("journal démarré depuis le menu d'onglet", await has(/Enregistrement : /));
  await tab.click({ button: "right" });
  await page.waitForTimeout(700);
  await page.getByText(/Alertes \(mot-clé/).first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder("error, failed, Build succeeded").fill("ALERTE_UI");
  await page.getByText("Enregistrer", { exact: true }).last().click();
  await page.waitForTimeout(1000);
  await page.mouse.click(1000, 400);
  await page.keyboard.type("echo ALERTE_$((1))_UI | sed s/_1_/_/\n", { delay: 10 });
  await page.waitForTimeout(2500);
  check("alerte mot-clé affichée", await has(/« ALERTE_UI »/));
  await tab.click({ button: "right" });
  await page.waitForTimeout(700);
  const [exp] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.getByText("Exporter l'historique (.txt)").first().click()]);
  check("export de l'historique", exp.suggestedFilename().endsWith(".txt"));
  await page.waitForTimeout(600);
  await page.mouse.click(1000, 400);
  await page.keyboard.type("exit\n", { delay: 15 });
  await page.waitForTimeout(2500);
  check("session terminée : compte à rebours de reconnexion", await has(/Reconnexion automatique dans/));
  await page.waitForTimeout(6000);
  check("session relancée automatiquement", !(await has(/Session terminée/)) && (await has(/^\d\. TEST_SSH$/)));

  console.log("Confirmation de fermeture désactivable");
  await page.getByLabel("Fermer l'onglet").last().click();
  await page.waitForTimeout(700);
  await page.getByText(/Ne plus demander/).first().click();
  await page.getByText("Fermer", { exact: true }).last().click();
  await page.waitForTimeout(1200);
  await quick("TEST_SSH");
  await page.getByLabel("Fermer l'onglet").last().click();
  await page.waitForTimeout(1200);
  check("fermeture sans confirmation après « Ne plus demander »", !(await has(/^Fermer la session$/)));
  check("saisie dans Paseo toujours possible", (await typeInComposer()) === "bonjour");

  console.log("Mobile (iPhone émulé)");
  const { devices } = createRequire(join(TMP, "package.json"))("playwright-core");
  const mctx = await browser.newContext({ ...devices["iPhone 13"] });
  const m = await mctx.newPage();
  m.on("pageerror", (e) => errors.push(`mobile: ${e.message}`));
  await m.goto("http://127.0.0.1:6790/", { waitUntil: "networkidle" });
  await m.waitForTimeout(2000);
  await m.mouse.click(25, 30);
  await m.waitForTimeout(1000);
  await m.getByText("SSH", { exact: true }).first().tap();
  await m.waitForTimeout(2500);
  check("barre d'onglets mobile", (await m.getByText("Terminaux", { exact: true }).count()) > 0 && (await m.getByLabel("Outils").count()) > 0);
  await m.getByText("TEST_SSH", { exact: true }).first().tap();
  await m.waitForTimeout(3500);
  // A tap on the terminal opens the keyboard (the typing field itself is invisible).
  await m.touchscreen.tap(195, 420);
  await m.waitForTimeout(400);
  check("toucher le terminal donne le focus à la saisie", await m.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Saisie du terminal"));
  await m.keyboard.type("echo tactile-oz", { delay: 25 });
  await m.keyboard.press("Backspace");
  await m.keyboard.type("k");
  await m.keyboard.press("Enter");
  await m.waitForTimeout(1500);
  const screenText = await m.evaluate(() => document.body.innerText.replace(/\u00a0/g, " "));
  check("saisie tactile avec effacement", /\ntactile-ok\n/.test(screenText));
  await m.getByLabel("ArrowUp").tap();
  await m.waitForTimeout(1200);
  const recalled = await m.evaluate(() => document.body.innerText.replace(/\u00a0/g, " "));
  check("rangée de touches (flèche haut = historique)", (recalled.match(/echo tactile-ok/g) ?? []).length >= 2);
  await mctx.close();

  check("aucune erreur JavaScript", errors.length === 0, errors.join(" | "));
} catch (err) {
  check("exception", false, err.message.split("\n")[0]);
  await page.screenshot({ path: join(TMP, "ui-failure.png") });
} finally {
  await browser.close();
  // Restore the defaults changed by the test.
  const c = await connect();
  const prefs = await c.rpc("settings.prefs.read", {});
  if (prefs.status === "ready") await c.rpc("settings.prefs.write", { revision: prefs.revision, values: { ...prefs.values, confirmClose: true } }).catch(() => {});
  await c.client.close();
}
process.exit(summary("Tests interface") ? 1 : 0);
