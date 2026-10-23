import { expect, test, type Locator } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 5 (lot 1) : scénario sur le journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle).
// Valeurs recalculées à la main depuis ref/fixtures/clair-test-generic-v1.json (voir tests/unit/budget.test.ts).
const run = Date.now().toString(36);
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
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
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
  await expect(page.getByTestId("setting-projection").getByRole("status")).toContainText("Règle de prorata enregistrée");

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

  // Hypothèses : augmentation générale 2 % en novembre ; départ du contrat 008 le 15 novembre (sortie 1 000 € brut
  // à 20 %) remplacé le 16 par une embauche à 50 % de 2 500 € brut temps plein (charges 20 %) ; primes de décembre.
  await page.getByTestId("hyp-tabs").getByRole("link", { name: "Hypothèses" }).click();
  expect(await txt(page.getByTestId("hyp-base-total").locator("dd"))).toBe("22 140,00 €");
  expect(await txt(page.getByTestId("hyp-base-masse"))).toContain("hors base : 2 460,00 €");
  const form = (k: string) => page.getByTestId(`hyp-form-${k}`);
  await page.getByTestId("hyp-add").getByText("Augmentation", { exact: true }).click();
  await form("augmentation").getByLabel("Libellé").fill("Générale 2 %");
  await form("augmentation").getByLabel("Taux (%)").fill("2");
  await form("augmentation").getByLabel("À compter de (mois)").fill("2026-11");
  await form("augmentation").getByLabel("Périmètre").selectOption("global");
  await form("augmentation").getByRole("button").click();
  await expect(form("augmentation").getByRole("status")).toContainText("Générale 2 %");

  await page.getByTestId("hyp-add").getByText("Départ", { exact: true }).click();
  await form("depart").getByLabel("Libellé").fill("Départ 008");
  await form("depart").getByLabel("Contrat").selectOption("payfit:TEST-A-CONTRACT-008");
  await form("depart").getByLabel("Dernier jour payé").fill("2026-11-15");
  await form("depart").getByLabel("Saisie").selectOption("brut");
  await form("depart").getByLabel("Brut (€)").fill("1000");
  await form("depart").getByLabel("Taux de charges (%)").fill("20");
  await form("depart").getByRole("button").click();
  await expect(form("depart").getByRole("status")).toContainText("Départ 008");

  await page.getByTestId("hyp-add").getByText("Embauche", { exact: true }).click();
  await form("embauche").getByLabel("Poste").fill("Remplaçant 008");
  await form("embauche").getByLabel("Service").selectOption("TEST-SVC-C");
  await form("embauche").getByLabel("Premier jour payé").fill("2026-11-16");
  await form("embauche").getByLabel("Brut mensuel temps plein (€)").fill("2500");
  await form("embauche").getByLabel("Quotité (%)").fill("50");
  await form("embauche").getByLabel("Taux de charges (%)").fill("20");
  await form("embauche").getByLabel("Effectif").selectOption("oui");
  await form("embauche").getByLabel("Remplace").selectOption({ label: "Départ 008" });
  await form("embauche").getByRole("button").click();
  await expect(form("embauche").getByRole("status")).toContainText("Remplaçant 008");

  await page.getByTestId("hyp-add").getByText("Élément ponctuel (prime, régularisation…)").click();
  await form("ponctuel").getByLabel("Libellé").fill("Primes de fin d'année");
  await form("ponctuel").getByLabel("Mois").fill("2026-12");
  await form("ponctuel").getByLabel("Saisie").selectOption("brut");
  await form("ponctuel").getByLabel("Brut (€)").fill("1000");
  await form("ponctuel").getByLabel("Taux de charges (%)").fill("30");
  await form("ponctuel").getByRole("button").click();
  await expect(form("ponctuel").getByRole("status")).toContainText("Primes de fin d'année");

  // Une hypothèse incohérente est refusée avec sa raison (deux augmentations générales le même mois).
  await form("augmentation").getByLabel("Libellé").fill("Doublon");
  await form("augmentation").getByLabel("Taux (%)").fill("1");
  await form("augmentation").getByLabel("À compter de (mois)").fill("2026-11");
  await form("augmentation").getByLabel("Périmètre").selectOption("global");
  await form("augmentation").getByRole("button").click();
  await expect(form("augmentation").getByRole("alert")).toContainText("en conflit en 2026-11");
  await page.reload();
  await expect(page.getByTestId("hyp-hypotheses").locator("tbody tr")).toHaveCount(4);
  await page.screenshot({ path: `${CAPTURES}/5-01-hypotheses.png`, fullPage: true });

  // Projection. Novembre : base + 2 % = 21 205,80 € pour les 6 contrats restants, 008 payé 15/30 (688,50 €),
  // sortie 1 200,00 €, embauche 15/30 (750,00 €) → 23 844,30 €. Décembre : 21 205,80 + 1 500,00 + 1 300,00 = 24 005,80 €.
  await page.getByTestId("hyp-tabs").getByRole("link", { name: "Projection" }).click();
  expect(await txt(row("2026-11"))).toBe("23 844,30 €");
  expect(await txt(row("2026-12"))).toBe("24 005,80 €");
  expect(await txt(page.getByTestId("proj-tile-landing").locator("dd"))).toBe("281 250,10 €");
  expect(await txt(page.getByTestId("proj-tile-headcount").locator("dd"))).toBe("7 · 6,10 ETP");
  await page.screenshot({ path: `${CAPTURES}/5-02-projection.png`, fullPage: true });

  // Critère d'acceptation : clic sur un mois projeté → hypothèses qui le composent, la somme tombe juste.
  await page.getByTestId("proj-table").locator("tr[data-month='2026-11'] a").click();
  const d = page.getByTestId("proj-detail-hyps");
  const hypCost = (label: string) => d.locator(`tr[data-hyp='${label}'] td[data-col='cost']`);
  expect(await txt(hypCost("Base figée 2026-09"))).toBe("22 140,00 €");
  expect(await txt(hypCost("Générale 2 %"))).toBe("442,80 €");
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
  await page.goto(hyp);
  await expect(page.getByTestId("hyp-scenarios").locator("tbody tr")).toHaveCount(2);

  // Lot 2 — budget saisi 2026 : 24 000,00 € par mois sauf décembre non saisi (n.d.), puis complété.
  await page.getByTestId("hyp-budgets").getByText("Saisir un budget").click();
  const bf = page.getByTestId("budget-create");
  await bf.getByLabel("Nom").fill("Budget 2026");
  await bf.getByLabel("Année").fill("2026");
  for (const mm of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]) await bf.locator(`input[name='m${mm}']`).fill("24000");
  await bf.getByRole("button").click();
  await expect(bf.getByRole("status")).toContainText("Budget « Budget 2026 » enregistré");
  await page.reload();
  await expect(page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] td[data-col='total']")).toContainText("n.d. — 1 mois non saisi");
  await page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] summary").click();
  const be = page.getByTestId("hyp-budgets-table").locator("form[data-testid^='budget-edit-']");
  await be.locator("input[name='m12']").fill("24000");
  await be.getByRole("button").click();
  await expect(be.getByRole("status")).toContainText("enregistré");
  await page.reload();
  expect(await txt(page.getByTestId("hyp-budgets-table").locator("tr[data-budget='Budget 2026'] td[data-col='total']"))).toBe("288 000,00 €");

  // Comparaison du révisé figé : budget, réel courant et N-1 cochés par défaut.
  await page.getByTestId("hyp-scenarios").getByRole("link", { name: "Révisé T4 2026" }).click();
  await page.getByTestId("hyp-tabs").getByRole("link", { name: "Comparaison" }).click();
  const cmp = (m: string, col: string) => page.getByTestId("cmp-table").locator(`tr[data-month='${m}'] td[data-col='${col}']`);
  const budgetCol = (await page.getByTestId("cmp-table").locator("thead th").allTextContents()).findIndex((t) => t.includes("Budget « Budget 2026 »"));
  expect(budgetCol).toBeGreaterThan(0);
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
  expect(await txt(page.getByTestId("proj-tile-headcount").locator("dd"))).toBe("7 · 6,10 ETP");
  await page.screenshot({ path: `${CAPTURES}/5-05-budget-n1.png`, fullPage: true });
  // Budget 2027 contre 2026 (réel janv.–sept. + projeté du révisé oct.–déc. = 281 250,10 €) : −8 780,50 €.
  await page.getByTestId("hyp-tabs").getByRole("link", { name: "Comparaison" }).click();
  await expect(page.getByTestId("cmp-tile-n1").locator("dd")).toContainText("-8 780,50 €");
  expect(await txt(cmp("2027-12", "n1"))).toContain("projeté (parent)");
});
