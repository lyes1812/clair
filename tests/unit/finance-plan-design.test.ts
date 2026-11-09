import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinancePlanGrid } from "@/app/e/[slug]/studio-finance/FinancePlanGrid";
import type { FinancePlan } from "@/lib/finance/types";

const manualPlan: FinancePlan = {
  id: "11111111-1111-4111-8111-111111111111", name: "Prévision fictive", kind: "forecast", year: 2026,
  currency: "EUR", firstForecastMonth: "2026-10", personnelSource: "manual", rhScenarioId: null,
  cells: { "2026-01": { revenue: 12345, personnel: 0 }, "2026-02": { "other-expenses": -125 }, "2026-10": { revenue: 65432 } },
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const grid = (plan: FinancePlan | null) => renderToStaticMarkup(createElement(FinancePlanGrid, { plan, year: 2026, rhOptions: [] }));
const amountInputs = (html: string) => [...html.matchAll(/<input\b[^>]*name="cell:[^"]+"[^>]*>/g)].map((match) => match[0]);
const namedInput = (inputs: string[], name: string) => inputs.find((input) => input.includes(`name="${name}"`)) ?? "";

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

  it("une prévision distingue le réel utilisé des anciennes saisies, préservées dans les 48 champs soumis", () => {
    const html = grid(manualPlan);
    const inputs = amountInputs(html);
    expect(inputs).toHaveLength(48);
    for (const input of inputs) {
      const month = input.match(/name="cell:(\d{4}-\d{2}):/)![1];
      expect(input.includes('readOnly=""')).toBe(month < "2026-10");
      expect(input).not.toContain('disabled=""');
      if (month < "2026-10") expect(input).toContain('aria-describedby="finance-plan-grid-help"');
    }
    expect(namedInput(inputs, "cell:2026-01:revenue")).toContain('value="123,45"');
    expect(namedInput(inputs, "cell:2026-01:personnel")).toContain('value="0"');
    expect(namedInput(inputs, "cell:2026-02:other-expenses")).toContain('value="-1,25"');
    expect(namedInput(inputs, "cell:2026-10:revenue")).toContain('value="654,32"');
    expect(namedInput(inputs, "cell:2026-12:revenue")).toContain('value=""');
    expect(html.match(/>Réel utilisé<\//g)).toHaveLength(9);
    expect(html.match(/>Hypothèses<\//g)).toHaveLength(3);
    const help = html.match(/<p[^>]*id="finance-plan-grid-help"[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(help).toContain("conservent d’anciennes saisies non utilisées");
    expect(help).toContain("leurs valeurs ne sont pas le réel comptable");
    expect(html.match(/id="finance-plan-grid-help"/g)).toHaveLength(1);
    expect(html).toContain('name="firstForecastMonth" required="" aria-describedby="finance-plan-grid-help"');
    expect(html).toContain('<option value="2026-10" selected="">Octobre 2026</option>');
  });

  it("un budget utilise les douze mois d’hypothèses et conserve les mêmes montants sans les verrouiller", () => {
    const forecastInputs = amountInputs(grid(manualPlan));
    const html = grid({ ...manualPlan, kind: "budget", firstForecastMonth: null });
    const budgetInputs = amountInputs(html);
    const submittedValues = (inputs: string[]) => inputs.map((input) => [input.match(/name="([^"]+)"/)![1], input.match(/value="([^"]*)"/)![1]]);
    expect(submittedValues(budgetInputs)).toEqual(submittedValues(forecastInputs));
    expect(budgetInputs.every((input) => !input.includes('readOnly=""') && !input.includes('disabled=""'))).toBe(true);
    expect(html.match(/>Hypothèses<\//g)).toHaveLength(12);
    expect(html).not.toContain("Réel utilisé");
    expect(html).toContain('type="hidden" name="firstForecastMonth" value=""');
  });

  it("la protection RH se cumule avec la bascule, sans faire passer le personnel manuel pour la source retenue", () => {
    const html = grid({ ...manualPlan, personnelSource: "rh", rhScenarioId: "22222222-2222-4222-8222-222222222222" });
    const inputs = amountInputs(html);
    expect(inputs).toHaveLength(48);
    for (const input of inputs) {
      const [, month, row] = input.match(/name="cell:(\d{4}-\d{2}):([a-z-]+)"/)!;
      const expected = month < "2026-10" || row === "personnel";
      expect(input.includes('readOnly=""')).toBe(expected);
      expect(input).not.toContain('disabled=""');
      if (expected) expect(input).toContain('aria-describedby="finance-plan-grid-help"');
    }
    expect(inputs.filter((input) => input.includes('readOnly=""'))).toHaveLength(39);
    expect(html).toContain("Scénario RH : saisies manuelles conservées, non utilisées.");
    expect(html).toContain("Le scénario fournit le personnel projeté.");
    expect(namedInput(inputs, "cell:2026-01:personnel")).toContain('value="0"');
  });

  it("sans bascule choisie, conserve le choix obligatoire sans inventer de mois comptable", () => {
    const html = grid({ ...manualPlan, firstForecastMonth: null });
    const select = html.match(/<select[^>]*name="firstForecastMonth"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toContain('required=""');
    expect(select).toContain('<option value="" disabled="" selected="">Choisir le mois…</option>');
    expect(select.match(/<option[^>]* selected=""/g)).toEqual(['<option value="" disabled="" selected=""']);
    expect(html).toContain("Aucun mois n’est choisi à ta place.");
    expect(html).not.toContain("Réel utilisé");
    expect(html).not.toContain('class="finance-plan-month-origin"');
    const inputs = amountInputs(html);
    expect(inputs).toHaveLength(48);
    expect(inputs.every((input) => !input.includes('readOnly=""') && !input.includes('disabled=""'))).toBe(true);
    expect(namedInput(inputs, "cell:2026-01:revenue")).toContain('value="123,45"');
    const fresh = grid(null);
    expect(amountInputs(fresh)).toHaveLength(48);
    expect(amountInputs(fresh).every((input) => input.includes('value=""'))).toBe(true);
  });
});
