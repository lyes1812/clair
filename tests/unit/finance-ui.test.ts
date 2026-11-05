import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FinanceView } from "@/app/e/[slug]/studio-finance/FinanceView";
import { FinancePlanGrid } from "@/app/e/[slug]/studio-finance/FinancePlanGrid";
import type { FinanceMonth, FinancePlan, FinanceProjectionMonth } from "@/lib/finance/types";
import type { FinanceViewProps } from "@/lib/finance/view-types";

// Petits montants fictifs écrits à la main : aucune source client ni appel externe.
const cell = (cents: number) => ({ cents, reason: null });
const month = (key: string): FinanceMonth => ({ month: key, cells: { revenue: cell(100_000), "other-income": cell(5_000), personnel: cell(40_000), "other-expenses": cell(15_000) }, result: cell(50_000), lineCount: 4 });
const action = async () => undefined;
const plan: FinancePlan = {
  id: "00000000-0000-4000-8000-000000000001", name: "Budget fictif", kind: "budget", year: 2026, currency: "EUR", firstForecastMonth: null,
  cells: { "2026-01": { revenue: 12345, personnel: 0 }, "2026-02": { "other-expenses": -125 } }, personnelSource: "manual", rhScenarioId: null, updatedAt: "2026-01-01T00:00:00.000Z",
};
function props(patch: Partial<FinanceViewProps> = {}): FinanceViewProps {
  return {
    slug: "espace-fictif", workspaceName: "Espace fictif", year: 2026, years: [2025, 2026], from: "2026-01", to: "2026-02", view: "overview", months: ["2026-01", "2026-02"],
    actuals: { months: [month("2026-01"), month("2026-02"), month("2026-03")], accounts: [{ account: "641000", row: "personnel", months: { "2026-01": cell(40_000), "2026-02": cell(40_000), "2026-03": cell(40_000) }, total: cell(120_000), lineCount: 3 }] },
    previous: { months: [month("2025-01"), month("2025-02")], accounts: [] },
    selectedPlan: plan, projection: null, selectedBudget: plan, budgetMonths: null, plans: [plan], mappings: [], revision: 7,
    source: { domain: "accounting", mode: "files", chosen: "fec", reason: "Fichier fictif appliqué.", apiApplied: false, filesApplied: true, appliedAt: null, modeSetAt: null, modeSetBy: null },
    sourceNotice: "Lecture fictive de deux mois ; une lecture ne prouve pas la clôture comptable.", rhOptions: [{ id: "00000000-0000-4000-8000-000000000002", name: "Scénario fictif", firstMonth: "2026-01", lastMonth: "2026-12" }], canEdit: true, canAdmin: true,
    savePlan: action, duplicatePlan: action, saveMappings: action, ...patch,
  };
}
const html = (patch: Partial<FinanceViewProps> = {}) => renderToStaticMarkup(createElement(FinanceView, props(patch)));
const table = (value: string, testid: string) => value.match(new RegExp(`<table[^>]*data-testid="${testid}"[\\s\\S]*?</table>`))?.[0] ?? "";

describe("présentation Studio Finance — lectures fictives", () => {
  it("conserve année, période, plan et budget entre vues et dans les exports", () => {
    const value = html();
    expect(value).toContain('name="debut"');
    expect(value).toContain('value="2026-01" selected=""');
    expect(value).toContain('value="2026-02" selected=""');
    for (const view of ["overview", "pnl", "mapping", "plans", "variance"]) {
      expect(value).toContain(`vue=${view}&amp;annee=2026&amp;debut=2026-01&amp;fin=2026-02&amp;plan=${plan.id}&amp;budget=${plan.id}`);
    }
    for (const format of ["xlsx", "csv"]) expect(value).toContain(`/studio-finance/export?vue=overview&amp;annee=2026&amp;debut=2026-01&amp;fin=2026-02&amp;plan=${plan.id}&amp;budget=${plan.id}&amp;format=${format}`);
    expect(value).toContain("ne prouve pas la clôture comptable");
  });

  it("les cumuls de période ne prennent pas mars inclus dans le modèle annuel", () => {
    const value = html({ view: "pnl" });
    const accounts = table(value, "finance-accounts-table");
    expect(accounts).toContain('data-money-cents="80000"');
    expect(accounts).not.toContain('data-money-cents="120000"');
    expect(table(value, "finance-pnl-table")).toContain('data-money-cents="200000"');
    expect(table(value, "finance-previous-table")).toContain("Janvier 2025");
  });

  it("un mois n.d. bloque le cumul au lieu d’afficher un total partiel", () => {
    const input = props();
    input.actuals.months[1].cells.revenue = { cents: null, reason: "Débit manquant dans la lecture fictive." };
    const value = html({ actuals: input.actuals, view: "pnl" });
    expect(table(value, "finance-pnl-table")).toContain("Débit manquant dans la lecture fictive.");
    expect(table(value, "finance-pnl-table")).not.toContain('data-money-cents="200000"');
  });

  it("les écarts restent n.d. sans budget explicitement sélectionné", () => {
    const value = html({ view: "variance", selectedBudget: null });
    expect(value).toContain("sélectionne un budget de comparaison");
    expect(value).not.toContain('data-testid="finance-variance-table"');
  });

  it.each(["overview", "variance"] as const)("%s : sans plan, propose la saisie existante sans remplir de budget ni perdre la période", (view) => {
    const value = html({ view, selectedPlan: null, projection: null, selectedBudget: null, budgetMonths: null, plans: [], canEdit: false });
    const target = value.match(/<a href="([^"]+)">Ouvrir Budget et prévision<\/a>/)?.[1];
    expect(target).toBeDefined();
    const url = new URL(target!.replaceAll("&amp;", "&"), "https://clair.invalid");
    expect(url.pathname).toBe("/e/espace-fictif/studio-finance");
    expect([...url.searchParams]).toEqual([["vue", "plans"], ["annee", "2026"], ["debut", "2026-01"], ["fin", "2026-02"]]);
    expect(value).not.toContain('data-testid="finance-variance-table"');
    expect(value).not.toContain('data-testid="finance-plan-save"');
  });

  it("affiche l’écart réel moins budget au centime fourni, sans inverser les charges", () => {
    const first = { ...month("2026-01"), origin: "plan" as const, personnelOrigin: "manual" as const };
    first.cells = { ...first.cells, personnel: cell(35_000) };
    const second = { ...month("2026-02"), origin: "plan" as const, personnelOrigin: "manual" as const };
    second.cells = { ...second.cells, personnel: cell(35_000) };
    const value = html({ view: "variance", budgetMonths: [first, second] });
    expect(table(value, "finance-variance-table")).toContain('data-money-cents="10000"');
    expect(value).toContain("Écart = réel − budget");
  });

  it("les rôles lecteurs n’ont pas de formulaire de plan ni de correspondance", () => {
    const common = { canEdit: false, canAdmin: false };
    expect(html({ ...common, view: "plans" })).not.toContain('data-testid="finance-plan-save"');
    expect(html({ ...common, view: "plans" })).toContain("Lecture seule");
    expect(html({ ...common, view: "mapping" })).not.toContain('name="account"');
    expect(html({ ...common, view: "mapping" })).not.toContain('data-testid="finance-mapping-save"');
  });

  it("transmet les correspondances compte/ligne alignées et garde la révision", () => {
    const value = html({ view: "mapping" });
    expect(value).toContain('name="revision" value="7"');
    expect(value).toContain('name="account" value="641000"');
    expect(value).toMatch(/name="row"[\s\S]*value="personnel" selected=""/);
  });

  it("borne le formulaire de correspondances à 256 sans annoncer la suppression des autres", () => {
    const input = props();
    input.actuals.accounts = Array.from({ length: 257 }, (_, index) => ({ account: `641${String(index).padStart(3, "0")}`, row: "personnel", months: {}, total: cell(0), lineCount: 0 }));
    const value = html({ view: "mapping", actuals: input.actuals });
    expect(value.match(/name="account"/g)).toHaveLength(256);
    expect(value).toContain("autres correspondances sont conservées");
  });
});

describe("saisie financière fictive — euros et douze mois", () => {
  it("nouveau plan : 48 cellules, aucune valeur fabriquée et aucun scénario préchoisi", () => {
    const value = html({ view: "plans", selectedPlan: null });
    expect(value).toContain('name="id" value="new"');
    expect(value.match(/name="cell:2026-\d{2}:[a-z-]+"/g)).toHaveLength(48);
    expect(value).toContain('name="firstForecastMonth" value=""');
    expect(value).toContain('name="rhScenarioId" value=""');
    expect(value).toContain("Vide = non renseigné");
  });

  it("les centimes restent décimaux dans les saisies, y compris négatifs et zéro", () => {
    const value = html({ view: "plans" });
    expect(value).toMatch(/name="cell:2026-01:revenue"[^>]*value="123,45"/);
    expect(value).toMatch(/name="cell:2026-01:personnel"[^>]*value="0"/);
    expect(value).toMatch(/name="cell:2026-02:other-expenses"[^>]*value="-1,25"/);
    expect(value).toMatch(/name="cell:2026-12:revenue"[^>]*value=""/);
  });

  it("prévision RH : mois de bascule et choix explicite du scénario, saisies manuelles préservées", () => {
    const input = props();
    const forecast = { ...plan, kind: "forecast" as const, firstForecastMonth: "2026-10", personnelSource: "rh" as const, rhScenarioId: input.rhOptions[0].id };
    const value = renderToStaticMarkup(createElement(FinancePlanGrid, { plan: forecast, year: 2026, rhOptions: input.rhOptions }));
    expect(value).toMatch(/name="firstForecastMonth"[\s\S]*value="2026-10" selected=""/);
    expect(value).toMatch(/name="rhScenarioId"[\s\S]*value="00000000-0000-4000-8000-000000000002" selected=""/);
    expect(value).toContain("Choisir explicitement un scénario");
    const personnelCell = value.match(/<input[^>]*name="cell:2026-01:personnel"[^>]*>/)?.[0] ?? "";
    expect(personnelCell).toContain('readOnly=""');
    expect(personnelCell).toContain('value="0"');
    expect(value).toContain("saisies manuelles conservées, non utilisées");
  });
});

describe("Finance vers les hypothèses RH explicitement retenues", () => {
  const source = { id: "abcdefab-0000-4000-8000-000000000002", name: "Prévision RH fictive", firstMonth: "2026-01", lastMonth: "2026-12" };
  const rhPlan: FinancePlan = { ...plan, name: "Budget lié au RH", personnelSource: "rh", rhScenarioId: source.id };
  const projection: FinanceProjectionMonth[] = ["2026-01", "2026-02"].map((key) => ({ ...month(key), origin: "plan", personnelOrigin: "rh" }));
  const sourceNote = (value: string) => value.match(/<p[^>]*data-testid="finance-rh-source"[\s\S]*?<\/p>/)?.[0] ?? "";
  const links = (value: string) => [...value.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)].map((match) => new URL(match[1].replaceAll("&amp;", "&"), "https://clair.invalid"));

  it.each(["overview", "pnl", "plans"] as const)("%s : ouvre le scénario choisi dans le même espace et expose sa période", (view) => {
    const value = html({ view, selectedPlan: rhPlan, projection, rhOptions: [source], canEdit: false });
    const note = sourceNote(value);
    const target = links(note)[0];
    expect(note).toContain("Budget lié au RH");
    expect(note).toContain("Prévision RH fictive");
    expect(note).toContain("Janvier 2026 à Décembre 2026");
    expect(note).toContain("Le réel comptable reste inchangé");
    expect(links(note)).toHaveLength(1);
    expect(target.pathname).toBe("/e/espace-fictif/studio-rh/hypotheses");
    expect([...target.searchParams]).toEqual([["scenario", source.id]]);
    // Ajouter l’accès à la source ne change ni le réel ni les résultats fournis.
    if (view === "pnl") {
      const baseline = html({ view, selectedPlan: plan, projection });
      expect(table(value, "finance-pnl-table")).toBe(table(baseline, "finance-pnl-table"));
      expect(table(value, "finance-projection-table").match(/data-money-cents="\d+"/g)).toEqual(table(baseline, "finance-projection-table").match(/data-money-cents="\d+"/g));
    }
  });

  it("reconnaît l’identifiant sélectionné sans changer de scénario lorsque sa casse diffère", () => {
    const value = html({ view: "pnl", selectedPlan: { ...rhPlan, rhScenarioId: source.id.toUpperCase() }, projection, rhOptions: [source] });
    expect(links(sourceNote(value))[0].searchParams.get("scenario")).toBe(source.id);
    expect(sourceNote(value)).not.toContain("indisponible");
  });

  it("un scénario indisponible reste n.d. et ne renvoie pas vers un autre scénario disponible", () => {
    const unavailable = projection.map((row) => ({ ...row, cells: { ...row.cells, personnel: { cents: null, reason: "Projection RH indisponible pour ce mois." } } }));
    const replacement = { ...source, id: "99999999-9999-4999-8999-999999999999", name: "Autre scénario fictif" };
    const value = html({ view: "pnl", selectedPlan: rhPlan, projection: unavailable, rhOptions: [replacement] });
    const note = sourceNote(value);
    expect(note).toContain("scénario RH sélectionné indisponible dans cet espace");
    expect(note).toContain("Aucune autre source RH n’est choisie à sa place");
    expect(links(note)[0].pathname).toBe("/e/espace-fictif/studio-rh/hypotheses");
    expect(links(note)[0].search).toBe("");
    expect(note).not.toContain(replacement.name);
    expect(table(value, "finance-projection-table")).toContain("Projection RH indisponible pour ce mois.");
  });

  it("une saisie manuelle ou l’absence de plan ne crée aucun accès présenté comme source RH", () => {
    const manual = projection.map((row) => ({ ...row, personnelOrigin: "manual" as const }));
    expect(sourceNote(html({ view: "pnl", selectedPlan: plan, projection: manual, rhOptions: [source] }))).toBe("");
    expect(sourceNote(html({ selectedPlan: null, projection: null, rhOptions: [source] }))).toBe("");
  });

  it("une période entièrement comptable ne fait pas passer son personnel pour une projection RH", () => {
    const actual: FinanceProjectionMonth[] = projection.map((row) => ({ ...row, origin: "actual", personnelOrigin: "accounting" }));
    actual.push({ ...month("2026-10"), origin: "plan", personnelOrigin: "rh" });
    const forecast = { ...rhPlan, kind: "forecast" as const, firstForecastMonth: "2026-10" };
    for (const view of ["overview", "pnl"] as const) expect(sourceNote(html({ view, selectedPlan: forecast, projection: actual, rhOptions: [source] }))).toBe("");
    // La lecture annuelle du plan contient en revanche octobre, réellement issu du RH.
    expect(sourceNote(html({ view: "plans", selectedPlan: forecast, projection: actual, rhOptions: [source], canEdit: false }))).toContain(source.name);
  });

  it("les écarts ouvrent la source du budget comparé, pas celle d’un autre plan affiché", () => {
    const other = { ...source, id: "99999999-9999-4999-8999-999999999999", name: "Autre prévision RH fictive" };
    const value = html({ view: "variance", selectedPlan: { ...rhPlan, id: "88888888-8888-4888-8888-888888888888", rhScenarioId: other.id }, selectedBudget: rhPlan, budgetMonths: projection, rhOptions: [other, source] });
    const note = sourceNote(value);
    expect(links(note)[0].searchParams.get("scenario")).toBe(source.id);
    expect(note).not.toContain(other.name);
    expect(note).toContain(rhPlan.name);
    expect(table(value, "finance-variance-table")).toContain('data-money-cents="0"');
  });
});
