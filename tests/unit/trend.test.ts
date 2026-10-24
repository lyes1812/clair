import { describe, expect, it } from "vitest";
import { costTone, trendClass } from "@/lib/trend";

// Tendance d'un coût : hausse = rouge, baisse = vert, nulle ou inconnue = neutre.
describe("tendance financière d'un coût", () => {
  it("+3 550,00 € de masse salariale : tendance négative (rouge) ; −79,51 € : positive (verte) ; 0 ou n.d. : neutre", () => {
    expect(costTone(355000)).toBe("bad");
    expect(costTone(-7951)).toBe("good");
    expect(costTone(0)).toBe("flat");
    expect(costTone(null)).toBe("flat");
    expect(costTone(undefined)).toBe("flat");
  });
  it("classes CSS : trend-bad, trend-good, aucune classe pour le neutre", () => {
    expect([trendClass("bad"), trendClass("good"), trendClass("flat")]).toEqual(["trend-bad", "trend-good", ""]);
  });
});
