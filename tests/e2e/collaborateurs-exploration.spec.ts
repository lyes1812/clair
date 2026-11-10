import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, exactText, signUp } from "./helpers";

// Recette exclusivement locale, transport PayFit et fichiers DSN génériques fictifs. Aucun accès possible à TEST.
test.skip(process.env.E2E_BASE_URL !== "http://127.0.0.1:4186", "Recette réservée à l'application locale fictive sur 127.0.0.1:4186.");
test.beforeAll(() => {
  const db = new URL(process.env.DATABASE_URL ?? "invalid");
  if (process.env.E2E_BASE_URL !== "http://127.0.0.1:4186" || process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS !== "true"
    || db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "55486"
    || db.pathname !== "/clair_fixture_e2e" || db.username !== "clair_fixture_app" || db.password || db.search || db.hash) {
    throw new Error("Dedicated fictional local app on 127.0.0.1:4186 and fixture database on port55486 required");
  }
});

type Mode = "tree" | "pivot" | "pointage" | "rubrique";
const SEP = "2026-09";
const span = () => Array.from({ length: 12 }, (_, i) => {
  const month = 2025 * 12 + 9 + i;
  return `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`;
});
const dsnFile = (month: string) => ({ name: `DSN-FICTIVE-${month}.txt`, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes({ month })) });

async function show(page: Page, base: string, mode: Mode, query: Record<string, string> = {}) {
  await page.goto(`${base}/${mode}?${new URLSearchParams({ mois: SEP, ...query })}`);
  await expect(page.getByTestId(`collab-exploration-${mode}`)).toBeVisible();
}
async function counts(page: Page, persons = 7, contracts = 7) {
  const values = page.getByTestId("exploration-counts").locator("dd");
  await expect(values.nth(0)).toHaveText(String(persons));
  await expect(values.nth(1)).toHaveText(String(contracts));
}
async function submit(page: Page) {
  await page.getByTestId("exploration-filters").getByRole("button", { name: "Afficher", exact: true }).click();
  await page.waitForLoadState("load");
}
async function capture(page: Page, name: string) {
  await mkdir(CAPTURES, { recursive: true });
  for (const width of [1440, 390, 340]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addStyleTag({ content: 'nextjs-portal { display:none!important; } body::before { content:"RECETTE LOCALE — DONNÉES 100 % FICTIVES"; display:block; position:relative; z-index:100; padding:12px; text-align:center; background:#edf3ff; color:#164a97; font:600 12px system-ui; }' });
    if (name.includes("pointage")) await page.getByRole("region", { name: "Pointage mensuel des collaborateurs", exact: true }).evaluate((el, absences) => {
      const cell = absences ? el.querySelector('[data-col="absences"]:has(details[open])') : null;
      if (cell) el.scrollLeft += cell.getBoundingClientRect().left - el.getBoundingClientRect().left - 1;
      else el.scrollLeft = 0;
    }, name.includes("absences"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(CAPTURES, `${name}-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) {
      const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll(".cxp, .cxp *")].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, className: el.className, left: r.left, right: r.right, width: r.width }; }).filter((r) => r.right > window.innerWidth && r.width > 0).slice(0, 35) }));
      await writeFile(path.join(CAPTURES, `${name}-${width}-geometry.json`), JSON.stringify(geometry, null, 2));
    }
    expect(overflow, `${name}, largeur ${width}`).toBe(false);
    if (width < 600 && name.includes("pointage")) {
      const table = page.getByRole("region", { name: "Pointage mensuel des collaborateurs", exact: true });
      await table.scrollIntoViewIfNeeded();
      await table.evaluate((el) => { el.scrollLeft = 0; });
      await table.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("Collaborateurs fictifs : arbre, pivot, pointage et rubriques PayFit puis DSN", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [], external = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== "http://127.0.0.1:4186") { external.add(url.origin); await route.abort(); }
    else await route.continue();
  });
  const run = Date.now().toString(36);
  await signUp(page, { name: "Admin FICTIF Collaborateurs", email: `exploration-fictive-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Entreprise FICTIVE Exploration ${run}`);
  const base = `/e/${slug}/studio-rh/collaborateurs`;

  await test.step("lecture PayFit fictive, une seule application de source", async () => {
    await page.goto(`/e/${slug}/donnees/payfit`);
    await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
    await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
    await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
    await page.getByLabel("Du mois").fill("2025-01");
    await page.getByLabel("Au mois").fill(SEP);
    await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
    await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");
  });

  await test.step("arbre documentaire, branches au clavier, recherche et fiches", async () => {
    await show(page, base, "tree");
    await counts(page);
    const vigilance = page.getByTestId("collab-read-details");
    await expect(vigilance).not.toHaveAttribute("open");
    await expect(vigilance).toContainText("sans historique d'affectation");
    await expect(page.getByTestId("exploration-vigilance")).toHaveCount(0);
    await vigilance.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(vigilance).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(vigilance).not.toHaveAttribute("open");
    await expect(vigilance.locator(":scope > summary")).toBeFocused();
    const branch = page.getByTestId("exploration-tree-node").first();
    await expect(branch).toHaveAttribute("open", "");
    await branch.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(branch).not.toHaveAttribute("open");
    await page.keyboard.press("Space");
    await expect(branch).toHaveAttribute("open", "");
    const leaf = branch.getByTestId("exploration-tree-node").first();
    await leaf.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(leaf).toHaveAttribute("open", "");
    const contract = leaf.locator("a.cxp-contract").first();
    await expect(contract).toHaveAttribute("href", /\/c\/payfit%3A/);
    await contract.click();
    await expect(page.getByTestId("collab-contract")).toBeVisible();
    await show(page, base, "tree", { q: "TEST-A-CONTRACT-001" });
    await counts(page, 1, 1);
    await page.getByLabel("Rechercher", { exact: true }).fill("aucun-resultat-fictif");
    await submit(page);
    await expect(page.getByTestId("exploration-empty")).toBeVisible();
    await counts(page, 0, 0);
    await show(page, base, "tree");
    await capture(page, "arbre-payfit-fictif");
  });

  await test.step("pivot, marges exactes, détail et inversion des axes", async () => {
    await show(page, base, "pivot", { mois: "2025-12" });
    await counts(page);
    const pivot = page.getByTestId("exploration-pivot-table");
    await expect(pivot.locator("tbody > tr")).toHaveCount(1); // équipe inconnue unique de la fixture.
    await expect(pivot.locator("thead")).toContainText("CDI");
    await expect(pivot.locator("thead")).toContainText("CDD");
    await expect(pivot.locator("tfoot td").last().locator("summary")).toHaveText("7");
    const detail = pivot.locator('tbody details:has(> summary[aria-label*=", CDI "])').first();
    await detail.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(detail).toHaveAttribute("open", "");
    await expect(detail.locator("a.cxp-contract")).toHaveCount(6);
    await page.getByTestId("exploration-swap").click();
    await page.waitForLoadState("load");
    await expect(page.getByRole("combobox", { name: "Lignes", exact: true })).toHaveValue("nature");
    await expect(page.getByRole("combobox", { name: "Colonnes", exact: true })).toHaveValue("team");
    await expect(pivot.locator("tbody > tr")).toHaveCount(2);
    await expect(pivot.locator("tfoot td").last().locator("summary")).toHaveText("7");
    await page.getByRole("combobox", { name: "Mesure", exact: true }).selectOption("contracts");
    await submit(page);
    await expect(page).toHaveURL(/mesure=contracts/);
    await expect(pivot.locator("tfoot td").last().locator("summary")).toHaveText("7");
    await capture(page, "pivot-payfit-fictif");
  });

  await test.step("pointage, zéros et manques restent distincts, source traçable", async () => {
    await show(page, base, "pointage", { mois: "2025-06" });
    const table = page.getByTestId("exploration-pointage-table");
    await expect(table.locator("tbody > tr")).toHaveCount(7);
    const zero = table.locator("tbody > tr").filter({ hasText: "TEST-A-CONTRACT-001" });
    for (const col of ["paid", "worked", "gap"]) await expect(zero.locator(`[data-col='${col}']`)).toHaveText("0");
    await show(page, base, "pointage", { mois: "2025-11" });
    const missing = table.locator("tbody > tr").filter({ hasText: "TEST-A-CONTRACT-005" });
    await expect(missing.locator("[data-col='paid']")).toContainText("n.d.");
    await expect(missing.locator("[data-col='worked']")).toHaveText("0");
    await expect(missing.locator("[data-col='gap']")).toContainText("n.d.");
    const maternity = table.locator("tbody > tr").filter({ hasText: "TEST-A-CONTRACT-002" });
    await expect(maternity.locator("[data-col='paid']")).toHaveText("128");
    await expect(maternity.locator("[data-col='worked']")).toHaveText("120");
    await expect(maternity.locator("[data-col='gap']")).toHaveText("-8");
    const absence = maternity.getByTestId("pointage-absence-details");
    await expect(absence.locator("summary")).toHaveText("1 événement remonté");
    await absence.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(absence).toHaveAttribute("open", "");
    const event = absence.getByTestId("pointage-absence-event");
    await expect(event).toContainText("test_maternity");
    await expect(event).toContainText("approuvée");
    await expect(event).toContainText("Début : 01/09/2025");
    await expect(event).toContainText("Fin : 15/12/2025");
    await expect(event).toContainText("début de journée");
    await expect(event).toContainText("fin de journée");
    await expect(absence.getByRole("link", { name: "Lecture des absences" })).toHaveAttribute("href", /\/donnees\/synchro\//);
    await capture(page, "pointage-payfit-absences-fictif");
    await show(page, base, "pointage");
    const first = table.locator("tbody > tr").filter({ hasText: "TEST-A-CONTRACT-001" });
    await expect(first.locator("[data-col='paid']")).toHaveText("160");
    await expect(first.locator("[data-col='worked']")).toHaveText("150");
    await expect(first.locator("[data-col='gap']")).toHaveText("-10");
    await expect(first.locator("[data-col='absences']")).toHaveText("0 événements remontés");
    await first.locator("summary").click();
    await expect(first).toContainText("paidWorkedTime");
    await expect(first).toContainText("effectiveWorkedTime");
    await capture(page, "pointage-payfit-fictif");
  });

  await test.step("rubrique comptable explicite, total primes exact et filtre individuel", async () => {
    await show(page, base, "rubrique");
    await expect(page.getByTestId("exploration-choose-rubric")).toBeVisible();
    await expect(page.getByTestId("exploration-rubrique-table")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Rubrique comptable", exact: true }).selectOption("primes");
    await submit(page);
    const table = page.getByTestId("exploration-rubrique-table");
    await expect(table.locator("tbody > tr")).toHaveCount(7);
    expect(await exactText(page.getByTestId("exploration-rubric-total"))).toBe("1 873,00 €"); // 10 % de 18 730 € de brut fictif.
    const source = table.locator("tbody > tr").first().locator("details");
    await source.locator("summary").click();
    await expect(source.getByRole("link", { name: "Lecture source" })).toHaveAttribute("href", /\/donnees\/synchro\//);
    await capture(page, "rubrique-payfit-fictif");
    await page.getByLabel("Rechercher", { exact: true }).fill("TEST-A-CONTRACT-001");
    await submit(page);
    await expect(table.locator("tbody > tr")).toHaveCount(1);
    expect(await exactText(page.getByTestId("exploration-rubric-total"))).toBe("300,00 €");
  });

  await test.step("périodes demandées invalides ou non couvertes fermées sans reprise", async () => {
    for (const mode of ["tree", "pivot", "pointage", "rubrique"] as const) {
      await show(page, base, mode, { mois: "2027-01", rubrique: "primes" });
      await expect(page.getByTestId("exploration-nd")).toBeVisible();
      await expect(page.locator(".cxp-contract")).toHaveCount(0);
    }
    for (const month of ["", "2026-13"]) {
      await show(page, base, "pivot", { mois: month });
      await expect(page.getByTestId("exploration-nd")).toBeVisible();
      await expect(page.getByTestId("exploration-pivot-table")).toHaveCount(0);
    }
  });

  await test.step("DSN fictives appliquées et source explicitement sélectionnée", async () => {
    await page.goto(`/e/${slug}/donnees/dsn`);
    await page.getByLabel(/Fichiers DSN/).setInputFiles(span().map(dsnFile));
    await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
    await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
    await page.goto(`/e/${slug}/donnees`);
    const choice = page.getByTestId("source-choice-rh");
    await choice.getByLabel("Règle").selectOption("files");
    await choice.getByRole("button", { name: "Appliquer", exact: true }).click();
    await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");
  });

  await test.step("quatre vues DSN : contrats déclarés, temps connus et type001 exact", async () => {
    for (const mode of ["tree", "pivot", "pointage"] as const) {
      await show(page, base, mode);
      await counts(page);
      await expect(page.getByTestId("source-badge-rh")).toContainText("Fichiers DSN");
      await expect(page.getByTestId("collab-read-details")).toContainText("Équipes non portées par la DSN");
      await expect(page.getByTestId("exploration-vigilance")).toHaveCount(0);
    }
    const table = page.getByTestId("exploration-pointage-table");
    const first = table.locator("tbody > tr").filter({ hasText: "TEST-A-CONTRACT-001" });
    await expect(first.locator("[data-col='paid']")).toHaveText("160");
    await expect(first.locator("[data-col='worked']")).toContainText("n.d.");
    await expect(first.locator("[data-col='gap']")).toContainText("n.d.");
    await expect(first.locator("[data-col='absences']")).toContainText("n.d.");
    await expect(first.locator("[data-col='absences']")).toContainText("Absences et arrêts non extraits de la DSN");
    await capture(page, "pointage-dsn-fictif");
    await show(page, base, "rubrique");
    await expect(page.getByTestId("exploration-choose-rubric")).toBeVisible();
    await page.getByRole("combobox", { name: "Type de rémunération DSN", exact: true }).selectOption("dsn:001");
    await submit(page);
    await expect(page.getByTestId("exploration-rubrique-table").locator("tbody > tr")).toHaveCount(7);
    expect(await exactText(page.getByTestId("exploration-rubric-total"))).toBe("18 730,00 €");
    await capture(page, "rubrique-dsn-fictif");
    await show(page, base, "pivot", { mois: "2025-09" });
    await expect(page.getByTestId("exploration-nd")).toBeVisible();
    await expect(page.getByTestId("exploration-pivot-table")).toHaveCount(0);
  });
  expect(external.size).toBe(0);
  expect(errors).toEqual([]);
});
