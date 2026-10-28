import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), get: vi.fn(), model: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/budget/store", () => ({ listScenarios: mocks.list, getScenario: mocks.get, BudgetError: class BudgetError extends Error {} }));
vi.mock("@/lib/restructuring/model", () => ({ buildRestructuring: mocks.model }));
import { loadRestructuringContext } from "@/lib/restructuring/context";
import { BudgetError } from "@/lib/budget/store";
const REF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", PRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (id: string) => ({ scenario: { id, name: `Scénario fictif ${id.slice(0, 1)}`, firstMonth: "2026-10", lastMonth: "2026-12", status: "brouillon", conventions: { prorata: "calendaire" } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif", name: "Espace fictif", role: "reader" } });
  mocks.list.mockResolvedValue([row(REF), row(PRO)]);
  mocks.get.mockImplementation(async (_: string, id: string) => ({ ...row(id), base: { readAt: "2026-10-01" }, baseHash: "fictif", hypotheses: [] }));
  mocks.model.mockReturnValue({ kind: "nd" });
});
describe("Restructuring : accès d’abord, scénarios et espace explicitement choisis", () => {
  it("un non-membre n’entraîne aucune lecture métier", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(loadRestructuringContext("refuse", {})).rejects.toThrow("404");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("aucune présélection du scénario le plus récent", async () => {
    const ctx = await loadRestructuringContext("fictif", {});
    expect(ctx.reference).toBeNull(); expect(ctx.proposal).toBeNull();
    expect(ctx.canEdit).toBe(false); expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.model).toHaveBeenCalledWith(null, null);
  });
  it("les identifiants d’un autre espace ne déclenchent pas de lecture", async () => {
    const ctx = await loadRestructuringContext("fictif", { reference: "autre-espace", projet: "../secret", vue: "inconnue" });
    expect(mocks.get).not.toHaveBeenCalled(); expect(ctx.notices).toHaveLength(2); expect(ctx.view).toBe("overview");
    expect(mocks.list).toHaveBeenCalledWith("espace-fictif");
  });
  it("deux versions choisies et normalisées restent sous le même espace", async () => {
    const ctx = await loadRestructuringContext("fictif", { reference: REF.toUpperCase(), projet: PRO, vue: "monthly" });
    expect(mocks.get.mock.calls).toEqual([["espace-fictif", REF], ["espace-fictif", PRO]]);
    expect(ctx.reference?.id).toBe(REF); expect(ctx.proposal?.id).toBe(PRO); expect(ctx.view).toBe("monthly");
  });
  it("une suppression concurrente ne remplace pas le projet choisi", async () => {
    mocks.get.mockResolvedValue(null);
    const ctx = await loadRestructuringContext("fictif", { projet: PRO });
    expect(ctx.proposal).toBeNull(); expect(ctx.notices).toHaveLength(1);
  });
  it("une intégrité refusée est indiquée sans exposer le message de la base", async () => {
    mocks.get.mockRejectedValue(new BudgetError("un message qui pourrait contenir un détail privé"));
    const ctx = await loadRestructuringContext("fictif", { reference: REF });
    expect(ctx.reference).toBeNull(); expect(ctx.notices.join(" ")).not.toContain("détail privé");
  });
});
