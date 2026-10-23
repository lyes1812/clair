import { describe, expect, it } from "vitest";
import { foldText, monthCount, sizeFmt, syncTone } from "@/app/e/[slug]/donnees/ui";

// Cas de référence écrits à la main : aucun résultat n'est recalculé par le code testé.
describe("écrans Données : aides de présentation", () => {
  it("monthCount : nombre de mois d'une période, bornes incluses", () => {
    expect(monthCount("2024-10", "2026-09")).toBe(24); // octobre 2024 → septembre 2026 = 3 + 12 + 9
    expect(monthCount("2025-01", "2025-01")).toBe(1);
    expect(monthCount("2024-02", "2025-02")).toBe(13);
    expect(monthCount("2025-12", "2026-01")).toBe(2); // passage d'année
  });

  it("monthCount : période inversée ou mal formée = null (jamais 0)", () => {
    expect(monthCount("2025-12", "2025-01")).toBeNull();
    expect(monthCount("", "2025-01")).toBeNull();
    expect(monthCount("2025-1", "2025-02")).toBeNull();
    expect(monthCount("2025-13", "2025-14")).toBeNull();
  });

  it("sizeFmt : octets, Ko arrondis, Mo à une décimale en virgule française", () => {
    expect(sizeFmt(512)).toBe("512 o");
    expect(sizeFmt(5300)).toBe("5 Ko"); // 5300 ÷ 1024 = 5,18
    expect(sizeFmt(1572864)).toBe("1,5 Mo"); // 1,5 × 1024 × 1024
  });

  it("syncTone : une teinte par état de lecture, le reste est neutre", () => {
    expect(syncTone("applied")).toBe("applied");
    expect(syncTone("preview")).toBe("preview");
    expect(syncTone("running")).toBe("running");
    expect(syncTone("failed")).toBe("failed");
    for (const s of ["superseded", "discarded", "unchanged", "inconnu"]) expect(syncTone(s)).toBe("neutral");
  });

  it("foldText : filtre sans accents ni casse", () => {
    expect(foldText("Éloïse Çelik")).toBe("eloise celik");
    expect(foldText("CDI (01)")).toBe("cdi (01)");
  });
});
