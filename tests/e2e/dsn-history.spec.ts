import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { historyDsnText, HISTORY_CONTRACT } from "../fixtures/dsn-history";
import { CAPTURES, createWorkspaceAsAdmin, exactText, signUp } from "./helpers";

// Recette exclusivement fictive : aucune URL ou base héritée ne peut remplacer ces deux services locaux.
test.skip(process.env.E2E_BASE_URL !== "http://127.0.0.1:4187", "Recette réservée à l’application fictive locale sur le port 4187.");
let pool: Pool;
test.beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL ?? "invalid");
  if (process.env.E2E_BASE_URL !== "http://127.0.0.1:4187" || process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS !== "true"
    || db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "55487"
    || db.pathname !== "/clair_dsn_history_e2e" || db.username !== "clair_history_fixture_app" || db.password || db.search || db.hash) {
    throw new Error("Dedicated fictional app on port 4187 and database on port 55487 required");
  }
  pool = new Pool({ connectionString: db.toString(), max: 2 });
  expect((await pool.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  expect((await pool.query("select count(*)::int n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relrowsecurity and not c.relforcerowsecurity")).rows[0].n).toBe(0);
});
test.afterAll(async () => { await pool?.end(); });

const months = (from: string, to: string) => {
  const result: string[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((m = 1), y++) : m++) result.push(`${y}-${String(m).padStart(2, "0")}`);
  return result;
};
const allMonths = months("2023-01", "2026-10");
const file = (month: string) => ({ name: `DSN-FICTIVE-${month}-P${month.slice(2, 4)}V01.txt`, mimeType: "text/plain", buffer: Buffer.from(historyDsnText({ month,
  ...(month === "2023-07" ? { netSocial: { amount: "9999.99", startDate: "2023-07-01", endDate: "2023-07-31" } } : {}),
})) });

async function scoped<T>(workspaceId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("begin read only");
    await tx.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
    const value = await fn(tx);
    await tx.query("rollback");
    return value;
  } catch (error) { await tx.query("rollback"); throw error; }
  finally { tx.release(); }
}
async function reference(workspaceId: string, expected: string[]) {
  await scoped(workspaceId, async (tx) => {
    const declarations = await tx.query("select r.period,r.data->>'eligible' eligible from source_record r join source_sync s on s.id=r.sync_id where s.provider='dsn' and s.status='applied' and r.collection='declarations' order by r.period");
    expect(declarations.rows.map((r: { period: string }) => r.period)).toEqual(expected);
    expect(declarations.rows.every((r: { eligible: string }) => r.eligible === "true")).toBe(true);
    const identities = await tx.query("select count(distinct case when r.collection='people' then r.data->>'personId' end)::int persons,count(distinct case when r.collection='contracts' then r.data->>'contractId' end)::int contracts from source_record r join source_sync s on s.id=r.sync_id where s.provider='dsn' and s.status='applied'");
    expect(identities.rows[0]).toEqual({ persons: 1, contracts: 1 });
    const sums = await tx.query("select r.data->>'type' type,sum((r.data->>'amountCents')::bigint)::text cents from source_record r join source_sync s on s.id=r.sync_id where s.provider='dsn' and s.status='applied' and r.collection='remunerations' group by r.data->>'type' order by type");
    expect(sums.rows).toEqual([{ type: "001", cents: String(expected.length * 123456) }, { type: "027", cents: "999999" }]);
  });
}
async function apply(page: Page, slug: string, periods: string[], norms: string[]) {
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles(periods.map(file));
  await page.getByRole("button", { name: "Déposer et prévisualiser", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  for (const norm of norms) await expect(page.getByTestId("dsn-upload-files")).toContainText(norm);
  await expect(page.getByTestId("dsn-declarations").getByText("éligible", { exact: true })).toHaveCount(periods.length);
  await expect(page.getByTestId("dsn-declarations").getByText("non éligible", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Appliquer cette lecture", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
}
async function capture(page: Page, name: string) {
  await mkdir(CAPTURES, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}body::before{content:"RECETTE LOCALE — DONNÉES 100 % FICTIVES";display:block;position:relative;z-index:100;padding:12px;text-align:center;background:#edf3ff;color:#164a97;font:600 12px system-ui}' });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('[role="region"],.table-wrap').forEach((el) => { el.scrollLeft = 0; }); });
    await page.screenshot({ path: path.join(CAPTURES, `${name}-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) {
      const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth,
        containers: [...document.querySelectorAll('main section,main details,main [role="region"],main .table-wrap')].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, className: el.className, left: r.left, right: r.right, width: r.width }; }).filter((r) => r.right > window.innerWidth && r.width > 0) }));
      await writeFile(path.join(CAPTURES, `${name}-${width}-geometry.json`), JSON.stringify(geometry, null, 2));
    }
    expect.soft(overflow, `${name}, largeur ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function identities(page: Page, base: string, month: string) {
  await page.goto(`${base}?mois=${month}`);
  await expect(page.getByRole("combobox", { name: "Mois", exact: true })).toHaveValue(month);
  const row = page.getByTestId("collab-monthly-table").locator("tbody > tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(HISTORY_CONTRACT);
  await expect(row).toContainText("01/09/2022");
  return { person: await row.locator("a[href*='/collaborateurs/p/']").first().getAttribute("href"), contract: await row.locator("a[href*='/collaborateurs/c/']").first().getAttribute("href") };
}

test("DSN fictives depuis 2023 : deux dépôts, 46 mois additifs et brut 001 distinct du 027", async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [], external = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== "http://127.0.0.1:4187") { external.add(url.origin); await route.abort(); }
    else await route.continue();
  });
  const run = Date.now().toString(36);
  await signUp(page, { name: "Admin FICTIF Historique DSN", email: `dsn-history-fictif-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Entreprise FICTIVE Historique DSN ${run}`);
  const workspaceId = (await pool.query("select id from organization where slug=$1", [slug])).rows[0].id as string;
  const base = `/e/${slug}/studio-rh/collaborateurs`;

  await apply(page, slug, months("2023-01", "2024-12"), ["P23V01", "P24V01"]);
  await reference(workspaceId, months("2023-01", "2024-12"));
  const original = await identities(page, base, "2023-01");
  expect(original.person).toMatch(/\/p\/dsn%3A/);
  expect(original.contract).toMatch(/\/c\/dsn%3A/);
  await apply(page, slug, months("2025-01", "2026-10"), ["P25V01", "P26V01"]);
  await reference(workspaceId, allMonths);
  await page.goto(`/e/${slug}/donnees/dsn`);
  await expect(page.getByTestId("dsn-coverage").locator("tbody > tr")).toHaveCount(46);
  await expect(page.getByTestId("dsn-coverage").locator("tbody > tr").filter({ hasText: "2023-01" })).toContainText("Complète");
  await expect(page.getByTestId("dsn-coverage").locator("tbody > tr").filter({ hasText: "2026-10" })).toContainText("Complète");
  await capture(page, "dsn-couverture-46-mois-fictive");

  expect(await identities(page, base, "2023-01")).toEqual(original);
  const options = await page.getByRole("combobox", { name: "Mois", exact: true }).locator("option").evaluateAll((rows) => rows.map((r) => (r as HTMLOptionElement).value));
  expect(options).toEqual(allMonths);
  await capture(page, "collaborateur-janvier2023-fictif");
  expect(await identities(page, base, "2026-10")).toEqual(original);
  await page.goto(original.contract!);
  await expect(page.getByTestId("collab-contract").getByRole("heading", { level: 2 })).toContainText(HISTORY_CONTRACT);
  await expect(page.getByTestId("source-badge-rh")).toContainText("DSN");

  await page.goto(`${base}/pointage?mois=2023-01`);
  const time = page.getByTestId("exploration-pointage-table").locator("tbody > tr");
  await expect(time).toHaveCount(1);
  await expect(time.locator('[data-col="paid"]')).toHaveText(/121[,.]33/);
  await expect(time.locator('[data-col="worked"]')).toContainText("n.d.");
  await expect(time.locator('[data-col="gap"]')).toContainText("n.d.");
  await time.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(time.locator("details")).toHaveAttribute("open", "");
  await capture(page, "pointage-janvier2023-fictif");

  for (const month of ["2023-01", "2023-07"]) {
    await page.goto(`${base}/rubrique?mois=${month}&rubrique=dsn%3A001`);
    await expect(page.getByTestId("exploration-rubrique-table").locator("tbody > tr")).toHaveCount(1);
    expect(await exactText(page.getByTestId("exploration-rubric-total"))).toBe("1 234,56 €");
  }
  await capture(page, "rubrique001-juillet2023-fictive");
  await page.goto(`${base}/rubrique?mois=2023-07&rubrique=dsn%3A027`);
  expect(await exactText(page.getByTestId("exploration-rubric-total"))).toBe("9 999,99 €");
  await page.goto(`/e/${slug}/studio-rh/masse-salariale?annee=2023&de=01&a=12`);
  expect(await exactText(page.getByTestId("ms-tile-brut").locator("dd"))).toBe("14 814,72 €");
  for (const month of ["2023-01", "2023-07"]) {
    const gross = page.getByTestId("ms-monthly-table").locator(`[data-month="${month}"] td[data-col="brut"]`);
    expect(await exactText(gross)).toBe("1 234,56 €");
  }
  await capture(page, "masse2023-brut001-fictif");
  await page.goto(`/e/${slug}/studio-rh/reporting-social?vue=rapport&mode=civil&annee=2023&fin=2023-12`);
  await expect(page.getByTestId("rs-payroll-table").locator("tbody > tr")).toHaveCount(12);
  for (const month of ["2023-01", "2023-07"]) {
    const rh = page.getByTestId("rs-rh-table").locator(`[data-month="${month}"]`);
    await expect(rh.locator("td").first()).toContainText("complet");
    await expect(rh.locator("td").nth(1)).toContainText(/^1(?:\s|\[|$)/);
    const gross = page.getByTestId("rs-payroll-table").locator(`[data-month="${month}"] td`).first();
    await expect(gross).toContainText("n.d.");
    await expect(gross.locator("[data-money-cents]")).toHaveCount(0);
  }
  await capture(page, "rapport2023-fictif");

  // Une norme inconnue reste un brouillon inéligible ; elle ne remplace aucun des 46 mois appliqués.
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles([{ name: "DSN-FICTIVE-NORME-INCONNUE.txt", mimeType: "text/plain", buffer: Buffer.from(historyDsnText({ month: "2023-01", norm: "P99V01", order: "2" })) }]);
  await page.getByRole("button", { name: "Déposer et prévisualiser", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  await expect(page.getByTestId("dsn-declarations")).toContainText("non éligible");
  await expect(page.getByTestId("dsn-declarations")).toContainText(/norme.*non prise en charge/i);
  await reference(workspaceId, allMonths);
  await capture(page, "norme-inconnue-brouillon-fictif");
  expect(external.size).toBe(0);
  expect(errors).toEqual([]);
});
