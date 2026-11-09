import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createWorkspaceAsAdmin, signUp } from "./helpers";

// Recette locale entièrement fictive. Aucun repli sur DATABASE_URL ni connecteur externe.
const fixtureUrl = process.env.E2E_FIXTURE_DATABASE_URL;
test.skip(!fixtureUrl, "E2E_FIXTURE_DATABASE_URL requise pour la recette locale fictive.");
let pool: Pool;
test.beforeAll(async () => {
  const url = new URL(fixtureUrl!);
  const app = new URL(process.env.E2E_BASE_URL ?? "invalid");
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55485"
    || url.pathname !== "/clair_fixture_e2e" || url.username !== "clair_fixture_app" || url.search || url.hash || url.password
    || app.origin !== "http://127.0.0.1:4185") throw new Error("Dedicated fictional local database and app required");
  pool = new Pool({ connectionString: fixtureUrl, max: 2 });
  const { rows } = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user");
  expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
});
test.afterAll(async () => { await pool?.end(); });

async function inWorkspace<T>(workspaceId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function seedSources(workspaceId: string, next = false) {
  return inWorkspace(workspaceId, async (client) => {
    const payfitId = randomUUID(), dsnId = randomUUID();
    const sync = async (id: string, provider: string, summary: unknown, date: string) => client.query(
      "insert into source_sync(id,workspace_id,provider,status,content_hash,started_at,decided_at,summary) values($1,$2,$3,'applied',$4,$5,$5,$6)",
      [id, workspaceId, provider, hash([provider, next, id]), date, summary]);
    const record = async (syncId: string, collection: string, key: string, data: unknown, period: string | null) => client.query(
      "insert into source_record(workspace_id,sync_id,collection,record_key,period,data,record_hash) values($1,$2,$3,$4,$5,$6,$7)",
      [workspaceId, syncId, collection, key, period, data, hash(data)]);
    if (!next) {
      await sync(dsnId, "dsn", {}, "2026-11-04T10:00:00Z");
      const declarationKey = "declaration-entierement-fictive";
      await record(dsnId, "declarations", declarationKey, { key: declarationKey, month: "2026-10", siret: "12345678900011", nature: "01", type: "01", fraction: "11", order: "1", eligible: true, blocking: [], contentHash: "declaration-fictive" }, "2026-10");
      await record(dsnId, "people", "personne-dsn-fictive", { declarationKey, personId: "personne-dsn-fictive", familyName: "Fictif-DSN", givenNames: "Alice" }, "2026-10");
      await record(dsnId, "contracts", "contrat-dsn-fictif", { declarationKey, contractId: "contrat-dsn-fictif", personId: "personne-dsn-fictive", startDate: "2025-01-01", endDate: null, nature: "01" }, "2026-10");
    }
    await sync(payfitId, "payfit", { collections: [{ collection: "collaborators", status: "read", count: 1 }, { collection: "contracts", status: "read", count: 1 }] }, next ? "2026-11-06T10:00:00Z" : "2026-11-05T10:00:00Z");
    await record(payfitId, "collaborators", "personne-payfit-fictive", { id: "personne-payfit-fictive", lastName: "Fictif", firstName: "Alice" }, null);
    await record(payfitId, "contracts", "contrat-payfit-fictif", { contractId: "contrat-payfit-fictif", collaboratorId: "personne-payfit-fictive", startDate: "2025-01-01", endDate: null, natureContratDsn: "02" }, null);
  });
}

async function link(page: Page, entity: "person" | "contract") {
  await page.getByText(entity === "person" ? "Lier deux personnes" : "Lier deux contrats", { exact: true }).click();
  const form = page.getByTestId(`rec-link-${entity}`);
  await expect(form.getByLabel("Ligne DSN")).toHaveValue("");
  await expect(form.getByLabel("Ligne PayFit")).toBeDisabled();
  const dsn = await form.getByLabel("Ligne DSN").locator("option[value]:not([value=''])").first().getAttribute("value");
  await form.getByLabel("Ligne DSN").selectOption(dsn!);
  await expect(form.getByLabel("Ligne PayFit")).toBeEnabled();
  await expect(form.getByLabel("Ligne PayFit")).toHaveValue("");
  const payfit = await form.getByLabel("Ligne PayFit").locator("option[value]:not([value=''])").first().getAttribute("value");
  await form.getByLabel("Ligne PayFit").selectOption(payfit!);
  await form.getByRole("button", { name: entity === "person" ? "Lier les personnes" : "Lier les contrats", exact: true }).click();
  await expect(page.getByTestId(`rec-${entity}-table`).locator("tbody > tr")).toHaveCount(1);
  await expect(page.getByTestId(`rec-${entity}-table`).getByText("Liée", { exact: true })).toBeVisible();
}

async function saveQualification(field: Locator, comment: string) {
  await field.getByText("Qualifier", { exact: true }).click();
  await field.getByLabel("Qualification").selectOption("explained");
  await field.getByLabel("Commentaire").fill(comment);
  await field.getByRole("button", { name: "Enregistrer la qualification" }).click();
  await expect(field.locator(".rec-field-resolution")).toContainText(comment);
}

async function captureFictionalReport(page: Page) {
  const dir = process.env.E2E_RECONCILIATION_CAPTURE_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  for (const width of [1440, 390, 340]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addStyleTag({ content: 'nextjs-portal { display:none!important; } body::before { content:"RECETTE LOCALE — DONNÉES 100 % FICTIVES"; display:block; position:relative; z-index:100; padding:12px; text-align:center; background:#edf3ff; color:#164a97; font:600 12px system-ui; }' });
    await page.getByRole("region", { name: "Correspondances des personnes", exact: true }).evaluate((element) => { element.scrollLeft = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(dir, `controle-fictif-${width}.png`), fullPage: true });
    if (width < 600) {
      const table = page.getByRole("region", { name: "Correspondances des personnes", exact: true });
      await table.scrollIntoViewIfNeeded();
      await table.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("Rapprochement fictif : décisions manuelles, historique, obsolescence et accès", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36), email = `rapprochement-${run}@test.invalid`;
  await signUp(page, { name: "Admin Rapprochement fictif", email });
  const { slug } = await createWorkspaceAsAdmin(page, `Entreprise Rapprochement fictive ${run}`);
  const workspace = (await pool.query("select id from organization where slug=$1", [slug])).rows[0].id as string;
  const actor = (await pool.query('select id from "user" where email=$1', [email])).rows[0].id as string;
  await seedSources(workspace);
  const base = `/e/${slug}/donnees/rapprochement`;
  await page.goto(base);
  await expect(page.getByTestId("rec-no-control")).toBeVisible();
  await expect(page.getByLabel("Mois DSN à contrôler")).toHaveValue("");
  await page.getByLabel("Mois DSN à contrôler").selectOption("2026-10");
  await page.getByTestId("rec-create").getByRole("button", { name: "Créer un nouveau contrôle" }).click();
  await page.waitForURL(/[?&]run=/);
  await page.waitForLoadState("load");
  const controlId = new URL(page.url()).searchParams.get("run")!;
  await expect(page.getByTestId("rec-person-table").locator("tbody > tr")).toHaveCount(2);
  await expect(page.getByTestId("rec-contract-table").locator("tbody > tr")).toHaveCount(2);
  await page.getByText("Lier deux contrats", { exact: true }).click();
  await expect(page.getByText("Lie d’abord les personnes correspondantes.", { exact: true })).toBeVisible();
  await page.getByText("Lier deux contrats", { exact: true }).click();
  await link(page, "person");
  await link(page, "contract");
  const nameField = page.getByTestId("rec-fields-person-0").locator('tr[data-field="familyName"]');
  await expect(nameField).toHaveAttribute("data-status", "different");
  const explanation = "Écart fictif vérifié avec les deux sources.";
  await saveQualification(nameField, explanation);
  await page.reload();
  await expect(nameField.locator(".rec-field-resolution")).toContainText(explanation);
  await expect(page.getByTestId("rec-journal").locator("tbody > tr")).toHaveCount(3);
  await expect(page.getByTestId("rec-journal").locator("tbody > tr td:nth-child(2)")).toHaveText(Array(3).fill("Admin Rapprochement fictif"));
  await expect(page.getByTestId("rec-journal")).not.toContainText(actor);
  await expect(page.getByTestId("rec-journal")).toContainText("Liaison de personnes");
  await expect(page.getByTestId("rec-journal")).toContainText("Liaison de contrats");
  await expect(page.getByTestId("rec-journal")).toContainText("Nom · écart expliqué");
  const vigilance = page.getByTestId("rec-vigilance");
  await expect(vigilance).not.toHaveAttribute("open");
  await vigilance.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(vigilance).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(vigilance).not.toHaveAttribute("open");
  await expect(vigilance.locator("summary")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await captureFictionalReport(page);
  const personRow = page.getByTestId("rec-row-person-0");
  await personRow.locator("summary").filter({ hasText: "Dissocier" }).click();
  const unlink = page.getByTestId("rec-unlink-person-0");
  await unlink.getByLabel("Commentaire").fill("Liaison fictive rouverte pour vérification.");
  await unlink.getByRole("button", { name: "Dissocier", exact: true }).click();
  await expect(page.getByTestId("rec-person-table").locator("tbody > tr")).toHaveCount(2);
  await expect(page.getByTestId("rec-contract-table").locator("tbody > tr")).toHaveCount(2);
  await expect(page.getByTestId("rec-fields-person-0")).toHaveCount(0);
  await expect(page.getByTestId("rec-fields-contract-0")).toHaveCount(0);
  await expect(page.getByTestId("rec-journal").locator("tbody > tr")).toHaveCount(4);
  await seedSources(workspace, true);
  await page.reload();
  await expect(page.getByTestId("rec-stale")).toBeVisible();
  await expect(page.getByText("Lier deux personnes", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="rec-unlink-"], [data-testid^="rec-resolve-field-"]')).toHaveCount(0);
  await expect(page.getByTestId("rec-journal").locator("tbody > tr")).toHaveCount(4);
  await page.getByLabel("Mois DSN à contrôler").selectOption("2026-10");
  await page.getByTestId("rec-create").getByRole("button", { name: "Créer un nouveau contrôle" }).click();
  await page.waitForURL((url) => !!url.searchParams.get("run") && url.searchParams.get("run") !== controlId);
  await expect(page.getByTestId("rec-stale")).toHaveCount(0);
  await expect(page.getByTestId("rec-person-table").locator("tbody > tr")).toHaveCount(2);
  await expect(page.getByTestId("rec-journal")).toHaveCount(0);
  const otherId = `fictif-autre-espace-${randomUUID()}`, otherSlug = `autre-rapprochement-fictif-${run}`;
  await pool.query("insert into organization(id,name,slug,created_at) values($1,$2,$3,now())", [otherId, "Autre espace fictif", otherSlug]);
  await pool.query('insert into member(id,organization_id,user_id,role,created_at) values($1,$2,$3,\'admin\',now())', [randomUUID(), otherId, actor]);
  await page.goto(`/e/${otherSlug}/donnees/rapprochement?run=${controlId}`);
  await expect(page.getByTestId("reconciliation-unavailable")).toBeVisible();
  await expect(page.getByTestId("rec-journal")).toHaveCount(0);
  await expect(page.getByText("Fictif-DSN", { exact: true })).toHaveCount(0);
  const readerContext = await browser.newContext();
  try {
    const reader = await readerContext.newPage(), readerEmail = `lecteur-rapprochement-${run}@test.invalid`;
    await signUp(reader, { name: "Lecteur Rapprochement fictif", email: readerEmail });
    const readerId = (await pool.query('select id from "user" where email=$1', [readerEmail])).rows[0].id as string;
    await pool.query('insert into member(id,organization_id,user_id,role,created_at) values($1,$2,$3,\'reader\',now())', [randomUUID(), workspace, readerId]);
    const response = await reader.goto(`${base}?run=${controlId}`);
    expect(response?.status()).toBe(404);
    await expect(reader.getByTestId("reconciliation")).toHaveCount(0);
    await expect(reader.getByText(explanation, { exact: true })).toHaveCount(0);
  } finally { await readerContext.close(); }
});
