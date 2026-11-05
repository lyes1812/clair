import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ add: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/e/[slug]/studio-rh/hypotheses/actions", () => ({ addHypothesisAction: mocks.add }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { addRestructuringHireAction } from "@/app/e/[slug]/studio-restructuring/hire-actions";

const SCENARIO = "22222222-2222-4222-8222-222222222222";
const form = () => {
  const value = new FormData();
  for (const [key, item] of Object.entries({ label: "Embauche fictive", count: "1", start: "2026-11-01", gross: "2500", quota: "80", charges: "40", counted: "oui", replaces: "depart-fictif", kind: "depart" })) value.append(key, item);
  return value;
};
beforeEach(() => { vi.resetAllMocks(); });

describe("Restructuring — délégation de l’embauche au moteur RH existant", () => {
  it("délègue une fois au scénario lié côté serveur, impose embauche et conserve la saisie sans mutation", async () => {
    const value = form();
    const before = [...value.entries()];
    const previous = { error: "Erreur fictive précédente" };
    const result = { ok: "Embauche fictive ajoutée", details: ["Détail fictif"] };
    mocks.add.mockResolvedValue(result);
    expect(await addRestructuringHireAction("espace-fictif", SCENARIO, previous, value)).toBe(result);
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith("espace-fictif", SCENARIO, "embauche", previous, value);
    expect(mocks.add.mock.calls[0][4]).toBe(value);
    expect([...value.entries()]).toEqual(before);
    expect(mocks.revalidate.mock.calls).toEqual([["/e/espace-fictif/studio-restructuring"], ["/e/espace-fictif/studio-finance"]]);
  });

  it("un refus d’autorisation remonté par l’action RH n’est ni transformé en succès ni revalidé", async () => {
    const failure = new Error("Accès fictif refusé");
    mocks.add.mockRejectedValue(failure);
    await expect(addRestructuringHireAction("espace-fictif", SCENARIO, undefined, form())).rejects.toBe(failure);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([{ error: "Projet figé fictif" }, { error: "Montant fictif absent", details: ["Champ requis"] }, { ok: "Réponse fictive", error: "Échec fictif" }, undefined])("un retour sans succès confirmé ne revalide rien : %j", async (result) => {
    mocks.add.mockResolvedValue(result);
    expect(await addRestructuringHireAction("espace-fictif", SCENARIO, undefined, form())).toBe(result);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
