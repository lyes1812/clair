import { describe, expect, it } from "vitest";
import { payrollExplorationQuery as query } from "@/lib/payroll/exploration-query";

describe("périodes de l’exploration de la masse salariale", () => {
  const months = ["2025-01", "2025-02", "2026-01", "2026-02", "2026-03"];
  it("prend le dernier mois explicitement clos de la lecture, sans choisir d’axe", () => {
    const q = query({}, months, ["2026-02", "2026-01", "2027-01", "invalide"], ["Service"]);
    expect(q.filters).toEqual({ year: "2026", from: "01", to: "02", referenceYear: "2025", axis: "", display: "tout" });
    expect(q.monthsA).toEqual(["2026-01", "2026-02"]);
    expect(q.monthsB).toEqual(["2025-01", "2025-02"]);
    expect(q.axis).toBeNull();
  });
  it("garde une référence hors lecture et tous les mois demandés : le moteur doit signaler leurs limites", () => {
    const q = query({ annee: "2027", de: "02", a: "04", reference: "2024", axe: "Service" }, months, ["2026-02"], ["Service"]);
    expect(q.monthsA).toEqual(["2027-02", "2027-03", "2027-04"]);
    expect(q.monthsB).toEqual(["2024-02", "2024-03", "2024-04"]);
    expect(q.years).toContain("2027");
    expect(q.referenceYears).toContain("2024");
    expect(q.axis).toBe("Service");
  });
  it.each([{ annee: "" }, { annee: "0" }, { annee: "2026x" }, { de: "00" }, { a: "13" }, { de: "03", a: "02" }, { annee: ["2026", "2026"] }])("refuse un périmètre explicite invalide : %j", (sp) => {
    const q = query(sp, months, ["2026-02"], []);
    expect(q.monthsA).toEqual([]);
    expect(q.notices).toContain("Période invalide : sélectionne une année et des mois dans l’ordre chronologique.");
  });
  it("refuse les références et axes répétés ou invalides sans réinterprétation", () => {
    const q = query({ reference: ["2025", "2025"], axe: ["Service", "Service"] }, months, ["2026-02"], ["Service"]);
    expect(q.monthsB).toEqual([]);
    expect(q.axis).toBeNull();
    expect(query({ reference: "", axe: "Direction" }, months, [], ["Service"]).axis).toBeNull();
  });
  it("ne fabrique pas d’année quand aucune source n’est lue", () => {
    const q = query({}, [], [], []);
    expect(q.monthsA).toEqual([]);
    expect(q.monthsB).toEqual([]);
    expect(q.years).toEqual([]);
    expect(q.filters.year).toBe("");
  });
  it("ne confond pas mois dupliqués et nouvelles années, et garde l’affichage explicite", () => {
    const q = query({ affichage: "tableau", de: "02", a: "02" }, [...months, "2026-02", "bad"], ["2026-02"], []);
    expect(q.years).toEqual(["2026", "2025"]);
    expect(q.monthsA).toEqual(["2026-02"]);
    expect(q.filters.display).toBe("tableau");
  });
});
