import { expect, test } from "@playwright/test";
import { addMonthsToDate } from "../../src/lib/dates";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 2 : référentiel Collaborateurs sur le transport PayFit fictif puis sur les DSN fictives (aucune donnée réelle).
const run = Date.now().toString(36);
const dsn = (month: string) => ({ name: `dsn-${month}.txt`, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes({ month })) });
const months = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const v = `${y}-${String(m).padStart(2, "0")}`;
    if (v > to) break;
    out.push(v);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

test("Collaborateurs : liste mensuelle, annuelle, fiche, puis bascule sur les DSN", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Collaborateurs", email: `collab-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Collaborateurs fictifs ${run}`);
  const collab = `/e/${slug}/studio-rh/collaborateurs`;

  // Sans source : n.d. explicite.
  await page.goto(collab);
  await expect(page.getByTestId("collaborateurs-nd")).toBeVisible();

  // Lecture PayFit fictive appliquée sur 24 mois.
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

  // Historique PayFit brut (défaut validé le 22/10/2026) : chiffres tels que l'API les renvoie, une seule mention en tête d'écran.
  // Le transport fictif renvoie tous les contrats : avril 2025 = 7 personnes, 1 entrée (002), 0 sortie, sans « ≥ » ni n.d.
  await page.goto(`${collab}?mois=2025-04`);
  await expect(page.getByTestId("payfit-history-notice")).toContainText("Données telles que remontées par l'API PayFit");
  await expect(page.getByTestId("payfit-history-notice")).toContainText("faussés dans un sens ou dans l'autre");
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("7");
  await expect(page.getByTestId("entries-count").locator("dd")).toHaveText("1");
  await expect(page.getByTestId("exits-count").locator("dd")).toHaveText("0");
  await expect(page.getByTestId("coverage-notice")).toHaveCount(0);
  await page.screenshot({ path: `${CAPTURES}/2-01-mois.png`, fullPage: true });
  await page.goto(`${collab}?mois=2024-10`);
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("6");
  await page.goto(`${collab}/annee?annee=2025`);
  await expect(page.getByTestId("year-jan1").locator("dd")).toHaveText("6");
  await expect(page.getByTestId("year-dec31").locator("dd")).toHaveText("7");
  await expect(page.getByTestId("year-entries").locator("dd")).toHaveText("1");
  await expect(page.getByTestId("year-exits").locator("dd")).toHaveText("1");

  // Paramètres › Historique PayFit = « signalé » : les mois antérieurs à la limite reviennent en « ≥ » et n.d.
  await page.goto(`/e/${slug}/parametres`);
  await expect(page.getByTestId("setting-payfit-history-origin")).toContainText("Valeur par défaut validée le 22/10/2026");
  await page.getByTestId("setting-payfit-history-flagged").check();
  await page.getByTestId("setting-payfit-history-save").click();
  await expect(page.getByTestId("setting-payfit-history").getByRole("status")).toContainText("Historique PayFit enregistré");
  await page.getByTestId("setting-payfit-history").screenshot({ path: `${CAPTURES}/2-05-parametres-historique.png` });

  // La borne basse PayFit dépend de la date de lecture réelle : fenêtre = mois de la date de référence − 12 (inclus).
  await page.goto(`${collab}?mois=2025-04`);
  await expect(page.getByTestId("payfit-history-notice")).toHaveCount(0);
  await expect(page.getByTestId("source-badge-rh")).toContainText("PayFit");
  await expect(page.getByTestId("rh-build-info")).toContainText("mois lus 2024-10 → 2026-09");
  await expect(page.getByTestId("rh-build-info")).toContainText("une société par espace");
  const refText = (await page.getByTestId("rh-build-info").textContent())!.match(/date de référence (\d{2})\/(\d{2})\/(\d{4})/)!;
  const refMonth = `${refText[3]}-${refText[2]}`;
  const windowStart = months("2024-01", refMonth).at(-13)!; // mois de référence − 12
  const lower = (m: string) => m <= windowStart; // entrées et sorties du mois incomplètes
  // Effectif à une date : exact dès la date de lecture − 12 mois (au jour près).
  const cutoff = addMonthsToDate(`${refText[3]}-${refText[2]}-${refText[1]}`, -12);
  const lowerAt = (date: string) => date < cutoff;
  const exitsCovered2025 = months("2025-01", "2025-12").filter((m) => !lower(m)).length;
  expect(lower("2025-04")).toBe(true); // vrai tant que la lecture a lieu avant mai 2026 + 12 mois
  // Avril 2025 — 7 personnes (borne basse), 1 entrée (002).
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("au moins 7");
  await expect(page.getByTestId("headcount-contracts").locator("dd")).toHaveText("au moins 7");
  await expect(page.getByTestId("present-any-day").locator("dd")).toHaveText("au moins 7");
  await expect(page.getByTestId("entries-count").locator("dd")).toHaveText("au moins 1");
  await expect(page.getByTestId("exits-count").locator("dd")).toContainText("n.d.");
  const row002 = page.getByTestId("collab-monthly-table").locator("tr[data-contract='TEST-A-CONTRACT-002']");
  await expect(row002).toContainText("entré le 01/04/2025");
  await expect(row002).toContainText("Fictif A-002");
  await expect(page.getByTestId("collab-monthly-table").getByRole("row")).toHaveCount(8);
  await page.screenshot({ path: `${CAPTURES}/2-01b-mois-signale.png`, fullPage: true });

  await page.goto(`${collab}?mois=2025-12`);
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText(lowerAt("2025-12-31") ? "au moins 7" : "7");
  if (lower("2025-12")) await expect(page.getByTestId("exits-count").locator("dd")).toContainText("n.d.");
  else await expect(page.getByTestId("exits-count").locator("dd")).toHaveText("1");
  await expect(page.getByTestId("collab-monthly-table").locator("tr[data-contract='TEST-A-CONTRACT-003']")).toContainText("sorti le 31/12/2025");
  await expect(page.getByTestId("month-exits")).toContainText("PayFit n'expose pas le motif");

  await page.goto(`${collab}?mois=2024-10`);
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("au moins 6");
  await expect(page.getByTestId("headcount-persons")).toContainText("borne basse");
  await expect(page.getByTestId("exits-count").locator("dd")).toContainText("n.d.");
  await expect(page.getByTestId("coverage-notice")).toContainText("hypothèse à confirmer");

  // Au-delà de la date de référence : n.d. strict.
  await page.goto(`${collab}?mois=2026-12`);
  await expect(page.getByTestId("headcount-persons").locator("dd")).toContainText("n.d. — période postérieure à la date de référence");
  await expect(page.getByTestId("month-nd")).toBeVisible();
  await expect(page.getByTestId("collab-monthly-table")).toHaveCount(0);

  // Filtres : état « entrés » en février 2026 ⇒ une seule ligne (004).
  await page.goto(`${collab}?mois=2026-02&etat=entres`);
  await expect(page.getByTestId("collab-monthly-table").getByRole("row")).toHaveCount(2);
  await expect(page.getByTestId("collab-monthly-table")).toContainText("entré le 15/02/2026");

  // Année 2025 : 7 lignes, 6 au 01/01, 7 au 31/12.
  await page.goto(`${collab}/annee?annee=2025`);
  await expect(page.getByTestId("year-jan1").locator("dd")).toHaveText("au moins 6");
  await expect(page.getByTestId("year-dec31").locator("dd")).toHaveText(lowerAt("2025-12-31") ? "au moins 7" : "7");
  await expect(page.getByTestId("year-entries").locator("dd")).toHaveText("au moins 1");
  // Sorties connues seulement sur les mois postérieurs au mois charnière.
  if (exitsCovered2025 > 0) {
    await expect(page.getByTestId("year-exits").locator("dd")).toHaveText(lower("2025-12") ? "au moins 0" : "au moins 1");
    await expect(page.getByTestId("year-exits")).toContainText(`sur les mois couverts (${exitsCovered2025}/12)`);
  } else await expect(page.getByTestId("year-exits")).toContainText("n.d.");
  await expect(page.getByTestId("collab-annual-table").getByRole("row")).toHaveCount(8);
  await expect(page.getByTestId("collab-annual-table").getByRole("row").filter({ hasText: "TEST-A-CONTRACT-002" })).toContainText("9 sur 12 couverts");
  await page.screenshot({ path: `${CAPTURES}/2-02-annee.png`, fullPage: true });

  // Mouvements sur la période par défaut (12 derniers mois).
  await page.goto(`${collab}/mouvements?de=2025-10&a=2026-09`);
  await expect(page.getByTestId("movements-entries")).toContainText("15/02/2026");
  await expect(page.getByTestId("movements-exits")).toContainText("31/12/2025"); // fait de source, listé même en borne basse
  await expect(page.getByTestId("upcoming-section")).toContainText("Aucun mouvement futur");

  // Fiche personne 003 : libellé, provenance, motif n.d., cellules de temps.
  await page.goto(`${collab}/p/${encodeURIComponent("payfit:TEST-A-PERSON-003")}`);
  await expect(page.getByTestId("collab-person")).toContainText("Fictif A-003");
  await expect(page.getByTestId("collab-person")).toContainText("lastName");
  const contract = page.getByTestId("collab-contract");
  await expect(contract).toContainText("contracts · TEST-A-CONTRACT-003 · endDate");
  await expect(contract).toContainText("PayFit n'expose pas le motif");
  const monthsTable = contract.getByTestId("contract-months");
  await expect(monthsTable.getByRole("row").filter({ hasText: "2025-06" })).toContainText("80 h");
  await expect(monthsTable.getByRole("row").filter({ hasText: "2025-11" })).toContainText("80 h / 75 h");
  await expect(monthsTable.getByRole("row").filter({ hasText: "2026-01" })).toHaveCount(0);
  await expect(page.getByTestId("contract-absences")).toContainText("PayFit ne fournit pas la durée");
  await page.screenshot({ path: `${CAPTURES}/2-03-fiche.png`, fullPage: true });

  // Clé mal formée ⇒ 404 ; identifiant inconnu ⇒ 404.
  const bad = await page.goto(`${collab}/p/${encodeURIComponent("payfit:nom%20en%20clair")}`);
  expect(bad?.status()).toBe(404);
  const unknown = await page.goto(`${collab}/p/${encodeURIComponent("payfit:INCONNU")}`);
  expect(unknown?.status()).toBe(404);

  // Dépôt des 24 DSN fictives, règle « Fichiers uniquement » ⇒ bascule explicite, 003 avec motif 026, octobre 2024 exact.
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles(months("2024-10", "2026-09").map(dsn));
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
  await page.goto(`/e/${slug}/donnees`);
  const choice = page.getByTestId("source-choice-rh");
  await choice.getByLabel("Règle").selectOption("files");
  await choice.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");

  await page.goto(`${collab}?mois=2025-12`);
  await expect(page.getByTestId("source-switch-notice")).toBeVisible();
  await expect(page.getByTestId("source-badge-rh")).toContainText("Fichiers DSN");
  await expect(page.getByTestId("source-badge-rh")).toContainText("Choix forcé par l'administrateur");
  await expect(page.getByTestId("rh-build-info")).toContainText("couverture complète 2024-10 → 2026-09");
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("7");
  await expect(page.getByTestId("exits-count").locator("dd")).toHaveText("1");
  await expect(page.getByTestId("month-exits")).toContainText("Fin de contrat à durée déterminée (026)");
  await page.goto(`${collab}?mois=2024-10`);
  await expect(page.getByTestId("headcount-persons").locator("dd")).toHaveText("6");
  await expect(page.getByTestId("headcount-persons")).not.toContainText("borne basse");
  await page.screenshot({ path: `${CAPTURES}/2-04-dsn-mois.png`, fullPage: true });

  // Une fiche PayFit sous la règle « Fichiers » n'est pas la source retenue.
  await page.goto(`${collab}/p/${encodeURIComponent("payfit:TEST-A-PERSON-003")}`);
  await expect(page.getByTestId("other-source")).toContainText("n'est pas la source retenue");

  // Fiche DSN du contrat 003 depuis la liste.
  await page.goto(`${collab}?mois=2025-12&q=003`);
  await page.getByTestId("collab-monthly-table").locator("tr[data-contract='TEST-A-CONTRACT-003'] a").first().click();
  await expect(page.getByTestId("collab-person")).toContainText("FICTIF A-003");
  await expect(page.getByTestId("collab-contract")).toContainText("S21.G00.62.001");
  await expect(page.getByTestId("contract-absences-nd")).toContainText("non extraits de la DSN");
});
