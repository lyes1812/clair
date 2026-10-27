import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinancePlanGrid } from "@/app/e/[slug]/studio-finance/FinancePlanGrid";
import type { FinancePlan } from "@/lib/finance/types";

describe("grille Finance — composants Clair partagés, données fictives", () => {
  it("recherche facultative au seuil commun, choix RH natif obligatoire et 48 montants intacts", () => {
    for (const count of [6, 7]) {
      const rhOptions = Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: `Scénario fictif ${index + 1}`, firstMonth: "2026-01", lastMonth: "2026-12",
      }));
      const selected = rhOptions[count - 1];
      const plan: FinancePlan = {
        id: "11111111-1111-4111-8111-111111111111", name: "Prévision fictive", kind: "forecast", year: 2026,
        currency: "EUR", firstForecastMonth: "2026-10", personnelSource: "rh", rhScenarioId: selected.id,
        cells: { "2026-01": { revenue: 12345, personnel: 0 }, "2026-02": { "other-expenses": -125 } }, updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const html = renderToStaticMarkup(createElement(FinancePlanGrid, { plan, year: 2026, rhOptions }));
      expect(html).toContain('<table class="data-table sticky sticky-first">');
      expect(html.match(/name="cell:2026-\d{2}:[a-z-]+"/g)).toHaveLength(48);
      expect(html).toMatch(/name="cell:2026-01:revenue"[^>]*value="123,45"/);
      const personnel = html.match(/<input[^>]*name="cell:2026-01:personnel"[^>]*>/)?.[0] ?? "";
      expect(personnel).toContain('readOnly=""');
      expect(personnel).toContain('value="0"');
      expect(html).toMatch(/name="cell:2026-02:other-expenses"[^>]*value="-1,25"/);
      expect(html).toMatch(/name="cell:2026-12:revenue"[^>]*value=""/);
      expect(html).toContain('name="rhScenarioId" required="" aria-describedby="finance-plan-rh-hint"');
      expect(html.match(/name="rhScenarioId"/g)).toHaveLength(1);
      expect(html).toContain('<option value="" disabled="">Choisir explicitement un scénario…</option>');
      expect(html).toContain(`<option value="${selected.id}" selected="">${selected.name} · Janvier 2026 → Décembre 2026</option>`);
      expect(html).toContain('<label for="finance-plan-rh">Scénario RH</label>');
      expect(html).toContain('id="finance-plan-rh-hint"');
      expect(html).toContain("Montants saisis en euros, avec décimales possibles. Vide = non renseigné ; 0 = montant nul.");
      if (count === 7) expect(html).toContain('type="button" class="btn filter-choice-toggle" aria-label="Rechercher : Scénario RH"');
      else expect(html).not.toContain('aria-label="Rechercher : Scénario RH"');
      expect(html).not.toMatch(/type="submit"|name="q"|name="search"/);
    }
  });

  it("un scénario RH indisponible garde le choix vide obligatoire, sans sélectionner le premier disponible", () => {
    const rhOptions = Array.from({ length: 8 }, (_, index) => ({
      id: `abcdefab-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Scénario fictif ${index + 1}`, firstMonth: "2026-01", lastMonth: "2026-12",
    }));
    const plan: FinancePlan = {
      id: "11111111-1111-4111-8111-111111111111", name: "Budget fictif", kind: "budget", year: 2026,
      currency: "EUR", firstForecastMonth: null, personnelSource: "rh", rhScenarioId: "99999999-9999-4999-8999-999999999999",
      cells: {}, updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(FinancePlanGrid, { plan, year: 2026, rhOptions }));
    const select = html.match(/<select[^>]*name="rhScenarioId"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toContain('required=""');
    expect(select).toContain('<option value="" disabled="" selected="">Choisir explicitement un scénario…</option>');
    expect(select.match(/<option[^>]* selected=""/g)).toEqual(['<option value="" disabled="" selected=""']);
    expect(html).toContain("Scénario RH indisponible : choisis un scénario avant d’enregistrer.");
    expect(select).not.toContain(plan.rhScenarioId!);

    const canonical = renderToStaticMarkup(createElement(FinancePlanGrid, { plan: { ...plan, rhScenarioId: rhOptions[1].id.toUpperCase() }, year: 2026, rhOptions }));
    expect(canonical).toContain(`<option value="${rhOptions[1].id}" selected="">`);
    expect(canonical).not.toContain("Scénario RH indisponible");
  });
});
