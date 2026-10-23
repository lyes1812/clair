import { expect, test, type Locator } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Entrées du cahier : KPI RH (turnover, absentéisme, effectifs mensuels), Collaborateurs (fiche), Reporting social — sur le
// journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle). Septembre 2026 : 7 contrats CDI, 6,10 ETP.
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };
const txt = async (l: Locator) => ((await l.textContent()) ?? "").replace(/\s+/g, " ").trim();

test("Entrées du cahier : KPI RH par onglet, effectifs mensuels par axe, fiche collaborateur, reporting social", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Cahier", email: `cahier-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Cahier fictif ${run}`);
  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée", slow);
  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");

  // KPI RH : l'écran historique (Suivi des effectifs) garde tous les indicateurs ; Turnover et Absentéisme les isolent.
  const kpi = `/e/${slug}/studio-rh/kpi`;
  await page.goto(kpi);
  await expect(page.getByTestId("kpi-tabs").getByRole("link", { name: "Suivi des effectifs" })).toHaveAttribute("aria-current", "page");
  for (const id of ["etp-end", "etp-avg", "headcount-avg", "turnover", "absenteeism"]) await expect(page.getByTestId(`kpi-tile-${id}`)).toBeVisible();
  const entriesFeb = await txt(page.getByTestId("kpi-monthly-table").locator("tr[data-month='2026-02'] td[data-col='entries']"));
  const exitsFeb = await txt(page.getByTestId("kpi-monthly-table").locator("tr[data-month='2026-02'] td[data-col='exits']"));
  await page.getByTestId("kpi-tabs").getByRole("link", { name: "Turnover" }).click();
  await expect(page.getByTestId("kpi-tile-turnover")).toBeVisible();
  await expect(page.getByTestId("kpi-tile-absenteeism")).toHaveCount(0);
  await expect(page.getByTestId("kpi-tile-etp-end")).toHaveCount(0);
  await expect(page.getByTestId("kpi-monthly-table").locator("th")).toHaveCount(5);
  await page.getByTestId("kpi-tabs").getByRole("link", { name: "Absentéisme" }).click();
  await expect(page.getByTestId("kpi-tile-absenteeism")).toBeVisible();
  await expect(page.getByTestId("kpi-tile-turnover")).toHaveCount(0);
  await page.getByTestId("kpi-tabs").getByRole("link", { name: "Pyramide" }).click();
  await expect(page.getByTestId("prevu")).toContainText("date de naissance");
  await page.getByTestId("kpi-tabs").getByRole("link", { name: "Livre de paie" }).click();
  await expect(page.getByTestId("prevu")).toContainText("PDF");

  // Effectifs mensuels : ETP par catégorie, septembre 2026 = 6,10 (tous CDI) ; inscrit = 7 ; somme des groupes = total.
  await page.getByTestId("kpi-tabs").getByRole("link", { name: "Effectifs mensuels" }).click();
  const em = page.getByTestId("em-form");
  await em.locator("#annee").selectOption("2026");
  await em.getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='CDI'] td[data-month='2026-09']"))).toBe("6,10");
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-09']"))).toBe("6,10");
  await expect(page.getByTestId("em-table").locator("tr[data-group='CDI'] td[data-month='2026-11']")).toContainText("n.d."); // mois non lu
  await expect(page.getByTestId("em-repart").locator("tr[data-group='CDI'] td[data-col='part']")).toContainText("100,00 %");
  await page.screenshot({ path: `${CAPTURES}/7-01-effectifs-mensuels.png`, fullPage: true });
  await em.locator("#mesure").selectOption("inscrit");
  await em.getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='CDI'] td[data-month='2026-09']"))).toBe("7");
  // Entrées et sorties de février 2026 : mêmes valeurs que le tableau mois par mois du suivi des effectifs.
  await em.locator("#mesure").selectOption("entrees");
  await em.getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-02']"))).toBe(entriesFeb);
  await em.locator("#mesure").selectOption("sorties");
  await em.getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-02']"))).toBe(exitsFeb);
  // Axe non fourni par les données : option désactivée, jamais inventée. Masse par service (axe analytique du journal) :
  // septembre 2026 = 24 600,00 € au total, somme des trois services ; octobre (mois non lu) n.d.
  await expect(em.locator("#axe option", { hasText: "Direction" })).toBeDisabled();
  await em.locator("#mesure").selectOption("masse");
  await em.locator("#axe").selectOption("service");
  await em.getByRole("button", { name: "Afficher" }).click();
  const eur = (t: string) => Math.round(Number(t.replace(/[^\d,-]/g, "").replace(",", ".")) * 100);
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-09']"))).toBe("24 600,00 €");
  const parts = await Promise.all(["TEST-SVC-A", "TEST-SVC-B", "TEST-SVC-C"].map(async (g) => eur(await txt(page.getByTestId("em-table").locator(`tr[data-group='${g}'] td[data-month='2026-09']`)))));
  expect(parts.reduce((a, b) => a + b, 0)).toBe(2460000);
  await expect(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-10']")).toContainText("n.d.");
  // ETP par service : la somme des services est l'ETP de septembre (6,10).
  await em.locator("#mesure").selectOption("etp");
  await em.getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-09']"))).toBe("6,10");

  // Version scénario : base T4 2026 sans hypothèse ; septembre lu dans le réel, octobre à décembre projetés (7 inscrits).
  await page.goto(`/e/${slug}/parametres#projection`);
  await page.getByTestId("setting-projection-calendaire").check();
  await page.getByTestId("setting-projection-save").click();
  await expect(page.getByTestId("setting-projection").getByRole("status")).toContainText("Règle de prorata enregistrée", slow);
  await page.goto(`/e/${slug}/studio-rh/hypotheses`);
  const create = page.getByTestId("hyp-create-form");
  await create.getByLabel("Nom").fill("Base T4");
  await create.getByLabel("Type").selectOption("revise");
  await create.getByRole("button", { name: "Créer le scénario" }).click();
  await expect(page.getByTestId("hyp-context")).toContainText("Base figée sur septembre 2026");
  await page.goto(`${kpi}?vue=effectifs`);
  const v = await page.locator("#version option", { hasText: "« Base T4 »" }).getAttribute("value");
  await page.locator("#version").selectOption(v!);
  await page.locator("#mesure").selectOption("inscrit");
  await page.locator("#annee").selectOption("2026");
  await page.getByTestId("em-form").getByRole("button", { name: "Afficher" }).click();
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='CDI'] td[data-month='2026-09']"))).toBe("7");
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='CDI'] td[data-month='2026-10']"))).toBe("7");
  expect(await txt(page.getByTestId("em-table").locator("tr[data-group='total'] td[data-month='2026-12']"))).toBe("7");
  await expect(page.getByTestId("em-table").locator("thead")).toContainText("proj.");
  await page.screenshot({ path: `${CAPTURES}/7-02-effectifs-scenario.png`, fullPage: true });

  // Collaborateurs : fiche collaborateur par recherche, entrées « Prévu ».
  await page.goto(`/e/${slug}/studio-rh/collaborateurs`);
  await expect(page.getByTestId("collab-tabs").getByRole("link", { name: "Liste mensuelle des collaborateurs" })).toHaveAttribute("aria-current", "page");
  await page.getByTestId("collab-tabs").getByRole("link", { name: "Fiche collaborateur" }).click();
  await page.getByLabel(/Rechercher/).fill("a-008");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByTestId("fiche-table").locator("tbody tr")).toHaveCount(1);
  await page.getByTestId("fiche-table").getByRole("link", { name: "Ouvrir la fiche" }).click();
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.goto(`/e/${slug}/studio-rh/collaborateurs/tree`);
  await expect(page.getByTestId("prevu")).toContainText("hiérarchie");

  // Reporting social : entrées « Prévu ».
  await page.goto(`/e/${slug}/studio-rh/reporting-social`);
  await expect(page.getByTestId("rs-tabs")).toContainText("BDESE");
  await page.getByTestId("rs-tabs").getByRole("link", { name: "BDESE" }).click();
  await expect(page.getByTestId("prevu")).toContainText("ne valide aucune obligation légale");
});
