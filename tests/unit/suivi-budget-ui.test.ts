import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SuiviView } from "@/app/e/[slug]/studio-rh/masse-salariale/suivi/SuiviView";
import { SuiviChart } from "@/app/e/[slug]/studio-rh/masse-salariale/suivi/SuiviChart";
import type { SuiviCell, SuiviGap, SuiviModel, SuiviMonth } from "@/lib/viz/suivi-budget";

// Valeurs et références entièrement fictives, sans accès à la base ni aux API.
const amount = (cents: number): SuiviCell => ({ kind: "value", cents });
const nd = (reason = "Mois fictif non lu."): Extract<SuiviCell, { kind: "nd" }> => ({ kind: "nd", reason });
const delta = (cents = 10_000): SuiviGap => ({ kind: "value", cents, pct: { num: 1, den: 13 }, pctReason: null });
function fixture(): SuiviModel {
  const rows: SuiviMonth[] = Array.from({ length: 12 }, (_, index) => {
    const month = `2026-${String(index + 1).padStart(2, "0")}`;
    const afterCutoff = index > 2;
    return { month, actual: afterCutoff ? nd("après la clôture retenue") : index === 1 ? nd() : amount(140_000), reference: amount(index === 2 ? 0 : 130_000), gap: afterCutoff ? nd("après la clôture retenue") : index === 1 ? nd() : index === 2 ? { kind: "value", cents: 140_000, pct: null, pctReason: "Référence nulle : pourcentage non défini." } : delta(), origin: index < 2 ? "Réel figé" : "Projeté", actualHref: afterCutoff || index === 1 ? null : `/e/espace-fictif/studio-rh/masse-salariale?mois=${month}#ms-detail`, referenceHref: `/e/espace-fictif/studio-rh/hypotheses?scenario=scenario-fictif&mois=${month}#proj-detail`, afterCutoff };
  });
  return {
    slug: "espace-fictif", years: ["2025", "2026"], options: [
      { value: "budget:budget-fictif", label: "Budget fictif 2026", kind: "budget", years: ["2026"], href: "/e/espace-fictif/studio-rh/hypotheses" },
      { value: "scenario:scenario-fictif", label: "Scénario fictif", kind: "scenario", years: ["2025", "2026"], href: "/e/espace-fictif/studio-rh/hypotheses?scenario=scenario-fictif" },
    ],
    state: { annee: "2026", reference: "scenario:scenario-fictif", cloture: "2026-03", affichage: "tout" },
    reference: { kind: "scenario", label: "Scénario fictif", href: "/e/espace-fictif/studio-rh/hypotheses?scenario=scenario-fictif" },
    source: { label: "PayFit", readAt: "2026-03-31T22:30:00.000Z", href: "/e/espace-fictif/donnees" },
    cutoffOptions: ["2026-01", "2026-03"], cutoff: "2026-03", notices: [], reason: null, rows,
    totals: { actual: nd(), reference: amount(260_000), gap: nd() },
    chart: { months: rows.map((row) => row.month), actual: rows.map((row) => row.actual.kind === "value" ? row.actual.cents : null), reference: rows.map((row) => row.reference.kind === "value" ? row.reference.cents : null) },
  };
}
const html = (model = fixture()) => renderToStaticMarkup(createElement(SuiviView, { model }));
const table = (value: string) => value.match(/<table[^>]*data-testid="suivi-table"[\s\S]*?<\/table>/)?.[0] ?? "";
const rowHtml = (value: string, month: string) => table(value).match(new RegExp(`<tr[^>]*data-month="${month}"[\\s\\S]*?<\\/tr>`))?.[0] ?? "";

describe("Suivi réel / budget — interface des agrégats fictifs", () => {
  it("conserve année, référence explicite, clôture et affichage dans les contrôles GET et liens de vue", () => {
    const value = html();
    expect(value).toContain('method="get"');
    expect(value).toContain('name="annee"');
    expect(value).toContain('value="2026" selected=""');
    expect(value).toContain('name="reference"');
    expect(value).toContain('value="scenario:scenario-fictif" selected=""');
    expect(value).toContain('value="2026-03" selected=""');
    expect(value).toContain('name="affichage" value="tout"');
    for (const affichage of ["tout", "graphique", "tableau"]) expect(value).toContain(`annee=2026&amp;reference=scenario%3Ascenario-fictif&amp;cloture=2026-03&amp;affichage=${affichage}`);
  });

  it("ne sélectionne jamais le premier budget quand aucune référence n’a été choisie", () => {
    const model = fixture(); model.reference = null; model.state.reference = "";
    model.totals.reference = nd("Choisis une référence."); model.totals.gap = nd("Choisis une référence.");
    const value = html(model);
    expect(value).toContain('<option value="" selected="">Choisir une référence</option>');
    expect(value).not.toContain('value="budget:budget-fictif" selected=""');
    expect(value).not.toContain('value="scenario:scenario-fictif" selected=""');
    expect(value).toContain('data-testid="suivi-choose-reference"');
    expect(value).toContain("Choisis un budget ou un scénario de référence");
  });

  it("garde le cumul fourni n.d. sans le remplacer par la somme des seuls mois connus", () => {
    const value = html();
    const actual = value.match(/<div[^>]*data-testid="suivi-total-actual"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(actual).toContain("n.d.");
    expect(actual).not.toContain('data-money-cents=');
    expect(value).toContain('data-money-cents="260000"');
    expect(value).toContain("Janvier → mars 2026");
  });

  it("présente les douze mois, origines et liens exacts des montants agrégés", () => {
    const value = html();
    expect(table(value).match(/data-month=/g)).toHaveLength(12);
    expect(rowHtml(value, "2026-01")).toContain('href="/e/espace-fictif/studio-rh/masse-salariale?mois=2026-01#ms-detail"');
    expect(rowHtml(value, "2026-03")).toContain('href="/e/espace-fictif/studio-rh/hypotheses?scenario=scenario-fictif&amp;mois=2026-03#proj-detail"');
    expect(rowHtml(value, "2026-01")).toContain("Réel figé");
    expect(rowHtml(value, "2026-03")).toContain("Projeté");
    expect(value).toContain('tabindex="0" role="region" aria-label="Suivi mensuel du réel et de la référence"');
  });

  it("distingue zéro renseigné, montant absent, mois après clôture et pourcentage non calculable", () => {
    const value = html();
    expect(rowHtml(value, "2026-03")).toContain('data-money-cents="0"');
    expect(rowHtml(value, "2026-03")).toContain("Référence nulle : pourcentage non défini.");
    expect(rowHtml(value, "2026-02")).toContain('title="Mois fictif non lu."');
    expect(rowHtml(value, "2026-04")).toContain("Après clôture");
    expect(rowHtml(value, "2026-04")).toContain('title="après la clôture retenue"');
    expect(rowHtml(value, "2026-04")).not.toContain('data-col="actual"><span class="money-display"');
  });

  it("les deux séries reprennent les valeurs du modèle, la référence pointillée et les interruptions n.d.", () => {
    const model = fixture();
    const value = renderToStaticMarkup(createElement(SuiviChart, { model }));
    expect(value).toContain('data-testid="suivi-chart"');
    expect(value).toContain('stroke-dasharray="6 4"');
    // Le réel de janvier et mars est isolé par février n.d. : aucune ligne réelle ne les relie.
    expect(value.match(/class="chart-line"/g)).toHaveLength(1);
    expect(value).toContain("Février 2026 : Réel PayFit n.d. (Mois fictif non lu.)");
    expect(value).toContain("Scénario fictif");
  });

  it("applique les modes tableau et graphique sans changer les montants du modèle", () => {
    const model = fixture(); model.state.affichage = "tableau";
    const value = html(model);
    expect(value).toContain('data-testid="suivi-table"');
    expect(value).not.toContain('data-testid="suivi-chart"');
    model.state.affichage = "graphique";
    const graph = html(model);
    expect(graph).toContain('data-testid="suivi-chart"');
    expect(graph).not.toContain('data-testid="suivi-table"');
    expect(graph).toContain('data-money-cents="260000"');
  });

  it("garde Vigilance fermé par défaut avec les raisons, et date la lecture au calendrier de Paris", () => {
    const value = html();
    const details = value.match(/<details[^>]*data-testid="suivi-vigilance"[^>]*>/)?.[0] ?? "";
    expect(details).toBeTruthy();
    expect(details).not.toContain(" open");
    expect(value).toContain("Mois fictif non lu.");
    expect(value).toContain("Référence nulle : pourcentage non défini.");
    expect(value).toContain("01/04/2026 00:30");
    const model = fixture(); model.source.readAt = null;
    expect(html(model)).toContain("lecture : n.d.");
  });

  it("colore seulement les écarts de coût et conserve le signe écrit devant le montant", () => {
    const model = fixture(); model.totals.gap = delta();
    let value = html(model);
    expect(value).toContain('<dd class="trend-bad"><span class="money-display" data-money-cents="10000"');
    expect(value).toContain('data-money-exact="+100,00');
    model.totals.gap = delta(-10_000);
    value = html(model);
    expect(value).toContain('<dd class="trend-good"><span class="money-display" data-money-cents="-10000"');
  });
});
