import { describe, expect, it } from "vitest";
import { formRevision, mappingsFromForm, planFromForm } from "@/lib/finance/forms";
import { emptyFinanceSettings } from "@/lib/finance/plans";

const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ id: "new", name: "Budget fictif", year: "2026", kind: "budget", personnelSource: "manual", ...extra })) f.set(k, v);
  return f;
};
describe("Saisie financière, montants exacts et blancs distincts", () => {
  it("100,01 euros = 10001 centimes ; zéro explicite gardé, vide absent", () => {
    const p = planFromForm(form({ "cell:2026-01:revenue": "100,01", "cell:2026-01:personnel": "0", "cell:2026-01:other-income": "", "cell:2026-02:personnel": "-0,50" }), emptyFinanceSettings());
    expect(p.cells).toEqual({ "2026-01": { revenue: 10001, personnel: 0 }, "2026-02": { personnel: -50 } });
    expect(p.currency).toBe("EUR");
  });
  it.each(["NaN", "1e3", "12,345", "=SUM(1)", "10000000001"])("refuse un montant invalide %s", (v) => {
    expect(() => planFromForm(form({ "cell:2026-01:revenue": v }), emptyFinanceSettings())).toThrow();
  });
  it("ne permet ni cellule autre année ni ligne inconnue ni mois inexistant", () => {
    for (const key of ["cell:2025-01:revenue", "cell:2026-13:revenue", "cell:2026-01:secret"]) expect(() => planFromForm(form({ [key]: "10" }), emptyFinanceSettings())).toThrow();
  });
  it("ne réécrit pas un identifiant d'une autre version ou d'un autre espace", () => {
    expect(() => planFromForm(form({ id: "11111111-1111-4111-8111-111111111111" }), emptyFinanceSettings())).toThrow(/introuvable/);
  });
  it("prévision exige le mois de bascule ; scénario RH explicite seulement", () => {
    expect(() => planFromForm(form({ kind: "forecast" }), emptyFinanceSettings())).toThrow();
    expect(() => planFromForm(form({ personnelSource: "rh" }), emptyFinanceSettings())).toThrow();
    expect(planFromForm(form({ kind: "forecast", firstForecastMonth: "2026-10" }), emptyFinanceSettings()).firstForecastMonth).toBe("2026-10");
  });
  it("refuse les champs singuliers répétés et les fichiers", () => {
    const f = form(); f.append("name", "Autre");
    expect(() => planFromForm(f, emptyFinanceSettings())).toThrow();
    const file = form(); file.set("cell:2026-01:revenue", new Blob(["1"]), "montant.txt");
    expect(() => planFromForm(file, emptyFinanceSettings())).toThrow();
  });
  it("révision requise, entière et bornée", () => {
    for (const v of ["", "-1", "NaN", "1e2", "9999999999999"]) expect(() => formRevision(form({ revision: v }))).toThrow();
    expect(formRevision(form({ revision: "4" }))).toBe(4);
  });
  it("préserve les correspondances non affichées, retour au défaut supprime une exception", () => {
    const s = { ...emptyFinanceSettings(), mappings: [{ account: "641", row: "other-expenses" as const }, { account: "707", row: "other-income" as const }] };
    const f = new FormData(); f.append("account", "641"); f.append("row", "personnel");
    expect(mappingsFromForm(f, s)).toEqual([{ account: "707", row: "other-income" }]);
  });
  it("refuse des lignes désalignées, comptes répétés ou faux comptes", () => {
    const f = new FormData(); f.append("account", "641");
    expect(() => mappingsFromForm(f, emptyFinanceSettings())).toThrow();
    f.append("row", "personnel"); f.append("account", "641"); f.append("row", "revenue");
    expect(() => mappingsFromForm(f, emptyFinanceSettings())).toThrow();
    const g = new FormData(); g.append("account", "421"); g.append("row", "personnel");
    expect(() => mappingsFromForm(g, emptyFinanceSettings())).toThrow();
  });
});
