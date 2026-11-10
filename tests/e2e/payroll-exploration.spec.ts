import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, exactText, signUp } from "./helpers";

// Une application et une base exclusivement fictives. Aucun repli sur TEST, une URL héritée ou un connecteur réel.
test.skip(process.env.E2E_BASE_URL !== "http://127.0.0.1:4186", "Recette réservée à l'application locale fictive4186.");
let pool: Pool;
test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "invalid");
  if (process.env.E2E_BASE_URL !== "http://127.0.0.1:4186" || process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS !== "true"
    || db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "55486"
    || db.pathname !== "/clair_fixture_e2e" || db.username !== "clair_fixture_app" || db.password || db.search || db.hash) {
    throw new Error("Dedicated fictional app4186, fixture providers and database55486 required");
  }
  pool = new Pool({ connectionString: db.toString(), max: 2 });
  const role = await pool.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
});
test.afterAll(async () => { await pool?.end(); });

const SEP = "2026-09";
const ranks = (year: string, end = 9) => Array.from({ length: end }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
const readMonths = [...ranks("2025", 12), ...ranks("2026")];
const period = { annee: "2026", de: "01", a: "09" };

async function inWorkspace<T>(workspaceId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("begin");
    await tx.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
    const result = await fn(tx);
    await tx.query("rollback"); // Toutes les vérifications directes de base sont en lecture seule.
    return result;
  } catch (error) { await tx.query("rollback"); throw error; }
  finally { tx.release(); }
}

async function sourceReference(workspaceId: string) {
  return inWorkspace(workspaceId, async (tx) => {
    const syncs = await tx.query("select id from source_sync where provider='payfit' and status='applied' order by started_at desc");
    expect(syncs.rows).toHaveLength(1);
    const syncId = syncs.rows[0].id as string;
    const statuses = await tx.query("select period,data->>'status' as status from source_record where sync_id=$1 and collection='payroll_status' order by period", [syncId]);
    expect(statuses.rows.map((r: { period: string }) => r.period)).toEqual(readMonths);
    expect(statuses.rows.every((r: { status: string }) => r.status === "completed")).toBe(true);
    const sums = new Map<string, bigint>();
    for (const year of ["2025", "2026"]) {
      // Fixture A1 : les comptes641100/641300 forment le brut,645100 les cotisations. Provisions et contreparties exclus.
      const total = await tx.query("select sum(coalesce((data->>'debitCents')::bigint,0)-coalesce((data->>'creditCents')::bigint,0))::text cents,count(*) filter(where data->>'debitCents' is null and data->>'creditCents' is null)::int missing from source_record where sync_id=$1 and collection='ledger_lines' and period=any($2::text[]) and data->>'accountId'=any($3::text[])", [syncId, ranks(year), ["641100", "641300", "645100"]]);
      expect(total.rows[0].missing).toBe(0);
      sums.set(year, BigInt(total.rows[0].cents));
    }
    expect(sums.get("2026")).toBe(21_126_000n);
    expect(sums.get("2025")).toBe(17_387_000n);
    return sums;
  });
}

async function show(page: Page, base: string, mode: "organisation" | "reel", query: Record<string, string> = {}) {
  await page.goto(`${base}/${mode}?${new URLSearchParams({ ...period, ...query })}`);
  await expect(page.getByTestId("prevu")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByTestId("ms-tabs")).not.toContainText("Prévu");
}
async function amount(locator: Locator, cents: bigint) {
  await expect(locator.locator("[data-money-cents]").first()).toHaveAttribute("data-money-cents", cents.toString());
}
async function submit(page: Page) {
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await page.waitForLoadState("load");
}
async function unavailableTotal(page: Page, mode: "organisation" | "reel") {
  const empty = page.getByTestId("payroll-exploration-nd");
  if (await empty.count()) {
    await expect(empty).toBeVisible();
    await expect(page.getByTestId(mode === "organisation" ? "payroll-total-masse" : "payroll-gap-masse")).toHaveCount(0);
    return;
  }
  // Les mois lus restent consultables ; le cumul de toute la fenêtre demandée doit être n.d.
  for (const metric of ["brut", "cotisations", "masse"]) {
    const dd = page.getByTestId(`payroll-${mode === "organisation" ? "total" : "gap"}-${metric}`).locator("dd");
    await expect(dd).toContainText("n.d.");
    await expect(dd.locator("[data-money-cents]")).toHaveCount(0);
  }
}
async function capture(page: Page, name: string) {
  await mkdir(CAPTURES, { recursive: true });
  for (const width of [1440, 390, 340]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}body::before{content:"RECETTE LOCALE — DONNÉES 100 % FICTIVES";display:block;position:relative;z-index:100;padding:12px;text-align:center;background:#edf3ff;color:#164a97;font:600 12px system-ui}' });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('[role="region"]').forEach((el) => { el.scrollLeft = 0; }); });
    await page.screenshot({ path: path.join(CAPTURES, `${name}-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) {
      const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("main, main *")].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, className: el.className, left: r.left, right: r.right, width: r.width }; }).filter((r) => r.right > window.innerWidth && r.width > 0).slice(0, 35) }));
      await writeFile(path.join(CAPTURES, `${name}-${width}-geometry.json`), JSON.stringify(geometry, null, 2));
    }
    expect.soft(overflow, `${name}, largeur${width}`).toBe(false);
  }
  // Une seule flèche après les captures : son animation native ne doit pas modifier leur cadrage.
  const scrollable = page.getByRole("region").filter({ has: page.locator("table") }).first();
  if (await scrollable.count() && await scrollable.evaluate((el) => el.scrollWidth > el.clientWidth)) {
    await scrollable.evaluate((el) => { el.scrollLeft = 0; });
    await scrollable.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollable.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("Masse fictive : organisation et écarts réels, clôture et provenance", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [], external = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== "http://127.0.0.1:4186") { external.add(url.origin); await route.abort(); }
    else await route.continue();
  });
  const run = Date.now().toString(36);
  await signUp(page, { name: "Admin FICTIF Masse", email: `masse-exploration-fictive-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Entreprise FICTIVE Masse ${run}`);
  const workspace = (await pool.query("select id from organization where slug=$1", [slug])).rows[0].id as string;
  const base = `/e/${slug}/studio-rh/masse-salariale`;

  await test.step("lecture PayFit fictive unique et preuve de clôture sur tous les mois", async () => {
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
    await sourceReference(workspace);
  });

  await test.step("organisation : axe explicite, conservation des totaux et détails de source", async () => {
    await page.goto(`${base}/organisation`);
    await expect(page.getByRole("combobox", { name: "Dernier mois", exact: true })).toHaveValue("09");
    await expect(page.getByTestId("payroll-choose-axis")).toBeVisible();
    await expect(page.getByTestId("payroll-total-masse")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Axe d’organisation", exact: true }).selectOption("Service");
    await submit(page);
    await expect(page).toHaveURL(/axe=Service/);
    const model = page.getByTestId("payroll-exploration-organisation");
    await amount(page.getByTestId("payroll-total-brut"), 16_077_000n);
    await amount(page.getByTestId("payroll-total-cotisations"), 5_049_000n);
    await amount(page.getByTestId("payroll-total-masse"), 21_126_000n);
    expect(await exactText(page.getByTestId("payroll-total-masse").locator("dd"))).toBe("211 260,00 €");
    const table = page.getByTestId("payroll-organisation-table").locator("table");
    const groupAmounts = [3_780_000n, 9_849_000n, 7_497_000n];
    await expect(table.locator("tbody > tr")).toHaveCount(3);
    for (const [i, code] of ["TEST-SVC-A", "TEST-SVC-B", "TEST-SVC-C"].entries()) {
      const row = table.locator("tbody > tr").filter({ hasText: code });
      await amount(row.locator("td").nth(2), groupAmounts[i]);
    }
    expect(groupAmounts.reduce((a, b) => a + b, 0n)).toBe(21_126_000n);
    await amount(table.locator("tfoot td").nth(2), 21_126_000n);
    await expect(page.getByTestId("payroll-organisation-monthly").locator("tbody > tr")).toHaveCount(9);
    await expect(page.getByTestId("payroll-organisation-chart")).toBeVisible();
    const vigilance = page.getByTestId("payroll-exploration-vigilance");
    await expect(vigilance).not.toHaveAttribute("open");
    await vigilance.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(vigilance).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(vigilance).not.toHaveAttribute("open");
    await expect(vigilance.locator(":scope > summary")).toBeFocused();
    await capture(page, "organisation-payfit-fictive");

    const group = page.getByTestId("payroll-organisation-group").filter({ hasText: "TEST-SVC-A" });
    await table.getByRole("link", { name: "Voir les comptes et contrats" }).first().click();
    await expect(group).toHaveAttribute("open", "");
    await group.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(group).not.toHaveAttribute("open");
    await page.keyboard.press("Space");
    await expect(group).toHaveAttribute("open", "");
    await expect(group.getByTestId("payroll-group-monthly").locator("tbody > tr")).toHaveCount(9);
    const accounts = group.locator("details").filter({ has: page.locator("summary", { hasText: /^Par compte comptable$/ }) });
    await accounts.locator(":scope > summary").focus();
    await page.keyboard.press("Space");
    await expect(accounts).toHaveAttribute("open", "");
    await expect(accounts.locator("tbody")).toContainText("641100");
    await expect(accounts.locator("tbody")).toContainText("645100");
    const contracts = group.locator("details").filter({ has: page.locator("summary", { hasText: /^Par contrat$/ }) });
    await contracts.locator(":scope > summary").click();
    await expect(contracts.locator("a[href*='/collaborateurs/p/']").first()).toHaveAttribute("href", /\/p\/payfit%3A/);
    const contractHref = await contracts.locator("a[href*='/collaborateurs/c/']").first().getAttribute("href");
    expect(contractHref).toMatch(/\/c\/payfit%3A/);
    const sources = group.locator("details.pye-source-lines");
    await sources.locator(":scope > summary").click();
    await expect(sources.getByRole("link", { name: "Lecture source" }).first()).toHaveAttribute("href", /\/donnees\/synchro\//);
    await sources.locator(":scope > summary").click();
    await capture(page, "organisation-details-fictifs");
    await page.goto(contractHref!);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId("source-badge-rh")).toContainText("PayFit — lecture appliquée");

    await show(page, base, "organisation", { axe: "Service" });
    const preferences = page.getByTestId("display-preferences");
    await preferences.locator(":scope > summary").click();
    await preferences.getByRole("button", { name: "k€", exact: true }).click();
    await amount(page.getByTestId("payroll-total-masse"), 21_126_000n);
    await expect(page.getByTestId("payroll-total-masse").locator("dd")).toContainText("211 k€");
    await preferences.getByRole("button", { name: "€", exact: true }).click();
    await page.keyboard.press("Escape");
    await model.getByRole("combobox", { name: "Affichage des résultats", exact: true }).selectOption({ label: "Tableau" });
    await page.waitForURL(/affichage=tableau/);
    await expect(page.getByTestId("payroll-organisation-chart")).toHaveCount(0);
    await amount(table.locator("tfoot td").nth(2), 21_126_000n);
  });

  await test.step("réel : périodes alignées, écarts positifs négatifs et nuls au centime", async () => {
    await page.goto(`${base}/reel`);
    await expect(page.getByRole("combobox", { name: "Dernier mois", exact: true })).toHaveValue("09");
    await amount(page.getByTestId("payroll-gap-brut"), 2_801_000n);
    await amount(page.getByTestId("payroll-gap-cotisations"), 938_000n);
    await amount(page.getByTestId("payroll-gap-masse"), 3_739_000n);
    expect(await exactText(page.getByTestId("payroll-gap-masse").locator("dd"))).toBe("+37 390,00 €");
    await expect(page.getByTestId("payroll-gap-periods")).toContainText("Janvier 2026 → Septembre 2026");
    await expect(page.getByTestId("payroll-gap-periods")).toContainText("Janvier 2025 → Septembre 2025");
    const monthly = page.getByTestId("payroll-gap-monthly");
    await expect(monthly.locator("tbody > tr")).toHaveCount(9);
    await expect(page.getByTestId("payroll-gap-chart")).toBeVisible();
    const contracts = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Écart par contrat$/ }) });
    await contracts.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(contracts).toHaveAttribute("open", "");
    for (const [key, a, b, delta] of [
      ["TEST-A-CONTRACT-003", 0n, 1_350_000n, -1_350_000n],
      ["TEST-A-CONTRACT-004", 3_549_000n, 0n, 3_549_000n],
      ["TEST-A-CONTRACT-006", 3_780_000n, 3_780_000n, 0n],
    ] as const) {
      const row = page.getByTestId("payroll-gap-contracts").locator("tbody > tr").filter({ hasText: key });
      await amount(row.locator('[data-col="a"]'), a);
      await amount(row.locator('[data-col="b"]'), b);
      await amount(row.locator('[data-col="delta"]'), delta);
      const text = await exactText(row.locator('[data-col="delta"]'));
      expect(text.startsWith(delta > 0n ? "+" : delta < 0n ? "−" : "0")).toBe(true);
      if (b === 0n) await expect(row.locator('[data-col="pct"]')).toContainText("n.d.");
    }
    const accounts = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Écart par compte comptable$/ }) });
    await accounts.locator(":scope > summary").click();
    await expect(page.getByTestId("payroll-gap-accounts")).toContainText("641100");
    const source = page.locator("details.pye-source-lines").first();
    await source.locator(":scope > summary").click();
    await expect(source.getByRole("link", { name: "Lecture source" }).first()).toHaveAttribute("href", /\/donnees\/synchro\//);
    await source.locator(":scope > summary").click();
    await capture(page, "reel-payfit-fictif");

    await page.getByRole("combobox", { name: "Période A · année", exact: true }).selectOption("2025");
    await page.getByRole("combobox", { name: "Référence B · année", exact: true }).selectOption("2026");
    await submit(page);
    await amount(page.getByTestId("payroll-gap-masse"), -3_739_000n);
    expect(await exactText(page.getByTestId("payroll-gap-masse").locator("dd"))).toBe("−37 390,00 €");
    await show(page, base, "reel", { reference: "2026" });
    await amount(page.getByTestId("payroll-gap-masse"), 0n);
    expect(await exactText(page.getByTestId("payroll-gap-masse").locator("dd"))).toBe("0,00 €");
  });

  await test.step("périodes explicites non couvertes : n.d. sans cumul partiel ni substitution", async () => {
    for (const mode of ["organisation", "reel"] as const) {
      await show(page, base, mode, { axe: "Service", a: "10" });
      await expect(page.getByRole("combobox", { name: "Dernier mois", exact: true })).toHaveValue("10");
      await unavailableTotal(page, mode);
      if (mode === "organisation") {
        const missing = page.getByTestId("payroll-organisation-monthly").locator('[data-month="2026-10"]');
        await expect(missing).toContainText("Mois hors de la lecture PayFit appliquée");
        await expect(missing.locator("[data-money-cents]")).toHaveCount(0);
      } else {
        const missing = page.getByTestId("payroll-gap-monthly").locator('[data-month="2026-10"]');
        await expect(missing.locator('[data-col="a"]')).toContainText("n.d.");
        await expect(missing.locator('[data-col="delta"]')).toContainText("n.d.");
        await expect(missing.locator('[data-col="delta"] [data-money-cents]')).toHaveCount(0);
      }
    }
    await show(page, base, "reel", { reference: "2024" });
    await expect(page.getByRole("combobox", { name: "Référence B · année", exact: true })).toHaveValue("2024");
    await unavailableTotal(page, "reel");
    await show(page, base, "organisation", { axe: "Service", de: "" });
    await expect(page.getByRole("combobox", { name: "Premier mois", exact: true })).toHaveValue("");
    await expect(page.getByTestId("payroll-exploration-nd")).toBeVisible();
  });

  await test.step("les écrans synthèse et suivi existants restent accessibles", async () => {
    await page.goto(`${base}?annee=2026&de=01&a=09`);
    await expect(page.getByTestId("ms-monthly-table")).toBeVisible();
    await expect(page.getByRole("link", { name: "Prévu", exact: true })).toHaveCount(0);
    await page.goto(`${base}/suivi?annee=2026&cloture=09`);
    await expect(page.getByTestId("suivi-budget")).toBeVisible();
    await expect(page.getByTestId("suivi-choose-reference")).toBeVisible();
  });

  await test.step("source DSN fictive choisie : aucun montant chargé PayFit réutilisé", async () => {
    await page.goto(`/e/${slug}/donnees/dsn`);
    await page.getByLabel(/Fichiers DSN/).setInputFiles([{ name: `DSN-FICTIVE-${SEP}.txt`, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes({ month: SEP })) }]);
    await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
    await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
    await page.goto(`/e/${slug}/donnees`);
    const choice = page.getByTestId("source-choice-rh");
    await choice.getByLabel("Règle").selectOption("files");
    await choice.getByRole("button", { name: "Appliquer", exact: true }).click();
    await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");
    for (const mode of ["organisation", "reel"] as const) {
      await show(page, base, mode, { axe: "Service" });
      await expect(page.getByTestId("payroll-exploration-nd")).toBeVisible();
      await expect(page.getByTestId(`payroll-exploration-${mode}`)).toContainText("Source : DSN");
      await expect(page.getByTestId(mode === "organisation" ? "payroll-total-masse" : "payroll-gap-masse")).toHaveCount(0);
      await capture(page, `${mode}-dsn-nd-fictif`);
    }
  });
  expect(external.size).toBe(0);
  expect(errors).toEqual([]);
});
