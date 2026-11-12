import { expect, test, type Page } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";
import { CAP13_FEC } from "./cap13-fixture";

// Cap 13, lot 2a : trésorerie à 13 semaines. Cas de référence écrit à la main, départ le mercredi 04/03/2026 avec un
// solde saisi de 20 000,00 € : client +5 000,00 le 06/03 (S1), URSSAF −9 000,00 le 16/03 (S3), salaires −12 000,00
// chaque fin de mois (S5, S9, S13). Soldes : S1 25 000,00 · S3 16 000,00 · S5 4 000,00 · S9 −8 000,00 · S13 −20 000,00.
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };
const tile = (page: Page, id: string) => page.locator(`[data-testid="cash-tile-${id}"] dd [data-money-cents]`);
const closing = (page: Page, week: number) => page.locator(`[data-testid="cash-weeks-table"] tr[data-row="closing"] td[data-week="${week}"] [data-money-cents]`);

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
async function saveStart(page: Page, v: { date: string; amount: string; overdraft: string }) {
  const form = page.getByTestId("cash-start-form");
  await form.locator("#cash-start-date").fill(v.date);
  await form.locator("#cash-start-amount").fill(v.amount);
  await form.locator("#cash-overdraft").fill(v.overdraft);
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(form.getByRole("status")).toBeVisible(slow);
}

test("Cap 13 lot 2a : plan à 13 semaines, solde saisi puis solde du FEC, rupture et traçabilité", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cap 13 tréso", email: `cap13t-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 tréso fictif ${run}`);
  const cash = `/e/${slug}/studio-restructuring?vue=cash`;

  // Sans FEC ni solde saisi : n.d. avec sa raison, aucun plan à zéro.
  await page.goto(cash);
  await expect(page.getByTestId("restructuring-tabs").getByRole("link", { name: "Cap 13 · Trésorerie 13 semaines" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("cash-unavailable")).toContainText("Aucun solde de départ");
  await expect(page.getByTestId("cash-tiles")).toHaveCount(0);

  // Solde saisi et daté : le plan se calcule sans FEC.
  await saveStart(page, { date: "2026-03-04", amount: "20000", overdraft: "" });
  await expect(tile(page, "start")).toHaveAttribute("data-money-cents", "2000000");
  await expect(page.getByTestId("cash-weeks-table").locator("thead th").nth(1)).toContainText("02/03 → 08/03");
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Aucune");

  await addFlow(page, { label: "Client fictif X", category: "customers", direction: "in", amount: "5000", date: "2026-03-06" });
  await addFlow(page, { label: "URSSAF fictive", category: "social", direction: "out", amount: "9000", date: "2026-03-16" });
  await addFlow(page, { label: "Salaires fictifs", category: "payroll", direction: "out", amount: "12000", date: "2026-01-31", recurrence: "monthly" });
  for (const [week, cents] of [[1, "2500000"], [3, "1600000"], [5, "400000"], [9, "-800000"], [13, "-2000000"]] as const) await expect(closing(page, week)).toHaveAttribute("data-money-cents", cents);
  await expect(tile(page, "low")).toHaveAttribute("data-money-cents", "-2000000");
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Semaine 9");
  await expect(page.getByTestId("cash-weeks")).toContainText("zéro (découvert autorisé non saisi)");
  // Traçabilité : chaque montant d'une semaine remonte à une ligne saisie.
  await page.getByTestId("cash-trace").locator("summary").click();
  await expect(page.getByTestId("cash-trace").getByRole("row").filter({ hasText: "URSSAF fictive" })).toContainText("16/03/2026");
  await page.screenshot({ path: `${CAPTURES}/cap13-03-plan-13-semaines.png`, fullPage: true });

  // Découvert autorisé de 8 000 € : la semaine 9 (−8 000,00) n'est plus sous le seuil, la rupture passe en semaine 13.
  await saveStart(page, { date: "2026-03-04", amount: "20000", overdraft: "8000" });
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Semaine 13", slow);

  // Suppression d'une ligne : le plan est recalculé.
  await page.getByTestId("cash-flows-table").getByRole("row").filter({ hasText: "URSSAF fictive" }).getByRole("button", { name: /Supprimer/ }).click();
  await expect(page.getByTestId("cash-flows-table")).not.toContainText("URSSAF fictive", slow);
  await expect(closing(page, 13)).toHaveAttribute("data-money-cents", "-1100000");

  // FEC appliqué, retour au solde du FEC : soldes bancaires nets au 15/03/2026 = 35 804,33 €.
  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([CAP13_FEC]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
  await page.goto(cash);
  await expect(page.getByTestId("cash-start-fec")).toContainText("non utilisé");
  await saveStart(page, { date: "", amount: "", overdraft: "8000" });
  await expect(tile(page, "start")).toHaveAttribute("data-money-cents", "3580433", slow);
  await expect(page.getByTestId("cash-tile-start")).toContainText("FEC · au 15/03/2026");
  // Le client du 06/03 est antérieur au départ : listé hors plan, pas compté.
  await expect(page.getByTestId("cash-ignored")).toContainText("Client fictif X");

  // Aide à la saisie : postes non lettrés = solde net fournisseurs (9 200,00 €) ; une dette proposée, la date reste à choisir.
  await expect(page.getByTestId("cash-open-total")).toContainText("égal au solde net");
  await expect(page.getByTestId("cash-open-total").locator("[data-money-cents]").first()).toHaveAttribute("data-money-cents", "920000");
  await page.getByTestId("cash-natures-table").getByRole("row").filter({ hasText: "Organismes sociaux" }).getByRole("link", { name: "Planifier" }).click();
  await expect(page.getByTestId("cash-prefill")).toBeVisible();
  const form = page.getByTestId("cash-flow-form");
  await expect(form.locator("#cash-flow-label")).toHaveValue("Organismes sociaux");
  await expect(form.locator("#cash-flow-amount")).toHaveValue("3500");
  await expect(form.locator("#cash-flow-date")).toHaveValue("");
  await form.locator("#cash-flow-date").fill("2026-03-20");
  await form.getByRole("button", { name: "Ajouter au plan" }).click();
  await expect(page.getByTestId("cash-flows-table")).toContainText("Organismes sociaux", slow);
  // Après l'ajout, le formulaire n'est plus pré-rempli : un second envoi ne compte pas la dette deux fois.
  await expect(page.getByTestId("cash-prefill")).toHaveCount(0);
  await expect(page.getByTestId("cash-flow-form").locator("#cash-flow-label")).toHaveValue("");
  await expect(page).toHaveURL(/date=2026-03-15/);
  for (const [week, cents] of [[1, "3580433"], [2, "3230433"], [4, "2030433"], [8, "830433"], [12, "-369567"], [13, "-369567"]] as const) await expect(closing(page, week)).toHaveAttribute("data-money-cents", cents);
  await expect(page.getByTestId("cash-tile-rupture")).toContainText("Aucune");
  await page.screenshot({ path: `${CAPTURES}/cap13-04-plan-depuis-fec.png`, fullPage: true });

  // Les deux vues Cap 13 gardent l'exercice et la date en passant de l'une à l'autre.
  await page.getByTestId("restructuring-tabs").getByRole("link", { name: "Cap 13 · Trésorerie et dettes" }).click();
  await expect(page.getByTestId("studio-restructuring-crisis")).toBeVisible();
});
