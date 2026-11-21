import type { KpiSuivi } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { glossaryEntry, type GlossaryEntry } from "@/lib/glossary";
import type { PayrollContext } from "@/lib/payroll/context";
import { kpiOriginText, type KpiSettingKey } from "@/lib/rh-kpi-settings";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import { absenceTypeText } from "@/lib/viz/kpi";
import { socialReportOf, type SocialCell, type SocialMetric, type SocialReport, type SocialRow, type SocialSearch } from "./social";

export const PUBLISHER_BLOCKS = [
  { key: "effectifs", label: "Effectifs et ETP", metrics: ["effectif", "etp-fin", "etp-moyen"], columns: ["headcount", "etp"] },
  { key: "mouvements", label: "Mouvements et turnover", metrics: ["entrees", "sorties", "turnover"], columns: ["entries", "exits"] },
  { key: "absenteisme", label: "Absentéisme", metrics: ["absenteisme"], columns: ["absenteeism"] },
] as const;
export type PublisherBlock = (typeof PUBLISHER_BLOCKS)[number]["key"];
export type PublisherColumn = (typeof PUBLISHER_BLOCKS)[number]["columns"][number];
export type PublisherSelection = { blocks: PublisherBlock[]; monthly: boolean; submitted: boolean; notices: string[] };
const list = (v: string | string[] | undefined) => v === undefined ? [] : Array.isArray(v) ? v : [v];
const one = (v: string | string[] | undefined) => list(v)[0] ?? "";

// Le marqueur de formulaire distingue l'ouverture initiale d'une composition
// volontairement vide. Les valeurs libres ne sont jamais reprises dans le PDF.
export function publisherSelection(raw: SocialSearch): PublisherSelection {
  const submitted = raw.composition !== undefined || raw.bloc !== undefined || raw.mensuel !== undefined;
  if (!submitted) return { blocks: PUBLISHER_BLOCKS.map((b) => b.key), monthly: true, submitted: false, notices: [] };
  const proposed = list(raw.bloc);
  const notices: string[] = [];
  if (proposed.some((value) => !PUBLISHER_BLOCKS.some((b) => b.key === value))) notices.push("Un bloc hors des choix proposés a été écarté.");
  if (raw.composition !== undefined && (list(raw.composition).length !== 1 || one(raw.composition) !== "1")) notices.push("Le marqueur de composition est invalide ; seuls les blocs explicitement choisis sont conservés.");
  if (raw.mensuel !== undefined && (list(raw.mensuel).length !== 1 || one(raw.mensuel) !== "1")) notices.push("Le choix du détail mensuel est invalide ; le détail n’est pas inclus.");
  const blocks = PUBLISHER_BLOCKS.filter((b) => proposed.includes(b.key)).map((b) => b.key);
  if (!blocks.length) notices.push("Choisis au moins un bloc pour prévisualiser et imprimer le rapport.");
  return { blocks, monthly: list(raw.mensuel).length === 1 && one(raw.mensuel) === "1", submitted, notices };
}

export type PublisherRow = Pick<SocialRow, "month" | "coverage" | PublisherColumn>;
export type PublisherParameter = { label: string; value: string; origin: string };
export type PublisherReport = Pick<SocialReport, "window" | "previousWindow" | "metrics" | "previous" | "limits"> & {
  kind: "ready" | "no-period" | "settings-invalid" | "empty";
  reason: string | null;
  source: Pick<SocialReport["source"], "kind" | "referenceDate" | "readAt" | "changedAt">;
  selection: PublisherSelection;
  period: SocialReport["selection"] | null;
  notices: string[];
  rows: PublisherRow[];
  columns: PublisherColumn[];
  definitions: Pick<GlossaryEntry, "id" | "term" | "definition" | "formula">[];
  parameters: PublisherParameter[];
};

const natureList = (codes: string[]) => codes.length ? codes.map(contractNatureLabel).join(", ") : "aucune";
function parameters(ctx: PayrollContext, selection: PublisherSelection): PublisherParameter[] {
  const settings = ctx.kpi.settings;
  const values = settings.values;
  const rows: [KpiSettingKey, string, string][] = [];
  const yes = (value: boolean) => value ? "oui" : "non";
  if (selection.blocks.includes("effectifs")) rows.push(
    ["fullTimeIsOne", "Un temps plein vaut 1 ETP", yes(values.fullTimeIsOne)],
    ["capAtOne", "Quotité plafonnée à 1", yes(values.capAtOne)],
    ["forfaitJoursIsOne", "Forfait jours sans quotité PayFit = 1 ETP", yes(values.forfaitJoursIsOne)],
    ["etpDecimals", "Décimales de la quotité avant la somme", String(values.etpDecimals)],
  );
  if (selection.blocks.includes("mouvements")) rows.push(
    ["turnoverFormula", "Formule du turnover", values.turnoverFormula === "half_sum" ? "moyenne des entrées et des sorties ÷ effectif moyen" : "sorties ÷ effectif du premier jour"],
    ["turnoverNatures", "Population du turnover", values.turnoverNatures?.length ? natureList(values.turnoverNatures) : "même population que les effectifs"],
    ["neutralizeContinuity", "Contrats continus neutralisés", yes(values.neutralizeContinuity)],
    ["excludedExitNatures", "Sorties non comptées (natures)", natureList(values.excludedExitNatures)],
  );
  if (selection.blocks.includes("absenteisme")) rows.push(
    ["absenceTypes", "Motifs retenus pour l’absentéisme", values.absenceTypes.length ? values.absenceTypes.map(absenceTypeText).join(", ") : "aucun (absentéisme n.d.)"],
    ["absenceStatuses", "Statuts d’absence retenus", values.absenceStatuses.map((status) => ABSENCE_STATUS_LABELS[status] ?? "statut non reconnu").join(", ")],
    ["dayBasis", "Base des jours", values.dayBasis === "calendar" ? "jours calendaires" : "du lundi au vendredi"],
  );
  const natures = ctx.kpi.collab.natures;
  return [
    { label: "Natures comptées dans l’effectif", value: natureList(natures.codes), origin: natures.origin === "default" ? "valeur par défaut validée" : "modifié par un administrateur" },
    ...rows.map(([key, label, value]) => ({ label, value, origin: kpiOriginText(key, settings.origins[key], (date) => dateTimeFmt.format(date)) })),
  ];
}

const reasons = (cell: SocialCell) => [cell.reason, ...cell.qualifiers].filter((reason): reason is string => !!reason);
export function publisherNotes(report: PublisherReport): string[] {
  return [...new Set([
    ...report.notices, ...report.limits,
    ...(report.previous.reason ? [report.previous.reason] : []),
    ...report.metrics.flatMap((m) => [m.current, m.previous].flatMap(reasons)),
    ...(report.selection.monthly ? report.rows.flatMap((row) => [row.coverage, ...report.columns.map((key) => row[key])].flatMap(reasons)) : []),
  ])];
}

// Le résolveur de période est celui de KPI RH, exécuté par la page. Le rapport
// social reste l'unique adaptateur de cellules, de formatage et de raisons publiques.
// Journal retiré : aucune cellule ni provenance paie ne quitte ce modèle.
export function publisherReportOf(ctx: PayrollContext, period: KpiSuivi, selection: PublisherSelection): PublisherReport {
  const excludedPayroll = "Journal comptable non inclus dans ce rapport RH.";
  const rhContext: PayrollContext = { ...ctx, input: null, read: null, unavailable: excludedPayroll,
    etpQualifiers: selection.blocks.includes("effectifs") ? ctx.etpQualifiers : [],
    kpi: period.kind === "ready" ? { ...ctx.kpi, input: period.input } : ctx.kpi };
  const report = socialReportOf(rhContext, period.kind === "ready" ? { mode: period.mode, fin: period.fin, annee: String(period.year) } : {});
  const source = { kind: report.source.kind, referenceDate: report.source.referenceDate, readAt: report.source.readAt, changedAt: report.source.changedAt };
  const selectedBlocks = PUBLISHER_BLOCKS.filter((b) => selection.blocks.includes(b.key));
  const metricIds = new Set<string>(selectedBlocks.flatMap((b) => [...b.metrics]));
  const columns = selectedBlocks.flatMap((b) => [...b.columns]);
  const periodNotices = period.kind === "ready" ? period.notices.map((notice) => {
    const key = /^paramètre ignoré : (mode|fin|annee)=/.exec(notice)?.[1];
    return key ? `Paramètre ${key} ignoré : valeur hors des choix de KPI RH.` : "Un paramètre hors des choix de KPI RH a été écarté.";
  }) : [];
  const base: PublisherReport = {
    kind: "no-period", reason: null, source, selection, period: period.kind === "ready" ? {
      mode: period.mode, fin: period.fin, year: period.year, closed: period.closed, years: period.years,
    } : null,
    window: period.kind === "ready" ? period.w : null,
    previousWindow: period.kind === "ready" ? report.previousWindow : null,
    notices: [...new Set([...selection.notices, ...periodNotices])],
    limits: report.limits.filter((limit) => limit !== excludedPayroll), metrics: [], rows: [], columns,
    previous: { available: false, reason: null }, definitions: [], parameters: [],
  };
  if (period.kind === "settings-invalid") return { ...base, kind: "settings-invalid", reason: "Paramètres des KPI illisibles : aucun indicateur n’est calculé. Un administrateur doit les réenregistrer dans Paramètres › Définitions des KPI." };
  if (period.kind !== "ready" || report.kind !== "ready") return { ...base, reason: "Les indicateurs nécessitent une lecture RH appliquée avec au moins un mois clos." };
  if (!selection.blocks.length) return { ...base, kind: "empty", reason: "Choisis au moins un bloc pour prévisualiser et imprimer le rapport." };
  const metrics = report.metrics.filter((metric) => metricIds.has(metric.id));
  const rows = report.rows.map(({ month, coverage, headcount, etp, entries, exits, absenteeism }) => ({ month, coverage, headcount, etp, entries, exits, absenteeism }));
  // Les qualificatifs ordinaires (« mouvements en contrats, effectif en
  // personnes ») expliquent l'unité ; ils n'invalident pas une comparaison N-1.
  const missingPrevious = metrics.some((metric) => metric.previous.kind !== "value"
    || metric.previous.qualifiers.some((qualifier) => qualifier.startsWith("Historique PayFit brut")));
  const definitions = [...new Set(metrics.map((metric) => metric.term))].flatMap((term) => {
    const entry = glossaryEntry(term);
    const formula = entry?.id === "turnover" && ctx.kpi.settings.values.turnoverFormula === "exits_over_start"
      ? "sorties ÷ effectif du premier jour" : entry?.formula;
    return entry ? [{ id: entry.id, term: entry.term, definition: entry.definition, ...(formula ? { formula } : {}) }] : [];
  });
  return { ...base, kind: "ready", metrics, rows, definitions, parameters: parameters(ctx, selection), previous: {
    available: !missingPrevious,
    reason: missingPrevious ? "N-1 incomplet ou qualifié pour les blocs choisis : consulter les raisons et bornes basses de chaque indicateur." : null,
  } };
}
