import { monthRange } from "@/lib/connectors/months";
import { gap, total, type Point, type Series } from "@/lib/budget/series";
import { formatEuros } from "@/lib/money";
import { fmtFixed } from "@/lib/rh/kpi/format";

// DTO du suivi autonome : montants globaux seulement, sans journal, contrat ou hypothèse nominative.
export type SuiviCell = { kind: "value"; cents: number } | { kind: "nd"; reason: string };
export type SuiviGap = { kind: "value"; cents: number; pct: { num: number; den: number } | null; pctReason: string | null } | { kind: "nd"; reason: string };
export type SuiviReferenceOption = { value: string; label: string; kind: "budget" | "scenario"; years: string[]; href: string };
export type SuiviReference = Pick<SuiviReferenceOption, "kind" | "label" | "href">;
export type SuiviAffichage = "tout" | "graphique" | "tableau";
export type SuiviMonth = {
  month: string;
  actual: SuiviCell;
  reference: SuiviCell;
  gap: SuiviGap;
  origin: string | null;
  actualHref: string | null;
  referenceHref: string | null;
  afterCutoff: boolean;
};
export type SuiviModel = {
  slug: string;
  years: string[];
  options: SuiviReferenceOption[];
  state: { annee: string; reference: string; cloture: string; affichage: SuiviAffichage };
  reference: SuiviReference | null;
  source: { label: string; readAt: string | null; href: string };
  cutoffOptions: string[];
  cutoff: string | null;
  notices: string[];
  reason: string | null;
  rows: SuiviMonth[];
  totals: { actual: SuiviCell; reference: SuiviCell; gap: SuiviGap };
  chart: { months: string[]; actual: (number | null)[]; reference: (number | null)[] };
};

export type SuiviInput = Pick<SuiviModel, "slug" | "years" | "options" | "source" | "cutoffOptions" | "cutoff" | "notices" | "reason" | "state"> & {
  selected: SuiviReferenceOption | null;
  actual: Series;
  planned: Series | null;
  actualReason: string;
  referenceReason: string;
};

const ORIGIN = { reel: "Réel figé", "projete-parent": "Projeté du parent", projete: "Projeté", budget: "Budget saisi" } as const;
const UNSAFE = "montant hors de la précision exacte en centimes";
// Le formateur commun divise par 100 (Number) : vérifier aussi qu'il conserve le centime à la borne de précision.
// Comparer les valeurs absolues : ses signes ASCII et le signe moins Unicode de fmtFixed sont typographiques.
const exactCents = (n: number) => Number.isSafeInteger(n) && formatEuros(Math.abs(n)) === `${fmtFixed({ num: Math.abs(n), den: 100 })}\u00a0€`;
const point = (s: Series, month: string): Point => s.points.get(month) ?? { month, kind: "nd", reason: "mois non couvert par cette lecture" };
const cell = (p: Point): SuiviCell => p.kind === "value" ? exactCents(p.cost) ? { kind: "value", cents: p.cost === 0 ? 0 : p.cost } : { kind: "nd", reason: UNSAFE } : { kind: "nd", reason: p.reason };
const totalCell = (s: Series, months: string[]): SuiviCell => {
  let running = 0;
  for (const month of months) {
    const p = point(s, month);
    if (p.kind === "value") {
      running += p.cost;
      if (!exactCents(p.cost) || !Number.isSafeInteger(running)) return { kind: "nd", reason: UNSAFE };
    }
  }
  const t = total(s, months);
  return t.kind === "value" ? exactCents(t.cost) ? { kind: "value", cents: t.cost } : { kind: "nd", reason: UNSAFE } : t;
};
const gapCell = (a: Series, b: Series, months: string[]): SuiviGap => {
  const g = gap(a, b, months);
  return g.kind === "nd" ? g : !exactCents(g.delta) ? { kind: "nd", reason: UNSAFE } : { kind: "value", cents: g.delta, pct: g.pct, pctReason: g.pct ? null : "référence nulle ou négative : pourcentage non défini" };
};

export function buildSuivi(input: SuiviInput): SuiviModel {
  const { slug, state, selected, cutoff, actual, planned } = input;
  const months = /^\d{4}$/.test(state.annee) ? monthRange(`${state.annee}-01`, `${state.annee}-12`) : [];
  const base = `/e/${encodeURIComponent(slug)}/studio-rh`;
  const rows: SuiviMonth[] = months.map((month) => {
    const afterCutoff = cutoff !== null && month > cutoff;
    const actualPoint: Point = !cutoff ? { month, kind: "nd", reason: input.actualReason } : afterCutoff ? { month, kind: "nd", reason: "après la clôture retenue" } : point(actual, month);
    const referencePoint = planned ? point(planned, month) : { month, kind: "nd" as const, reason: input.referenceReason };
    const actualValue = cell(actualPoint);
    const referenceValue = cell(referencePoint);
    const actualHref = actualValue.kind === "value" ? `${base}/masse-salariale?annee=${state.annee}&de=${month.slice(5)}&a=${month.slice(5)}&mois=${month}&affichage=tableau#ms-detail` : null;
    const referenceHref = referenceValue.kind !== "value" || !selected ? null : selected.kind === "budget" ? selected.href : referencePoint.kind === "value" && referencePoint.layer === "projete" ? `${selected.href}&vue=resultat&sous=projection&mois=${month}&affichage=tableau#proj-detail` : `${selected.href}&vue=resultat&sous=projection&affichage=tableau`;
    const delta: SuiviGap = actualValue.kind === "nd" ? actualValue : referenceValue.kind === "nd" ? referenceValue : gapCell(actual, planned!, [month]);
    return { month, actual: actualValue, reference: referenceValue, gap: delta, origin: referencePoint.kind === "value" ? ORIGIN[referencePoint.layer] : null, actualHref, referenceHref, afterCutoff };
  });
  const cumulated = cutoff ? months.filter((m) => m <= cutoff) : [];
  const actualTotal: SuiviCell = cumulated.length ? totalCell(actual, cumulated) : { kind: "nd", reason: input.actualReason };
  const referenceTotal: SuiviCell = !planned ? { kind: "nd", reason: input.referenceReason } : cumulated.length ? totalCell(planned, cumulated) : { kind: "nd", reason: input.actualReason };
  const gapTotal: SuiviGap = actualTotal.kind === "nd" ? actualTotal : referenceTotal.kind === "nd" ? referenceTotal : gapCell(actual, planned!, cumulated);
  return {
    slug, years: input.years, options: input.options, state, source: input.source,
    reference: selected ? { kind: selected.kind, label: selected.label, href: selected.href } : null,
    cutoffOptions: input.cutoffOptions, cutoff, notices: input.notices, reason: input.reason, rows,
    totals: { actual: actualTotal, reference: referenceTotal, gap: gapTotal },
    chart: { months, actual: rows.map((r) => r.actual.kind === "value" ? r.actual.cents : null), reference: rows.map((r) => r.reference.kind === "value" ? r.reference.cents : null) },
  };
}
