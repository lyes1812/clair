import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: () => { throw new Error("Accès base interdit dans ce test fictif"); } }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: () => { throw new Error("Accès utilisateur interdit dans ce test fictif"); } }));
vi.mock("@/lib/connectors/sync", () => ({ lastSync: () => { throw new Error("Lecture source interdite dans ce test fictif"); }, activeSync: () => { throw new Error("Lecture source interdite dans ce test fictif"); } }));
import { LandingView } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";
import type { Retraite } from "@/lib/budget/lot3";

describe("Atterrissage : qualification visible de la ventilation calculée", () => {
  it("affiche l’estimation dans les vues graphique et tableau, sans la présenter comme une paie journalière observée", () => {
    const retraite: Retraite = { kind: "value", year: "2026", atterrissage: 120_000, realised: 2_000, projected: 0, total: 2_000, retraite: 118_000,
      rows: [{ label: "Tuilages réalisés — estimation calendaire", realised: 2_000, projected: 0 }], qualification: "Estimation calendaire : ventilation calculée, pas observée ; brut inchangé." };
    for (const affichage of ["graphique", "tableau"]) {
      const html = renderToStaticMarkup(createElement(LandingView, { hrefBase: "/e/fictif/studio-rh/hypotheses", scenarioId: "scenario-fictif", year: "2026",
        landing: { kind: "value", year: "2026", actual: 90_000, prior: 0, projected: 30_000, total: 120_000, actualMonths: ["2026-01"], priorMonths: [], projectedMonths: ["2026-12"] },
        retraite, measures: { kind: "value", year: "2026", rows: [] }, sens: [], options: [], chosen: [], affichage }));
      expect(html).toContain('data-testid="atr-overlap-qualification"');
      expect(html).toContain("ventilation calculée, pas observée");
      if (affichage === "tableau") expect(html).toContain("Tuilages réalisés — estimation calendaire");
    }
  });
});
