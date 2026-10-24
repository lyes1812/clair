import { expect, test, type Locator } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 5 (lot 1) : scénario sur le journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle).
// Valeurs recalculées à la main depuis ref/fixtures/clair-test-generic-v1.json (voir tests/unit/budget.test.ts).
const run = Date.now().toString(36);
const slow = { timeout: 30_000 }; // environnement déployé : actions serveur parfois lentes
const txt = async (l: Locator) => ((await l.textContent()) ?? "").replace(/\s+/g, " ").trim();

test("Hypothèses budgétaires : base figée, hypothèses datées, projection traçable", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Budget", email: `budget-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Budget fictif ${run}`);
  const hyp = `/e/${slug}/studio-rh/hypotheses`;

  // Sans lecture PayFit : n.d. explicite.
  await page.goto(hyp);
  await expect(page.getByTestId("hyp-nd")).toContainText("base figée impossible");

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

  // Sans règle de prorata : Clair refuse de projeter et renvoie vers Paramètres.
  await page.goto(hyp);
  await expect(page.getByTestId("hyp-conventions-nd")).toContainText("conventions de calcul non renseignées");
  await page.goto(`/e/${slug}/parametres#projection`);
  await expect(page.getByTestId("setting-projection-origin")).toContainText("Non renseignée");
  await page.getByTestId("setting-projection-calendaire").check();
  await page.getByTestId("setting-projection-save").click();
  await expect(page.getByTestId("setting-projection").getByRole("status")).toContainText("Règle de prorata enregistrée", slow);

  // Création : base figée sur septembre 2026, projection octobre → décembre 2026.
  await page.goto(hyp);
  const create = page.getByTestId("hyp-create-form");
  await create.getByLabel("Nom").fill("Révisé T4 2026");
  await create.getByLabel("Type").selectOption("revise");
  await expect(create.getByLabel("Premier mois projeté")).toHaveValue("2026-10");
  await expect(create.getByLabel("Dernier mois projeté")).toHaveValue("2026-12");
  await create.getByRole("button", { name: "Créer le scénario" }).click();
  await expect(page.getByTestId("hyp-context")).toContainText("Base figée sur septembre 2026");

  // Sans hypothèse : base reconduite. Base de septembre = 90 % du brut (primes exclues) + charges au taux observé :
  // 16 857,00 € + 5 283,00 € = 22 140,00 € par mois ; atterrissage = réel janv.–sept. 211 260,00 € + 3 × 22 140,00 €.
  const row = (m: string) => page.getByTestId("proj-table").locator(`tr[data-month='${m}'] td[data-col='cost']`);
  expect(await txt(row("2026-10"))).toBe("22 140,00 €");
  expect(await txt(row("2026-09"))).toBe("24 600,00 €");
  expect(await txt(page.getByTestId("proj-tile-landing").locator("dd"))).toBe("277 680,00 €");

  // Hypothèses : augmentation générale 2 % en novembre (grille des taux) ; départ du contrat 008 le 15 novembre (sortie
  // 1 000 € brut à 20 %) remplacé le 16 par une embauche à 50 % de 2 500 € brut temps plein (charges 20 %) ; primes de décembre.
  const tab = (name: string | RegExp) => page.getByTestId("hyp-tabs").getByRole("link", { name });
  await tab("Bases individuelles").click();
  expect(await txt(page.getByTestId("hyp-base-total").locator("dd"))).toBe("22 140,00 €");
  expect(await txt(page.getByTestId("hyp-base-masse"))).toContain("hors base : 2 460,00 €");
  await tab("Hypothèses globales").click();
  await page.getByTestId("glob-rates-table").locator("input[name='rate|global|2026-11']").fill("2");
  await page.getByTestId("glob-rates-form").getByRole("button", { name: "Enregistrer les taux" }).click();
  await expect(page.getByTestId("glob-rates-form").getByRole("status")).toContainText("1 ligne écrite", slow);

  await tab("Modifications de postes").click();
  await page.getByTestId("sal-search").getByLabel("Rechercher (nom, service)").fill("a-008");
  await page.getByTestId("sal-search").getByRole("button", { name: "Rechercher" }).click();
  await page.getByTestId("sal-table").getByRole("link").first().click();
  await page.getByTestId("sal-add").getByText(/^Départ \(/).click();
  const dep = page.getByTestId("sal-form-depart");
  await dep.getByLabel("Libellé").fill("Départ 008");
  await dep.getByLabel("Dernier jour payé").fill("2026-11-15");
  await dep.getByLabel("Saisie").selectOption("brut");
  await dep.getByLabel("Brut (€)").fill("1000");
  await dep.getByLabel("Taux de charges (%)").fill("20");
  await dep.getByRole("button").click();
  await expect(dep.getByRole("status")).toContainText("Départ 008", slow);

  await tab("Embauches prévisionnelles").click();
  if (!(await page.getByTestId("hyp-form-embauche").isVisible())) await page.getByText(/^Ajouter une embauche \(/).click();
  const he0 = page.getByTestId("hyp-form-embauche");
  await he0.getByLabel("Poste", { exact: true }).fill("Remplaçant 008");
  await he0.getByLabel("Centre de coûts (service)").fill("TEST-SVC-C");
  await he0.getByLabel("Catégorie").selectOption("cdi");
  await he0.getByLabel("Premier jour payé").fill("2026-11-16");
  await he0.getByLabel("Brut mensuel temps plein (€)").fill("2500");
  await he0.getByLabel("Quotité (%)").fill("50");
  await he0.getByLabel("Taux de charges (%)").fill("20");
  await he0.getByLabel("Effectif").selectOption("oui");
  await he0.getByLabel("Remplace (un seul poste)").selectOption({ label: "Départ 008" });
  await he0.getByRole("button").click();
  await expect(he0.getByRole("status")).toContainText("Remplaçant 008", slow);

  await tab("Enveloppes par rubrique").click();
  await page.getByTestId("env-ponctuels").getByText("Élément ponctuel (prime, régularisation…)").click();
  const form = (k: string) => page.getByTestId(`hyp-form-${k}`);
  await form("ponctuel").getByLabel("Libellé").fill("Primes de fin d'année");
  await form("ponctuel").getByLabel("Mois").fill("2026-12");
  await form("ponctuel").getByLabel("Saisie").selectOption("brut");
  await form("ponctuel").getByLabel("Brut (€)").fill("1000");
  await form("ponctuel").getByLabel("Taux de charges (%)").fill("30");
  await form("ponctuel").getByRole("button").click();
  await expect(form("ponctuel").getByRole("status")).toContainText("Primes de fin d'année", slow);

  // Une hypothèse incohérente est refusée avec sa raison (deux départs pour le même contrat) et rien n'est enregistré.
  await tab("Modifications de postes").click();
  await page.getByTestId("sal-search").getByLabel("Rechercher (nom, service)").fill("a-008");
  await page.getByTestId("sal-search").getByRole("button", { name: "Rechercher" }).click();
  await page.getByTestId("sal-table").getByRole("link").first().click();
  await page.getByTestId("sal-add").getByText(/^Départ \(/).click();
  const dep2 = page.getByTestId("sal-form-depart");
  await dep2.getByLabel("Libellé").fill("Doublon");
  await dep2.getByLabel("Dernier jour payé").fill("2026-12-10");
  await dep2.getByRole("button").click();
  await expect(dep2.getByRole("alert")).toContainText("deux départs pour le même contrat", slow);
  await tab("Contrôles des changements").click();
  await expect(page.getByTestId("hyp-hypotheses").locator("tbody tr")).toHaveCount(4);
  await page.screenshot({ path: `${CAPTURES}/5-01-hypotheses.png`, fullPage: true });

  // Projection. Novembre : base + 2 % = 21 205,80 € pour les 6 contrats restants, 008 payé 15/30 (688,50 €),
  // sortie 1 200,00 €, embauche 15/30 (750,00 €) → 23 844,30 €. Décembre : 21 205,80 + 1 500,00 + 1 300,00 = 24 005,80 €.
  await tab("Résultat").click();
  expect(await txt(row("2026-11"))).toBe("23 844,30 €");
  expect(await txt(row("2026-12"))).toBe("24 005,80 €");
  expect(await txt(page.getByTestId("proj-tile-landing").locator("dd"))).toBe("281 250,10 €");
  expect(await txt(page.getByTestId("proj-tile-headcount").locator("dd"))).toBe("7 personnes · 6,10 ETP");
  await page.screenshot({ path: `${CAPTURES}/5-02-projection.png`, fullPage: true });

  // Critère d'acceptation : clic sur un mois projeté → hypothèses qui le composent, la somme tombe juste.
  await page.getByTestId("proj-table").locator("tr[data-month='2026-11'] a").click();
  const d = page.getByTestId("proj-detail-hyps");
  const hypCost = (label: string) => d.locator(`tr[data-hyp="${label}"] td[data-col='cost']`);
  expect(await txt(hypCost("Base figée 2026-09"))).toBe("22 140,00 €");
  expect(await txt(hypCost("Augmentation toute l'entreprise 2026-11"))).toBe("442,80 €");
  expect(await txt(hypCost("Départ 008"))).toBe("-688,50 €");
  expect(await txt(hypCost("Départ 008 — coûts de sortie"))).toBe("1 200,00 €");
  expect(await txt(hypCost("Remplaçant 008"))).toBe("750,00 €");
  expect(await txt(page.getByTestId("proj-detail-total").locator("td[data-col='cost']"))).toBe("23 844,30 €");
  await page.getByTestId("proj-detail").screenshot({ path: `${CAPTURES}/5-03-detail-mois.png` });

  // Figer puis dupliquer : la copie est un brouillon indépendant avec les mêmes hypothèses.
  await page.getByTestId("hyp-freeze").getByRole("button").click();
  await expect(page.getByTestId("hyp-status")).toHaveText("Figé");
  await page.getByTestId("hyp-duplicate").getByLabel("Nom de la copie").fill("Variante sans prime");
  await page.getByTestId("hyp-duplicate").getByRole("button").click();
  await expect(page.getByTestId("hyp-status")).toHaveText("Brouillon");
  expect(await txt(row("2026-12"))).toBe("24 005,80 €");
  // Un brouillon ne peut pas servir de base au budget suivant (il pourrait encore changer).
  await expect(page.getByTestId("hyp-chain-frozen-only")).toBeVisible();
  await page.goto(hyp);
  await expect(page.getByTestId("hyp-scenarios").locator("tbody tr")).toHaveCount(2);

  // Salariés : on cherche un salarié, on lui crée un congé non payé (26 octobre → 25 novembre, 0 %) sur la copie (brouillon).
  await page.getByTestId("hyp-scenarios").getByRole("link", { name: "Variante sans prime" }).click();
  await tab("Modifications de postes").click();
  await page.getByTestId("sal-search").getByLabel("Rechercher (nom, service)").fill("a-001");
  await page.getByTestId("sal-search").getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByTestId("sal-table").locator("tbody tr")).toHaveCount(1);
  await page.getByTestId("sal-table").getByRole("link").first().click();
  await expect(page.getByTestId("sal-fiche")).toContainText("CDI");
  await page.getByTestId("sal-add").getByText("Congé non payé ou partiellement payé").click();
  const ab = page.getByTestId("sal-form-absence");
  await ab.getByLabel("Du", { exact: true }).fill("2026-10-26");
  await ab.getByLabel("Au (inclus)").fill("2026-11-25");
  await ab.getByLabel(/Part du salaire payée/).fill("0");
  await ab.getByRole("button").click();
  await expect(ab.getByRole("status")).toContainText("enregistrée", slow);
  await page.reload();
  // Octobre : payé 25/31 de 3 780,00 € = 3 048,39 € ; novembre : 275 400 € ×... (+2 %) payé 5/30 = 642,60 €.
  expect(await txt(page.getByTestId("sal-months").locator("tr[data-month='2026-10'] td[data-col='cost']"))).toBe("3 048,39 €");
  expect(await txt(page.getByTestId("sal-months").locator("tr[data-month='2026-11'] td[data-col='cost']"))).toBe("642,60 €");
  await page.screenshot({ path: `${CAPTURES}/5-06-salarie.png`, fullPage: true });

  // Lot 4 — saisie en masse : un départ (15 décembre, démission) et une augmentation de 3 % en décembre, depuis les tableaux.
  const bulk = page.getByTestId("sal-bulk");
  await bulk.getByText(/^Départs \(/).click();
  await bulk.locator("input[name='date_0']").fill("2026-12-15");
  await bulk.locator("input[name='motif_0']").fill("Démission");
  await page.getByTestId("sal-bulk-departs").getByRole("button").click();
  await expect(page.getByTestId("sal-bulk-departs").getByRole("status")).toContainText("1 hypothèse enregistrée", slow);
  await bulk.getByText(/^Augmentations \(/).click();
  await bulk.locator("input[name='from']").fill("2026-12");
  await bulk.locator("input[name='rate_1']").fill("3");
  await page.getByTestId("sal-bulk-raises").getByRole("button").click();
  await expect(page.getByTestId("sal-bulk-raises").getByRole("status")).toContainText("1 hypothèse enregistrée", slow);
  // Une ligne invalide (taux illisible) refuse le lot entier avec sa raison : rien n'est enregistré (tout ou rien).
  await bulk.locator("input[name='from']").fill("2026-12");
  await bulk.locator("input[name='rate_2']").fill("abc");
  await page.getByTestId("sal-bulk-raises").getByRole("button").click();
  await expect(page.getByTestId("sal-bulk-raises").getByRole("alert")).toContainText("taux en pourcentage requis", slow);

  // Lot 4 — embauches : deux stagiaires non comptés dans un centre de coûts, profil d'un salarié recopié (valeurs modifiables).
  await tab("Embauches prévisionnelles").click();
  if (!(await page.getByTestId("hyp-form-embauche").isVisible())) await page.getByText(/^Ajouter une embauche \(/).click();
  const he = form("embauche");
  await he.getByLabel("Recopier le profil d'un salarié (facultatif)").selectOption({ index: 1 });
  await expect(page.getByTestId("hire-copy-note")).toContainText("Profil de");
  await expect(he.getByLabel("Taux de charges (%)")).not.toHaveValue("");
  await he.getByLabel("Poste", { exact: true }).fill("Stagiaire tech");
  await he.getByLabel("Nombre de postes").fill("2");
  await he.getByLabel("Centre de coûts (service)").fill("TEST-SVC-C");
  await he.getByLabel("Catégorie").selectOption("stagiaire");
  await he.getByLabel("Motif d'embauche (facultatif)").fill("Stage");
  await he.getByLabel("Premier jour payé").fill("2026-11-02");
  await he.getByLabel("Brut mensuel temps plein (€)").fill("600");
  await he.getByLabel("Quotité (%)").fill("100");
  await he.getByLabel("Taux de charges (%)").fill("5");
  await he.getByLabel("Effectif").selectOption("non");
  await he.getByRole("button").click();
  await expect(he.getByRole("status")).toContainText("2 hypothèses enregistrées : « Stagiaire tech (1/2) » à « Stagiaire tech (2/2) »", slow);
  await page.reload();
  await expect(page.getByTestId("emb-table").locator("tr[data-hyp='Stagiaire tech (2/2)']")).toContainText("Stagiaire");
  await expect(page.getByTestId("emb-table").locator("tr[data-hyp='Stagiaire tech (2/2)']")).toContainText("Stage");
  await expect(page.getByTestId("emb-by-month").locator("tr[data-group='Stagiaire']")).toContainText("2");
  await page.screenshot({ path: `${CAPTURES}/5-07-embauches.png`, fullPage: true });

  // Lot 5 — enveloppe de service : TEST-SVC-A, novembre 1 000 € brut + 40 % = 1 400,00 € chargés.
  await tab("Enveloppes par service").click();
  const envS = page.getByTestId("env-service-form");
  await envS.locator("input[name='target_0']").fill("TEST-SVC-A");
  await envS.locator("select[name='mode_0']").selectOption("brut");
  await envS.locator("input[name='taux_0']").fill("40");
  await envS.locator("input[name='m_0_2026-11']").fill("1000");
  await envS.getByRole("button", { name: "Enregistrer les enveloppes" }).click();
  await expect(envS.getByRole("status")).toContainText("1 ligne écrite", slow);
  // Enveloppe de rubrique saisie en coût chargé : décembre 500,00 € ; « Reporter » annonce la plage reportée.
  await tab("Enveloppes par rubrique").click();
  const envR = page.getByTestId("env-rubrique-form");
  await envR.locator("input[name='m_0_2026-11']").fill("500");
  await envR.getByTestId("fill-r0").click();
  await expect(envR.locator("[data-fill-note]")).toContainText("reportée sur 1 mois");
  await expect(envR.locator("input[name='m_0_2026-12']")).toHaveValue("500");
  await envR.getByTestId("grid-reset").click();
  await expect(envR.locator("input[name='m_0_2026-12']")).toHaveValue("");
  await envR.locator("input[name='target_0']").fill("Primes variables");
  await envR.locator("input[name='m_0_2026-12']").fill("500");
  await envR.getByRole("button", { name: "Enregistrer les enveloppes" }).click();
  await expect(envR.getByRole("status")).toContainText("1 ligne écrite", slow);
  // Hypothèses globales : taux de 1 % en décembre pour toute l'entreprise ; constante de référence avec sa source.
  await tab("Hypothèses globales").click();
  await page.getByTestId("glob-rates-table").locator("input[name='rate|global|2026-12']").fill("1");
  await page.getByTestId("glob-rates-form").getByRole("button", { name: "Enregistrer les taux" }).click();
  await expect(page.getByTestId("glob-rates-form").getByRole("status")).toContainText("1 ligne écrite", slow);
  const gc = page.getByTestId("glob-consts-form");
  await gc.locator("input[name='label_0']").fill("Taux accident du travail");
  await gc.locator("select[name='unit_0']").selectOption("pct");
  await gc.locator("input[name='source_0']").fill("Notification CARSAT 2026");
  await gc.locator("input[name='m_0_2026-10']").fill("2,5");
  await gc.getByRole("button", { name: "Enregistrer les constantes" }).click();
  await expect(gc.getByRole("status")).toContainText("1 ligne écrite", slow);
  // Constante sans source : refusée.
  await gc.locator("input[name='label_1']").fill("Plafond mensuel SS");
  await gc.locator("input[name='m_1_2026-10']").fill("4005");
  await gc.getByRole("button", { name: "Enregistrer les constantes" }).click();
  await expect(gc.getByRole("alert")).toContainText("Plafond mensuel SS : source requise", slow);
  // Bases individuelles : correction de la base du premier contrat (2 500 € à 40 %).
  await tab("Bases individuelles").click();
  const bg = page.getByTestId("bases-grid");
  await bg.locator("input[name='salary_0']").fill("2500");
  await bg.locator("input[name='charges_0']").fill("40");
  await bg.getByRole("button", { name: "Enregistrer les bases corrigées" }).click();
  await expect(bg.getByRole("status")).toContainText("1 ligne écrite", slow);
  await page.reload();
  await expect(page.getByTestId("hyp-base-contracts").locator("tbody tr").first()).toContainText("corrigée");
  // Modifications de postes : changement de quotité à 50 % en décembre pour un salarié.
  await tab("Modifications de postes").click();
  await page.getByTestId("sal-search").getByLabel("Rechercher (nom, service)").fill("a-002");
  await page.getByTestId("sal-search").getByRole("button", { name: "Rechercher" }).click();
  await page.getByTestId("sal-table").getByRole("link").first().click();
  await page.getByTestId("sal-add").getByText(/^Changement de service ou de quotité/).click();
  const chg = page.getByTestId("sal-form-changement");
  await chg.getByLabel("À compter de (mois)").fill("2026-12");
  await chg.getByLabel("Nouvelle quotité (%, facultatif)").fill("50");
  await chg.getByRole("button").click();
  await expect(chg.getByRole("status")).toContainText("enregistrée", slow);
  await page.reload();
  await expect(page.getByTestId("sal-events")).toContainText("Changement de service / quotité");
  // Contrôles effectifs : égalité début + entrées − sorties = fin vérifiée chaque mois ; base concordante.
  await tab("Contrôles effectifs").click();
  for (const m of ["2026-10", "2026-11", "2026-12"]) await expect(page.getByTestId("ctrl-eff-table").locator(`tr[data-month='${m}'] td[data-col='controle']`)).toContainText("égalité vérifiée");
  await expect(page.getByTestId("ctrl-base-line")).toContainText("contrats comptés de la base");
  await page.screenshot({ path: `${CAPTURES}/5-09-controles-effectifs.png`, fullPage: true });
  // Contrôles des changements : coût attribué aux enveloppes.
  await tab("Contrôles des changements").click();
  expect(await txt(page.getByTestId("hyp-hypotheses").locator("tr[data-hyp='Enveloppe TEST-SVC-A'] td[data-col='effet']"))).toBe("+1 400,00 €");
  expect(await txt(page.getByTestId("hyp-hypotheses").locator("tr[data-hyp='Enveloppe Primes variables'] td[data-col='effet']"))).toBe("+500,00 €");
  await page.screenshot({ path: `${CAPTURES}/5-10-controles-changements.png`, fullPage: true });
  await page.goto(hyp);

  // Lot 2 — budget saisi 2026 : 24 000,00 € par mois sauf décembre non saisi (n.d.), puis complété.
  await page.getByTestId("hyp-budgets").getByText("Saisir un budget").click();
  const bf = page.getByTestId("budget-create");
  await bf.getByLabel("Nom").fill("Budget 2026");
  await bf.getByLabel("Année").fill("2026");
  for (const mm of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]) await bf.locator(`input[name='m${mm}']`).fill("24000");
  await bf.getByRole("button").click();
  await expect(bf.getByRole("status")).toContainText("Budget « Budget 2026 » enregistré", slow);
  await page.reload();
  await expect(page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] td[data-col='total']")).toContainText("n.d. — 1 mois non saisi");
  await page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] summary").click();
  const be = page.getByTestId("hyp-budgets-table").locator("form[data-testid^='budget-edit-']");
  await be.locator("input[name='m12']").fill("24000");
  await be.getByRole("button").click();
  await expect(be.getByRole("status")).toContainText("enregistré", slow);
  await page.reload();
  expect(await txt(page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] td[data-col='total']"))).toBe("288 000,00 €");

  // Comparaison du révisé figé : budget, réel courant et N-1 cochés par défaut.
  await page.getByTestId("hyp-scenarios").getByRole("link", { name: "Révisé T4 2026" }).click();
  await tab("Résultat").click();
  await page.getByTestId("res-tabs").getByRole("link", { name: "Comparaison" }).click();
  const cmp = (m: string, col: string) => page.getByTestId("cmp-table").locator(`tr[data-month='${m}'] td[data-col='${col}']`);
  await expect(page.getByTestId("cmp-table").locator("thead")).toContainText("Budget « Budget 2026 »");
  // Année : 281 250,10 € projetés contre 288 000,00 € de budget → −6 749,90 € ; janv.–sept. : 211 260,00 € contre 216 000,00 €.
  const tileB = page.locator("[data-testid^='cmp-tile-budget-']");
  await expect(tileB.locator("dd")).toContainText("-6 749,90 €");
  await expect(page.locator("[data-testid^='cmp-ytd-budget-']")).toContainText("-4 740,00 €");
  // N-1 : février 2025 = 18 230,00 € (module 4) ; réel courant : septembre 2026 lu, octobre non lu.
  expect(await txt(cmp("2026-02", "n1"))).toContain("18 230,00 €");
  expect(await txt(cmp("2026-09", "reel"))).toContain("24 600,00 €");
  expect(await txt(cmp("2026-10", "reel"))).toBe("n.d.");
  // Pont vs N-1 : volume + coût moyen = écart ; vs budget saisi : n.d. (pas d'ETP).
  const br = page.getByTestId("cmp-bridge");
  await expect(br.locator("tr[data-bridge^='budget-']")).toContainText("budget saisi sans ETP");
  const eur = (t: string) => Number(t.replace(/[^\d,-]/g, "").replace(",", "."));
  const [bd, bv, bc] = await Promise.all(["delta", "volume", "cout-moyen"].map((k) => txt(br.locator(`tr[data-bridge='n1'] td[data-col='${k}']`))));
  expect(Math.round((eur(bv) + eur(bc)) * 100)).toBe(Math.round(eur(bd) * 100));
  await page.screenshot({ path: `${CAPTURES}/5-04-comparaison.png`, fullPage: true });

  // Simulateur N+1 : budget 2027 dérivé de l'état de décembre 2026 du révisé (sans l'élément ponctuel de décembre) :
  // 21 205,80 € (6 contrats après 2 %) + 1 500,00 € (remplaçant à 50 %) = 22 705,80 € par mois.
  await page.getByTestId("hyp-scenario").getByText("Préparer le budget suivant (simulateur N+1)").click();
  const ch = page.getByTestId("hyp-chain");
  await ch.getByLabel("Nom").fill("Budget 2027");
  await ch.getByLabel("Type").selectOption("budget");
  await expect(ch.getByLabel("Dernier mois projeté")).toHaveValue("2027-12");
  await ch.getByRole("button").click();
  await expect(page.getByTestId("hyp-context")).toContainText("Base dérivée du scénario « Révisé T4 2026 »");
  expect(await txt(row("2027-01"))).toBe("22 705,80 €");
  expect(await txt(page.getByTestId("proj-tile-landing").locator("dd"))).toBe("272 469,60 €");
  expect(await txt(page.getByTestId("proj-tile-headcount").locator("dd"))).toBe("7 personnes · 6,10 ETP");
  await page.screenshot({ path: `${CAPTURES}/5-05-budget-n1.png`, fullPage: true });
  // Base dérivée : coût projeté de décembre 2026 par le révisé = base + primes de fin d'année (1 300,00 €, non reprises).
  await tab("Bases individuelles").click();
  await expect(page.getByTestId("hyp-base-masse")).toContainText("Coût projeté de décembre 2026 par « Révisé T4 2026 »");
  expect(await txt(page.getByTestId("hyp-base-masse").locator("dd"))).toBe("24 005,80 €");
  await expect(page.getByTestId("hyp-base-gap")).toContainText("éléments ponctuels de décembre 2026 1 300,00 €");
  await tab("Résultat").click();
  // Budget 2027 contre 2026 (réel janv.–sept. + projeté du révisé oct.–déc. = 281 250,10 €) : −8 780,50 €.
  await page.getByTestId("res-tabs").getByRole("link", { name: "Comparaison" }).click();
  await expect(page.getByTestId("cmp-tile-n1").locator("dd")).toContainText("-8 780,50 €");
  expect(await txt(cmp("2027-12", "n1"))).toContain("projeté — scénario « Révisé T4 2026 »");

  // Lot 4 — reprise des hypothèses d'un autre scénario : les départs de la variante (datés de 2026) sont hors de l'horizon
  // du budget 2027, ils ne sont pas repris et sont listés avec leur raison.
  await tab("Contrôles des changements").click();
  const imp = page.getByTestId("hyp-import-form");
  const source = await imp.locator("select[name='source'] option", { hasText: "Variante sans prime" }).getAttribute("value");
  await imp.getByLabel("Scénario source").selectOption(source!);
  await imp.getByLabel("Départs").check();
  await imp.getByRole("button").click();
  await expect(imp.getByRole("status")).toContainText("0 hypothèse reprise", slow);
  await expect(page.getByTestId("hyp-import-form-details")).toContainText("Non reprise — Départ 008");
  await page.screenshot({ path: `${CAPTURES}/5-08-reprise.png`, fullPage: true });

  // Taux par statut « cadre dirigeant » (indicateur PayFit) : les 6 contrats repris de la base dérivée sont tous « hors cadre
  // dirigeant » (fixture) ; le taux « cadres dirigeants » ne touche personne. Janvier 2027 : 3 % de 21 205,80 € = 636,17 €
  // (à quelques centimes d'arrondi par contrat près), jamais appliqué à l'embauche ; total 22 705,80 € + 636,17 €.
  await tab("Hypothèses globales").click();
  const gr = page.getByTestId("glob-rates-table");
  await expect(gr).toContainText("Cadres dirigeants");
  await expect(gr).toContainText("0 contrat");
  await expect(gr).toContainText("Hors cadres dirigeants");
  await expect(gr).toContainText("6 contrats");
  await gr.locator("input[name='rate|statut:autres|2027-01']").fill("3");
  await gr.locator("input[name='rate|statut:dirigeant|2027-01']").fill("5");
  await page.getByTestId("glob-rates-form").getByRole("button", { name: "Enregistrer les taux" }).click();
  await expect(page.getByTestId("glob-rates-form").getByRole("status")).toContainText("2 lignes écrites", slow);
  await page.screenshot({ path: `${CAPTURES}/5-11-taux-par-statut.png`, fullPage: true });
  await tab("Résultat").click();
  const jan = eur(await txt(row("2027-01")));
  expect(Math.abs(jan - (22705.8 + 636.17))).toBeLessThan(0.06);
});
