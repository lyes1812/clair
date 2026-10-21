import { describe, expect, it } from "vitest";
import { resolveSourceMode } from "@/lib/sources";

// Règle validée : l'API fait foi si connectée et appliquée, sinon les fichiers ; l'administrateur peut forcer.
describe("source retenue par domaine", () => {
  it.each([
    ["auto", true, true, "api"],
    ["auto", true, false, "api"],
    ["auto", false, true, "files"],
    ["auto", false, false, null],
    ["api", true, true, "api"],
    ["api", false, true, null],
    ["files", true, true, "files"],
    ["files", true, false, null],
  ] as const)("mode %s, API %s, fichiers %s → %s", (mode, api, files, pick) => {
    expect(resolveSourceMode(mode, api, files).pick).toBe(pick);
  });
  it("explique toujours pourquoi, y compris quand rien n'est retenu", () => {
    expect(resolveSourceMode("api", false, true).reason).toContain("aucune lecture API appliquée");
    expect(resolveSourceMode("auto", false, false).reason).toContain("Aucune source appliquée");
    expect(resolveSourceMode("auto", true, true).reason).toContain("non utilisés");
  });
});
