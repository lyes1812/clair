import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization } = await import("@/db/schema");
const sync = await import("@/lib/connectors/sync");
const { importFecFiles } = await import("@/lib/fec/import");
const { fixtureFecBytes, fixtureFecFilename } = await import("@/lib/fec/fixture");
const { ledgerTotals } = await import("@/lib/connectors/views");
const { readCrisisLines, readSupplierLines, getCashPlan, updateCashPlan, CashPlanError } = await import("@/lib/restructuring/crisis/store");
const { withWorkspace } = await import("@/db/workspace-scope");
const { workspaceSetting, workspaceEvent } = await import("@/db/schema");
const { CASH_PLAN_KEY, emptyCashPlan } = await import("@/lib/restructuring/crisis/cashplan");
type CashFlow = import("@/lib/restructuring/crisis/cashplan").CashFlow;
const { buildCrisisPosition } = await import("@/lib/restructuring/crisis/model");

// FEC fictif (profil A, exercice clos le 30/09/2025) : salaires dus puis virés chaque mois depuis la banque, cotisations dues.
const run = Date.now();
const A = `test-crisis-a-${run}`;
const B = `test-crisis-b-${run}`;
const actor = null as unknown as string;
const options = { exerciseEnd: "2025-09" } as const;
const filename = fixtureFecFilename(options);
let syncId = "";

beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
  syncId = await importFecFiles(A, [{ filename, bytes: fixtureFecBytes(options) }], actor);
  await sync.applySync(A, syncId, actor);
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("Cap 13 : lecture des écritures de bilan d’un FEC appliqué", () => {
  it("ne lit que les comptes de trésorerie et de dette, jusqu’à la date d’arrêté", async () => {
    const lines = await readCrisisLines(A, syncId, filename, "2024-10-31");
    expect([...new Set(lines.map((l) => l.accountId))].sort()).toEqual(["421000", "431000", "512000"]);
    expect(lines.every((l) => l.date <= "2024-10-31")).toBe(true);
    expect(lines.length).toBeLessThan((await readCrisisLines(A, syncId, filename, "2025-09-30")).length);
  });
  it("cas de référence au 31/10/2024 : banque créditrice de 13 840,00 €, salaires soldés, cotisations dues = charges du mois", async () => {
    const position = buildCrisisPosition(await readCrisisLines(A, syncId, filename, "2024-10-31"), "2024-10-31", null);
    if (position.kind !== "value") throw new Error(position.reason);
    const debt = (id: string) => position.natures.find((n) => n.id === id)!.debt.cents;
    const charges = (await ledgerTotals(A, syncId, /^645100/)).find((t) => t.period === "2024-10")!.debitCents!;
    expect(charges).toBeGreaterThan(0);
    expect(debt("banks")).toBe(1_384_000);
    expect(debt("staff")).toBe(0);
    expect(debt("social")).toBe(charges);
    expect(position.cash.available.cents).toBe(0);
    expect(position.totalDebt.cents).toBe(1_384_000 + charges);
  });
  it("isolation : un autre espace ne lit rien, même avec l’identifiant de lecture", async () => {
    expect(await readCrisisLines(B, syncId, filename, "2025-09-30")).toEqual([]);
  });
  it("un autre nom de fichier ne renvoie rien", async () => {
    expect(await readCrisisLines(A, syncId, "autre.txt", "2025-09-30")).toEqual([]);
  });
});

describe("Cap 13 : plan de trésorerie enregistré par espace", () => {
  const flow = (id: string): CashFlow => ({ id, label: `Flux fictif ${id}`, category: "suppliers", direction: "out", amountCents: 12_345, date: "2026-03-10", recurrence: "once", until: null });
  it("un espace sans plan lit un plan vide, sans rien écrire", async () => {
    expect(await getCashPlan(A)).toEqual(emptyCashPlan());
    expect(await withWorkspace(A, (tx) => tx.select().from(workspaceSetting).where(sql`key = ${CASH_PLAN_KEY}`))).toHaveLength(0);
  });
  it("chaque modification incrémente la révision ; le journal ne contient ni libellé ni montant", async () => {
    await updateCashPlan(A, actor, (c) => ({ ...c, flows: [...c.flows, flow("f1")] }), "flow-added");
    const after = await updateCashPlan(A, actor, (c) => ({ ...c, start: { date: "2026-03-04", cents: -500 }, overdraftCents: 0 }), "start-changed");
    expect(after).toMatchObject({ revision: 2, start: { date: "2026-03-04", cents: -500 }, overdraftCents: 0 });
    expect((await getCashPlan(A)).flows.map((f) => f.id)).toEqual(["f1"]);
    const events = await withWorkspace(A, (tx) => tx.select({ detail: workspaceEvent.detail }).from(workspaceEvent).where(sql`detail->>'key' = ${CASH_PLAN_KEY}`));
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("Flux fictif");
    expect(JSON.stringify(events)).not.toContain("12345");
  });
  it("deux ajouts simultanés sont tous deux conservés", async () => {
    await Promise.all([
      updateCashPlan(A, actor, (c) => ({ ...c, flows: [...c.flows, flow("f2")] }), "flow-added"),
      updateCashPlan(A, actor, (c) => ({ ...c, flows: [...c.flows, flow("f3")] }), "flow-added"),
    ]);
    expect((await getCashPlan(A)).flows.map((f) => f.id).sort()).toEqual(["f1", "f2", "f3"]);
  });
  it("une modification invalide est refusée et n’enregistre rien", async () => {
    await expect(updateCashPlan(A, actor, (c) => ({ ...c, flows: [...c.flows, { ...flow("f4"), amountCents: -1 }] }), "flow-added")).rejects.toThrow(CashPlanError);
    await expect(updateCashPlan(A, actor, (c) => ({ ...c, flows: [...c.flows, flow("f1")] }), "flow-added")).rejects.toThrow(CashPlanError);
    expect((await getCashPlan(A)).flows).toHaveLength(3);
  });
  it("isolation : l’espace B ne voit pas le plan de A", async () => {
    expect(await getCashPlan(B)).toEqual(emptyCashPlan());
  });
  it("écritures fournisseurs : aucune dans ce FEC de paie ; lettrage lu à l’import pour les nouveaux dépôts", async () => {
    expect(await readSupplierLines(A, syncId, filename, "2025-09-30")).toEqual([]);
    const [record] = await withWorkspace(A, (tx) => tx.execute(sql`select data from source_record where sync_id = ${syncId} and collection = 'ledger_lines' limit 1`)).then((r) => r.rows as { data: Record<string, unknown> }[]);
    expect(Object.hasOwn(record.data, "lettering")).toBe(true);
    expect(Object.hasOwn(record.data, "pieceDate")).toBe(true);
  });
});
