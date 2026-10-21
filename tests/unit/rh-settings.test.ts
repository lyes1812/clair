import { describe, expect, it } from "vitest";
import { DEFAULT_HEADCOUNT_NATURES, parseNatureCodes } from "@/lib/rh-settings";

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
