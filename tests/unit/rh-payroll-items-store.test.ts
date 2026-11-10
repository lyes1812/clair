import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { CollabContext } from "@/lib/rh/view";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), coverage: vi.fn(), selected: [] as unknown[][], fields: [] as Record<string, unknown>[], conditions: [] as unknown[] }));
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: mocks.scope }));
vi.mock("@/lib/dsn/import", () => ({ dsnCoverageIn: mocks.coverage }));
import { loadDsnPayrollItems } from "@/lib/rh/payroll-items-store";

const M = "2026-10";
const pair = { sourceId: "sync-A", key: "declaration-A" };
function ctx(): CollabContext {
  return { chosen: "dsn", workspace: { id: "workspace-fixture" }, data: {
    build: { source: "dsn", inputs: { source: "dsn", coverage: [{ month: M, selected: [pair] }] } },
    persons: [], contracts: [], coverage: [{ month: M, presenceStatus: "complete" }],
  } } as unknown as CollabContext;
}
const sourceRow = { id: "row-fixture", syncId: "sync-A", declarationKey: "declaration-A", month: M,
  personId: "PRIVATE-PERSON-FINGERPRINT-FIXTURE", contractId: "PRIVATE-CONTRACT-FINGERPRINT-FIXTURE", type: "001", amountCents: "12345",
  paymentDate: "2026-11-02", startDate: "2026-10-01", endDate: "2026-10-31" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.fields = []; mocks.conditions = [];
  mocks.coverage.mockResolvedValue([{ month: M, status: "complete", selected: [pair] }]);
  mocks.selected = [[{ id: "sync-A", startedAt: new Date("2026-11-05T12:00:00Z") }], [sourceRow]];
  mocks.scope.mockImplementation(async (_workspace, callback) => {
    const tx = { select: (fields: Record<string, unknown>) => {
      mocks.fields.push(fields); const rows = mocks.selected.shift() ?? [];
      const chain = { from: () => chain, where: (condition: unknown) => { mocks.conditions.push(condition); return chain; }, orderBy: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    } };
    return callback(tx);
  });
});

describe("Rémunérations DSN : chargement minimal isolé", () => {
  it("utilise la transaction de l'espace en lecture seule et ne charge que les champs nécessaires", async () => {
    const result = await loadDsnPayrollItems(ctx(), M);
    expect(mocks.scope).toHaveBeenCalledWith("workspace-fixture", expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(result.rows[0]).toMatchObject({ attachment: "unlinked", personKey: null, contractKey: null, amount: { kind: "value", cents: 12345 } });
    expect(result.readAt).toBe("2026-11-05T12:00:00.000Z");
    expect(Object.keys(mocks.fields[1])).toEqual(["id", "syncId", "declarationKey", "month", "personId", "contractId", "type", "amountCents", "paymentDate", "startDate", "endDate"]);
    expect(mocks.fields[1]).not.toHaveProperty("data");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|declaration-A|personId|contractId|NIR|NTT/);
  });
  it("filtre SQL par couples exacts dépôt/déclaration et par mois et collection", async () => {
    const data = ctx(); const second = { sourceId: "sync-B", key: "declaration-B", filename: null };
    if (data.data?.build.inputs.source !== "dsn") throw new Error("Fixture DSN attendue");
    data.data.build.inputs.coverage[0].selected.push(second);
    mocks.coverage.mockResolvedValue([{ month: M, status: "complete", selected: [pair, second] }]);
    mocks.selected[0].push({ id: "sync-B", startedAt: new Date("2026-11-06T12:00:00Z") });
    await loadDsnPayrollItems(data, M);
    const query = new PgDialect().sqlToQuery(mocks.conditions[1] as SQL);
    expect(query.params).toEqual(["remunerations", M, "sync-A", "declaration-A", "sync-B", "declaration-B"]);
    expect(query.sql).toContain(" or ");
    expect(query.sql).toContain("declarationKey");
    const syncQuery = new PgDialect().sqlToQuery(mocks.conditions[0] as SQL);
    expect(syncQuery.params).toContain("dsn"); expect(syncQuery.params).toContain("applied");
  });
  it("ne lit pas les occurrences si le référentiel contient un établissement manquant", async () => {
    const data = ctx(); data.data!.coverage.push({ month: M, presenceStatus: "missing" } as never);
    expect(await loadDsnPayrollItems(data, M)).toMatchObject({ kind: "nd", coverage: { status: "incomplete" }, rows: [] });
    expect(mocks.fields).toEqual([]);
  });
  it.each(["incomplete", "blocked"])("la couverture source %s interdit une lecture partielle", async (status) => {
    mocks.coverage.mockResolvedValue([{ month: M, status, selected: [pair] }]);
    expect(await loadDsnPayrollItems(ctx(), M)).toMatchObject({ kind: "nd", rows: [], coverage: { status } });
    expect(mocks.fields).toEqual([]);
  });
  it("refuse une sélection changée et un dépôt qui n'est plus appliqué", async () => {
    mocks.coverage.mockResolvedValueOnce([{ month: M, status: "complete", selected: [{ ...pair, sourceId: "sync-B" }] }]);
    expect((await loadDsnPayrollItems(ctx(), M)).reason).toContain("a changé");
    expect(mocks.fields).toEqual([]);
    mocks.selected = [[]];
    expect((await loadDsnPayrollItems(ctx(), M)).reason).toContain("appliqué");
    expect(mocks.fields).toHaveLength(1);
  });
  it("un mois invalide ou une autre source RH n'ouvre aucune lecture DSN", async () => {
    expect((await loadDsnPayrollItems(ctx(), "2026-99")).kind).toBe("nd");
    const data = ctx(); data.chosen = "payfit";
    expect((await loadDsnPayrollItems(data, M)).kind).toBe("nd");
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("préserve les dépassements sous forme texte et nettoie les dates invalides", async () => {
    mocks.selected[1] = [{ ...sourceRow, amountCents: "9007199254740992", paymentDate: "2026-99-99" }];
    const result = await loadDsnPayrollItems(ctx(), M);
    expect(result.rows[0].amount.kind).toBe("nd"); expect(result.rows[0].paymentDate).toBeNull();
  });
  it("ne révèle pas une exception privée dans le résultat", async () => {
    mocks.coverage.mockRejectedValueOnce(new Error("PRIVATE-NAME-FIXTURE SQL CONTENT"));
    const result = await loadDsnPayrollItems(ctx(), M);
    expect(result.kind).toBe("nd"); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SQL/);
  });
});
