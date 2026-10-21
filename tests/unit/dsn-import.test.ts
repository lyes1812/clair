import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization, sourceFile, sourceRecord } = await import("@/db/schema");
const { withWorkspace } = await import("@/db/workspace-scope");
const sync = await import("@/lib/connectors/sync");
const { dsnCoverage, importDsnFiles, listDsnFiles } = await import("@/lib/dsn/import");
const { fixtureDsnBytes } = await import("@/lib/dsn/fixture");
type DsnSyncSummary = import("@/lib/dsn/import").DsnSyncSummary;

const run = Date.now();
const A = `test-dsn-a-${run}`;
const B = `test-dsn-b-${run}`;
const actor = null as unknown as string;
const file = (name: string, o: Parameters<typeof fixtureDsnBytes>[0]) => ({ filename: name, bytes: fixtureDsnBytes(o) });

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

describe("import de fichiers DSN", () => {
  let first = "";

  it("dépôt de deux mois : aperçu avec déclarations éligibles, fichiers conservés chiffrés", async () => {
    first = await importDsnFiles(A, [file("2024-10.dsn", { month: "2024-10" }), file("2024-11.dsn", { month: "2024-11" })], actor);
    const s = (await sync.getSync(A, first))!;
    expect(s.status).toBe("preview");
    const summary = s.summary as DsnSyncSummary;
    expect(summary.files.map((f) => f.status)).toEqual(["read", "read"]);
    expect(summary.declarations.every((d) => d.eligible)).toBe(true);
    expect(summary.collections.find((c) => c.collection === "people")).toMatchObject({ count: 12 });
    const stored = await withWorkspace(A, (tx) => tx.select().from(sourceFile));
    expect(stored).toHaveLength(2);
    expect(stored.every((f) => !f.sealedContent.includes("S21.G00.30.001") && !/2990175\d{6}/.test(f.sealedContent))).toBe(true);
    // Aperçu : la couverture « après application » inclut ce dépôt ; la couverture réelle est encore vide.
    expect(await dsnCoverage(A)).toHaveLength(0);
    expect((await dsnCoverage(A, first)).map((c) => [c.month, c.status])).toEqual([["2024-10", "complete"], ["2024-11", "complete"]]);
  });

  it("application : couverture complète sur deux mois", async () => {
    await sync.applySync(A, first, actor);
    expect((await dsnCoverage(A)).map((c) => c.status)).toEqual(["complete", "complete"]);
  });

  it("réimport du même fichier : reconnu à son empreinte, aucun doublon", async () => {
    const again = await importDsnFiles(A, [file("copie.dsn", { month: "2024-10" })], actor);
    const s = (await sync.getSync(A, again))!;
    expect(s.status).toBe("unchanged");
    expect((s.summary as DsnSyncSummary).files[0]).toMatchObject({ status: "duplicate" });
    expect(await listDsnFiles(A)).toHaveLength(2);
    expect(await dsnCoverage(A)).toHaveLength(2);
  });

  it("annule et remplace (03, ordre 2) : fait foi après application, la normale est écartée", async () => {
    const id = await importDsnFiles(A, [file("2024-10-ar.dsn", { month: "2024-10", photograph: 2, type: "03", order: "2" })], actor);
    const before = (await dsnCoverage(A, id)).find((c) => c.month === "2024-10")!;
    expect(before.selected[0].type).toBe("03");
    expect(before.excluded[0].reason).toContain("remplacée");
    await sync.applySync(A, id, actor);
    const after = (await dsnCoverage(A)).find((c) => c.month === "2024-10")!;
    expect(after.status).toBe("complete");
    expect(after.selected.map((d) => d.type)).toEqual(["03"]);
    // Les dépôts précédents restent appliqués (lecture additive).
    expect((await sync.getSync(A, first))!.status).toBe("applied");
  });

  it("fraction 1/2 seule : couverture incomplète, signalée", async () => {
    const id = await importDsnFiles(A, [file("2024-12-f1.dsn", { month: "2024-12", fraction: "12" })], actor);
    await sync.applySync(A, id, actor);
    const dec = (await dsnCoverage(A)).find((c) => c.month === "2024-12")!;
    expect(dec.status).toBe("incomplete");
    expect(dec.messages.join(" ")).toContain("manque 2/2");
  });

  it("fichier invalide : dépôt en échec, rien n'est conservé", async () => {
    const id = await importDsnFiles(A, [{ filename: "mauvais.dsn", bytes: new TextEncoder().encode("ceci n'est pas une DSN\n") }], actor);
    const s = (await sync.getSync(A, id))!;
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("mauvais.dsn");
    expect(await listDsnFiles(A)).toHaveLength(4);
  });

  it("abandon d'un aperçu : enregistrements et fichier supprimés, nouveau dépôt possible", async () => {
    const id = await importDsnFiles(A, [file("2025-01.dsn", { month: "2025-01" })], actor);
    await sync.discardSync(A, id, actor);
    const [{ n }] = await withWorkspace(A, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(sourceRecord).where(sql`${sourceRecord.syncId} = ${id}`));
    expect(n).toBe(0);
    expect((await listDsnFiles(A)).some((f) => f.filename === "2025-01.dsn")).toBe(false);
    const retry = await importDsnFiles(A, [file("2025-01.dsn", { month: "2025-01" })], actor);
    expect((await sync.getSync(A, retry))!.status).toBe("preview");
  });

  it("isolation : l'espace B ne voit ni fichiers ni couverture de A, et ses identifiants diffèrent", async () => {
    expect(await listDsnFiles(B)).toHaveLength(0);
    expect(await dsnCoverage(B)).toHaveLength(0);
    const id = await importDsnFiles(B, [file("2024-10.dsn", { month: "2024-10" })], actor);
    expect((await sync.getSync(B, id))!.status).toBe("preview");
    const [a] = await withWorkspace(A, (tx) => tx.select({ data: sourceRecord.data }).from(sourceRecord).where(sql`${sourceRecord.collection} = 'people' and ${sourceRecord.data}->>'employeeNumber' = '001'`).limit(1));
    const [b] = await withWorkspace(B, (tx) => tx.select({ data: sourceRecord.data }).from(sourceRecord).where(sql`${sourceRecord.collection} = 'people' and ${sourceRecord.data}->>'employeeNumber' = '001'`).limit(1));
    expect(a.data.personId).not.toBe(b.data.personId);
  });
});
