import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization } = await import("@/db/schema");
const sync = await import("@/lib/connectors/sync");
const { importAgedFiles } = await import("@/lib/aged/import");
const { readAgedBalance } = await import("@/lib/aged/store");
const { AGED_AS_OF, agedCsv, agedXlsx } = await import("@/lib/aged/fixture");
type AgedSyncSummary = import("@/lib/aged/import").AgedSyncSummary;

// Lot L3 : dépôt de la balance âgée fictive (4 factures, 4 450,00 €), aperçu, application, remplacement, isolement des espaces.
const run = Date.now();
const A = `test-aged-a-${run}`;
const B = `test-aged-b-${run}`;
const actor = null as unknown as string;
const enc = (s: string) => new TextEncoder().encode(s);

let first = "";
beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
  first = await importAgedFiles(A, [{ filename: "balance-agee.csv", bytes: enc(agedCsv()) }], actor, { asOf: AGED_AS_OF });
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("dépôt de la balance âgée", () => {
  it("aperçu : 4 factures, total au centime, rien en vigueur avant application", async () => {
    const s = await sync.getSync(A, first);
    expect(s!.status).toBe("preview");
    const summary = s!.summary as AgedSyncSummary;
    expect(summary).toMatchObject({ asOf: AGED_AS_OF, invoiceCount: 4, totalCents: 445_000 });
    expect(await readAgedBalance(A)).toBeNull();
    const preview = await readAgedBalance(A, first);
    expect(preview).toMatchObject({ pending: true, asOf: AGED_AS_OF });
    expect(preview!.invoices.map((i) => i.amountCents)).toEqual([300_000, 70_000, 30_000, 45_000]);
  });

  it("date de la balance obligatoire", async () => {
    await expect(importAgedFiles(A, [{ filename: "b.csv", bytes: enc(agedCsv()) }], actor, { asOf: "" })).rejects.toThrow(/Date de la balance/);
  });

  it("application, même fichier redéposé : aucun doublon ; une nouvelle balance remplace la précédente", async () => {
    await sync.applySync(A, first, actor);
    expect((await readAgedBalance(A))!.syncId).toBe(first);
    const again = await importAgedFiles(A, [{ filename: "balance-agee.csv", bytes: enc(agedCsv()) }], actor, { asOf: AGED_AS_OF });
    expect((await sync.getSync(A, again))!.status).toBe("unchanged");
    const xlsx = await importAgedFiles(A, [{ filename: "balance-agee.xlsx", bytes: await agedXlsx() }], actor, { asOf: "2026-11-30" });
    expect((await sync.getSync(A, xlsx))!.summary).toMatchObject({ replaces: [first] });
    await sync.applySync(A, xlsx, actor);
    const now = await readAgedBalance(A);
    expect(now).toMatchObject({ syncId: xlsx, asOf: "2026-11-30", pending: false });
    expect(now!.invoices.reduce((t, i) => t + i.amountCents, 0)).toBe(445_000);
  });

  it("isolement : l'espace B ne voit rien de A", async () => {
    expect(await readAgedBalance(B)).toBeNull();
    expect(await readAgedBalance(B, first)).toBeNull();
  });
});
