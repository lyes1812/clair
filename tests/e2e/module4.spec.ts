import { expect, test, type Locator } from "@playwright/test";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 4 (lot 1) : masse salariale réelle sur le journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle).
// Valeurs attendues recalculées à la main depuis la fixture (voir tests/unit/payroll.test.ts).
const run = Date.now().toString(36);
const dsn = (month: string) => ({ name: `dsn-${month}.txt`, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes({ month })) });
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((m = 1), (y += 1)) : (m += 1)) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};
const txt = async (l: Locator) => ((await l.textContent()) ?? "").replace(/\s+/g, " ").trim();

test("Masse salariale : synthèse N / N-1, coût par ETP, détail par compte, grille de comptes", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Masse salariale", email: `ms-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Masse salariale fictive ${run}`);
  const ms = `/e/${slug}/studio-rh/masse-salariale`;

  // Sans lecture PayFit : n.d. explicite.
  await page.goto(ms);
  await expect(page.getByTestId("ms-nd")).toContainText("aucune source RH retenue");

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
  // Services : code analytique « Service » du journal fictif, seul axe présent ; la somme égale le total.
  const svc = (code: string, col: string) => page.getByTestId("ms-services-table").locator(`tr[data-service='${code}'] td[data-col='${col}']`);
  await expect(page.getByTestId("ms-services")).toContainText("seul axe présent");
  expect(await txt(svc("TEST-SVC-B", "n"))).toBe("98 490,00 €");
  expect(await txt(svc("TEST-SVC-B", "n1"))).toBe("58 800,00 €");
  expect(await txt(svc("TEST-SVC-A", "n"))).toBe("37 800,00 €");
  expect(await txt(svc("TEST-SVC-C", "n"))).toBe("74 970,00 €");
  expect(await txt(svc("TEST-SVC-B", "cout-pm"))).toBe("3 939,60 €");
  expect(await txt(page.getByTestId("ms-services-total").locator("td[data-col='n']"))).toBe("211 260,00 €");
  await page.screenshot({ path: `${CAPTURES}/4-01-masse-salariale.png`, fullPage: true });
  // Filtre Service B : toute la page sur le service.
  await page.getByTestId("ms-services-table").locator("tr[data-service='TEST-SVC-B'] a").click();
  await expect(page.getByTestId("ms-period")).toContainText("service TEST-SVC-B");
  expect(await txt(tile("masse").locator("dd"))).toBe("98 490,00 €");
  await page.goto(ms);

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
  await page.goto(`${ms}?vue=constructor`);
  await expect(page.getByTestId("ms-param-notice")).toContainText("paramètre ignoré : vue=constructor");

  // Contrôle DSN : sans dépôt, l'écran le dit ; avec les DSN fictives (même société), brut DSN = brut du journal.
  await page.goto(ms);
  await expect(page.getByTestId("ms-dsn-control")).toContainText("aucune DSN déposée");
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles(span("2025-01", "2026-09").map(dsn));
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
  await page.goto(ms);
  expect(await txt(row("2026-01", "dsn"))).toBe("14 830,00 €");
  expect(await txt(row("2026-01", "dsn-ecart"))).toBe("0,00 €");
  expect(await txt(row("2026-03", "dsn"))).toBe("18 730,00 €");
  expect(await txt(page.getByTestId("ms-monthly-foot").locator("td[data-col='dsn-ecart']"))).toBe("0,00 €");
  await page.getByTestId("ms-monthly-table").screenshot({ path: `${CAPTURES}/4-03-controle-dsn.png` });

  // Source RH = DSN (choix du client) : brut déclaré type 001, masse chargée n.d. avec sa raison.
  await page.goto(`/e/${slug}/donnees`);
  const choice = page.getByTestId("source-choice-rh");
  await choice.getByLabel("Règle").selectOption("files");
  await choice.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");
  await page.goto(ms);
  await expect(page.getByTestId("ms-source")).toContainText("DSN déposées");
  expect(await txt(tile("brut").locator("dd"))).toBe("160 770,00 €");
  expect(await txt(page.getByTestId("ms-tile-brut-n1"))).toContain("N-1 : 132 760,00 €");
  await expect(tile("masse").locator("dd")).toContainText("n.d. — cotisations patronales non portées salarié par salarié par la DSN");
  await page.screenshot({ path: `${CAPTURES}/4-04-source-dsn.png`, fullPage: true });
  await page.goto(`/e/${slug}/donnees`);
  await page.getByTestId("source-choice-rh").getByLabel("Règle").selectOption("api");
  await page.getByTestId("source-choice-rh").getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("PayFit");

  // Lot 2 — Fixe & variable : brut par libellé de paie PayFit fictif ; primes = 10 % du brut en mars, juin, septembre
  // (« Primes sur objectif ») + 5 % en juin (« Primes de vacances »).
  await page.goto(ms);
  await page.getByTestId("ms-tabs").getByRole("link", { name: "Fixe & variable" }).click();
  await expect(page.getByTestId("fv-labels")).toBeVisible();
  expect(await txt(page.getByTestId("fv-tile-fixe").locator("dd"))).toBe("154 214,50 €");
  expect(await txt(page.getByTestId("fv-tile-primes").locator("dd"))).toBe("6 555,50 €");
  expect(await txt(page.getByTestId("fv-tile-primes"))).toContain("N-1 : 4 954,00 €");
  const lbl = (l: string) => page.getByTestId("fv-labels").locator(`tr[data-label='${l}'] td[data-col='n']`);
  expect(await txt(lbl("Primes sur objectif"))).toBe("5 619,00 €");
  expect(await txt(lbl("Primes de vacances"))).toBe("936,50 €");
  expect(await txt(page.getByTestId("fv-labels-total").locator("td[data-col='n']"))).toBe("160 770,00 €");
  await expect(page.getByTestId("fv-non-recurrents")).toContainText("non distingués par le journal PayFit");
  await page.screenshot({ path: `${CAPTURES}/4-05-fixe-variable.png`, fullPage: true });

  // Paie & comptabilité : provision CP fin septembre 2026 = 10 % + 4 % du brut de septembre ; sans comptabilité, n.d.
  await page.getByTestId("ms-tabs").getByRole("link", { name: "Paie & comptabilité" }).click();
  expect(await txt(page.getByTestId("pc-tile-provision").locator("dd"))).toBe("2 622,20 €");
  expect(await txt(page.getByTestId("pc-tile-provision-n1"))).toContain("2 251,20 €");
  await expect(page.getByTestId("pc-recon-nd")).toContainText("aucune source comptable retenue");
  // Avec Pennylane fictif (641100 = brut total, pas de compte 6413 ni de provision) : l'écart sort rubrique par rubrique.
  await page.goto(`/e/${slug}/donnees/pennylane`);
  await page.getByLabel("Clé API Pennylane").fill("fixture-pl-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await page.getByLabel("Du mois").fill("2026-01");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");
  await page.goto(`${ms}?vue=paie-compta`);
  const ecart = (r: string) => page.getByTestId("pc-recon-rubrics").locator(`tr[data-rubric='${r}'] td[data-col='ecart']`);
  expect(await txt(ecart("salaires"))).toBe("−6 555,50 €");
  expect(await txt(ecart("primes"))).toBe("+6 555,50 €");
  expect(await txt(ecart("cotisations"))).toBe("0,00 €");
  expect(await txt(ecart("provisions-cp"))).toBe("+546,00 €");
  expect(await txt(page.getByTestId("pc-recon-total").locator("td[data-col='ecart']"))).toBe("+546,00 €");
  await expect(page.getByTestId("pc-ratio-value")).toContainText("n.d. — aucun produit d'exploitation");
  await page.screenshot({ path: `${CAPTURES}/4-06-paie-compta.png`, fullPage: true });

  // Grille de comptes : défaut proposé visible, modifiable par l'administrateur ; définitions dans l'écran.
  await page.goto(`/e/${slug}/parametres`);
  await expect(page.getByTestId("setting-payroll-origin")).toContainText("Valeur par défaut validée le 22/10/2026");
  await expect(page.getByTestId("setting-payroll-axis-origin")).toContainText("seul axe analytique présent");
  await page.getByTestId("setting-payroll-primes").fill("6413, 6418");
  await page.getByTestId("setting-payroll-save").click();
  await expect(page.getByTestId("setting-payroll").getByRole("status")).toContainText("Grille de comptes enregistrée");
  await page.reload();
  await expect(page.getByTestId("setting-payroll-origin")).toContainText("Modifié le");
  await page.goto(ms);
  await expect(page.getByTestId("ms-grid")).toContainText("Primes (brut) : 6413, 6418");
  expect(await txt(tile("masse").locator("dd"))).toBe("211 260,00 €");
});
