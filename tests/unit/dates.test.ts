import { describe, expect, it } from "vitest";
import { addMonths, addMonthsToDate, formatDate, formatMonth, isActiveOn, isIsoDate, monthEnd, monthsBetween, overlapsMonth } from "@/lib/dates";

describe("dates calendaires", () => {
  it("valide les dates réelles seulement", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("20240101")).toBe(false);
  });
  it("fin de mois, y compris février bissextile et décembre", () => {
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(monthEnd("2025-02")).toBe("2025-02-28");
    expect(monthEnd("2025-12")).toBe("2025-12-31");
  });
  it("arithmétique de mois sur le passage d'année", () => {
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-02", "2025-11")).toEqual([]);
  });
});

describe("présence d'un contrat (bornes incluses)", () => {
  it.each([
    ["2024-10-01", null, "2024-10-01", true],
    ["2024-10-01", null, "2024-09-30", false],
    ["2024-10-01", "2025-12-31", "2025-12-31", true],
    ["2024-10-01", "2025-12-31", "2026-01-01", false],
    ["2026-02-15", null, "2026-02-14", false],
    ["2026-02-15", null, "2026-02-15", true],
  ])("début %s, fin %s, date %s → %s", (start, end, date, expected) => {
    expect(isActiveOn(start, end, date)).toBe(expected);
  });
  it.each([
    ["2024-10-01", "2025-12-31", "2025-12", true],
    ["2024-10-01", "2025-12-31", "2026-01", false],
    ["2026-02-15", null, "2026-02", true],
    ["2026-02-15", null, "2026-01", false],
    ["2025-03-10", "2025-03-14", "2025-03", true],
  ])("contrat %s → %s recouvre %s : %s", (start, end, month, expected) => {
    expect(overlapsMonth(start, end, month)).toBe(expected);
  });
});

describe("formats français", () => {
  it("date et mois", () => {
    expect(formatDate("2025-04-10")).toBe("10/04/2025");
    expect(formatDate(null)).toBe("n.d.");
    expect(formatMonth("2025-04")).toBe("Avril 2025");
  });
});

describe("décalage d'une date en mois", () => {
  it("garde le jour, ou le ramène au dernier jour du mois cible", () => {
    expect(addMonthsToDate("2026-10-21", -12)).toBe("2025-10-21");
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsToDate("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2025-12-15", 1)).toBe("2026-01-15");
  });
});
