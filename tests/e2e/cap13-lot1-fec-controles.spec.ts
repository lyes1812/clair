import { expect, test } from "@playwright/test";
import { fixtureIban } from "../../src/lib/bank/fixture";
import { COMPANY_FEC_FILENAME, companyFecBytes, companyFecText } from "../../src/lib/fec/fixture-company";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot L1 : rapport de contrôle F01 à F09. FEC fictif conforme (solde 512 au 31/10/2026 = 15 000,00 €), relevé
// fictif clôturé à 14 985,00 € le même jour : F08 signale un écart de 15,00 €. FEC déséquilibré de 0,10 € : refusé (F03, F04).
const run = Date.now().toString(36);
const slow = { timeout: 60_000 };
const IBAN = fixtureIban();
const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>F</MsgId></GrpHdr><Stmt><Id>S1</Id><FrToDt><FrDtTm>2026-10-01T00:00:00</FrDtTm><ToDtTm>2026-10-31T23:59:59</ToDtTm></FrToDt><Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct><Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">15985.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">14985.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-31</Dt></Dt></Bal><Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-31</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>ECHEANCE PRET FICTIF</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;

async function depositFec(page: import("@playwright/test").Page, slug: string, bytes: Uint8Array) {
  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([{ name: COMPANY_FEC_FILENAME, mimeType: "text/plain", buffer: Buffer.from(bytes) }]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
}

test("Cap 13 lot L1 : rapport F01 à F09, écart banque chiffré, FEC déséquilibré refusé", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cap 13 FEC", email: `cap13f-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 FEC fictif ${run}`);

  // Relevé d'abord, pour que F08 ait un solde à comparer.
  await page.goto(`/e/${slug}/donnees/bank`);
  await page.locator("#bank-files").setInputFiles({ name: "releve-octobre.xml", mimeType: "application/xml", buffer: Buffer.from(camt) });
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);

  // FEC conforme : aperçu avec rapport complet.
  await depositFec(page, slug, companyFecBytes());
  const report = page.getByTestId("fec-control-report");
  for (const code of ["F01", "F02", "F03", "F04", "F05", "F07", "F09"]) await expect(report.getByTestId(`fec-check-${code}`)).toHaveAttribute("data-status", "ok");
  await expect(report.getByTestId("fec-check-F08")).toHaveAttribute("data-status", "fail");
  await expect(report.getByTestId("fec-check-F08")).toContainText("15,00");
  await expect(report.getByTestId("fec-check-F09")).toContainText("92,5 %");
  await page.screenshot({ path: `${CAPTURES}/cap13-l1-apercu.png`, fullPage: true });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);

  // Page Fichiers FEC : rapport de l'exercice en vigueur, soldes fournisseurs dépliables.
  await page.goto(`/e/${slug}/donnees/fec`);
  await expect(page.getByTestId("fec-control-report")).toContainText(COMPANY_FEC_FILENAME);
  await page.getByTestId("fec-suppliers").locator("summary").click();
  await expect(page.getByTestId("fec-suppliers")).toContainText("Fournisseur fictif Alpha");
  await page.screenshot({ path: `${CAPTURES}/cap13-l1-rapport.png`, fullPage: true });

  // FEC déséquilibré de 0,10 € : refusé, rapport conservé.
  const lines = companyFecText().split("\r\n");
  lines[6] = lines[6].replace("\t1000,00\t", "\t1000,10\t");
  await depositFec(page, slug, new TextEncoder().encode(lines.join("\r\n")));
  await expect(page.getByTestId("sync-error")).toContainText("F03");
  const blocked = page.getByTestId("fec-blocked-report");
  await expect(blocked.getByTestId("fec-check-F03")).toHaveAttribute("data-status", "fail");
  await expect(blocked.getByTestId("fec-check-F04")).toContainText("0,10");
  await page.screenshot({ path: `${CAPTURES}/cap13-l1-refus.png`, fullPage: true });
});
