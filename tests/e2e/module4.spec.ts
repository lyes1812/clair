import { expect, test, type Locator } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 4 (lot 1) : masse salariale réelle sur le journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle).
// Valeurs attendues recalculées à la main depuis la fixture (voir tests/unit/payroll.test.ts).
const run = Date.now().toString(36);
const txt = async (l: Locator) => ((await l.textContent()) ?? "").replace(/\s+/g, " ").trim();

test("Masse salariale : synthèse N / N-1, coût par ETP, détail par compte, grille de comptes", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Masse salariale", email: `ms-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Masse salariale fictive ${run}`);
  const ms = `/e/${slug}/studio-rh/masse-salariale`;

  // Sans lecture PayFit : n.d. explicite.
  await page.goto(ms);
  await expect(page.getByTestId("ms-nd")).toContainText("aucune lecture PayFit appliquée");

  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");

  // Période par défaut : janvier → dernier mois clos (septembre 2026), comparée aux mêmes mois de 2025.
  await page.goto(ms);
  await expect(page.getByTestId("ms-source")).toContainText("journal comptable de paie PayFit");
  await expect(page.getByTestId("ms-period")).toContainText("janvier → septembre 2026");
  const tile = (id: string) => page.getByTestId(`ms-tile-${id}`);
  expect(await txt(tile("masse").locator("dd"))).toBe("211 260,00 €");
  expect(await txt(page.getByTestId("ms-tile-masse-n1"))).toContain("N-1 : 173 870,00 €");
  expect(await txt(tile("evolution").locator("dd"))).toBe("+21,50 %");
  expect(await txt(tile("evolution"))).toContain("+37 390,00 €");
  expect(await txt(tile("cost-etp").locator("dd"))).toBe("3 919,48 €");
  expect(await txt(tile("cost-etp"))).toContain("53,90 ETP-mois");
  expect(await txt(tile("brut").locator("dd"))).toBe("160 770,00 €");
  expect(await txt(tile("cotisations"))).toContain("taux : 31,41 % du brut");
  await expect(page.getByTestId("ms-composition")).toBeVisible();
  const row = (m: string, col: string) => page.getByTestId("ms-monthly-table").locator(`tr[data-month='${m}'] td[data-col='${col}']`);
  await expect(page.getByTestId("ms-monthly-table").locator("tbody tr")).toHaveCount(9);
  expect(await txt(row("2026-02", "masse"))).toBe("19 530,00 €");
  expect(await txt(row("2026-02", "masse-n1"))).toBe("18 230,00 €");
  expect(await txt(page.getByTestId("ms-monthly-foot").locator("td[data-col='masse']"))).toBe("211 260,00 €");
  await page.screenshot({ path: `${CAPTURES}/4-01-masse-salariale.png`, fullPage: true });

  // Détail par compte de janvier 2026 : 641100 et 645100, contreparties exclues.
  await page.getByTestId("ms-monthly-table").locator("tr[data-month='2026-01'] a").first().click();
  const detail = page.getByTestId("ms-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator("tr[data-account='641100']")).toContainText("Salaires et appointements");
  expect(await txt(detail.locator("tr[data-account='641100'] td").nth(5))).toBe("14 830,00 €");
  expect(await txt(page.getByTestId("ms-detail-cotisations"))).toBe("4 700,00 €");
  expect(await txt(page.getByTestId("ms-detail-masse"))).toBe("19 530,00 €");
  await expect(detail.locator("tr[data-account='421000']")).toHaveCount(0);
  await detail.screenshot({ path: `${CAPTURES}/4-02-detail-compte.png` });

  // Raccourci « Janv.–mars » : 19 530 + 19 530 + 24 600 = 63 660,00 €.
  await page.getByTestId("ms-presets").getByRole("link", { name: "Janv.–mars" }).click();
  expect(await txt(tile("masse").locator("dd"))).toBe("63 660,00 €");
  // Paramètre GET invalide : remplacé et signalé.
  await page.goto(`${ms}?annee=2031`);
  await expect(page.getByTestId("ms-param-notice")).toContainText("paramètre ignoré : annee=2031");

  // Grille de comptes : défaut proposé visible, modifiable par l'administrateur ; définitions dans l'écran.
  await page.goto(`/e/${slug}/parametres`);
  await expect(page.getByTestId("setting-payroll-origin")).toContainText("Valeur par défaut proposée");
  await page.getByTestId("setting-payroll-primes").fill("6413, 6418");
  await page.getByTestId("setting-payroll-save").click();
  await expect(page.getByTestId("setting-payroll").getByRole("status")).toContainText("Grille de comptes enregistrée");
  await page.reload();
  await expect(page.getByTestId("setting-payroll-origin")).toContainText("Modifié le");
  await page.goto(ms);
  await expect(page.getByTestId("ms-grid")).toContainText("Primes et gratifications (brut) : 6413, 6418");
  expect(await txt(tile("masse").locator("dd"))).toBe("211 260,00 €");
});
