import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Menu général et ergonomie : chaque entrée du menu « Toutes les entrées » s'ouvre sans erreur (1280 px), la page ne déborde
// pas à l'horizontale sur mobile (390 px), les graphiques ont un seul arrêt de tabulation — sur le journal PayFit fictif
// (profil A, photographie 1 ; aucune donnée réelle).
const run = Date.now().toString(36);
const slow = { timeout: 30_000 };

test("Menu général : toutes les entrées s'ouvrent, pas de débordement mobile, graphiques au clavier", async ({ page }) => {
  test.setTimeout(900_000);
  await signUp(page, { name: "Admin Menu", email: `menu-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Menu fictif ${run}`);
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

  // Un scénario avec une augmentation et une embauche, puis sa copie : les écrans de résultat ont des données à tracer.
  await page.goto(`/e/${slug}/studio-rh/hypotheses`);
  const create = page.getByTestId("hyp-create-form");
  await create.getByLabel("Nom").fill("Base T4");
  await create.getByLabel("Type").selectOption("revise");
  await create.getByRole("button", { name: "Créer le scénario" }).click();
  await expect(page.getByTestId("hyp-context")).toContainText("Base figée sur septembre 2026");
  const tab = (name: string | RegExp) => page.getByTestId("hyp-tabs").getByRole("link", { name });
  await tab("Hypothèses globales").click();
  await page.getByTestId("glob-rates-table").locator("input[name='rate|global|2026-11']").fill("2");
  await page.getByTestId("glob-rates-form").getByRole("button", { name: "Enregistrer les taux" }).click();
  await expect(page.getByTestId("glob-rates-form").getByRole("status")).toContainText("1 ligne écrite", slow);
  await tab("Embauches prévisionnelles").click();
  if (!(await page.getByTestId("hyp-form-embauche").isVisible())) await page.getByText(/^Ajouter une embauche \(/).click();
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
  await page.getByTestId("hyp-duplicate").getByLabel("Nom de la copie").fill("Variante T4");
  await page.getByTestId("hyp-duplicate").getByRole("button").click();
  await expect(page.getByTestId("hyp-scenario")).toContainText("Variante T4");

  // Le menu : ouverture, fermeture à Échap, entrée courante.
  await page.goto(`/e/${slug}/studio-rh/masse-salariale/ecart`);
  const button = page.getByTestId("mega-button");
  const panel = page.getByTestId("mega-panel");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("link", { name: "Écart budgétaire", exact: true })).toHaveAttribute("aria-current", "page");
  for (const family of ["Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"]) await expect(panel.getByRole("heading", { name: family })).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/9-00-menu-general.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await button.click();
  const links = await panel.locator("a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href")!, text: (a.textContent ?? "").trim() })));
  const entries = [...new Map(links.map((l) => [l.href, l])).values()];
  expect(entries.length).toBeGreaterThanOrEqual(30);
  // Les entrées « Prévu » sont annoncées comme telles.
  expect(links.filter((l) => /Prévu$/.test(l.text)).length).toBeGreaterThanOrEqual(10);
  const extra = [`/e/${slug}/donnees`, `/e/${slug}/parametres`, `/e/${slug}/membres`].map((href) => ({ href, text: href.split("/").pop()! }));
  const all = [...entries, ...extra];
  const slugOf = (t: string, i: number) => `${String(i + 1).padStart(2, "0")}-${t.replace(/Prévu$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  // 1280 px : chaque entrée s'ouvre, a un titre, aucune page d'erreur ; les entrées d'hypothèses mènent à un scénario.
  const problems: string[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [i, e] of all.entries()) {
    const resp = await page.goto(e.href, { waitUntil: "networkidle" });
    const body = (await page.locator("body").innerText()).slice(0, 4000);
    if (!resp || resp.status() >= 400) problems.push(`${e.href} : statut ${resp?.status()}`);
    else if (/Application error|This page couldn.t load|Internal Server Error/i.test(body)) problems.push(`${e.href} : page d'erreur`);
    else if ((await page.locator("h1").count()) === 0) problems.push(`${e.href} : pas de titre`);
    if (e.href.includes("/hypotheses?vue=") && !page.url().includes("scenario=")) problems.push(`${e.href} : n'a pas ouvert un scénario`);
    await page.screenshot({ path: `${CAPTURES}/9-1280-${slugOf(e.text, i)}.png`, fullPage: true });
  }
  expect(problems).toEqual([]);

  // 390 px : aucune page ne déborde à l'horizontale (les tableaux défilent dans leur cadre).
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow: string[] = [];
  for (const [i, e] of all.entries()) {
    await page.goto(e.href, { waitUntil: "networkidle" });
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (w.sw > w.iw + 1) {
      // Éléments qui dépassent et ne sont pas dans une zone de défilement : le coupable à corriger.
      const culprits = await page.evaluate(() => {
        const iw = window.innerWidth;
        const inScroll = (el: Element) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") return true;
          }
          return false;
        };
        const out: string[] = [];
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > iw + 1 && !inScroll(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}[${el.getAttribute("data-testid") ?? ""}] ${Math.round(r.right)}`);
        }
        return out.slice(0, 6);
      });
      overflow.push(`${e.href} : largeur ${w.sw} > ${w.iw} ; ${culprits.join(" | ")}`);
    }
    await page.screenshot({ path: `${CAPTURES}/9-390-${slugOf(e.text, i)}.png`, fullPage: true });
  }
  expect(overflow).toEqual([]);

  // Synthèse du Studio RH : le titre du menu latéral y mène ; le menu déroulant « Fonctionnalités » ouvre les cinq familles.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/e/${slug}/donnees`);
  await page.getByTestId("main-menu").getByRole("link", { name: "Studio RH", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${slug}/studio-rh$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthèse du Studio RH");
  const drop = page.getByTestId("mega-button-page");
  await expect(drop).toHaveAttribute("aria-expanded", "false");
  await page.waitForLoadState("networkidle"); // menu interactif avant le clic (environnement déployé)
  await drop.click();
  const dropPanel = page.getByTestId("mega-panel-page");
  await expect(dropPanel).toBeVisible();
  for (const family of ["Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"]) await expect(dropPanel.getByRole("heading", { name: family })).toBeVisible();
  await expect(dropPanel.getByRole("link", { name: "Écart budgétaire", exact: true })).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/9-10-synthese-menu-deroulant.png` });
  await page.keyboard.press("Escape");
  await expect(dropPanel).toBeHidden();
  await expect(page.getByTestId("sy-tiles-rh")).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/9-11-synthese-studio-rh.png`, fullPage: true });

  // Glossaire : une page, toutes les définitions, recherche sans accent ni casse, ancres.
  await page.goto(`/e/${slug}/glossaire`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Glossaire");
  await expect(page.getByTestId("glossaire-def-turnover")).toBeAttached();
  const glossEntries = page.locator("[data-testid^='glossaire-def-']");
  const allEntries = await glossEntries.count();
  expect(allEntries).toBeGreaterThanOrEqual(40);
  await page.getByTestId("glossaire-recherche").getByRole("searchbox").fill("EFFECTIF MOYEN");
  await page.getByTestId("glossaire-recherche").getByRole("button").first().click();
  await expect(page.getByTestId("glossaire-def-headcount-average")).toBeVisible();
  expect(await glossEntries.count()).toBeLessThan(allEntries);
  await expect(page.getByTestId("glossaire-def-etp-contract")).toHaveCount(0);
  await page.goto(`/e/${slug}/glossaire?q=zzzzintrouvable`);
  await expect(page.getByTestId("glossaire-vide")).toBeVisible();
  await page.goto(`/e/${slug}/glossaire#def-etp-month-end`);
  await expect(page.locator("#def-etp-month-end")).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/9-12-glossaire.png`, fullPage: true });

  // Tendances financières : une hausse de coût est rouge (jamais sur un ETP), avec son signe écrit.
  await page.goto(`/e/${slug}/studio-rh/masse-salariale/ecart`);
  await expect(page.locator("tr[data-row='etp'] td.trend-bad, tr[data-row='etp'] td.trend-good")).toHaveCount(0);

  // Au clavier : un seul arrêt de tabulation par graphique, flèches entre les colonnes.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/e/${slug}/studio-rh/kpi?vue=effectifs`);
  const hits = page.getByTestId("em-chart").locator(".hit");
  expect(await hits.count()).toBeGreaterThanOrEqual(12);
  await expect(page.getByTestId("em-chart").locator(".hit[tabindex='0']")).toHaveCount(1);
  await hits.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(hits.nth(1)).toBeFocused();
  await expect(page.getByTestId("em-chart").locator(".chart-tip")).toBeVisible();
});
