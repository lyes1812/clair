import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization, sourceFile } = await import("@/db/schema");
const { withWorkspace } = await import("@/db/workspace-scope");
const sync = await import("@/lib/connectors/sync");
const { fecCoverage, importFecFiles, listFecFiles } = await import("@/lib/fec/import");
const { fixtureFecBytes, fixtureFecFilename } = await import("@/lib/fec/fixture");
const { ledgerTotals } = await import("@/lib/connectors/views");
type FecSyncSummary = import("@/lib/fec/import").FecSyncSummary;

const run = Date.now();
const A = `test-fec-a-${run}`;
const B = `test-fec-b-${run}`;
const actor = null as unknown as string;
const file = (o: Parameters<typeof fixtureFecBytes>[0], name = fixtureFecFilename(o)) => ({ filename: name, bytes: fixtureFecBytes(o) });

beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("import de fichiers FEC", () => {
  let first = "";

  it("dépôt d'un exercice : aperçu, exercice lu, fichier conservé chiffré", async () => {
    first = await importFecFiles(A, [file({ exerciseEnd: "2025-09" })], actor);
    const s = (await sync.getSync(A, first))!;
    expect(s.status).toBe("preview");
    const summary = s.summary as FecSyncSummary;
    expect(summary.exercises[0]).toMatchObject({ siren: "000000000", closingDate: "2025-09-30", firstDate: "2024-10-31", lastDate: "2025-09-30", balanced: true, replaces: [] });
    expect(summary.collections.find((c) => c.collection === "accounts")).toMatchObject({ count: 5 });
    const [stored] = await withWorkspace(A, (tx) => tx.select().from(sourceFile));
    expect(stored.kind).toBe("fec");
    expect(stored.sealedContent).not.toContain("JournalCode");
    expect(await fecCoverage(A)).toHaveLength(0);
    expect((await fecCoverage(A, first)).map((e) => e.pending)).toEqual([true]);
  });

  it("application : exercice en vigueur ; totaux par compte exacts (641100 octobre 2024 = 13 840,00 €)", async () => {
    await sync.applySync(A, first, actor);
    expect((await fecCoverage(A)).map((e) => [e.filename, e.pending])).toEqual([["000000000FEC20250930.txt", false]]);
    const totals = await ledgerTotals(A, first, /^(?:[67]|421|431|437)/);
    expect(totals.find((t) => t.period === "2024-10" && t.accountId === "641100")?.debitCents).toBe(1384000);
    expect(totals.some((t) => t.accountId === "512000")).toBe(false);
  });

  it("réimport du même fichier : reconnu à son empreinte, aucun doublon", async () => {
    const again = await importFecFiles(A, [file({ exerciseEnd: "2025-09" }, "copie.txt")], actor);
    expect((await sync.getSync(A, again))!.status).toBe("unchanged");
    expect(await listFecFiles(A)).toHaveLength(1);
  });

  it("second exercice, sans recouvrement : les deux sont en vigueur", async () => {
    const id = await importFecFiles(A, [file({ exerciseEnd: "2026-09" })], actor);
    await sync.applySync(A, id, actor);
    expect((await fecCoverage(A)).map((e) => e.firstDate)).toEqual(["2024-10-31", "2025-10-31"]);
  });

  it("FEC corrigé sur un exercice déjà appliqué : annoncé en aperçu, remplace l'ancien à l'application", async () => {
    const id = await importFecFiles(A, [file({ exerciseEnd: "2025-09", photograph: 2 }, "000000000FEC20250930-v2.txt")], actor);
    const s = (await sync.getSync(A, id))!;
    const ex = (s.summary as FecSyncSummary).exercises[0];
    expect(ex.siren).toBeNull();
    // Nom hors convention : SIREN n.d., donc pas de recouvrement détecté avec le SIREN 000000000.
    expect(ex.replaces).toEqual([]);
    await sync.discardSync(A, id, actor);
    const corrected = await importFecFiles(A, [{ filename: "000000000FEC20250930.txt", bytes: fixtureFecBytes({ exerciseEnd: "2025-09", photograph: 2 }) }], actor);
    const c = (await sync.getSync(A, corrected))!;
    expect((c.summary as FecSyncSummary).exercises[0].replaces.map((r) => r.filename)).toEqual(["000000000FEC20250930.txt"]);
    expect(c.warnings.join(" ")).toContain("remplacera");
    await sync.applySync(A, corrected, actor);
    expect((await sync.getSync(A, first))!.status).toBe("superseded");
    const inForce = await fecCoverage(A);
    expect(inForce).toHaveLength(2);
    expect(inForce.find((e) => e.firstDate === "2024-10-31")?.syncId).toBe(corrected);
  });

  it("fichier invalide : dépôt en échec, rien n'est conservé", async () => {
    const id = await importFecFiles(A, [{ filename: "pas-un-fec.txt", bytes: new TextEncoder().encode("a;b;c\n1;2;3\n") }], actor);
    const s = (await sync.getSync(A, id))!;
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("En-tête");
  });

  it("isolation : l'espace B ne voit rien de A", async () => {
    expect(await listFecFiles(B)).toHaveLength(0);
    expect(await fecCoverage(B)).toHaveLength(0);
  });
});
