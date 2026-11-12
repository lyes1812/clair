import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot 1 : trésorerie et dettes comptabilisées lues dans un FEC fictif (SIREN fictif, écritures équilibrées).
// Cas de référence écrit à la main, arrêté au 28/02/2026 : disponibilités 37 804,33 €, dettes 65 500,00 €.
const run = Date.now().toString(36);
const HEADER = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"];
type Row = [journal: string, num: string, date: string, account: string, aux: string, debit: string, credit: string];
const ROWS: Row[] = [
  ["AN", "AN1", "20260101", "512000", "", "50000,00", "0,00"],
  ["AN", "AN1", "20260101", "530000", "", "150,00", "0,00"],
  ["AN", "AN1", "20260101", "503000", "", "1000,00", "0,00"],
  ["AN", "AN1", "20260101", "164000", "", "0,00", "30000,00"],
  ["AN", "AN1", "20260101", "519000", "", "0,00", "5000,00"],
  ["AN", "AN1", "20260101", "455000", "", "0,00", "7000,00"],
  ["AN", "AN1", "20260101", "101000", "", "0,00", "9150,00"],
  ["BQ", "BQ1", "20260115", "627000", "", "2000,00", "0,00"],
  ["BQ", "BQ1", "20260115", "512100", "", "0,00", "2000,00"],
  ["AC", "AC1", "20260120", "607000", "", "10000,00", "0,00"],
  ["AC", "AC1", "20260120", "401000", "F001", "0,00", "10000,00"],
  ["OD", "OD1", "20260201", "411000", "", "300,00", "0,00"],
  ["OD", "OD1", "20260201", "419000", "", "0,00", "300,00"],
  ["OD", "OD2", "20260201", "658000", "", "100,00", "0,00"],
  ["OD", "OD2", "20260201", "467000", "", "0,00", "100,00"],
  ["BQ", "BQ2", "20260205", "401000", "F001", "4000,00", "0,00"],
  ["BQ", "BQ2", "20260205", "512000", "", "0,00", "4000,00"],
  ["BQ", "BQ3", "20260206", "401000", "F002", "500,00", "0,00"],
  ["BQ", "BQ3", "20260206", "512000", "", "0,00", "500,00"],
  ["BQ", "BQ4", "20260210", "613000", "", "7845,67", "0,00"],
  ["BQ", "BQ4", "20260210", "512000", "", "0,00", "7845,67"],
  ["OD", "OD3", "20260228", "604000", "", "1200,00", "0,00"],
  ["OD", "OD3", "20260228", "408000", "", "0,00", "1200,00"],
  ["OD", "OD4", "20260228", "641000", "", "8000,00", "0,00"],
  ["OD", "OD4", "20260228", "421000", "", "0,00", "8000,00"],
  ["OD", "OD5", "20260228", "645000", "", "3500,00", "0,00"],
  ["OD", "OD5", "20260228", "431000", "", "0,00", "3500,00"],
  ["VT", "VT1", "20260228", "411000", "", "14400,00", "0,00"],
  ["VT", "VT1", "20260228", "706000", "", "0,00", "12000,00"],
  ["VT", "VT1", "20260228", "445710", "", "0,00", "2400,00"],
  ["OD", "OD6", "20260228", "445660", "", "900,00", "0,00"],
  ["OD", "OD6", "20260228", "471000", "", "0,00", "900,00"],
  // Après la date d'arrêté du cas de référence.
  ["AC", "AC2", "20260315", "607000", "", "2500,00", "0,00"],
  ["AC", "AC2", "20260315", "401000", "F001", "0,00", "2500,00"],
];
const fecText = [HEADER.join("\t"), ...ROWS.map(([journal, num, date, account, aux, debit, credit]) =>
  [journal, `Journal fictif ${journal}`, num, date, account, `Compte fictif ${account}`, aux, aux ? `Tiers fictif ${aux}` : "", `P-${num}`, date, `Écriture fictive ${num}`, debit, credit, "", "", date, "", ""].join("\t"))].join("\r\n");
const cents = (testid: string) => `[data-testid="${testid}"] dd [data-money-cents]`;

test("Cap 13 lot 1 : trésorerie et dettes à une date, rangs choisis par l’espace", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Admin Cap 13", email: `cap13-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 fictif ${run}`);
  const crisis = `/e/${slug}/studio-restructuring?vue=crisis`;

  // Sans FEC appliqué : n.d. avec sa raison, jamais zéro.
  await page.goto(crisis);
  await expect(page.getByTestId("crisis-unavailable")).toContainText("Aucun FEC appliqué");
  await expect(page.getByTestId("crisis-tiles")).toHaveCount(0);

  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([{ name: "000000000FEC20261231.txt", mimeType: "text/plain", buffer: Buffer.from(fecText, "utf-8") }]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  await expect(page.getByTestId("fec-exercises").first()).toContainText("équilibré");
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");

  // Par défaut : dernière date d'écriture de l'exercice (15/03/2026), la facture de mars est comptée.
  await page.goto(crisis);
  await expect(page.getByTestId("restructuring-tabs").getByRole("link", { name: "Cap 13 · Trésorerie et dettes" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(cents("crisis-tile-debt"))).toHaveAttribute("data-money-cents", "6800000");

  // Cas de référence : arrêté au 28/02/2026.
  await page.locator("#crisis-date").fill("2026-02-28");
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page).toHaveURL(/date=2026-02-28/);
  await expect(page.locator(cents("crisis-tile-cash"))).toHaveAttribute("data-money-cents", "3780433");
  await expect(page.locator(cents("crisis-tile-debt"))).toHaveAttribute("data-money-cents", "6550000");
  await expect(page.locator(cents("crisis-tile-coverage"))).toHaveAttribute("data-money-cents", "-2769567");
  await expect(page.locator(cents("crisis-tile-securities"))).toHaveAttribute("data-money-cents", "100000");
  const debt = (nature: string) => page.getByTestId(`crisis-nature-${nature}`).locator("td.num").first().locator("[data-money-cents]");
  for (const [nature, value] of [["suppliers", "720000"], ["staff", "800000"], ["social", "350000"], ["tax", "240000"], ["financial", "3000000"], ["banks", "700000"], ["partners", "700000"], ["other", "40000"]]) {
    await expect(debt(nature)).toHaveAttribute("data-money-cents", value);
  }
  // Soldes débiteurs affichés à part, jamais déduits ; découvert signalé.
  await expect(page.getByTestId("crisis-nature-suppliers").locator("td.num").nth(1).locator("[data-money-cents]")).toHaveAttribute("data-money-cents", "50000");
  await expect(page.getByTestId("crisis-warnings")).toContainText("créditeur");
  await expect(page.getByTestId("crisis-natures")).toContainText("Tiers fictif F001");

  // Aucun rang supposé : n.d. tant que l'espace n'a rien choisi.
  await expect(page.getByTestId("crisis-ranks-nd")).toContainText("Rang non choisi");
  await page.screenshot({ path: `${CAPTURES}/cap13-01-sans-rang.png`, fullPage: true });
  const form = page.getByTestId("crisis-ranks-form");
  for (const [nature, rank] of [["staff", "superprivilege"], ["social", "privilege"], ["tax", "privilege"], ["financial", "surete"], ["banks", "surete"], ["suppliers", "chirographaire"], ["partners", "chirographaire"], ["other", "chirographaire"]]) {
    await form.locator(`select[name="rank-${nature}"]`).selectOption(rank);
  }
  await form.getByRole("button", { name: "Enregistrer les rangs" }).click();
  const ranks = page.getByTestId("crisis-ranks-table");
  await expect(ranks).toBeVisible({ timeout: 30_000 });
  const rank = (label: string) => ranks.getByRole("row").filter({ hasText: label }).locator("[data-money-cents]");
  await expect(rank("Superprivilège des salaires")).toHaveAttribute("data-money-cents", "800000");
  await expect(rank("Privilégié")).toHaveAttribute("data-money-cents", "590000");
  await expect(rank("Garanti par une sûreté")).toHaveAttribute("data-money-cents", "3700000");
  await expect(rank("Chirographaire")).toHaveAttribute("data-money-cents", "1460000");
  // Le formulaire relit les rangs enregistrés ; le total reste visible sous le tableau des natures.
  await expect(form.locator('select[name="rank-staff"]')).toHaveValue("superprivilege");
  await expect(page.getByTestId("crisis-total-debt")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("crisis-ranks-form").locator('select[name="rank-suppliers"]')).toHaveValue("chirographaire");
  await page.screenshot({ path: `${CAPTURES}/cap13-02-rangs.png`, fullPage: true });

  // Les autres vues du Studio Restructuring restent accessibles depuis les onglets.
  await page.getByTestId("restructuring-tabs").getByRole("link", { name: "Vue d’ensemble" }).click();
  await expect(page.getByTestId("studio-restructuring")).toBeVisible();
  await expect(page.getByTestId("restructuring-tabs").getByRole("link", { name: "Cap 13 · Trésorerie et dettes" })).toBeVisible();
});
