import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization } = await import("@/db/schema");
const sync = await import("@/lib/connectors/sync");
const { importFecFiles } = await import("@/lib/fec/import");
const { fixtureFecBytes, fixtureFecFilename } = await import("@/lib/fec/fixture");
const { ledgerTotals } = await import("@/lib/connectors/views");
const { readCrisisLines } = await import("@/lib/restructuring/crisis/store");
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
