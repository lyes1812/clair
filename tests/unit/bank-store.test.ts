import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.CLAIR_SECRETS_KEY ??= Buffer.alloc(32, 3).toString("base64");

const { db, pool } = await import("@/db/client");
const { organization, sourceRecord, sourceSync } = await import("@/db/schema");
const sync = await import("@/lib/connectors/sync");
const { withWorkspace } = await import("@/db/workspace-scope");
const { importBankFiles } = await import("@/lib/bank/import");
const { readBankLedger } = await import("@/lib/bank/store");
const { bankStart } = await import("@/lib/bank/ledger");
const { fixtureCamt, fixtureCsv, fixtureIban, fixtureMonths } = await import("@/lib/bank/fixture");
type BankSyncSummary = import("@/lib/bank/import").BankSyncSummary;

const run = Date.now();
const A = `test-bank-a-${run}`;
const B = `test-bank-b-${run}`;
const actor = null as unknown as string;
const enc = (s: string) => new TextEncoder().encode(s);
const IBAN = fixtureIban();

// Six mois fictifs (janvier à juin 2026) en deux dépôts qui se chevauchent sur mars.
const all = fixtureMonths("2026-06", 6);
const firstPart = all.slice(0, 3); // janvier → mars
const secondPart = all.slice(2); // mars → juin
const opening = 5_000_000;
const openingOfMarch = opening + firstPart.slice(0, 2).flatMap((m) => m.movements).reduce((t, m) => t + m.amountCents, 0);
const total = (ms: typeof all) => ms.flatMap((m) => m.movements).reduce((t, m) => t + m.amountCents, 0);

let first = "";
let second = "";

beforeAll(async () => {
  await db.insert(organization).values([
    { id: A, name: "Espace A", slug: A, createdAt: new Date() },
    { id: B, name: "Espace B", slug: B, createdAt: new Date() },
  ]);
  first = await importBankFiles(A, [{ filename: "releve-t1.xml", bytes: enc(fixtureCamt(firstPart, opening, IBAN)) }], actor);
  await sync.applySync(A, first, actor);
  second = await importBankFiles(A, [{ filename: "releve-t2.xml", bytes: enc(fixtureCamt(secondPart, openingOfMarch, IBAN)) }], actor);
});
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${A}, ${B})`);
  await pool.end();
});

describe("import des relevés bancaires", () => {
  it("aperçu du second dépôt : chevauchement de mars reconnu, continuité au centime", async () => {
    const s = await sync.getSync(A, second);
    expect(s!.status).toBe("preview");
    const summary = s!.summary as BankSyncSummary;
    expect(summary.duplicates).toEqual({ known: secondPart[0].movements.length, inDeposit: 0 });
    expect(summary.statements).toHaveLength(4);
    expect(summary.statements.every((st) => st.continuity.kind === "ok")).toBe(true);
    expect(summary.statements[0].masked).toBe(`${IBAN.slice(0, 4)} … ${IBAN.slice(-4)}`);
    // L'aperçu montre le résultat de l'application, doublons écartés.
    const preview = await readBankLedger(A, second);
    expect(preview[0].movements).toHaveLength(all.flatMap((m) => m.movements).length);
  });

  it("après application : 0 doublon, six mois d'historique, solde de clôture de juin = ouverture + mouvements", async () => {
    await sync.applySync(A, second, actor);
    const ledger = await readBankLedger(A);
    expect(ledger).toHaveLength(1);
    const account = ledger[0];
    expect(account.movements).toHaveLength(all.flatMap((m) => m.movements).length);
    expect(account.duplicates).toBe(secondPart[0].movements.length);
    expect(account.historyOk).toBe(true);
    expect(account.gaps).toEqual([]);
    expect(account.lastClosing).toEqual({ date: "2026-06-30", cents: opening + total(all) });
    expect(account.movements.reduce((t, m) => t + m.amountCents, 0)).toBe(total(all));
    expect(bankStart(ledger)).toMatchObject({ kind: "value", date: "2026-06-30", cents: opening + total(all) });
  });

  it("un CSV du même compte (IBAN saisi) se raccroche au même compte, sans doublon", async () => {
    const id = await importBankFiles(A, [{ filename: "juin.csv", bytes: enc(fixtureCsv(all.slice(5), opening + total(all.slice(0, 5)))) }], actor, { csvIban: IBAN.replace(/(.{4})/g, "$1 ") });
    const summary = (await sync.getSync(A, id))!.summary as BankSyncSummary;
    expect(summary.files[0]).toMatchObject({ status: "read" });
    expect(summary.duplicates.known).toBe(all[5].movements.length);
    expect(summary.profiles[0].profile.order).toBe("reverse");
    const ledger = await readBankLedger(A, id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].movements).toHaveLength(all.flatMap((m) => m.movements).length);
    await sync.discardSync(A, id, actor);
  });

  it("même fichier redéposé : reconnu à son empreinte, rien à appliquer", async () => {
    const id = await importBankFiles(A, [{ filename: "copie.xml", bytes: enc(fixtureCamt(firstPart, opening, IBAN)) }], actor);
    const s = await sync.getSync(A, id);
    expect(s!.status).toBe("unchanged");
    expect((s!.summary as BankSyncSummary).files[0].status).toBe("duplicate");
  });

  it("fichier refusé : la raison est enregistrée, aucune donnée lue", async () => {
    const id = await importBankFiles(A, [{ filename: "x.csv", bytes: enc("Date;Libellé;Montant\n02/03/2026;X;1,00\n") }], actor);
    const s = await sync.getSync(A, id);
    expect(s!.status).toBe("failed");
    expect(s!.errorMessage).toMatch(/IBAN/);
    await expect(importBankFiles(A, [{ filename: "y.csv", bytes: enc("x") }], actor, { csvIban: "FR00 1234" })).rejects.toThrow(/IBAN saisi invalide/);
  });

  it("l'IBAN n'est jamais stocké en clair", async () => {
    const rows = await withWorkspace(A, (tx) => tx.select({ data: sourceRecord.data }).from(sourceRecord).where(sql`${sourceRecord.collection} like 'bank_%'`));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(JSON.stringify(r.data)).not.toContain(IBAN.slice(4, 20));
    const syncs = await withWorkspace(A, (tx) => tx.select({ summary: sourceSync.summary, warnings: sourceSync.warnings }).from(sourceSync).where(sql`${sourceSync.provider} = 'bank'`));
    for (const s of syncs) expect(JSON.stringify(s)).not.toContain(IBAN.slice(4, 20));
  });

  it("isolation : un autre espace ne voit ni relevé ni mouvement, et ne peut pas lire l'aperçu de A", async () => {
    expect(await readBankLedger(B)).toEqual([]);
    expect(await readBankLedger(B, second)).toEqual([]);
    expect(await sync.getSync(B, second)).toBeNull();
  });
});
