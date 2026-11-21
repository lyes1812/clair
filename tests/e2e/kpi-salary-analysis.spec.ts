import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, exactText, signUp } from "./helpers";

// Uniquement des personnes et montants fictifs (profil A, photographie 1,
// société 1). Les sept bruts mensuels sont 3 000 ; 2 240 ; 3 900 ; 3 100 ;
// 3 000 ; 2 240 ; 1 250 euros : total 18 730, moyenne 2 675,71, médiane 3 000.
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };

test("Analyse des salaires : sources fictives, filtres, navigation et lecture mobile", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signUp(page, { name: "Admin Analyse fictive", email: `analyse-salaires-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Salaires fictifs ${run}`);
  const salary = `/e/${slug}/studio-rh/kpi?vue=salaires`;
  const tileValue = (id: string) => page.getByTestId(`salary-tile-${id}`).locator("dd").first();

  // Le nouvel onglet reste accessible et explique l'absence de source.
  await page.goto(salary);
  await expect(page.getByTestId("salary-analysis")).toBeVisible();
  await expect(page.getByTestId("salary-status")).toContainText("Aucune source RH retenue");
  for (const id of ["persons", "total", "mean", "median"]) await expect(tileValue(id)).toHaveText("n.d.");

  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée", slow);
  await page.getByLabel("Du mois").fill("2026-08");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)", slow);

  await page.goto(salary);
  await expect(page.getByRole("heading", { name: "Analyse des salaires", exact: true })).toBeVisible();
  await expect(page.getByTestId("salary-filters").getByLabel("Mois", { exact: true })).toHaveValue("2026-09");
  await expect(page.locator('[data-testid^="salary-tile-"]')).toHaveCount(4);
  await expect(tileValue("persons")).toHaveText("7");
  expect(await exactText(tileValue("total"))).toBe("18 730,00 €");
  expect(await exactText(tileValue("mean"))).toBe("2 675,71 €");
  expect(await exactText(tileValue("median"))).toBe("3 000,00 €");
  await expect(page.getByTestId("salary-status")).toHaveCount(0);
  await expect(page.getByTestId("salary-coverage")).toContainText("0 non rattachée(s)");

  const tabs = page.getByTestId("kpi-tabs");
  const kpiLabels = ["Turnover", "Absentéisme", "Effectifs mensuels", "Suivi des effectifs", "Pyramide", "Analyse des salaires", "Livre de paie", "Publisher"];
  await expect(tabs.getByRole("link")).toHaveCount(8);
  for (const name of kpiLabels) await expect(tabs.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  const active = tabs.getByRole("link", { name: "Analyse des salaires", exact: true });
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect(active.locator(".soon")).toHaveCount(0);
  await expect(page.getByTestId("prevu")).toHaveCount(0);

  // Les autres familles et les 38 destinations demeurent dans le menu existant.
  await page.waitForLoadState("networkidle");
  await page.getByTestId("mega-button").click();
  const panel = page.getByTestId("mega-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("section li > a")).toHaveCount(38);
  for (const name of ["Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"]) {
    await expect(panel.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("link", { name: "Analyse des salaires", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(panel.getByRole("link", { name: "Pointage des collaborateurs", exact: true })).toHaveAttribute("href", `/e/${slug}/studio-rh/collaborateurs/pointage`);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Les liens de source gardent la destination de détail existante et le mois.
  const sources = page.getByTestId("salary-source-table");
  await expect(sources.getByRole("link", { name: "Voir les lignes" })).toHaveCount(2);
  const salaries = sources.locator("tbody tr", { hasText: "Salaires et appointements" });
  await salaries.getByRole("link", { name: "Voir les lignes" }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${slug}/studio-rh/collaborateurs/rubrique\\?mois=2026-09&rubrique=salaires$`));
  await expect(page.getByTestId("exploration-rubrique-table")).toBeVisible();
  await page.goto(salary);

  // La sélection de composante reste explicite, sans annualisation ni ETP.
  await page.getByTestId("salary-filters").getByLabel("Rémunérations", { exact: true }).selectOption("salaires");
  await page.getByTestId("salary-filters").getByRole("button", { name: "Afficher", exact: true }).click();
  expect(await exactText(tileValue("total"))).toBe("16 857,00 €");
  expect(await exactText(tileValue("mean"))).toBe("2 408,14 €");
  expect(await exactText(tileValue("median"))).toBe("2 700,00 €");
  await expect(page.getByTestId("salary-source-table").locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "Dernier mois clos", exact: true }).click();

  await page.getByTestId("salary-filters").getByLabel("Mois", { exact: true }).selectOption("2026-08");
  await page.getByTestId("salary-filters").getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByTestId("salary-filters").getByLabel("Mois", { exact: true })).toHaveValue("2026-08");
  expect(await exactText(tileValue("total"))).toBe("18 730,00 €");
  await expect(page.getByTestId("salary-source-table").locator("tbody tr")).toHaveCount(1);

  // Une demande non couverte, future ou mal formée n'affiche jamais septembre
  // à sa place. Le fixture completed ne fabrique pas un mois connu ouvert ; ce
  // dernier cas est couvert par les tests unitaires de la sélection des périodes.
  for (const month of ["2025-01", "9999-12", "2026-99"]) {
    await page.goto(`${salary}&mois=${month}`);
    await expect(page.getByTestId("salary-status")).toBeVisible();
    for (const id of ["persons", "total", "mean", "median"]) await expect(tileValue(id)).toHaveText("n.d.");
    await expect(page.getByTestId("salary-source-table")).toHaveCount(0);
  }

  await page.goto(salary);
  // Aucun nouveau tableau nominatif : le détail conserve sa destination source.
  await expect(page.getByTestId("salary-analysis").getByRole("link", { name: /^TEST|^Fictif/ })).toHaveCount(0);
  await page.screenshot({ path: `${CAPTURES}/salary-analysis-desktop-fictif.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("salary-analysis")).toBeVisible();
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
    font: getComputedStyle(document.body).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
    tiles: [...document.querySelectorAll('[data-testid^="salary-tile-"]')].map((element) => {
      const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, bottom: box.bottom };
    }),
  }));
  expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.width + 1);
  expect(mobile.font).toBe("-apple-system");
  expect(mobile.tiles).toHaveLength(4);
  for (let index = 1; index < mobile.tiles.length; index++) {
    expect(Math.abs(mobile.tiles[index].left - mobile.tiles[0].left)).toBeLessThanOrEqual(1);
    expect(mobile.tiles[index].top).toBeGreaterThanOrEqual(mobile.tiles[index - 1].bottom);
  }
  await page.screenshot({ path: `${CAPTURES}/salary-analysis-mobile-fictif.png`, fullPage: true });
});
