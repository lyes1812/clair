import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestructuringView } from "@/app/e/[slug]/studio-restructuring/RestructuringView";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import type { RestructuringContext } from "@/lib/restructuring/context";
import type { Metric, RestructuringModel, RestructuringScenario } from "@/lib/restructuring/model";

const REFERENCE = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "22222222-2222-4222-8222-222222222222";
const metric = (value: number | null, reason: string | null = null): Metric => ({ value, reason });
const base = (): BaseSnapshot => ({ currency: "EUR", refMonth: "2026-09", syncId: "fixture-only", readAt: "2026-10-01T09:00:00.000Z", contracts: [], actuals: [], refMasse: 0, refBaseCost: 0, etpNote: null });
const hypotheses = (): Hypothesis[] => [
  { id: "depart-fictif", kind: "depart", label: "MESURE_PERSONNELLE_FICTIVE", contractKey: "contrat-fictif", lastPaidDate: "2026-10-15", exitCost: null },
  { id: "embauche-fictive", kind: "embauche", label: "REMPLACEMENT_PERSONNEL_FICTIF", service: "Service fictif", start: "2026-10-16", end: null, grossFullTimeCents: 109876, quotaBps: 8000, chargesBps: 4200, counted: true, replaces: "depart-fictif" },
  { id: "changement-fictif", kind: "changement", label: "CHANGEMENT_FICTIF", contractKey: "contrat-fictif", from: "2026-11", quotaBps: 5000 },
  { id: "ponctuel-fictif", kind: "ponctuel", label: "PONCTUEL_FICTIF", month: "2026-10", amount: { mode: "charge", costCents: 12345 }, service: null, nonRecurring: true },
  { id: "enveloppe-fictive", kind: "enveloppe", label: "ENVELOPPE_FICTIVE", axis: "rubrique", target: "Rubrique fictive", monthly: { "2026-10": 0, "2026-11": 45678 }, chargesBps: null },
];
const scenario = (id: string, name: string, hyps: Hypothesis[]): RestructuringScenario => ({ id, name, status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-11", baseHash: "fixture-base-commune", base: base(), hypotheses: hyps, conventions: { prorata: "calendaire" } });
const model = (): RestructuringModel => ({
  kind: "value", reason: null, warnings: [],
  months: [
    { month: "2026-10", referenceCost: metric(100000), proposalCost: metric(115000), savings: metric(-15000), cumulative: metric(-15000), transitionCost: metric(15000), exitCost: metric(15000), replacementCost: metric(20000), referenceEtp4: metric(20000), proposalEtp4: metric(15000) },
    { month: "2026-11", referenceCost: metric(100000), proposalCost: metric(80000), savings: metric(20000), cumulative: metric(5000), transitionCost: metric(0), exitCost: metric(0), replacementCost: metric(20000), referenceEtp4: metric(20000), proposalEtp4: metric(10000) },
  ],
  totals: { referenceCost: metric(200000), proposalCost: metric(195000), savings: metric(5000), transitionCost: metric(15000), exitCost: metric(15000), replacementCost: metric(40000) },
  payback: { month: "2026-11", reason: "Premier retour durable à un cumul positif dans cette fixture." }, endEtpDelta: metric(10000),
});
function props(patch: Partial<RestructuringContext> = {}): RestructuringContext {
  const reference = scenario(REFERENCE, "Référence fictive", [{ id: "ref-only", kind: "ponctuel", label: "REFERENCE_UNIQUEMENT_NON_MONTREE", month: "2026-10", amount: { mode: "charge", costCents: 0 }, service: null }]);
  const proposal = scenario(PROPOSAL, "Projet fictif", hypotheses());
  return { slug: "fixture-only", workspaceName: "Espace fictif", canEdit: true, view: "overview", reference, proposal,
    options: [reference, proposal].map(({ id, name, firstMonth, lastMonth }) => ({ id, name, firstMonth, lastMonth, status: "brouillon" as const })), model: model(), notices: [], ...patch };
}
const html = (patch: Partial<RestructuringContext> = {}) => renderToStaticMarkup(createElement(RestructuringView, props(patch)));
const select = (value: string, name: string) => value.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?<\\/select>`))?.[0] ?? "";

describe("Studio Restructuring — présentation sur fixtures fictives", () => {
  it("les deux choix sont explicites, obligatoires, et jamais remplacés par le premier scénario", () => {
    const input = props();
    input.reference = null; input.proposal = null;
    input.model = { ...model(), kind: "nd", reason: "Choisis deux scénarios comparables.", months: [] };
    const value = renderToStaticMarkup(createElement(RestructuringView, input));
    for (const name of ["reference", "projet"]) {
      const control = select(value, name);
      expect(control).toContain('required=""');
      expect(control.match(/<option[^>]* selected=""/g)).toEqual(['<option value="" disabled="" selected=""']);
    }
    expect(value).toContain('method="get"');
    expect(value).not.toContain('method="post"');
    expect(value).not.toContain('data-testid="restructuring-export"');
    expect(value).not.toContain('data-testid="restructuring-kpis"');
    expect(value).toContain("Choisis deux scénarios comparables.");
  });

  it("onglets et exports gardent la référence et le projet choisis, sans données individuelles", () => {
    const value = html();
    for (const view of ["overview", "measures", "monthly"]) expect(value).toContain(`vue=${view}&amp;reference=${REFERENCE}&amp;projet=${PROPOSAL}`);
    for (const format of ["csv", "xlsx"]) expect(value).toContain(`/studio-restructuring/export?vue=overview&amp;reference=${REFERENCE}&amp;projet=${PROPOSAL}&amp;format=${format}`);
    expect(value).not.toContain("MESURE_PERSONNELLE_FICTIVE");
    expect(value).not.toContain("REMPLACEMENT_PERSONNEL_FICTIF");
  });

  it("réemploie les quatre tuiles RH, les montants exacts et les formules, sans doubler les coûts ponctuels", () => {
    const value = html();
    expect(value).toContain('class="facts ms-tiles four restructuring-tiles"');
    expect(value).toContain('data-testid="restructuring-net-savings"');
    expect(value).toContain('data-money-cents="5000"');
    expect(value).toContain('data-money-cents="15000"');
    expect(value).toContain("+1,00 ETP");
    expect(value).toContain("ETP de référence − ETP du projet");
    expect(value).toContain("Novembre 2026");
    expect(value).toContain("Σ (coût de référence − coût du projet)");
    expect(value).toContain("ils ne sont pas soustraits une seconde fois");
    expect(value).toContain("Aucune indemnité légale ou conventionnelle n’est estimée ici");
    expect(value).toContain('data-testid="restructuring-costs"');
    expect(value).toContain('data-testid="restructuring-cumulative"');
  });

  it("les mesures de l'éditeur reprennent le projet seulement, avec coûts de sortie non saisis explicitement n.d.", () => {
    const value = html({ view: "measures" });
    expect(value).toContain('data-testid="restructuring-measures-table"');
    expect(value).toContain("MESURE_PERSONNELLE_FICTIVE");
    expect(value).toContain("REMPLACEMENT_PERSONNEL_FICTIF");
    expect(value).not.toContain("REFERENCE_UNIQUEMENT_NON_MONTREE");
    expect(value).toContain("n.d. — coût de sortie non saisi");
    expect(value).toContain('data-money-cents="109876"');
    expect(value).toContain('data-money-cents="12345"');
    expect(value).toContain('data-money-cents="45678"');
    expect(value).toContain('data-money-cents="0"');
    expect(value).toContain("15/10/2026");
    expect(value).toContain("16/10/2026");
    expect(value).toContain("Remplacement lié à :");
    expect(value).toContain(`hypotheses?scenario=${PROPOSAL}&amp;vue=postes`);
    expect(value).toContain(`hypotheses?scenario=${PROPOSAL}&amp;vue=embauches`);
  });

  it("un lecteur voit seulement le comptage et la synthèse, sans détail nominatif ni invitation à modifier", () => {
    const value = html({ view: "measures", canEdit: false });
    expect(value).toContain("5 hypothèses dans le projet");
    expect(value).toContain("synthèse agrégée");
    for (const forbidden of ["MESURE_PERSONNELLE_FICTIVE", "REMPLACEMENT_PERSONNEL_FICTIF", "CHANGEMENT_FICTIF", "PONCTUEL_FICTIF", "ENVELOPPE_FICTIVE", "109876", "Modifier le projet", "Préparer les remplacements", "Ouvrir ou dupliquer", 'data-testid="restructuring-measures-table"']) expect(value).not.toContain(forbidden);
    expect(value).toContain("Lire le projet dans Hypothèses");
  });

  it("le tableau conserve raisons n.d., coûts déjà inclus et ETP de fin de mois sans remplacer une absence par zéro", () => {
    const input = props({ view: "monthly" });
    input.model.months[0].exitCost = metric(null, "Coût de sortie non saisi dans cette fixture.");
    const value = renderToStaticMarkup(createElement(RestructuringView, input));
    expect(value).toContain('class="data-table sticky sticky-first restructuring-monthly"');
    expect(value).toContain("Coût de sortie non saisi dans cette fixture.");
    expect(value).toContain("chacun déjà inclus dans son coût total ; ils ne s’ajoutent pas");
    expect(value).toContain("Sorties du projet");
    expect(value).toContain("Remplacements liés du projet");
    expect(value).toContain("ETP référence");
    expect(value).toContain("ETP projet");
    const firstRow = value.match(/data-testid="restructuring-month-2026-10"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(firstRow).toContain('data-money-cents="-15000"');
    expect(firstRow).not.toContain('data-money-cents="0"');
    expect(value).toContain('tabindex="0" role="region" aria-label="Comparaison mensuelle');
  });

  it("les raisons de blocage et avertissements restent visibles, sans tracer de comparaison refusée", () => {
    const input = props();
    input.model = { ...model(), kind: "nd", reason: "Les bases figées sont différentes.", months: [], warnings: ["Avertissement fictif." ] };
    input.notices = ["Avertissement fictif."];
    const value = renderToStaticMarkup(createElement(RestructuringView, input));
    expect(value).toContain("Les bases figées sont différentes.");
    expect(value.match(/Avertissement fictif\./g)).toHaveLength(1);
    for (const id of ["restructuring-kpis", "restructuring-costs", "restructuring-cumulative", "restructuring-export"]) expect(value).not.toContain(`data-testid="${id}"`);
    expect(value).toContain(`hypotheses?scenario=${REFERENCE}`);
    expect(value).toContain("Préparer ou dupliquer un scénario");
  });
});
