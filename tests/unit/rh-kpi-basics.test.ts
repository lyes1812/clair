import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { normalizeAbsence } from "@/lib/connectors/payfit/client";
import { KPI_PARSERS } from "@/lib/rh-kpi-settings";
import { absenceSlots, countDays, isWeekday } from "@/lib/rh/kpi/days";
import { fmtDelta, fmtEtp4, fmtFixed, fmtFraction, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { ratio, reduce, roundHalfUp, same, sub, times } from "@/lib/rh/kpi/fraction";
import { checkWindow, civilWindow, closedMonths, defaultYear, lastClosedMonth, previousWindow, rollingWindow, selectableYears } from "@/lib/rh/kpi/period";
import { etp4FromFte, etp4FromQuotas } from "@/lib/rh/kpi/etp";
import { monthRange } from "@/lib/connectors/months";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { dsnFixtureBuild, payfitBuild, payfitFixtureBuild } from "./helpers/rh";

describe("fractions et arrondis (entiers exacts)", () => {
  it("réduit, soustrait, multiplie et compare sans flottant", () => {
    expect(reduce({ num: 707000, den: 120000 })).toEqual({ num: 707, den: 120 });
    expect(sub({ num: 12, den: 83 }, { num: 7, den: 13 })).toEqual({ num: -425, den: 1079 });
    expect(times(sub({ num: 12, den: 83 }, { num: 7, den: 13 }), 100)).toEqual({ num: -42500, den: 1079 });
    expect(same({ num: 24, den: 166 }, { num: 12, den: 83 })).toBe(true);
    expect(() => ratio(1, 0)).toThrow();
    expect(() => ratio(0.5, 1)).toThrow();
  });
  it("arrondit au plus proche, demi en s'éloignant de zéro", () => {
    expect(roundHalfUp({ num: 217, den: 40 }, 2)).toBe(543n); // 5,425 → 5,43
    expect(roundHalfUp({ num: -217, den: 40 }, 2)).toBe(-543n);
    expect(roundHalfUp({ num: 707, den: 120 }, 2)).toBe(589n);
  });
  it("quotités : rapport arrondi à n décimales en dix-millièmes", () => {
    expect(etp4FromQuotas(138.67, 173.33, 4)).toBe(8000); // 0,8000346
    expect(etp4FromQuotas(86.67, 173.33, 4)).toBe(5000); // 0,5000288
    expect(etp4FromQuotas(120, 151.67, 4)).toBe(7912);
    expect(etp4FromQuotas(120, 151.67, 3)).toBe(7910);
    expect(etp4FromQuotas(120, 151.67, 2)).toBe(7900);
    expect(etp4FromQuotas(169, 151.67, 4)).toBe(11143);
    expect(etp4FromFte(0.8333, 4)).toBe(8333);
    expect(etp4FromFte(0.8333, 2)).toBe(8300);
  });
});

describe("affichage fr-FR", () => {
  it("valeurs de contrôle", () => {
    expect(fmtFixed({ num: 707, den: 120 })).toBe("5,89");
    expect(fmtFixed({ num: 217, den: 40 })).toBe("5,43");
    expect(fmtPercent({ num: 12, den: 83 })).toBe("14,46 %");
    expect(fmtPercent({ num: 0, den: 372 })).toBe("0,00 %");
    expect(fmtDelta({ kind: "exact", unit: "points", value: { num: -42500, den: 1079 } })).toBe("−39,39 pts");
    expect(fmtDelta({ kind: "exact", unit: "etp", value: { num: 1, den: 2 } })).toBe("+0,50 ETP");
    expect(fmtDelta({ kind: "exact", unit: "persons", value: { num: 5, den: 12 } })).toBe("+0,42 personne");
    expect(fmtEtp4(61000)).toBe("6,10");
    expect(fmtHalfDays(1)).toBe("0,5 j");
    expect(fmtHalfDays(30)).toBe("15 j");
    expect(fmtFraction({ num: 24, den: 166 })).toBe("12/83");
  });
});

describe("jours et créneaux d'absence", () => {
  it("jours calendaires et du lundi au vendredi", () => {
    expect(isWeekday("2026-03-02")).toBe(true); // lundi
    expect(isWeekday("2026-03-07")).toBe(false);
    expect(countDays("2026-03-01", "2026-03-31", "calendar")).toBe(31);
    expect(countDays("2026-03-01", "2026-03-31", "weekdays")).toBe(22);
    expect(countDays("2026-02-15", "2026-02-28", "weekdays")).toBe(10);
  });
  const clip = { from: "2026-03-01", to: "2026-03-31" };
  const a = (s: string, sm: string | null, e: string, em: string | null) => ({ start: { date: s, moment: sm }, end: { date: e, moment: em } });
  it("A1/A2 : demi-journées selon les moments", () => {
    expect(absenceSlots(a("2026-03-02", "middle-of-day", "2026-03-04", "middle-of-day"), clip, "calendar").slots).toEqual(["2026-03-02#1", "2026-03-03#0", "2026-03-03#1", "2026-03-04#0"]);
    expect(absenceSlots(a("2026-03-02", "beginning-of-day", "2026-03-02", "middle-of-day"), clip, "calendar").slots).toEqual(["2026-03-02#0"]);
    expect(absenceSlots(a("2026-03-02", "middle-of-day", "2026-03-02", "end-of-day"), clip, "calendar").slots).toEqual(["2026-03-02#1"]);
    expect(absenceSlots(a("2026-03-02", "beginning-of-day", "2026-03-02", "end-of-day"), clip, "calendar").slots).toHaveLength(2);
  });
  it("A6/A7 : week-end compté en calendaire seulement, sans incertitude", () => {
    expect(absenceSlots(a("2026-03-06", "beginning-of-day", "2026-03-09", "end-of-day"), clip, "calendar").slots).toHaveLength(8);
    expect(absenceSlots(a("2026-03-06", "beginning-of-day", "2026-03-09", "end-of-day"), clip, "weekdays").slots).toHaveLength(4);
    const we = absenceSlots(a("2026-03-07", "beginning-of-day", "2026-03-08", "end-of-day"), clip, "weekdays");
    expect(we).toEqual({ slots: [], uncertain: [], notes: [] });
  });
  it("A11–A13 : moment absent ou non interprété, mi → mi le même jour ⇒ jour non compté et incertain", () => {
    const nul = absenceSlots(a("2026-03-02", null, "2026-03-04", "end-of-day"), clip, "calendar");
    expect(nul.slots).toHaveLength(4);
    expect(nul.uncertain).toEqual(["2026-03-02#0", "2026-03-02#1"]);
    expect(absenceSlots(a("2026-03-02", "end-of-day", "2026-03-04", "end-of-day"), clip, "calendar").slots).toHaveLength(4);
    expect(absenceSlots(a("2026-03-02", "beginning-of-day", "2026-03-04", "beginning-of-day"), clip, "calendar").slots).toHaveLength(4);
    const mm = absenceSlots(a("2026-03-02", "middle-of-day", "2026-03-02", "middle-of-day"), clip, "calendar");
    expect(mm.slots).toEqual([]);
    expect(mm.uncertain).toHaveLength(2);
    expect(mm.notes[0]).toContain("bornes incohérentes");
  });
});

describe("périodes closes et fenêtres (aucune horloge)", async () => {
  const payfit = await payfitFixtureBuild();
  const dsn = dsnFixtureBuild();
  it("P1 / D1 : dernier mois clos 2026-09 ; année par défaut 2025", () => {
    expect(lastClosedMonth(payfit)).toBe("2026-09"); // 31/10/2026 > 21/10/2026
    expect(closedMonths(payfit)[0]).toBe("2024-10");
    expect(lastClosedMonth(dsn)).toBe("2026-09");
    expect(defaultYear(payfit)).toBe(2025);
    expect(selectableYears(payfit)).toEqual([{ year: 2024, closed: true }, { year: 2025, closed: true }, { year: 2026, closed: false }]);
    const w = rollingWindow("2026-09");
    expect(w).toMatchObject({ from: "2025-10", to: "2026-09", label: "12 mois glissants : octobre 2025 → septembre 2026" });
    expect(previousWindow(w)).toMatchObject({ from: "2024-10", to: "2025-09" });
    expect(previousWindow(civilWindow(2025))).toMatchObject({ from: "2024-01", to: "2024-12", label: "année civile 2024" });
  });
  it("Q1 : lecture le dernier jour d'un mois ⇒ ce mois est clos", async () => {
    const q = await payfitBuild("fixture-A-1", createFixtureFetch("fixture-A-1"), monthRange("2024-10", "2026-01"), new Date("2026-01-31T08:00:00Z"));
    expect(lastClosedMonth(q)).toBe("2026-01");
  });
  it("W1 : une fenêtre qui dépasse le dernier mois clos est n.d. « période non close »", () => {
    expect(checkWindow(payfit, rollingWindow("2026-10"))).toMatchObject({ code: "period-not-closed", reason: expect.stringContaining("2026-10 n'est pas clos") });
    expect(checkWindow(payfit, civilWindow(2026))?.code).toBe("period-not-closed");
    expect(checkWindow(payfit, rollingWindow("2026-09"))).toBeNull();
  });
});

describe("paramètres des KPI : parseurs stricts (S1)", () => {
  it("valeurs admises et refusées", () => {
    expect(KPI_PARSERS.absenceTypes(["b", "a", "a"])).toEqual(["a", "b"]);
    expect(KPI_PARSERS.absenceTypes([])).toEqual([]);
    expect(KPI_PARSERS.absenceTypes(["a b"])).toBeNull();
    expect(KPI_PARSERS.absenceStatuses([])).toBeNull();
    expect(KPI_PARSERS.absenceStatuses(["approved", "x"])).toBeNull();
    expect(KPI_PARSERS.absenceStatuses(["pending_approval", "approved"])).toEqual(["approved", "pending_approval"]);
    expect(KPI_PARSERS.excludedExitNatures(["02", "2"])).toBeNull();
    expect(KPI_PARSERS.excludedExitNatures([])).toEqual([]);
    expect(KPI_PARSERS.etpDecimals(3)).toBe(3);
    expect(KPI_PARSERS.etpDecimals(5)).toBeNull();
    expect(KPI_PARSERS.etpDecimals("4")).toBeNull();
    expect(KPI_PARSERS.dayBasis("weekdays")).toBe("weekdays");
    expect(KPI_PARSERS.dayBasis("ouvrés")).toBeNull();
    expect(KPI_PARSERS.fullTimeIsOne("true")).toBeNull();
    expect(KPI_PARSERS.turnoverFormula("exits_over_start")).toBe("exits_over_start");
  });
});

describe("absences PayFit : normalisation (S5)", () => {
  const row = (o: Record<string, unknown> = {}) => ({ id: "a1", contractId: "c1", type: "sick", status: "approved", startDate: { date: "2026-03-02", moment: "beginning-of-day" }, endDate: { date: "2026-03-04", moment: "end-of-day" }, ...o });
  it("refuse un moment inconnu, une fin avant le début, un type avec espace ; admet moment et statut nuls", () => {
    expect(() => normalizeAbsence(row({ startDate: { date: "2026-03-02", moment: "noon" } }))).toThrow();
    expect(() => normalizeAbsence(row({ startDate: { date: "2026-03-05", moment: null } }))).toThrow();
    expect(() => normalizeAbsence(row({ type: "a b" }))).toThrow();
    expect(normalizeAbsence(row({ startDate: { date: "2026-03-02", moment: null }, status: null })).data).toMatchObject({ start: { date: "2026-03-02", moment: null }, status: null });
  });
});

describe("déterminisme : aucune horloge dans le moteur KPI (S4)", () => {
  it("ni Date.now, ni new Date() sans argument, ni todayParis dans src/lib/rh/kpi", () => {
    const out = execSync(`grep -rnE "Date\\.now|new Date\\(\\)|todayParis" src/lib/rh/kpi || true`, { encoding: "utf8" });
    expect(out.trim()).toBe("");
  });
});
