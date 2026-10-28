import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), execute: vi.fn(), selected: [] as unknown[][], writes: [] as unknown[], order: [] as string[] }));
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: mocks.scope }));
import { ACTUAL_NON_RECURRING_KEY, actualEventVersion, listActualEvents, saveActualEvent } from "@/lib/payroll/non-recurring-store";
const event: ActualEvent = { id: "11111111-1111-4111-8111-111111111111", syncId: "22222222-2222-4222-8222-222222222222", month: "2026-06", kind: "tuilage", chargedCents: null, contractKeys: ["fictif-a", "fictif-b"], note: "SOURCE_PRIVEE_FICTIVE" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.selected = [[{ id: event.syncId }], []]; mocks.writes = []; mocks.order = [];
  mocks.execute.mockImplementation(async () => { mocks.order.push("lock"); });
  mocks.scope.mockImplementation(async (_workspace, callback) => {
    const tx = {
      execute: mocks.execute,
      select: () => {
        mocks.order.push("read"); const rows = mocks.selected.shift() ?? [];
        const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
        return chain;
      },
      insert: () => ({ values: (value: unknown) => {
        mocks.order.push("write"); mocks.writes.push(value);
        const chain = { onConflictDoUpdate: () => chain, then: (resolve: (r: unknown) => unknown) => Promise.resolve(undefined).then(resolve) }; return chain;
      } }),
    };
    return callback(tx);
  });
});
describe("Déclarations du réel : stockage isolé et journal minimal", () => {
  it("écrit sous verrou, avec l’espace, et journalise seulement opération et nombre", async () => {
    await saveActualEvent("espace-fictif", "acteur-fictif", event, null);
    expect(mocks.scope.mock.calls[0][0]).toBe("espace-fictif"); expect(mocks.order[0]).toBe("lock");
    expect(mocks.writes[0]).toMatchObject({ workspaceId: "espace-fictif", value: event, key: `${ACTUAL_NON_RECURRING_KEY}${event.id}` });
    const audit = mocks.writes[1] as { detail: unknown };
    expect(audit.detail).toEqual({ key: "rh.payroll.actualNonRecurring", operation: "created", count: 1 });
    expect(JSON.stringify(audit)).not.toContain(event.note); expect(JSON.stringify(audit)).not.toContain("fictif-a");
  });
  it("un formulaire périmé est refusé sous verrou avant écriture", async () => {
    mocks.selected = [[{ id: event.syncId }], [{ key: `${ACTUAL_NON_RECURRING_KEY}${event.id}`, value: { ...event, chargedCents: 1000 } }]];
    await expect(saveActualEvent("espace-fictif", "acteur-fictif", event, actualEventVersion(event))).rejects.toThrow("depuis l’affichage");
    expect(mocks.writes).toEqual([]);
  });
  it("la mise à jour de la version affichée conserve l’identifiant", async () => {
    mocks.selected = [[{ id: event.syncId }], [{ key: `${ACTUAL_NON_RECURRING_KEY}${event.id}`, value: event }]];
    await saveActualEvent("espace-fictif", "acteur-fictif", { ...event, chargedCents: 0 }, actualEventVersion(event));
    expect(mocks.writes[0]).toMatchObject({ key: `${ACTUAL_NON_RECURRING_KEY}${event.id}`, value: { ...event, chargedCents: 0 } });
  });
  it("les binômes inversés ne créent pas deux coûts, y compris après changement de lecture", async () => {
    mocks.selected = [[{ id: event.syncId }], [{ key: `${ACTUAL_NON_RECURRING_KEY}ancien`, value: { ...event, id: "33333333-3333-4333-8333-333333333333", syncId: "44444444-4444-4444-8444-444444444444", contractKeys: [...event.contractKeys].reverse() } }]];
    await expect(saveActualEvent("espace-fictif", "acteur-fictif", event, null)).rejects.toThrow("existe déjà"); expect(mocks.writes).toEqual([]);
  });
  it("une lecture remplacée est refusée avant écriture", async () => {
    mocks.selected = [[{ id: "autre-lecture" }]];
    await expect(saveActualEvent("espace-fictif", "acteur-fictif", event, null)).rejects.toThrow("lecture PayFit a changé"); expect(mocks.writes).toEqual([]);
  });
  it("un payload illisible interdit le retraitement partiel", async () => {
    mocks.selected = [[{ value: { ...event, chargedCents: -1 } }]];
    await expect(listActualEvents("espace-fictif")).rejects.toThrow("illisible");
  });
});
