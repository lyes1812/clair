import { expect, test } from "@playwright/test";
import { fixtureIban } from "../../src/lib/bank/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot L2 : relevés bancaires. Cas de référence écrit à la main, un compte fictif, deux relevés CAMT.053 qui se
// chevauchent du 10 au 15 janvier 2026 :
//   relevé 1, du 01/01 au 15/01 : ouverture 10 000,00 ; 05/01 loyer −1 200,00 ; 10/01 client +3 000,00 ; clôture 11 800,00.
//   relevé 2, du 10/01 au 31/01 : ouverture 8 800,00 ; 10/01 client +3 000,00 (déjà connu) ; 20/01 URSSAF −2 500,50 ;
//   clôture 9 299,50.
// Attendu : 3 mouvements, 1 doublon écarté, continuité au centime, solde de départ du plan 9 299,50 € au 31/01/2026.
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };
const IBAN = fixtureIban();

const bal = (code: string, cents: number, date: string) =>
  `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${(cents / 100).toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
const ntry = (date: string, cents: number, label: string) =>
  `<Ntry><Amt Ccy="EUR">${(Math.abs(cents) / 100).toFixed(2)}</Amt><CdtDbtInd>${cents < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${date}</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>${label}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
const camt = (from: string, to: string, open: number, close: number, entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>F</MsgId></GrpHdr><Stmt><Id>${from}</Id><FrToDt><FrDtTm>${from}T00:00:00</FrDtTm><ToDtTm>${to}T23:59:59</ToDtTm></FrToDt><Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>${bal("OPBD", open, from)}${bal("CLBD", close, to)}${entries}</Stmt></BkToCstmrStmt></Document>`;
const FILE1 = camt("2026-01-01", "2026-01-15", 1_000_000, 1_180_000, ntry("2026-01-05", -120_000, "PRLV LOYER FICTIF") + ntry("2026-01-10", 300_000, "VIR CLIENT FICTIF"));
const FILE2 = camt("2026-01-10", "2026-01-31", 880_000, 929_950, ntry("2026-01-10", 300_000, "VIR CLIENT FICTIF") + ntry("2026-01-20", -250_050, "PRLV URSSAF"));

async function deposit(page: import("@playwright/test").Page, slug: string, name: string, body: string, iban = "") {
  await page.goto(`/e/${slug}/donnees/bank`);
  await page.locator("#bank-files").setInputFiles({ name, mimeType: "application/xml", buffer: Buffer.from(body) });
  if (iban) await page.locator("#bank-iban").fill(iban);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
}

test("Cap 13 lot L2 : relevés qui se chevauchent sans doublon, continuité, solde de départ du plan", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cap 13 banque", email: `cap13b-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 banque fictif ${run}`);

  // Sans relevé : n.d. avec sa raison sur la carte Données et dans le plan.
  await page.goto(`/e/${slug}/donnees`);
  await expect(page.getByTestId("bank-coverage-summary")).toContainText("n.d. — aucun relevé appliqué");

  await deposit(page, slug, "releve-1.xml", FILE1);
  await expect(page.getByTestId("bank-statements")).toContainText("continu");
  await expect(page.getByTestId("bank-duplicates")).toContainText("Aucun mouvement déjà connu");
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);

  await deposit(page, slug, "releve-2.xml", FILE2);
  await expect(page.getByTestId("bank-duplicates")).toContainText("1 mouvement(s) déjà présent(s)");
  await expect(page.getByTestId("bank-accounts-after")).toContainText("01/01/2026 → 31/01/2026");
  await page.screenshot({ path: `${CAPTURES}/cap13-l2-apercu.png`, fullPage: true });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);

  // CSV sans IBAN saisi : refusé avec la raison, rien n'est lu.
  await deposit(page, slug, "export.csv", "Date;Libellé;Montant\n02/02/2026;X;1,00\n");
  await expect(page.getByTestId("sync-error")).toContainText("IBAN");

  // Compte : 3 mouvements, 1 doublon écarté, dernier solde 9 299,50 €, IBAN masqué.
  await page.goto(`/e/${slug}/donnees/bank`);
  const accounts = page.getByTestId("bank-accounts");
  await expect(accounts).toContainText(`${IBAN.slice(0, 4)} … ${IBAN.slice(-4)}`);
  await expect(accounts).not.toContainText(IBAN);
  const row = accounts.locator("tbody tr").first();
  await expect(row.locator("td").nth(3)).toHaveText("3");
  await expect(row.locator("td").nth(4)).toHaveText("1");
  await expect(row.locator("td").nth(5)).toContainText("31/01/2026");
  await expect(accounts).toContainText("Historique inférieur à 6 mois");
  await page.screenshot({ path: `${CAPTURES}/cap13-l2-comptes.png`, fullPage: true });

  // Trésorerie 13 semaines : le solde de départ vient des relevés, au centime.
  await page.goto(`/e/${slug}/studio-restructuring?vue=cash`);
  await expect(page.locator(`[data-testid="cash-tile-start"] dd [data-money-cents]`)).toHaveAttribute("data-money-cents", "929950", slow);
  await expect(page.getByTestId("cash-tile-start")).toContainText("Relevés · au 31/01/2026");
  await expect(page.getByTestId("cash-start-bank")).toContainText("31/01/2026");
  await page.screenshot({ path: `${CAPTURES}/cap13-l2-tresorerie.png`, fullPage: true });
});
