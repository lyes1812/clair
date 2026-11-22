import { expect, test } from "@playwright/test";
import { fixtureIban } from "../../src/lib/bank/fixture";
import { agedCsv } from "../../src/lib/aged/fixture";
import { COMPANY_FEC_FILENAME, companyFecBytes } from "../../src/lib/fec/fixture-company";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot L3 : passif par créance. Cas de référence écrit à la main (même calcul que tests/unit/claims.test.ts) :
//   FEC fictif au 31/10/2026 : dettes 54 000,00 € dont fournisseurs 401 4 000,00 € ; balance âgée fictive 4 450,00 €.
//   Passif = 54 000,00 − 4 000,00 + 4 450,00 = 54 450,00 €. Virement du 05/11 « AC-1 » 700,00 € : facture Œuvre payée
//   depuis, retirée du passif exigible (53 750,00 €). Échu : Alpha 3 000,00 €. Contrôle balance ↔ 401 : écart 450,00 €.
const run = Date.now().toString(36);
const slow = { timeout: 60_000 };
const IBAN = fixtureIban();
const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>F</MsgId></GrpHdr><Stmt><Id>S11</Id><FrToDt><FrDtTm>2026-11-01T00:00:00</FrDtTm><ToDtTm>2026-11-05T23:59:59</ToDtTm></FrToDt><Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct><Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">15000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-01</Dt></Dt></Bal><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">14300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-05</Dt></Dt></Bal><Ntry><Amt Ccy="EUR">700.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-05</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>VIR SEPA FOURNISSEUR FICTIF OEUVRE AC-1</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;

async function apply(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);
}
const cents = (page: import("@playwright/test").Page, testid: string) => page.locator(`[data-testid="${testid}"] [data-money-cents]`).first();

test("Cap 13 lot L3 : passif par créance, rapprochement balance âgée ↔ FEC ↔ banque, rang et échéance par créance", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cap 13 passif", email: `cap13p-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 passif fictif ${run}`);

  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([{ name: COMPANY_FEC_FILENAME, mimeType: "text/plain", buffer: Buffer.from(companyFecBytes()) }]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
  await apply(page);

  await page.goto(`/e/${slug}/donnees/bank`);
  await page.locator("#bank-files").setInputFiles({ name: "releve-novembre.xml", mimeType: "application/xml", buffer: Buffer.from(camt) });
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
  await apply(page);

  // Sans balance âgée : fournisseurs lus dans le FEC, une créance par auxiliaire.
  const crisis = `/e/${slug}/studio-restructuring?vue=crisis&date=2026-10-31`;
  await page.goto(crisis);
  await expect(page.getByTestId("claims-aged-none")).toBeVisible(slow);
  await expect(cents(page, "claims-tile-passif")).toHaveAttribute("data-money-cents", "5400000");

  // Dépôt de la balance âgée (CSV), aperçu avec tranches recalculées, application.
  await page.goto(`/e/${slug}/donnees/aged`);
  await page.locator("#aged-files").setInputFiles({ name: "balance-agee.csv", mimeType: "text/csv", buffer: Buffer.from(agedCsv()) });
  await page.locator("#aged-date").fill("2026-10-31");
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
  await expect(page.getByTestId("aged-profile")).toContainText("Fournisseur");
  await expect(page.getByTestId("aged-preview-aging")).toContainText(/4\s450/);
  await page.screenshot({ path: `${CAPTURES}/cap13-l3-apercu.png`, fullPage: true });
  await apply(page);

  await page.goto(crisis);
  await expect(page.getByTestId("claims-aged-used")).toContainText("4 factures", slow);
  await expect(cents(page, "claims-tile-passif")).toHaveAttribute("data-money-cents", "5445000");
  await expect(cents(page, "claims-tile-exigible")).toHaveAttribute("data-money-cents", "5375000");
  await expect(cents(page, "claims-tile-echu")).toHaveAttribute("data-money-cents", "300000");
  await expect(page.getByTestId("claims-reconciliation")).toContainText("54 450,00");
  await expect(page.getByTestId("claims-control")).toHaveAttribute("data-strong", "true");
  await expect(page.getByTestId("claims-control")).toContainText("450,00");
  const table = page.getByTestId("claims-table");
  await expect(table.locator('tr[data-exigibility="payee"]')).toContainText("AC-1");
  await expect(table.locator('tr[data-exigibility="payee"]')).toContainText("payée le 05/11/2026");
  await expect(table.locator("tr", { hasText: "Emprunt bancaire" })).toHaveAttribute("data-exigibility", "nd");

  // Échéance et rang saisis pour l'emprunt : il sort en semaine 5, classé « sûreté ».
  const loan = table.locator("tr", { hasText: "Emprunt bancaire" });
  await loan.locator('input[type="date"]').fill("2026-11-30");
  await loan.locator("select").selectOption("surete");
  await page.getByRole("button", { name: "Enregistrer rangs et échéances" }).click();
  await expect(page.getByTestId("claims-form")).toContainText("Rangs et échéances des créances enregistrés", slow);
  await page.goto(crisis);
  await expect(page.getByTestId("claims-table").locator("tr", { hasText: "Emprunt bancaire" })).toHaveAttribute("data-exigibility", "semaine");
  await expect(cents(page, "claims-schedule-s5")).toHaveAttribute("data-money-cents", "4900000");
  await expect(page.getByTestId("claims-by-rank")).toContainText("Garanti par une sûreté");
  await page.getByTestId("crisis-claims").screenshot({ path: `${CAPTURES}/cap13-l3-passif.png` });

  // Autre date d'arrêté : la balance n'est pas utilisée et l'écran propose sa date.
  await page.goto(`/e/${slug}/studio-restructuring?vue=crisis&date=2026-10-30`);
  await expect(page.getByTestId("claims-aged-other-date")).toContainText("31/10/2026", slow);
});
