import { expect, test, type Page } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot 2b : scénarios. Plan de base du lot 2a (départ 04/03/2026, 20 000,00 € saisis ; client +5 000,00 le 06/03,
// URSSAF −9 000,00 le 16/03, salaires −12 000,00 en fin de mois) : S9 −8 000,00, S13 −20 000,00, rupture en semaine 9.
// Scénario écrit à la main : URSSAF reportée de 4 semaines (S7) ; salaires (36 000,00) étalés en 4 échéances mensuelles de
// 9 000,00 dès le 15/04 (S7, S11, puis deux après la semaine 13) ; cession de 10 000,00 le 28/04 (S9).
// Soldes du scénario : S5 25 000,00 · S7 7 000,00 · S9 17 000,00 · S11 8 000,00 · S13 8 000,00 ; 18 000,00 reportés.
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };
const cell = (page: Page, row: string, week: number) => page.locator(`[data-testid="cash-comparison-table"] tr[data-row="${row}"] td[data-week="${week}"] [data-money-cents]`);

async function addFlow(page: Page, f: { label: string; category: string; direction: string; amount: string; date: string; recurrence?: string }) {
  const form = page.getByTestId("cash-flow-form");
  await form.locator("#cash-flow-label").fill(f.label);
  await form.locator("#cash-flow-category").selectOption(f.category);
  await form.locator("#cash-flow-direction").selectOption(f.direction);
  await form.locator("#cash-flow-amount").fill(f.amount);
  await form.locator("#cash-flow-date").fill(f.date);
  await form.locator("#cash-flow-recurrence").selectOption(f.recurrence ?? "once");
  await form.getByRole("button", { name: "Ajouter au plan" }).click();
  await expect(page.getByTestId("cash-flows-table")).toContainText(f.label, slow);
}

test("Cap 13 lot 2b : scénario comparé au plan de base, mesures tracées, plan de base intact", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cap 13 scénarios", email: `cap13s-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 scénarios fictif ${run}`);
  await page.goto(`/e/${slug}/studio-restructuring?vue=cash`);
  const start = page.getByTestId("cash-start-form");
  await start.locator("#cash-start-date").fill("2026-03-04");
  await start.locator("#cash-start-amount").fill("20000");
  await start.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("cash-tiles")).toBeVisible(slow);
  await addFlow(page, { label: "Client fictif X", category: "customers", direction: "in", amount: "5000", date: "2026-03-06" });
  await addFlow(page, { label: "URSSAF fictive", category: "social", direction: "out", amount: "9000", date: "2026-03-16" });
  await addFlow(page, { label: "Salaires fictifs", category: "payroll", direction: "out", amount: "12000", date: "2026-01-31", recurrence: "monthly" });
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Semaine 9");

  // Aucun scénario par défaut ; création puis ouverture du scénario, encore identique au plan de base.
  await expect(page.getByTestId("cash-scenarios-empty")).toBeVisible();
  await expect(page.getByTestId("cash-scenario")).toHaveCount(0);
  await page.getByTestId("cash-scenario-form").locator("#cash-scenario-name").fill("Moratoire fictif");
  await page.getByTestId("cash-scenario-form").getByRole("button", { name: "Créer le scénario" }).click();
  await expect(page).toHaveURL(/scenario=[0-9a-f-]{36}/, slow);
  await expect(page.getByTestId("cash-measures-empty")).toBeVisible();
  await expect(cell(page, "scenario", 13)).toHaveAttribute("data-money-cents", "-2000000");

  // Report de l'URSSAF de 4 semaines.
  await page.getByTestId("cash-measure-report").locator("summary").click();
  const report = page.getByTestId("cash-measure-report-form");
  await report.locator("#cash-report-flow").selectOption({ label: "URSSAF fictive · Le 16/03/2026" });
  await report.locator("#cash-report-weeks").fill("4");
  await report.getByRole("button", { name: "Ajouter le report" }).click();
  await expect(page.getByTestId("cash-measures-table")).toContainText("Report de 4 semaines · URSSAF fictive", slow);
  await expect(cell(page, "scenario", 3)).toHaveAttribute("data-money-cents", "2500000");

  // Étalement des salaires en 4 échéances mensuelles à partir du 15/04.
  await page.getByTestId("cash-measure-etalement").locator("summary").click();
  const etalement = page.getByTestId("cash-measure-etalement-form");
  // L'URSSAF porte déjà une mesure : elle n'est plus proposée.
  await expect(etalement.locator("#cash-etal-flow option")).toHaveCount(2);
  await etalement.locator("#cash-etal-flow").selectOption({ index: 1 });
  await etalement.locator("#cash-etal-count").fill("4");
  await etalement.locator("#cash-etal-frequency").selectOption("monthly");
  await etalement.locator("#cash-etal-first").fill("2026-04-15");
  await etalement.getByRole("button", { name: "Ajouter l’étalement" }).click();
  await expect(page.getByTestId("cash-measures-table")).toContainText("Étalement en 4 échéances · Salaires fictifs", slow);

  // Cession d'actif de 10 000 € le 28/04.
  await page.getByTestId("cash-measure-encaissement").locator("summary").click();
  const cession = page.getByTestId("cash-measure-encaissement-form");
  await cession.locator("#cash-enc-label").fill("Cession fictive");
  await cession.locator("#cash-enc-nature").selectOption("cession");
  await cession.locator("#cash-enc-amount").fill("10000");
  await cession.locator("#cash-enc-date").fill("2026-04-28");
  await cession.getByRole("button", { name: "Ajouter l’encaissement" }).click();
  await expect(page.getByTestId("cash-measures-table")).toContainText("Cession fictive", slow);

  // Cas de référence : soldes du scénario, écarts, point bas, rupture, montant reporté après la semaine 13.
  for (const [week, cents] of [[1, "2500000"], [5, "2500000"], [7, "700000"], [9, "1700000"], [11, "800000"], [13, "800000"]] as const) await expect(cell(page, "scenario", week)).toHaveAttribute("data-money-cents", cents);
  for (const [week, cents] of [[9, "-800000"], [13, "-2000000"]] as const) await expect(cell(page, "base", week)).toHaveAttribute("data-money-cents", cents);
  await expect(cell(page, "delta", 13)).toHaveAttribute("data-money-cents", "2800000");
  await expect(page.locator('[data-testid="cash-scenario-low"] dd [data-money-cents]')).toHaveAttribute("data-money-cents", "700000");
  await expect(page.getByTestId("cash-scenario-low")).toContainText("Fin de semaine 7");
  await expect(page.getByTestId("cash-scenario-rupture")).toContainText("Aucune");
  await expect(page.getByTestId("cash-scenario-rupture")).toContainText("Plan de base : semaine 9");
  await expect(page.locator('[data-testid="cash-scenario-beyond"] dd [data-money-cents]')).toHaveAttribute("data-money-cents", "1800000");
  await expect(page.getByTestId("cash-measures-table").getByRole("row").filter({ hasText: "Étalement" }).locator("[data-money-cents]")).toHaveAttribute("data-money-cents", "1800000");
  // Traçabilité : chaque montant du scénario dit de quelle mesure il vient.
  await page.getByTestId("cash-scenario-weeks-trace").locator("summary").click();
  await expect(page.getByTestId("cash-scenario-weeks-trace")).toContainText("URSSAF fictive (reporté de 4 sem., prévu le 16/03/2026)");
  await expect(page.getByTestId("cash-scenario-weeks-trace")).toContainText("Salaires fictifs (échéance 2/4)");
  await expect(page.getByTestId("cash-scenario-weeks-table")).toContainText("Encaissements · Exceptionnels");
  // Le plan de base n'est pas modifié.
  await expect(page.locator('[data-testid="cash-weeks-table"] tr[data-row="closing"] td[data-week="13"] [data-money-cents]')).toHaveAttribute("data-money-cents", "-2000000");
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Semaine 9");
  await page.screenshot({ path: `${CAPTURES}/cap13-05-scenario.png`, fullPage: true });

  // Lot 3 : le classeur du dossier de crise s'exporte avec le scénario affiché, sans mise en cache.
  await page.getByTestId("cap13-export").click();
  const exportHref = await page.getByTestId("cap13-export-xlsx").getAttribute("href");
  expect(exportHref).toMatch(/\/studio-restructuring\/cap13-export\?vue=cash&scenario=[0-9a-f-]{36}/);
  const exported = await page.request.get(exportHref!);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("spreadsheetml");
  expect(exported.headers()["content-disposition"]).toContain("cap13-dossier-de-crise-2026-03-04.xlsx");
  expect(exported.headers()["cache-control"]).toBe("no-store");
  expect((await exported.body()).byteLength).toBeGreaterThan(5_000);
  await page.keyboard.press("Escape");

  // Ligne de base supprimée : la mesure qui la visait est signalée, ni appliquée ni effacée.
  await page.getByTestId("cash-flows-table").getByRole("row").filter({ hasText: "URSSAF fictive" }).getByRole("button", { name: /Supprimer/ }).click();
  await expect(page.getByTestId("cash-measures-table")).toContainText("non appliquée — la ligne visée a été supprimée du plan de base", slow);
  await expect(page.getByTestId("cash-measures-table").getByRole("row")).toHaveCount(4);

  // Retour au plan de base seul, puis suppression du scénario (confirmée).
  await page.getByTestId("cash-scenarios-table").getByRole("link", { name: "Revenir au plan de base" }).click();
  await expect(page.getByTestId("cash-scenario")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("cash-scenarios-table").getByRole("button", { name: /Supprimer/ }).click();
  await expect(page.getByTestId("cash-scenarios-empty")).toBeVisible(slow);
});
