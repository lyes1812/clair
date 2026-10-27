import type { NextRequest } from "next/server";
import { AXES } from "@/lib/budget/monthly";
import { formatDate } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { xlsxResponse } from "@/lib/export/response";
import { loadSourceInputs, sourceRows, type SourceInput, type SourceRequest } from "@/lib/export/sources";
import { buildWorkbook, definitionsFor, type FilterSpec, type SheetSpec } from "@/lib/export/xlsx";
import { KPI_TERMS } from "@/lib/glossary/kpi";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { splitAxisLabel, unitLabel } from "@/lib/viz/kpi";
import { requireWorkspace, type WorkspaceAccess } from "@/lib/workspace";
import { effectifsShare, loadEffectifs } from "../effectifs-data";
import { CATEGORY_TABLE_LABELS, categoryScopeNote, loadCategoryMonths, loadKpiSuivi, suiviColumnOn, type KpiSuivi } from "../suivi-data";
import { KPI_VUES } from "../tabs";
import { categoriesSheet, effectifsGridSheet, effectifsShareSheet, suiviSheet } from "./sheets";

export const dynamic = "force-dynamic";

// Export Excel de KPI RH : tableau « Mois par mois » (Suivi des effectifs, Turnover, Absentéisme) ou grille des Effectifs mensuels.
// Mêmes paramètres d'adresse et mêmes fonctions que l'écran ; onglets Filtres, Sources et Définitions. Aucun CSV n'existait pour
// ces tableaux : l'export est Excel seulement. Aucune donnée nominative : ouvert à tous les rôles de l'espace, comme l'écran.
type Ready = Extract<KpiSuivi, { kind: "ready" }>;
type Search = Record<string, string | string[] | undefined>;
const TABLE_VUES = ["suivi", "turnover", "absenteisme"] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

const definitionsOf = (ids: string[]) => {
  const { definitions, unknown } = definitionsFor(ids);
  if (unknown.length) console.warn(`export KPI RH : identifiants de glossaire inconnus (${unknown.join(", ")})`);
  return definitions;
};

// Raison d'un écran sans tableau (même message que l'écran).
function notReady(s: Exclude<KpiSuivi, Ready>): string {
  if (s.kind === "no-input") {
    const state = s.ctx.collab.state;
    return `n.d. — référentiel Collaborateurs indisponible${state && "reason" in state ? ` : ${state.reason}` : ""}`;
  }
  if (s.kind === "settings-invalid") return `n.d. — paramètres des KPI illisibles : ${s.ctx.settings.invalid.map((k) => KPI_KEYS[k]).join(", ")}`;
  return `n.d. — aucun mois clos à la date de référence (${formatDate(s.data.build.referenceDate)})`;
}

// Source RH retenue (référentiel Collaborateurs) et, au besoin, journal de paie PayFit ou saisie dans Clair.
async function sourcesOf(s: Ready, workspaceId: string, extra: { journal?: string; scenario?: boolean } = {}) {
  const rh = s.data.build.source === "dsn" ? "dsn" : "payfit";
  const rhUsage = rh === "dsn" ? "référentiel Collaborateurs : contrats et quotités déclarés" : "référentiel Collaborateurs : contrats, quotités et absences";
  const requests: SourceRequest[] = [{ provider: rh, usage: extra.journal && rh === "payfit" ? `${rhUsage} ; ${extra.journal}` : rhUsage }];
  if (extra.journal && rh !== "payfit") requests.push({ provider: "payfit", usage: extra.journal });
  const inputs: SourceInput[] = await loadSourceInputs(workspaceId, requests);
  if (extra.scenario) inputs.push({ label: "Hypothèses budgétaires", usage: "scénario saisi dans Clair (mois projetés)", last: null, applied: null, neverStatus: "Saisie dans Clair" });
  return sourceRows(inputs);
}

function scopeFilters(s: Ready): FilterSpec[] {
  const etab = s.ctx.collab.establishments.find((e) => e.id === s.etab);
  return [
    { label: "Établissement", value: s.etab ? (etab?.label ?? s.etab) : "Tous" },
    { label: "Nature", value: s.nature ? contractNatureLabel(s.nature) : "Natures comptées dans l'effectif" },
    ...(s.notices.length ? [{ label: "Paramètres ignorés", value: s.notices.join(" ; ") }] : []),
  ];
}

async function suiviXlsx(workspace: WorkspaceAccess, s: Ready, vue: (typeof TABLE_VUES)[number]): Promise<Response> {
  const sheets: SheetSpec[] = [suiviSheet({ dash: s.dash, data: s.data, establishments: s.input.scope.establishments, rawLimit: s.rawLimit, vue })];
  if (vue === "suivi") {
    // Même entrée filtrée que les tuiles et le tableau « Mois par mois » (établissement, nature), comme l'écran : la note de la
    // feuille dit que les filtres s'appliquent et nomme les catégories hors du périmètre.
    const cat = await loadCategoryMonths(s.input, s.w, workspace.id);
    sheets.push(categoriesSheet(cat.months, cat.keys, CATEGORY_TABLE_LABELS, { scope: categoryScopeNote(s, cat.hidden) }));
  }
  const on = (c: string) => suiviColumnOn(vue, c);
  const label = KPI_VUES.find((v) => v.key === vue)!.label;
  const buffer = await buildWorkbook({
    title: `KPI RH — ${label}`,
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    filters: [
      { label: "Entrée", value: label },
      { label: "Période", value: s.w.label },
      { label: "N-1", value: s.dash.previousWindow.label },
      { label: "Date de référence", value: formatDate(s.data.build.referenceDate) },
      ...scopeFilters(s),
    ],
    sheets,
    sources: await sourcesOf(s, workspace.id),
    definitions: definitionsOf([
      KPI_TERMS.monthly,
      KPI_TERMS.closedPeriod,
      KPI_TERMS.previousPeriod,
      ...(on("headcount") ? [KPI_TERMS.headcountAverage] : []),
      ...(on("etp") ? [KPI_TERMS.etpMonthEnd, KPI_TERMS.etpAverage] : []),
      ...(on("etp-prorated") ? [KPI_TERMS.etpProrated] : []),
      ...(vue === "turnover" ? [KPI_TERMS.turnover] : []),
      ...(on("absenteeism") ? [KPI_TERMS.absenteeism] : []),
      ...(vue === "suivi" ? [KPI_TERMS.categories] : []),
      KPI_TERMS.ndReasons,
    ]),
  });
  return xlsxResponse(buffer, `kpi-rh-${vue}`);
}

async function effectifsXlsx(workspace: WorkspaceAccess, slug: string, s: Ready, sp: Search): Promise<Response> {
  const e = await loadEffectifs(slug, workspace.id, s.ctx.input, { mesure: one(sp.mesure), axe: one(sp.axe), version: one(sp.version), annee: one(sp.annee) });
  if (e.grid.kind === "nd") return text(`n.d. — ${e.grid.reason}`, 422);
  const { repart, basis } = effectifsShare(e.grid, e.stock, e.year);
  const axisLabel = splitAxisLabel(AXES.find((a) => a.key === e.axis)!.label).name;
  const buffer = await buildWorkbook({
    title: `Effectifs mensuels — ${e.mdef.label} par ${axisLabel.toLowerCase()}`,
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    filters: [
      { label: "Rubrique", value: e.mdef.label },
      { label: "Axe de répartition", value: axisLabel },
      { label: "Version", value: e.versionLabel },
      { label: "Année", value: e.year },
      { label: "Unité", value: unitLabel(e.unit) },
      { label: "Base de la répartition", value: basis },
    ],
    sheets: [effectifsGridSheet(e.grid, e.unit), effectifsShareSheet(repart!, e.unit, basis)],
    sources: await sourcesOf(s, workspace.id, { journal: e.measure === "masse" || e.axis === "service" ? "journal comptable de paie (masse salariale, codes analytiques)" : undefined, scenario: e.full !== null }),
    definitions: definitionsOf([e.full ? KPI_TERMS.effectifsVersion : KPI_TERMS.effectifs, KPI_TERMS.effectifsMeasures, KPI_TERMS.effectifsBreakdown, KPI_TERMS.effectifsShare]),
  });
  return xlsxResponse(buffer, `effectifs-mensuels-${e.measure}-${e.axis}-${e.year}`);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  // Paramètre répété : tableau, comme les searchParams de la page ; la première valeur est retenue (one), comme à l'écran.
  const sp: Search = {};
  for (const k of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(k);
    sp[k] = all.length > 1 ? all : all[0];
  }
  if (sp.format && one(sp.format) !== "xlsx") return text("Format inconnu : xlsx.", 400);
  const s = await loadKpiSuivi(slug, sp);
  if (s.kind !== "ready") return text(notReady(s), 422);
  if (s.vue === "effectifs") return effectifsXlsx(workspace, slug, s, sp);
  const vue = TABLE_VUES.find((v) => v === s.vue);
  if (!vue) return text("Aucun tableau à exporter pour cette entrée.", 404);
  return suiviXlsx(workspace, s, vue);
}
