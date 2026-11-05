import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), add: vi.fn(), event: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/budget/store", () => ({
  BudgetError: class BudgetError extends Error {}, addHypotheses: mocks.add,
  applyChanges: vi.fn(), importHypotheses: vi.fn(), createScenario: vi.fn(), deleteBudget: vi.fn(), deleteHypothesis: vi.fn(),
  deleteScenario: vi.fn(), duplicateScenario: vi.fn(), freezeScenario: vi.fn(), getScenario: vi.fn(), saveBudget: vi.fn(), MAX_MONTH_CENTS: 1_000_000_000_000,
}));
vi.mock("@/lib/budget/settings", () => ({ getConventions: vi.fn() }));
vi.mock("@/lib/budget/categories", () => ({ getCategoryNatures: vi.fn(), getContractCategories: vi.fn(), categoryOfContract: vi.fn() }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: mocks.event }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { addHypothesisAction } from "@/app/e/[slug]/studio-rh/hypotheses/actions";

const SCENARIO = "22222222-2222-4222-8222-222222222222";
const marker = "PARAMETRE_FICTIF_CONFIDENTIEL";
const form = () => {
  const f = new FormData();
  for (const [key, value] of Object.entries({ label: "POSTE_FICTIF_PRIVE", count: "1", start: "2026-11-01", end: "", gross: "2500", quota: "80", charges: "40", counted: "oui", category: "cdi", service: "SERVICE_FICTIF_PRIVE", replaces: "" })) f.set(key, value);
  return f;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif" }, session: { user: { id: "editeur-fictif" } } });
  mocks.add.mockResolvedValue({ added: [], skipped: [], notes: [] });
  mocks.event.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("Retour d’une écriture d’hypothèse — action RH réelle, données fictives", () => {
  it("un échec du journal après insertion confirme l’embauche, avertit et ne réessaie pas l’insertion", async () => {
    mocks.event.mockRejectedValue(new Error(marker));
    const result = await addHypothesisAction("fictif", SCENARIO, "embauche", undefined, form());
    expect(result?.ok).toContain("enregistrée");
    expect(result?.error).toBeUndefined();
    expect(result?.details?.join(" ")).toMatch(/journal|traçabilité/);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalledWith("espace-fictif", "editeur-fictif", SCENARIO, [expect.objectContaining({ kind: "embauche", grossFullTimeCents: 250000, quotaBps: 8000, service: "SERVICE_FICTIF_PRIVE" })], "all");
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/e/fictif/studio-rh/hypotheses");
    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls].flat();
    expect(logged.every((item) => typeof item === "string")).toBe(true);
    const logText = logged.join(" ");
    for (const forbidden of [marker, "POSTE_FICTIF_PRIVE", "SERVICE_FICTIF_PRIVE"]) expect(logText).not.toContain(forbidden);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("une erreur de persistance contenant des paramètres ne sort ni dans le retour ni dans les logs", async () => {
    const failure = Object.assign(new Error(`Failed query; params: ${marker}`), { params: [marker, "POSTE_FICTIF_PRIVE"] });
    mocks.add.mockRejectedValue(failure);
    const result = await addHypothesisAction("fictif", SCENARIO, "embauche", undefined, form());
    expect(result).toEqual({ error: "Enregistrement impossible." });
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(1);
    expect(typeof vi.mocked(console.error).mock.calls[0][0]).toBe("string");
    const logText = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    for (const forbidden of [marker, "POSTE_FICTIF_PRIVE", "SERVICE_FICTIF_PRIVE", "Failed query", "params:"]) expect(logText).not.toContain(forbidden);
  });

  it("deux postes restent un lot unique et le second journal est tenté même si le premier échoue", async () => {
    const f = form();
    f.set("count", "2");
    mocks.event.mockRejectedValueOnce(new Error(marker)).mockResolvedValueOnce(undefined);
    const result = await addHypothesisAction("fictif", SCENARIO, "embauche", undefined, f);
    expect(result?.ok).toContain("2 hypothèses enregistrées");
    expect(result?.error).toBeUndefined();
    expect(result?.details?.join(" ")).toContain("journal");
    expect(mocks.add).toHaveBeenCalledTimes(1);
    const candidates = mocks.add.mock.calls[0][3];
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate: { label: string }) => candidate.label)).toEqual(["POSTE_FICTIF_PRIVE (1/2)", "POSTE_FICTIF_PRIVE (2/2)"]);
    expect(new Set(candidates.map((candidate: { id: string }) => candidate.id)).size).toBe(2);
    expect(mocks.event).toHaveBeenCalledTimes(2);
    expect(mocks.event.mock.calls.map((call) => call[3].hypothesisId)).toEqual(candidates.map((candidate: { id: string }) => candidate.id));
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/e/fictif/studio-rh/hypotheses");
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("un refus d’accès précède toute insertion, tout journal et toute revalidation", async () => {
    const refusal = new Error("404 fictif");
    mocks.auth.mockRejectedValue(refusal);
    await expect(addHypothesisAction("fictif", SCENARIO, "embauche", undefined, form())).rejects.toBe(refusal);
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor");
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
