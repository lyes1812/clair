import { expect, test, type Locator } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp, exactText } from "./helpers";

// Écart budgétaire et analyse des écarts sur le journal PayFit fictif (profil A, photographie 1 ; aucune donnée réelle).
// Deux scénarios de la même base : « Base T4 » (aucune hypothèse) et « Variante T4 » (prime de décembre 1 000 € brut + 30 %
// et embauche à 50 % de 2 500 € brut temps plein à 20 % le 16 novembre). Valeurs recalculées à la main (voir budget.test.ts).
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };
const txt = exactText;

test("Écart budgétaire et analyse des écarts : rubriques, détail par salarié, cascade ETP", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Admin Écart", email: `ecart-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Écart fictif ${run}`);
  const hyp = `/e/${slug}/studio-rh/hypotheses`;
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
  await page.goto(`/e/${slug}/parametres#projection`);
  await page.getByTestId("setting-projection-calendaire").check();
  await page.getByTestId("setting-projection-save").click();
  await expect(page.getByTestId("setting-projection").getByRole("status")).toContainText("Règle de prorata enregistrée", slow);

  // Scénario de base, puis variante dupliquée.
  await page.goto(hyp);
  const create = page.getByTestId("hyp-create-form");
  await create.getByLabel("Nom").fill("Base T4");
  await create.getByLabel("Type").selectOption("revise");
  await create.getByRole("button", { name: "Créer le scénario" }).click();
  await expect(page.getByTestId("hyp-context")).toContainText("Base figée sur septembre 2026");
  await page.getByTestId("hyp-duplicate").getByLabel("Nom de la copie").fill("Variante T4");
  await page.getByTestId("hyp-duplicate").getByRole("button").click();
  await expect(page.getByTestId("hyp-scenario")).toContainText("Variante T4");
  const tab = (name: string | RegExp) => page.getByTestId("hyp-tabs").getByRole("link", { name });
  await tab("Embauches prévisionnelles").click();
  const he = page.getByTestId("hyp-form-embauche");
  await he.getByLabel("Poste", { exact: true }).fill("Remplaçant");
  await he.getByLabel("Centre de coûts (service)").fill("TEST-SVC-C");
  await he.getByLabel("Catégorie").selectOption("cdi");
  await he.getByLabel("Premier jour payé").fill("2026-11-16");
  await he.getByLabel("Brut mensuel temps plein (€)").fill("2500");
  await he.getByLabel("Quotité (%)").fill("50");
  await he.getByLabel("Taux de charges (%)").fill("20");
  await he.getByLabel("Effectif").selectOption("oui");
  await he.getByRole("button", { name: "Ajouter l'embauche" }).click();
  await expect(he.getByRole("status")).toContainText("Remplaçant", slow);
  await tab("Enveloppes par rubrique").click();
  await page.getByTestId("env-ponctuels").getByText("Élément ponctuel (prime, régularisation…)").click();
  const po = page.getByTestId("hyp-form-ponctuel");
  await po.getByLabel("Libellé").fill("Primes de fin d'année");
  await po.getByLabel("Mois").fill("2026-12");
  await po.getByLabel("Saisie").selectOption("brut");
  await po.getByLabel("Brut (€)").fill("1000");
  await po.getByLabel("Taux de charges (%)").fill("30");
  await po.getByRole("button").click();
  await expect(po.getByRole("status")).toContainText("Primes de fin d'année", slow);

  // Écart budgétaire : version 1 = « Base T4 » 2026, version 2 = « Variante T4 » 2026, octobre à décembre.
  await page.goto(`/e/${slug}/studio-rh/masse-salariale`);
  await page.getByTestId("ms-tabs").getByRole("link", { name: "Écart budgétaire" }).click();
  const form = page.getByTestId("ecart-form");
  const pick = async (sel: string, text: string) => {
    const v = await form.locator(`${sel} option`, { hasText: text }).first().getAttribute("value");
    await form.locator(sel).selectOption(v!);
  };
  await pick("#v1", "« Base T4 »");
  await pick("#v2", "« Variante T4 »");
  await form.locator("#v3").selectOption("");
  await form.locator("#de").selectOption("10");
  await form.locator("#a").selectOption("12");
  await form.getByRole("button", { name: "Afficher" }).click();
  // Choix d'affichage en liste déroulante (lot d'ergonomie du 25/10) : même adresse qu'avant.
  await page.getByTestId("ecart-vues").locator("select").selectOption({ label: "Détail" });
  await page.waitForURL(/vue=detail/);
  const row = (k: string, col: string) => page.getByTestId("ecart-table").locator(`tr[data-row='${k}'] td[data-col='${col}']`);
  // Base : 3 × 22 140,00 € = 66 420,00 € ; variante : + prime 1 300,00 € + embauche 750,00 € (novembre) et 1 500,00 € (décembre).
  expect(await txt(row("masse", "v1"))).toBe("66 420,00 €");
  expect(await txt(row("masse", "v2"))).toBe("69 970,00 €");
  expect(await txt(row("masse", "g1"))).toBe("+3 550,00 €");
  expect(await txt(row("masse", "p1"))).toBe("+5,34 %"); // 355 000 ÷ 6 642 000 = 5,3449…
  expect(await txt(row("remun", "g1"))).toBe("+1 875,00 €"); // embauche : 625 + 1 250
  expect(await txt(row("primes", "g1"))).toBe("+1 000,00 €");
  expect(await txt(row("charges", "g1"))).toBe("+675,00 €"); // 125 + 250 + 300
  expect(await txt(row("indemnites", "g1"))).toBe("0,00 €");
  expect(await txt(row("autres", "g1"))).toBe("0,00 €");
  // ETP moyen : 6,10 → (6,10 + 6,60 + 6,60) ÷ 3 = 6,43 (+0,33) ; effectif fin décembre : 7 → 8 ; une entrée en novembre.
  expect(await txt(row("etp", "v1"))).toBe("6,10");
  expect(await txt(row("etp", "v2"))).toBe("6,43");
  expect(await txt(row("etp", "g1"))).toBe("+0,33");
  expect(await txt(row("headcount", "g1"))).toBe("+1");
  expect(await txt(row("entrees", "v2"))).toBe("1");
  // Total brut = somme des rubriques ; masse = brut + charges, au centime (lecture des valeurs affichées).
  const eur = (t: string) => Math.round(Number(t.replace(/[^\d,-]/g, "").replace(",", ".")) * 100);
  const [brut, remun, primes, indem, autres, charges, masse] = await Promise.all(["brut", "remun", "primes", "indemnites", "autres", "charges", "masse"].map(async (k) => eur(await txt(row(k, "v2")))));
  expect(brut).toBe(remun + primes + indem + autres);
  expect(masse).toBe(brut + charges);
  await page.screenshot({ path: `${CAPTURES}/6-01-ecart.png`, fullPage: true });

  // Détail par salarié de l'écart de masse : l'embauche (+2 250,00 €) et la prime sans salarié (+1 300,00 €) ; somme = écart.
  await row("masse", "g1").getByRole("link").click();
  await expect(page.getByTestId("zoom")).toBeVisible();
  await expect(page.getByTestId("zoom-table").locator("tbody tr")).toHaveCount(2);
  expect(await txt(page.getByTestId("zoom-table").locator("tr[data-person='Remplaçant (embauche)'] td[data-col='ecart']"))).toBe("+2 250,00 €");
  expect(await txt(page.getByTestId("zoom-table").locator("tbody tr").filter({ hasText: "Hors salarié" }).locator("td[data-col='ecart']"))).toBe("+1 300,00 €");
  await expect.poll(() => exactText(page.getByTestId("zoom-ok"))).toContain("rapproché de l'écart de la rubrique (+3 550,00 €)");
  expect(await txt(page.getByTestId("zoom-totals").locator("[data-col='total-all']"))).toBe("+3 550,00 €");
  await page.screenshot({ path: `${CAPTURES}/6-02-zoom.png`, fullPage: true });
  // Export CSV de l'écart : mêmes valeurs que l'écran.
  const csv = await page.request.get(`/e/${slug}/studio-rh/masse-salariale/ecart/export?${new URL(page.url()).searchParams.toString().replace(/&?zoom=[^&]*/, "")}&vue=detail`);
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body).toContain('"Masse salariale chargée";"66420,00";"69970,00";"3550,00";"5,34"');

  // Tendance financière : +3 550,00 € de masse salariale chargée est une hausse de coût (rouge, signe écrit) ; un ETP n'est jamais coloré.
  const back = new URL(page.url());
  for (const k of ["zoom", "zq", "nz", "zp"]) back.searchParams.delete(k);
  await page.goto(`${back.pathname}?${back.searchParams.toString()}`);
  const masseGap = page.locator("tr[data-row='masse'] td[data-col='g1']").first();
  await expect(masseGap).toHaveClass(/trend-bad/);
  await expect.poll(() => exactText(masseGap)).toContain("+3 550,00 €");
  await expect(page.locator("tr[data-row='etp'] td.trend-bad, tr[data-row='etp'] td.trend-good")).toHaveCount(0);

  // Analyse des écarts : cascade d'ETP, contributions de masse, pont volume / coût moyen.
  await page.goto(`/e/${slug}/studio-rh/masse-salariale/analyse`);
  const f2 = page.getByTestId("ecart-form");
  const pick2 = async (sel: string, text: string) => {
    const v = await f2.locator(`${sel} option`, { hasText: text }).first().getAttribute("value");
    await f2.locator(sel).selectOption(v!);
  };
  await pick2("#v1", "« Base T4 »");
  await pick2("#v2", "« Variante T4 »");
  await f2.locator("#de").selectOption("10");
  await f2.locator("#a").selectOption("12");
  await f2.getByRole("button", { name: "Afficher" }).click();
  const step = (t: string, id: string, col = "valeur") => page.getByTestId(t).locator(`tr[data-step='${id}'] td[data-col='${col}']`);
  // ETP : départ 6,10 ; entrée nouvelle (embauche présente novembre et décembre à 0,5) = 2 × 0,5 ÷ 3 = +0,33 ; arrivée 6,43 ; résiduel nul.
  expect(await txt(step("analyse-etp-table", "start"))).toBe("6,10");
  expect(await txt(step("analyse-etp-table", "entrees-new"))).toBe("+0,33");
  expect(await txt(step("analyse-etp-table", "sorties"))).toBe("0,00");
  expect(await txt(step("analyse-etp-table", "residual"))).toBe("0,00");
  expect(await txt(step("analyse-etp-table", "end"))).toBe("6,43");
  await expect(page.getByTestId("analyse-etp-who")).toContainText("Remplaçant (embauche)");
  // Masse : contributions par rubrique, résiduel nul.
  expect(await txt(step("analyse-masse-table", "remun"))).toBe("+1 875,00 €");
  expect(await txt(step("analyse-masse-table", "primes"))).toBe("+1 000,00 €");
  expect(await txt(step("analyse-masse-table", "charges"))).toBe("+675,00 €");
  expect(await txt(step("analyse-masse-table", "residual"))).toBe("0,00 €");
  expect(await txt(step("analyse-masse-table", "total"))).toBe("+3 550,00 €");
  expect(await txt(step("analyse-masse-table", "total", "pct"))).toBe("+5,34 %");
  // Pont : volume = (19,30 − 18,30) ÷ 18,30 × 66 420 € = 3 629,51 € ; coût moyen = 3 550,00 − 3 629,51 = −79,51 €.
  expect(await txt(page.getByTestId("pont-delta").locator("dd"))).toBe("+3 550,00 €");
  expect(await txt(page.getByTestId("pont-volume").locator("dd"))).toBe("+3 629,51 €");
  expect(await txt(page.getByTestId("pont-cout").locator("dd"))).toBe("−79,51 €");
  await page.screenshot({ path: `${CAPTURES}/6-03-analyse.png`, fullPage: true });

  // Entrées « Prévu » de Masse salariale (par organisation, écart réel, suivi réel / budget) : ouvertes, étiquetées, sans simulation.
  const ms = `/e/${slug}/studio-rh/masse-salariale`;
  for (const [vue, label, marker] of [["organisation", "MS par organisation", "Non réalisé"], ["reel", "Écart réel", "rubrique de bulletin"], ["suivi", "Suivi réel / budget", "Non réalisé"]] as const) {
    await page.goto(`${ms}/${vue}`);
    await expect(page.getByTestId("ms-tabs").getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("prevu")).toContainText(marker);
    await expect(page.getByTestId("prevu")).toContainText("Prévu");
  }
  await expect(page.getByTestId("ms-tabs").locator(".soon")).toHaveCount(3);
  await page.screenshot({ path: `${CAPTURES}/6-04-ms-prevu.png`, fullPage: true });
  expect((await page.request.get(`${ms}/inconnue`)).status()).toBe(404);
  // « Masse salariale croisée » n'est plus « Prévu » : sa page (chapitre 01 par défaut) s'ouvre sous le même onglet.
  await page.goto(`${ms}/croisee`);
  await expect(page.getByTestId("ms-tabs").getByRole("link", { name: "Masse salariale croisée" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("ms-tabs").getByRole("link", { name: "Masse salariale croisée" }).locator(".soon")).toHaveCount(0);
  await expect(page.getByTestId("cx-page")).toBeVisible();
  await expect(page.getByTestId("cx-chapter-head")).toContainText("01 / 10");
});
