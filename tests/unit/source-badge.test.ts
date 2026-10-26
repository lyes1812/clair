import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceBadge } from "@/components/SourceBadge";
import type { SourceResolution } from "@/lib/sources";

const source: SourceResolution = {
  domain: "rh", mode: "auto", chosen: "payfit", reason: "API connectée et appliquée.",
  apiApplied: true, filesApplied: false, appliedAt: new Date("2026-01-15T10:00:00Z"),
  modeSetAt: null, modeSetBy: null,
};
const render = (changes: Partial<SourceResolution> = {}) => renderToStaticMarkup(h(SourceBadge, { resolution: { ...source, ...changes }, slug: "fixture" }));

describe("bandeau de source : contexte unique, avertissements conservés", () => {
  it.each(["payfit", "pennylane"] as const)("allège seulement la confirmation automatique %s déjà portée par la source et sa date", (chosen) => {
    const html = render({ chosen, domain: chosen === "payfit" ? "rh" : "accounting" });
    expect(html).toContain(chosen === "payfit" ? "PayFit" : "Pennylane");
    expect(html).toContain("lecture appliquée le");
    expect(html).toContain('href="/e/fixture/donnees"');
    expect(html).not.toContain(source.reason);
  });

  it("conserve les fichiers concurrents non utilisés, même avec une API appliquée", () => {
    const reason = "API connectée et appliquée : elle fait foi (des fichiers sont aussi appliqués, non utilisés).";
    expect(render({ filesApplied: true, reason })).toContain(reason);
  });

  it("conserve les raisons de n.d. et la provenance fichier", () => {
    const reason = "Aucune source appliquée pour ce domaine.";
    const html = render({ chosen: null, appliedAt: null, apiApplied: false, reason });
    expect(html).toContain("n.d.");
    expect(html).toContain(reason);
    expect(html).not.toContain("lecture appliquée le");
    const fileReason = "Aucune lecture API appliquée : les fichiers déposés font foi.";
    expect(render({ chosen: "dsn", apiApplied: false, filesApplied: true, reason: fileReason })).toContain(fileReason);
  });

  it("conserve le choix forcé et sa date", () => {
    const html = render({ mode: "api", reason: "API choisie par l'administrateur.", modeSetAt: new Date("2026-01-16T10:00:00Z") });
    expect(html).toContain("API choisie par l&#x27;administrateur.");
    expect(html).toContain("Choix forcé par l&#x27;administrateur le");
  });

  it("ne retire pas une raison dès qu'une confirmation ou une date manque", () => {
    for (const changes of [{ appliedAt: null }, { apiApplied: false }, { filesApplied: true }, { chosen: "dsn" as const }, { mode: "api" as const }]) {
      expect(render(changes)).toContain(source.reason);
    }
    expect(render({ reason: "Lecture partielle : contrats archivés absents." })).toContain("Lecture partielle : contrats archivés absents.");
  });
});
