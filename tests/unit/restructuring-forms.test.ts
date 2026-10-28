import { describe, expect, it } from "vitest";
import { exitFromForm } from "@/lib/restructuring/forms";
import { assertExpectedHypotheses } from "@/lib/budget/store";
import type { Hypothesis } from "@/lib/budget/types";

const form = (patch: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [key, value] of Object.entries({ contractKey: "contrat-fictif", motif: "Licenciement", lastPaidDate: "2026-11-30", exitMode: "charge", exitCout: "1 234,56", ...patch })) f.set(key, value);
  return f;
};
const previous: Extract<Hypothesis, { kind: "depart" }> = { id: "depart-fictif", kind: "depart", contractKey: "contrat-fictif", label: "Libellé fictif conservé", motif: "Démission", lastPaidDate: "2026-11-30", exitCost: null };

describe("Saisie non récurrente : licenciement et rupture conventionnelle", () => {
  it.each(["Licenciement", "Rupture conventionnelle"])("%s est un seul départ avec coût chargé saisi", (motif) => {
    const result = exitFromForm(form({ motif }), "id-fictif");
    expect(result).toMatchObject({ id: "id-fictif", kind: "depart", motif, label: motif, exitCost: { mode: "charge", costCents: 123456 } });
  });
  it("mode brut : reprend le montant et le taux explicites, aucune exonération supposée", () => {
    expect(exitFromForm(form({ exitMode: "brut", exitBrut: "2500,01", exitTaux: "20" }), "fictif").exitCost).toEqual({ mode: "brut", brutCents: 250001, chargesBps: 2000 });
    expect(() => exitFromForm(form({ exitMode: "brut", exitBrut: "2500,01", exitTaux: "" }), "fictif")).toThrow("Taux de charges explicite");
  });
  it("coût vide et zéro explicite restent distincts", () => {
    expect(() => exitFromForm(form({ exitCout: "" }), "fictif")).toThrow("Coût de sortie positif ou nul requis");
    expect(exitFromForm(form({ exitCout: "0" }), "fictif").exitCost).toEqual({ mode: "charge", costCents: 0 });
  });
  it.each([
    [{ motif: "" }, "Choisis"], [{ lastPaidDate: "2026-02-30" }, "date valide"], [{ exitMode: "aucun" }, "mode de saisie"],
    [{ exitCout: "-1" }, "positif ou nul"], [{ exitCout: "1000000000001" }, "positif ou nul"], [{ contractKey: "" }, "contrat"],
  ])("refuse une saisie incomplète ou hors borne", (patch, message) => {
    expect(() => exitFromForm(form(patch), "fictif")).toThrow(message);
  });
  it("compléter un départ conserve son identifiant, son contrat et son libellé", () => {
    const result = exitFromForm(form({ contractKey: "contrat-forge", motif: "Démission" }), "nouvel-id-ignore", previous);
    expect(result).toMatchObject({ ...previous, exitCost: { mode: "charge", costCents: 123456 } });
  });
  it("un changement concurrent est refusé avant de réécrire l’hypothèse", () => {
    expect(() => assertExpectedHypotheses([{ ...previous, exitCost: { mode: "charge", costCents: 100 } }], [previous])).toThrow("a changé entre-temps");
    expect(() => assertExpectedHypotheses([], [previous])).toThrow("a changé entre-temps");
    expect(() => assertExpectedHypotheses([{ ...previous }], [previous])).not.toThrow();
  });
});
