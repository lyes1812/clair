import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, sha256 } from "@/lib/crypto";
import type { Hypothesis } from "@/lib/budget/types";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), apply: vi.fn(), event: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: mocks.auth }));
vi.mock("@/lib/budget/store", () => ({ getScenario: mocks.get, applyChanges: mocks.apply }));
vi.mock("@/lib/events", () => ({ recordEvent: mocks.event }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveExitAction } from "@/app/e/[slug]/studio-restructuring/actions";
const SCENARIO = "11111111-1111-4111-8111-111111111111";
const departure: Extract<Hypothesis, { kind: "depart" }> = { id: "22222222-2222-4222-8222-222222222222", kind: "depart", label: "MESURE_FICTIVE_PRIVEE", contractKey: "contrat-fictif", lastPaidDate: "2026-11-30", motif: "Licenciement", exitCost: null };
const form = (patch: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [key, value] of Object.entries({ contractKey: "contrat-fictif", motif: "Rupture conventionnelle", lastPaidDate: "2026-11-30", exitMode: "charge", exitCout: "2000,01", ...patch })) f.set(key, value);
  return f;
};
const full = (hypotheses: Hypothesis[] = []) => ({ scenario: { status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-12" }, base: { contracts: [{ contractKey: "contrat-fictif" }] }, hypotheses });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ workspace: { id: "espace-fictif" }, session: { user: { id: "editeur-fictif" } } });
  mocks.get.mockResolvedValue(full()); mocks.apply.mockResolvedValue({ put: 1, removed: 0 }); mocks.event.mockResolvedValue(undefined);
});
describe("Coûts non récurrents : écriture autorisée dans un seul brouillon", () => {
  it("un lecteur refusé ne déclenche aucune lecture ni écriture métier", async () => {
    mocks.auth.mockRejectedValue(new Error("404"));
    await expect(saveExitAction("fictif", SCENARIO, {}, undefined, form())).rejects.toThrow("404");
    expect(mocks.auth).toHaveBeenCalledWith("fictif", "editor"); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("un scénario absent ou figé n’est pas modifié", async () => {
    mocks.get.mockResolvedValue(null);
    expect((await saveExitAction("fictif", SCENARIO, {}, undefined, form()))?.error).toContain("brouillon");
    mocks.get.mockResolvedValue({ ...full(), scenario: { ...full().scenario, status: "fige" } });
    expect((await saveExitAction("fictif", SCENARIO, {}, undefined, form()))?.error).toContain("brouillon");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("enregistre un seul départ, sans ajout d’un second élément ponctuel", async () => {
    const result = await saveExitAction("fictif", SCENARIO, {}, undefined, form());
    expect(result?.ok).toContain("enregistrés");
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.apply).toHaveBeenCalledWith("espace-fictif", "editeur-fictif", SCENARIO, { put: [expect.objectContaining({ kind: "depart", motif: "Rupture conventionnelle", exitCost: { mode: "charge", costCents: 200001 } })], remove: [], expected: [] });
    expect(mocks.event).toHaveBeenCalledWith("espace-fictif", "editeur-fictif", "budget.hypothesis_added", { kind: "depart", operation: "created", count: 1 });
  });
  it("la mise à jour remplace le départ existant, garde le contrat et vérifie l’état attendu sous verrou", async () => {
    mocks.get.mockResolvedValue(full([departure]));
    const versions = { [departure.id]: sha256(canonicalJson(departure)) };
    await saveExitAction("fictif", SCENARIO, versions, undefined, form({ hypothesisId: departure.id, contractKey: "contrat-forge" }));
    expect(mocks.apply).toHaveBeenCalledWith("espace-fictif", "editeur-fictif", SCENARIO, { put: [expect.objectContaining({ id: departure.id, label: departure.label, contractKey: departure.contractKey, exitCost: { mode: "charge", costCents: 200001 } })], remove: [], expected: [departure] });
  });
  it("un ancien formulaire ne peut pas écraser une mesure modifiée dans un autre onglet", async () => {
    const versions = { [departure.id]: sha256(canonicalJson(departure)) };
    mocks.get.mockResolvedValue(full([{ ...departure, exitCost: { mode: "charge", costCents: 999 } }]));
    const result = await saveExitAction("fictif", SCENARIO, versions, undefined, form({ hypothesisId: departure.id }));
    expect(result?.error).toContain("depuis l’affichage"); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ contractKey: "autre-espace" }, { lastPaidDate: "2027-01-01" }, { exitCout: "" }, { hypothesisId: "inconnue" }])("refuse les entrées invalides avant écriture", async (patch) => {
    expect((await saveExitAction("fictif", SCENARIO, {}, undefined, form(patch)))?.error).toBeTruthy();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("un départ déjà présent ne peut pas être ajouté une deuxième fois", async () => {
    mocks.get.mockResolvedValue(full([departure]));
    expect((await saveExitAction("fictif", SCENARIO, {}, undefined, form()))?.error).toContain("existe déjà");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("une erreur du journal n’incite pas à répéter l’écriture et aucune erreur brute n’est journalisée", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.event.mockRejectedValue(new Error("DETAIL_FICTIF_NE_PAS_LOGUER"));
    const result = await saveExitAction("fictif", SCENARIO, {}, undefined, form());
    expect(result?.ok).toBeTruthy(); expect(result?.details?.join(" ")).toContain("n’a pas pu être confirmée");
    expect(mocks.apply).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});
