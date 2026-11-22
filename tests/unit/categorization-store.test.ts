import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization, sourceRecord, sourceSync, workspaceEvent } = await import("@/db/schema");
const { withWorkspace } = await import("@/db/workspace-scope");
const { getCategorization, personNames, updateCategorization } = await import("@/lib/bank/categorization-store");

// Lot L4 : saisies de catégories sous verrou, journal sans libellé ni montant, noms à pseudonymiser lus en base, isolement des espaces.
const run = Date.now();
const A = `test-cat-a-${run}`;
const B = `test-cat-b-${run}`;

beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
  await withWorkspace(A, async (tx) => {
    const [s] = await tx.insert(sourceSync).values({ workspaceId: A, provider: "dsn", status: "applied" }).returning({ id: sourceSync.id });
    await tx.insert(sourceRecord).values([
      { workspaceId: A, syncId: s.id, collection: "people", recordKey: "p1", data: { givenNames: "Camille", familyName: "Testard" }, recordHash: "h1" },
      { workspaceId: A, syncId: s.id, collection: "ledger_lines", recordKey: "l1", data: { accountId: "455000", auxiliaryLabel: "Dominique Exemplier" }, recordHash: "h2" },
      { workspaceId: A, syncId: s.id, collection: "ledger_lines", recordKey: "l2", data: { accountId: "401000", auxiliaryLabel: "GROSSISTE FICTIF" }, recordHash: "h3" },
    ]);
  });
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("catégorisation : stockage", () => {
  it("espace sans saisie : état vide", async () => {
    expect(await getCategorization(A)).toEqual({ decisions: {}, learned: {}, ai: {}, noAi: false });
  });

  it("deux saisies successives se cumulent ; l'autre espace ne voit rien ; le journal ne porte que des comptes", async () => {
    await updateCategorization(A, null, (c) => ({ ...c, decisions: { ...c.decisions, "fx-1": "suppliers" } }), "revue", { decisions: 1 });
    await updateCategorization(A, null, (c) => ({ ...c, learned: { ...c.learned, "GROSSISTE FICTIF": "suppliers" } }), "revue", { learned: 1 });
    expect(await getCategorization(A)).toMatchObject({ decisions: { "fx-1": "suppliers" }, learned: { "GROSSISTE FICTIF": "suppliers" } });
    expect((await getCategorization(B)).decisions).toEqual({});
    const events = await withWorkspace(A, (tx) => tx.select({ detail: workspaceEvent.detail }).from(workspaceEvent).where(and(eq(workspaceEvent.workspaceId, A), eq(workspaceEvent.kind, "bank.categorized"))));
    expect(events.map((e) => e.detail)).toEqual(expect.arrayContaining([{ operation: "revue", decisions: 1 }, { operation: "revue", learned: 1 }]));
    expect(JSON.stringify(events)).not.toContain("GROSSISTE");
  });

  it("une valeur invalide après modification est refusée et rien n'est remplacé", async () => {
    await expect(updateCategorization(A, null, (c) => ({ ...c, decisions: { "fx-2": "inconnue" as never } }), "revue")).rejects.toThrow(/invalides/);
    expect((await getCategorization(A)).decisions).toEqual({ "fx-1": "suppliers" });
  });

  it("noms à pseudonymiser : salariés et tiers 421/425/455, pas les fournisseurs ; rien pour l'autre espace", async () => {
    const names = await personNames(A);
    expect(names).toEqual(expect.arrayContaining(["Testard", "Camille Testard", "Testard Camille", "Dominique Exemplier"]));
    expect(names).not.toContain("GROSSISTE FICTIF");
    expect(await personNames(B)).toEqual([]);
  });
});
