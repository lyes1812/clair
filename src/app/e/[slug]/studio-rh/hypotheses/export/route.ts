import type { NextRequest } from "next/server";
import { project } from "@/lib/budget/engine";
import { getScenario, KIND_LABELS, type ScenarioFull } from "@/lib/budget/store";
import type { Projection } from "@/lib/budget/types";
import { monthRange } from "@/lib/connectors/months";
import { formatMonth } from "@/lib/dates";
import { xlsxResponse } from "@/lib/export/response";
import { loadSourceInputs, sourceRows, type SourceInput } from "@/lib/export/sources";
import { buildWorkbook, definitionsFor, type FilterSpec, type SheetSpec, type SourceSpec } from "@/lib/export/xlsx";
import { BUDGET_TERMS } from "@/lib/glossary/budget";
import { HYP_TERMS } from "@/lib/glossary/hypotheses";
import { hasAtLeast } from "@/lib/roles";
import { dateFr } from "@/lib/viz/hyp-saisie";
import { frDates } from "@/lib/viz/hypotheses";
import { requireWorkspace, type WorkspaceAccess } from "@/lib/workspace";
import { constantsOf, envelopesOf, rateMap, rateScopes } from "../grids-data";
import { loadComparison, projectionRows } from "../resultat-data";
import { resolveVue } from "../tabs";
import { basesSheet, bridgeSheet, comparisonSheet, constantsSheet, envelopesSheet, gapsSheet, natureSheet, projectionSheet, ratesSheet } from "./sheets";

export const dynamic = "force-dynamic";

// Export Excel des Hypothèses budgétaires : Résultat (Projection, Comparaison) et grilles de saisie (Bases individuelles,
// Enveloppes, Hypothèses globales). Mêmes paramètres d'adresse que l'écran (scenario, vue, sous, annee, cmp ; « grille » choisit
// la grille des Hypothèses globales) et mêmes fonctions ; onglets Filtres, Sources et Définitions. Le CSV des grilles reste
// produit par le navigateur (GridTools) ; Projection et Comparaison n'avaient pas d'export : Excel seulement. Bases individuelles
// est nominatif (un contrat par ligne) : administrateurs et éditeurs seulement.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const PRORATA_SHORT = { calendaire: "jours calendaires", ouvres: "jours ouvrés", aucun: "aucun" } as const;

const definitionsOf = (ids: string[]) => {
  const { definitions, unknown } = definitionsFor(ids);
  if (unknown.length) console.warn(`export des hypothèses : identifiants de glossaire inconnus (${unknown.join(", ")})`);
  return definitions;
};

function scenarioFilters(full: ScenarioFull): FilterSpec[] {
  const s = full.scenario;
  const b = full.base;
  return [
    { label: "Scénario", value: `${s.name} (${KIND_LABELS[s.kind]}, ${s.status === "fige" ? "figé" : "brouillon"})` },
    { label: "Projection", value: `${formatMonth(s.firstMonth)} → ${formatMonth(s.lastMonth)}` },
    { label: "Base", value: b.origin ? `dérivée du scénario « ${b.origin.scenarioName} » (état projeté fin ${formatMonth(b.origin.month).toLowerCase()})` : `figée sur ${formatMonth(b.refMonth).toLowerCase()}` },
    { label: "Prorata", value: PRORATA_SHORT[s.conventions.prorata] },
  ];
}

// Sources : la base figée du scénario (lecture PayFit à sa création, ou scénario parent) et la saisie dans Clair.
function scenarioSources(full: ScenarioFull): SourceInput[] {
  const b = full.base;
  return [
    b.origin
      ? { label: "Scénario parent (base dérivée)", usage: `état projeté du scénario « ${b.origin.scenarioName} » fin ${formatMonth(b.origin.month).toLowerCase()}, repris le ${dateFr(b.origin.at)}`, last: null, applied: null, neverStatus: "Figée dans le scénario" }
      : { label: "PayFit (base figée du scénario)", usage: `réel figé jusqu'à ${formatMonth(b.refMonth).toLowerCase()} · lecture du ${dateFr(b.readAt)}`, last: null, applied: null, neverStatus: "Figée dans le scénario" },
    { label: "Hypothèses budgétaires", usage: "hypothèses saisies dans Clair", last: null, applied: null, neverStatus: "Saisie dans Clair" },
  ];
}

async function workbook(workspace: WorkspaceAccess, o: { title: string; file: string; filters: FilterSpec[]; sheets: SheetSpec[]; sources: SourceSpec[]; definitions: string[] }): Promise<Response> {
  const buffer = await buildWorkbook({ title: o.title, workspaceName: workspace.name, generatedAt: new Date().toISOString(), filters: o.filters, sheets: o.sheets, sources: o.sources, definitions: definitionsOf(o.definitions) });
  return xlsxResponse(buffer, o.file);
}

const SAVED: FilterSpec = { label: "Valeurs", value: "enregistrées (une saisie non enregistrée n'est pas reprise)" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const sp: Search = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(k);
    sp[k] = all.length > 1 ? all : all[0];
  }
  if (sp.format && one(sp.format) !== "xlsx") return text("Format inconnu : xlsx.", 400);
  const scenarioId = one(sp.scenario);
  if (!scenarioId) return text("Scénario requis.", 400);
  const { vue, sous } = resolveVue(one(sp.vue), one(sp.sous));
  // Rôle vérifié avant toute lecture : le détail par contrat est réservé aux administrateurs et aux éditeurs.
  if (vue === "bases" && !hasAtLeast(workspace.role, "editor")) return text("Détail nominatif réservé aux administrateurs et aux éditeurs.", 403);
  const full = await getScenario(workspace.id, scenarioId);
  if (!full) return text("Scénario introuvable.", 404);
  const s = full.scenario;
  const months = monthRange(s.firstMonth, s.lastMonth);
  const base = scenarioFilters(full);
  const fileBase = `${s.name}-${s.firstMonth}`;

  if (vue === "resultat" && (sous === "projection" || sous === "comparaison")) {
    const proj: Projection = project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions);
    if (sous === "projection") {
      if (proj.kind === "error") return text(`Projection refusée : ${proj.errors.map(frDates).join(" ; ")}`, 422);
      const nature = natureSheet(proj.months);
      return workbook(workspace, {
        title: `Projection — ${s.name}`,
        file: `projection-${fileBase}`,
        filters: base,
        sheets: [projectionSheet(projectionRows(full.base, proj, s)), ...(nature ? [nature] : [])],
        sources: sourceRows(scenarioSources(full)),
        definitions: [HYP_TERMS.projection, HYP_TERMS.coutNature, HYP_TERMS.effectif, BUDGET_TERMS.base],
      });
    }
    const c = await loadComparison(slug, workspace.id, s, full.base, proj, sp);
    const sources = scenarioSources(full);
    if (c.selected.includes("reel")) sources.push(...(await loadSourceInputs(workspace.id, [{ provider: "payfit", usage: "journal de paie (réel courant)" }])));
    const sheets: SheetSpec[] = [comparisonSheet(c.principal, c.compared, c.year)];
    if (c.compared.length) sheets.push(gapsSheet(c.principal, c.compared, c.year, full.base.refMonth), bridgeSheet(c.principal, c.compared, c.year));
    return workbook(workspace, {
      title: `Comparaison ${c.year} — ${s.name}`,
      file: `comparaison-${c.year}-${fileBase}`,
      filters: [...base, { label: "Année", value: c.year }, { label: "Lectures comparées", value: c.compared.length ? c.compared.map((x) => x.label).join(" ; ") : "aucune" }],
      sheets,
      sources: sourceRows(sources),
      definitions: [HYP_TERMS.comparaison, HYP_TERMS.origineMois, HYP_TERMS.pont],
    });
  }
  if (vue === "bases") {
    return workbook(workspace, {
      title: `Bases individuelles — ${s.name}`,
      file: `bases-${fileBase}`,
      filters: [...base, SAVED],
      sheets: [basesSheet(full.base, full.hypotheses)],
      sources: sourceRows(scenarioSources(full)),
      definitions: [BUDGET_TERMS.bases, BUDGET_TERMS.base, BUDGET_TERMS.baseContrat, BUDGET_TERMS.grilles],
    });
  }
  if (vue === "env-service" || vue === "env-rubrique") {
    const axis = vue === "env-service" ? "service" : "rubrique";
    return workbook(workspace, {
      title: `Enveloppes par ${axis} — ${s.name}`,
      file: `enveloppes-${axis}-${fileBase}`,
      filters: [...base, SAVED],
      sheets: [envelopesSheet(envelopesOf(full.hypotheses, axis), axis, months)],
      sources: sourceRows(scenarioSources(full)),
      definitions: [BUDGET_TERMS.enveloppe, BUDGET_TERMS.grilles],
    });
  }
  if (vue === "globales") {
    const constantes = one(sp.grille) === "constantes";
    const { scopes, statutNote } = rateScopes(full.base, full.hypotheses);
    return workbook(workspace, {
      title: `${constantes ? "Constantes de référence" : "Taux d'augmentation"} — ${s.name}`,
      file: `${constantes ? "constantes" : "taux-augmentation"}-${fileBase}`,
      filters: [...base, SAVED, ...(!constantes && statutNote ? [{ label: "Statut cadre dirigeant", value: statutNote }] : [])],
      sheets: [constantes ? constantsSheet(constantsOf(full.hypotheses), months) : ratesSheet(scopes, rateMap(full.hypotheses), months)],
      sources: sourceRows(scenarioSources(full)),
      definitions: constantes ? [BUDGET_TERMS.constantes, BUDGET_TERMS.grilles] : [BUDGET_TERMS.globales, BUDGET_TERMS.grilles],
    });
  }
  return text("Aucun tableau à exporter pour cette entrée.", 404);
}
