import { expect, test } from "@playwright/test";
import { fixtureIban } from "../../src/lib/bank/fixture";
import { fixtureFlows } from "../../src/lib/bank/categories-fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Cap 13, lot L4 : catégorisation des flux bancaires, sans clé d'IA (mode règles seules). Cas de référence écrit à la main :
//   54 flux fictifs, 2 par gabarit (27 gabarits) ; 22 gabarits reconnus par le référentiel → 44 flux classés (81,5 %) ;
//   5 gabarits de tiers nommés → 10 flux à revoir. Le tiers « GROSSISTE FICTIF » appris en fournisseur classe ses 2 flux ;
//   un achat de matériel saisi en investissement. Après revue : 46 flux par règles et tiers appris (85,2 %), 7 à revoir.
const run = Date.now().toString(36);
const slow = { timeout: 60_000 };
const IBAN = fixtureIban();
const flows = fixtureFlows(54);
const amount = (c: number) => (Math.abs(c) / 100).toFixed(2);
const opening = 100_000_00;
const closing = opening + flows.reduce((t, f) => t + f.amountCents, 0);
const entries = flows.map((f) => `<Ntry><Amt Ccy="EUR">${amount(f.amountCents)}</Amt><CdtDbtInd>${f.amountCents < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${f.bookingDate}</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>${f.label}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join("");
const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>F</MsgId></GrpHdr><Stmt><Id>S1</Id><FrToDt><FrDtTm>2026-01-01T00:00:00</FrDtTm><ToDtTm>2026-06-30T23:59:59</ToDtTm></FrToDt><Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct><Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amount(opening)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-01</Dt></Dt></Bal><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amount(closing)}</Amt><CdtDbtInd>${closing < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Dt><Dt>2026-06-30</Dt></Dt></Bal>${entries}</Stmt></BkToCstmrStmt></Document>`;

test("Cap 13 lot L4 : catégorisation des flux, référentiel, revue, tiers appris, sans IA", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Admin Cap 13 catégories", email: `cap13c-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cap 13 catégories fictif ${run}`);

  await page.goto(`/e/${slug}/donnees/bank`);
  await page.locator("#bank-files").setInputFiles({ name: "releve-s1.xml", mimeType: "application/xml", buffer: Buffer.from(camt) });
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\//, slow);
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-active")).toBeVisible(slow);

  await page.goto(`/e/${slug}/donnees/bank`);
  await page.getByTestId("bank-categories-link").click();
  await expect(page.getByTestId("categories-tile-total")).toContainText("54", slow);
  await expect(page.getByTestId("categories-tile-rules")).toContainText("81,5 %");
  await expect(page.getByTestId("categories-tile-review")).toContainText("10");
  await expect(page.getByTestId("categories-ia-missing")).toBeVisible();
  await expect(page.getByTestId("categories-row")).toHaveCount(10);

  const table = page.getByTestId("categories-table");
  await table.locator("tr", { hasText: "GROSSISTE FICTIF 100051" }).locator('input[type="checkbox"]').check();
  await table.locator("tr", { hasText: "GROSSISTE FICTIF 100051" }).locator("select").selectOption("suppliers");
  await table.locator("tr", { hasText: "MATERIEL FICTIF 100052" }).locator("select").selectOption("capex");
  await page.getByRole("button", { name: "Enregistrer les catégories" }).click();
  await expect(page.getByTestId("categories-form")).toContainText("2 catégorie(s) enregistrée(s)", slow);

  await page.reload();
  await expect(page.getByTestId("categories-tile-rules")).toContainText("85,2 %", slow);
  await expect(page.getByTestId("categories-tile-review")).toContainText("7");
  await expect(page.getByTestId("categories-row")).toHaveCount(7);
  await expect(page.getByTestId("categories-learned")).toContainText("GROSSISTE FICTIF");
  await expect(page.getByTestId("categories-learned")).toContainText("Fournisseurs d’exploitation");

  await page.goto(`/e/${slug}/donnees/bank/categories?vue=tous`);
  await expect(page.getByTestId("categories-row")).toHaveCount(54);
  await expect(page.getByTestId("categories-table").locator("tr", { hasText: "MATERIEL FICTIF 100052" })).toContainText("Investissements");
  await expect(page.getByTestId("categories-table").locator("tr", { hasText: "GROSSISTE FICTIF 100024" })).toContainText("Tiers appris");
  await page.goto(`/e/${slug}/donnees/bank/categories`);
  await page.screenshot({ path: `${CAPTURES}/cap13-l4-categories.png`, fullPage: true });

  // Mode sans IA (administrateur) : affiché, puis retiré.
  await page.getByRole("button", { name: "Activer le mode sans IA" }).click();
  await expect(page.getByTestId("categories-ia-off")).toBeVisible(slow);
  await page.getByRole("button", { name: "Retirer le mode sans IA" }).click();
  await expect(page.getByTestId("categories-ia-missing")).toBeVisible(slow);
});
