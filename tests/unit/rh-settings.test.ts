import { describe, expect, it } from "vitest";
import { KPI_DEFAULTS, KPI_DEFAULT_STATUS, KPI_PARSERS } from "@/lib/rh-kpi-settings";
import { DEFAULT_HEADCOUNT_NATURES, DEFAULT_PAYFIT_HISTORY, parseNatureCodes, parsePayfitHistoryMode } from "@/lib/rh-settings";

describe("natures comptées dans l'effectif", () => {
  it("défaut validé : CDI (01) et CDD (02)", () => {
    expect([...DEFAULT_HEADCOUNT_NATURES]).toEqual(["01", "02"]);
  });
  it("accepte des codes à deux chiffres, dédoublonnés et triés ; refuse le reste", () => {
    expect(parseNatureCodes(["02", "01", "02"])).toEqual(["01", "02"]);
    expect(parseNatureCodes([])).toBeNull();
    expect(parseNatureCodes(["1"])).toBeNull();
    expect(parseNatureCodes("01")).toBeNull();
    expect(parseNatureCodes(["01", 2])).toBeNull();
  });
});

describe("historique PayFit et défauts validés le 22/10/2026", () => {
  it("historique : brut par défaut ; seules les valeurs « raw » et « flagged » sont lisibles", () => {
    expect(DEFAULT_PAYFIT_HISTORY).toBe("raw");
    expect(parsePayfitHistoryMode("raw")).toBe("raw");
    expect(parsePayfitHistoryMode("flagged")).toBe("flagged");
    expect(parsePayfitHistoryMode("brut")).toBeNull();
    expect(parsePayfitHistoryMode(null)).toBeNull();
  });
  it("forfait jours sans quotité = 1 ETP et maladie ordinaire comptée : défauts validés", () => {
    expect(KPI_DEFAULTS.forfaitJoursIsOne).toBe(true);
    expect(KPI_DEFAULTS.absenceTypes).toEqual(["fr_maladie_ordinaire"]);
    expect(KPI_DEFAULT_STATUS.forfaitJoursIsOne).toBe("validated");
    expect(KPI_PARSERS.forfaitJoursIsOne("oui")).toBeNull();
  });
});
