import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFinanceSettings } from "@/lib/finance/plans";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/finance/store", () => ({ getFinanceSettings: mocks.read, saveFinanceSettings: mocks.write }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { savePlanAction, duplicatePlanAction, saveMappingsAction } from "@/app/e/[slug]/studio-finance/actions";
const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ revision: "0", id: "new", name: "Budget fictif", year: "2026", kind: "budget", personnelSource: "manual", "cell:2026-01:revenue": "1,01" })) f.set(k, v);
  return f;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { user: { id: "acteur-fictif" } }, workspace: { id: "espace-autorise" } });
  mocks.read.mockResolvedValue(emptyFinanceSettings());
  mocks.write.mockResolvedValue(undefined);
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
});
describe("Actions Finance, autorisation serveur et écriture dans l'espace autorisé", () => {
  it("exige editor pour un plan et admin pour les correspondances", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(savePlanAction("refuse", undefined, form())).rejects.toThrow("404");
    await expect(saveMappingsAction("refuse", undefined, form())).rejects.toThrow("404");
    expect(mocks.auth.mock.calls).toEqual([["refuse", "editor"], ["refuse", "admin"]]);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("ne fait pas confiance à workspaceId ni acteur envoyés par le navigateur", async () => {
    const f = form(); f.set("workspaceId", "autre-espace"); f.set("actor", "autre-acteur");
    await expect(savePlanAction("autorise", undefined, f)).rejects.toThrow(/REDIRECT:/);
    expect(mocks.read).toHaveBeenCalledWith("espace-autorise");
    expect(mocks.write).toHaveBeenCalledWith("espace-autorise", "acteur-fictif", 0, expect.objectContaining({ plans: [expect.objectContaining({ currency: "EUR", cells: { "2026-01": { revenue: 101 } } })] }));
  });
  it("refuse une ancienne révision avant écriture", async () => {
    mocks.read.mockResolvedValue({ ...emptyFinanceSettings(), revision: 1 });
    expect(await savePlanAction("autorise", undefined, form())).toMatchObject({ error: expect.stringContaining("autre onglet") });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("ne laisse ni exception SQL ni donnée métier dans la réponse ou les logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.write.mockRejectedValue(new Error("SQL + NOM_FICTIF_SECRET + 12345"));
    const result = await savePlanAction("autorise", undefined, form());
    expect(JSON.stringify(result)).not.toMatch(/SQL|NOM_FICTIF_SECRET|12345/);
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("duplication d'une version non accessible refusée et sans écriture", async () => {
    const f = form(); f.set("id", "11111111-1111-4111-8111-111111111111");
    expect(await duplicatePlanAction("autorise", undefined, f)).toMatchObject({ error: expect.stringContaining("introuvable") });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
