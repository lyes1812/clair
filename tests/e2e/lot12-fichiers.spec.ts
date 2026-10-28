import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, setConfidentialite, signUp } from "./helpers";

// Lot 12 — fichiers réels : les classeurs Excel et les CSV proposés par les menus « Exporter » sont téléchargés depuis l'environnement
// vérifié, et le PDF de synthèse de la Masse salariale croisée est produit en mode impression (A4 paysage). Les fichiers sont
// déposés dans <captures>/fichiers/ puis contrôlés hors navigateur (scripts/verify-exports.mjs : exceljs, LibreOffice, pdfinfo).
const run = Date.now().toString(36);
const OUT = `${CAPTURES}/fichiers`;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("Fichiers réels : classeurs Excel, CSV et PDF de synthèse téléchargés depuis l'environnement vérifié", async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  await signUp(page, { name: "Admin Fichiers", email: `fichiers-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Fichiers fictifs ${run}`);

  // Lecture PayFit fictive appliquée sur 24 mois (mêmes étapes que les autres parcours).
  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");
  // Données fictives : sept personnes, services de deux ou trois personnes. Le seuil est posé à 1 pour que les fichiers portent
  // les tableaux complets ; le masquage est vérifié à part (module3, module4, module6) avec un seuil de 3.
  await setConfidentialite(page, slug, 1);

  const files: { name: string; bytes: number; type: string; from: string }[] = [];
  // Le type du fichier est lu dans la réponse (un lien sans format explicite peut servir le CSV historique) : seuls Excel et CSV
  // sont acceptés, et l'extension suit le type reçu.
  const download = async (href: string, stem: string) => {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
    const type = res.headers()["content-type"] ?? "";
    const ext = type.includes(XLSX) ? "xlsx" : type.startsWith("text/csv") ? "csv" : null;
    expect(ext, `${href} : type inattendu ${type}`).not.toBeNull();
    const body = await res.body();
    const name = `${stem}.${ext}`;
    writeFileSync(`${OUT}/${name}`, body);
    files.push({ name, bytes: body.length, type, from: href });
  };
  // Tous les liens d'export d'une page (menu « Exporter » : Excel en premier, CSV conservé), téléchargés un par un.
  const downloadAll = async (url: string, prefix: string) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const hrefs = await page.locator("a[href*='/export?']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
    expect(hrefs.length, `${url} : aucun lien d'export`).toBeGreaterThan(0);
    let i = 0;
    for (const href of [...new Set(hrefs)]) await download(href, `${prefix}-${String(++i).padStart(2, "0")}`);
  };

  const base = `/e/${slug}/studio-rh`;
  await downloadAll(`${base}/kpi?fin=2026-09`, "kpi-suivi");
  await downloadAll(`${base}/kpi?vue=effectifs&fin=2026-09`, "kpi-effectifs-mensuels");
  await downloadAll(`${base}/masse-salariale`, "masse-salariale-synthese");
  await downloadAll(`${base}/masse-salariale/ecart?v1=reel%3A2025&v2=reel%3A2026&de=01&a=09`, "ecart-budgetaire");
  for (const ch of ["synthese", "effectifs", "absences", "fixe-variable", "services", "budget", "paie-compta", "effets"]) {
    await downloadAll(`${base}/masse-salariale/croisee?chapitre=${ch}`, `croisee-${ch}`);
  }
  // Un chapitre « Prévu » n'a pas d'export.
  expect((await page.request.get(`${base}/masse-salariale/croisee/export?chapitre=juridique&format=xlsx`)).status()).toBe(404);

  // PDF : « Synthèse en PDF · 1 page » (mode body[data-print="synthese"]) et l'impression ordinaire du chapitre 02.
  await page.goto(`${base}/masse-salariale/croisee`);
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => { document.body.dataset.print = "synthese"; });
  await page.pdf({ path: `${OUT}/croisee-synthese-1-page.pdf`, format: "A4", landscape: true, printBackground: true, margin: { top: "11mm", bottom: "11mm", left: "11mm", right: "11mm" } });
  await page.evaluate(() => { delete document.body.dataset.print; });
  await page.goto(`${base}/masse-salariale/croisee?chapitre=effectifs`);
  await page.waitForLoadState("networkidle");
  await page.pdf({ path: `${OUT}/croisee-effectifs-impression.pdf`, format: "A4", landscape: true, printBackground: true, margin: { top: "11mm", bottom: "11mm", left: "11mm", right: "11mm" } });
  await page.emulateMedia({ media: "screen" });

  writeFileSync(`${OUT}/index.json`, JSON.stringify({ slug, files }, null, 2));
  expect(files.filter((f) => f.name.endsWith(".xlsx")).length).toBeGreaterThanOrEqual(10);
});
