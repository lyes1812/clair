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
const { COMPANY_FEC_FILENAME, companyFecBytes, largeFecText } = await import("@/lib/fec/fixture-company");
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

describe("contrôles F01 à F09 à l'import (Cap 13, lot L1)", () => {
  it("FEC conforme : contrôles conservés avec l'exercice, constats non bloquants repris en avertissements", async () => {
    const id = await importFecFiles(B, [{ filename: COMPANY_FEC_FILENAME, bytes: companyFecBytes() }], actor);
    const s = (await sync.getSync(B, id))!;
    expect(s.status).toBe("preview");
    const ex = (s.summary as FecSyncSummary).exercises[0];
    expect(ex.controls!.checks.map((c) => [c.code, c.status])).toEqual([["F01", "ok"], ["F02", "ok"], ["F03", "ok"], ["F04", "ok"], ["F05", "ok"], ["F07", "ok"], ["F09", "ok"]]);
    expect(ex.controls!.bank512.at(-1)).toEqual(["2026-10-31", 1_500_000]);
    await sync.discardSync(B, id, actor);
  });

  it("FEC déséquilibré : refusé, rapport conservé, aucune ligne enregistrée", async () => {
    const bytes = companyFecBytes({ mutate: (rows) => { rows[5][11] = "1000,10"; return rows; } });
    const id = await importFecFiles(B, [{ filename: COMPANY_FEC_FILENAME, bytes }], actor);
    const s = (await sync.getSync(B, id))!;
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("Refusé par F03 (écriture déséquilibrée), F04 (total des débits différent du total des crédits)");
    const report = (s.summary as FecSyncSummary).blocked![0];
    expect(report.checks.find((c) => c.code === "F04")).toMatchObject({ status: "fail", gapCents: 10 });
    expect(await listFecFiles(B)).toHaveLength(0);
  });

  it("200 000 lignes : lues, contrôlées et enregistrées en aperçu en moins de 30 secondes", async () => {
    const t0 = Date.now();
    const id = await importFecFiles(B, [{ filename: "000000000FEC20261231.txt", bytes: new TextEncoder().encode(largeFecText(200_000)) }], actor);
    const ms = Date.now() - t0;
    const s = (await sync.getSync(B, id))!;
    expect(s.status).toBe("preview");
    expect((s.summary as FecSyncSummary).exercises[0].lines).toBe(200_000);
    console.info(`Import FEC 200 000 lignes : ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
    const t1 = Date.now();
    await sync.applySync(B, id, actor);
    console.info(`Application FEC 200 000 lignes : ${Date.now() - t1} ms`);
  }, 120_000);
});
