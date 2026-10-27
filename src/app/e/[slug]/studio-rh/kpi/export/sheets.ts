import type { CategoryMonth } from "@/lib/budget/categories";
import type { Cell } from "@/lib/budget/versions";
import { exactRatio, type ColumnKind, type ColumnSpec, type ExportCell, type SheetSpec } from "@/lib/export/xlsx";
import type { Count, HeadcountResult } from "@/lib/rh/headcount";
import { ETP_PRORATED_LABEL } from "@/lib/rh/kpi/etp-prorata";
import type { KpiDashboard, Kind, Ratio } from "@/lib/rh/kpi/types";
import type { PayfitHistoryLimit } from "@/lib/rh/raw-history";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { showCount, showHeadcount } from "@/lib/rh/view";
import { monthShortLabel } from "@/lib/viz/kpi";
import { coverageShown, SUIVI_COLUMNS, suiviColumnOn, type SuiviColumn } from "../suivi-data";
import type { KpiVue } from "../tabs";

// Feuilles Excel de KPI RH, construites depuis les mêmes objets que l'écran (aucun recalcul, aucun accès base) : une valeur
// exacte est un vrai nombre, une borne basse garde sa valeur avec la mention « borne basse » dans Observations, un n.d. est
// « n.d. » avec sa raison ; les réserves que l'écran met en infobulle passent dans Observations. Les demi-journées sont écrites
// en jours (valeur exacte, comme l'écran : « 12,5 j »).

const ND_PREFIX = /^n\.d\. — /;
type Value = { kind: Kind | "nd" };
const LOWER = "borne basse (au moins)";

export const SUIVI_HEADERS: Record<SuiviColumn, { header: string; kind: ColumnKind; width?: number }> = {
  coverage: { header: "Couverture", kind: "text", width: 22 },
  headcount: { header: "Effectif fin de mois (personnes)", kind: "nombre" },
  etp: { header: "ETP fin de mois", kind: "etp" },
  "etp-prorated": { header: ETP_PRORATED_LABEL, kind: "etp", width: 22 },
  entries: { header: "Entrées", kind: "nombre" },
  exits: { header: "Sorties", kind: "nombre" },
  theoretical: { header: "Jours théoriques (j)", kind: "etp" },
  "absence-days": { header: "Jours d'absence (j)", kind: "etp" },
  absenteeism: { header: "Absentéisme", kind: "pourcent" },
  "etp-n1": { header: "ETP fin de mois N-1", kind: "etp" },
  "absenteeism-n1": { header: "Absentéisme N-1", kind: "pourcent" },
};

const exact = (r: Ratio): ExportCell => ({ exact: exactRatio(r.num, r.den) });
const days = (half: number): ExportCell => ({ exact: exactRatio(half, 2) });

// Une cellule et, pour une borne basse, la mention à porter en observation ; foot : réserve que l'écran met en infobulle
// (mêmes fonctions que la page : showHeadcount, showCount).
type Out = { cell: ExportCell; lower: boolean; foot?: string };
function out<T extends Value>(v: T, reason: (x: Extract<T, { kind: "nd" }>) => string, value: (x: Exclude<T, { kind: "nd" }>) => ExportCell): Out {
  if (v.kind === "nd") return { cell: { nd: reason(v as Extract<T, { kind: "nd" }>) }, lower: false };
  return { cell: value(v as Exclude<T, { kind: "nd" }>), lower: v.kind === "lower_bound" };
}
const ndOf = (x: { nd: { reason: string } }) => x.nd.reason;
const count = (c: Count): Out => ({ ...out(c, ndOf, (x) => x.value), foot: showCount(c).foot });
const headcount = (h: HeadcountResult): Out => ({ ...out(h, ndOf, (x) => x.persons), foot: showHeadcount(h, "persons").foot });

// Réserves d'une cellule pour Observations : la mention de borne basse, puis les précisions de l'infobulle de l'écran, sans le
// renvoi vers la couverture (colonne propre) ni « au moins » (déjà dit par la borne basse) ; sans doublon.
const SCREEN_ONLY = new Set(["au moins", "borne basse (voir la couverture du mois)"]);
function cellNotes(o: Out): string[] {
  const parts = [...new Set((o.foot ?? "").split(" · ").filter((p) => p !== "" && !SCREEN_ONLY.has(p)))];
  return o.lower && !parts.some((p) => p.startsWith("borne basse")) ? [LOWER, ...parts] : parts;
}

export type SuiviSheetIn = { dash: KpiDashboard; data: RhBuildData; establishments?: string[]; rawLimit: PayfitHistoryLimit | null; vue: KpiVue };

// Colonnes visibles de l'écran pour l'entrée choisie, dans le même ordre.
export const suiviColumns = (vue: KpiVue): SuiviColumn[] => SUIVI_COLUMNS.filter((c) => suiviColumnOn(vue, c));

// Colonnes des lignes « Période » : moyennes mensuelles (effectif, ETP : affichées au centième, comme à l'écran), puis totaux
// (entrées, sorties, jours : entiers et jours au format de leur colonne) et taux d'absentéisme de la période. L'écran les réunit
// dans une seule ligne ; le classeur les sépare pour que chaque valeur garde le format de l'écran (« 5 » entrées, « 6,08 »
// personnes en moyenne).
const PERIOD_AVERAGES: SuiviColumn[] = ["headcount", "etp", "etp-n1"];
const PERIOD_RATES: SuiviColumn[] = ["absenteeism", "absenteeism-n1"];

// Tableau « Mois par mois » : une ligne par mois de la fenêtre, puis les lignes « Période » (valeurs des tuiles de l'écran).
export function suiviSheet({ dash, data, establishments, rawLimit, vue }: SuiviSheetIn): SheetSpec {
  const cols = suiviColumns(vue);
  const t = dash.tiles;
  const rows: ExportCell[][] = [];
  const rowKinds: (ColumnKind | undefined)[] = [];
  const line = (label: string, cells: Partial<Record<SuiviColumn, Out>>, extra: string[] = [], kind?: ColumnKind) => {
    const notes = [...extra];
    for (const c of cols) {
      const o = cells[c];
      const n = o ? cellNotes(o) : [];
      if (n.length) notes.push(`${SUIVI_HEADERS[c].header} : ${n.join(" · ")}`);
    }
    rows.push([label, ...cols.map((c) => cells[c]?.cell ?? ""), [...new Set(notes)].join(" ; ")]);
    rowKinds.push(kind);
  };
  for (const r of dash.rows) {
    const cov = coverageShown(data, r.month, establishments, rawLimit);
    const covCell: Out = cov.kind === "nd" ? { cell: { nd: cov.text.replace(ND_PREFIX, "") }, lower: false } : { cell: cov.text, lower: false };
    line(
      r.month,
      {
        coverage: covCell,
        headcount: headcount(r.headcount),
        etp: out(r.etp, ndOf, (x) => x.etp4),
        "etp-prorated": out(r.etpProrated, ndOf, (x) => exact(x.ratio)),
        entries: count(r.movements.entries),
        exits: count(r.movements.exits),
        theoretical: out(r.theoretical, ndOf, (x) => days(x.half)),
        "absence-days": out(r.absenteeism, ndOf, (x) => days(x.ratio.num)),
        absenteeism: out(r.absenteeism, ndOf, (x) => exact(x.ratio)),
        "etp-n1": out(r.previous.etp, ndOf, (x) => x.etp4),
        "absenteeism-n1": out(r.previous.absenteeism, ndOf, (x) => exact(x.ratio)),
      },
      cols.includes("coverage") && cov.kind === "lower" && cov.foot ? [`Couverture : ${cov.foot}`] : [],
    );
  }
  const absCur = t.absenteeism.current;
  const period = dash.window.label;
  // Moyennes : la ligne est au format ETP (centième) pour la colonne d'effectif aussi.
  if (cols.some((c) => PERIOD_AVERAGES.includes(c))) {
    line(
      "Période — moyennes",
      {
        headcount: out(t.headcountAverage.current, ndOf, (x) => exact(x.ratio)),
        etp: out(t.etpAverage.current, ndOf, (x) => exact(x.ratio)),
        "etp-n1": out(t.etpAverage.previous, ndOf, (x) => exact(x.ratio)),
      },
      [`Moyennes des fins de mois (${period})`],
      "etp",
    );
  }
  const totals = cols.filter((c) => !PERIOD_AVERAGES.includes(c) && c !== "coverage" && c !== "etp-prorated");
  if (totals.length) {
    const rate = totals.some((c) => PERIOD_RATES.includes(c));
    line(
      rate ? "Période — totaux et taux" : "Période — totaux",
      {
        entries: out(dash.movements.entries, ndOf, (x) => x.value),
        exits: out(dash.movements.exits, ndOf, (x) => x.value),
        theoretical: out(dash.theoretical, ndOf, (x) => days(x.half)),
        "absence-days": out(absCur, ndOf, (x) => days(x.ratio.num)),
        absenteeism: out(absCur, ndOf, (x) => exact(x.ratio)),
        "absenteeism-n1": out(t.absenteeism.previous, ndOf, (x) => exact(x.ratio)),
      },
      [`Totaux des mois (${period})${rate ? " ; absentéisme : taux de la période" : ""}`],
    );
  }
  const columns: ColumnSpec[] = [
    { header: "Mois", key: "mois", kind: "text", width: 12 },
    ...cols.map((c): ColumnSpec => ({ header: SUIVI_HEADERS[c].header, key: c, kind: SUIVI_HEADERS[c].kind, ...(SUIVI_HEADERS[c].width ? { width: SUIVI_HEADERS[c].width } : {}) })),
    { header: "Observations", key: "observations", kind: "text" },
  ];
  return {
    name: "Mois par mois",
    columns,
    rows,
    rowKinds,
    note: "ETP, jours et pourcentages affichés au centième, valeur exacte conservée dans la cellule. Colonnes N-1 : même mois un an plus tôt.",
  };
}

// Tableau « Effectif et ETP par catégorie » (Suivi) : contrats et ETP de fin de mois de chaque catégorie, puis le total. Les filtres
// Établissement et Nature s'appliquent comme à l'écran (mêmes mois, mêmes colonnes) : `scope` est la mention du périmètre de
// l'écran (categoryScopeNote), reprise dans la note de la feuille.
export function categoriesSheet(months: CategoryMonth[], keys: string[], labels: Record<string, string>, opts: { scope?: string | null } = {}): SheetSpec {
  const label = (k: string) => labels[k] ?? k;
  // L'écran n'écrit que « ETP n.d. » : la raison propre à chaque contrat (quotité absente ou illisible, contrat non déclaré…)
  // est dans le détail de l'ETP fin de mois du tableau « Mois par mois ».
  const ETP_ND = { nd: "ETP fin de mois n.d. pour au moins un contrat de la catégorie (raison : détail de l'ETP fin de mois)" };
  const TOTAL_ND = { nd: "ETP fin de mois n.d. pour au moins un contrat du mois (raison : détail de l'ETP fin de mois)" };
  const columns: ColumnSpec[] = [
    { header: "Mois", key: "mois", kind: "text", width: 12 },
    ...[...keys, "total"].flatMap((k): ColumnSpec[] => [
      { header: `${k === "total" ? "Total" : label(k)} — effectif`, key: `${k}-n`, kind: "nombre" },
      { header: `${k === "total" ? "Total" : label(k)} — ETP`, key: `${k}-etp`, kind: "etp" },
    ]),
    { header: "Observations", key: "observations", kind: "text" },
  ];
  const rows = months.map((c): ExportCell[] => {
    if (c.kind === "nd") return [c.month, ...[...keys, "total"].flatMap(() => [{ nd: c.reason }, { nd: c.reason }]), ""];
    const all = Object.values(c.byCategory);
    const cells = keys.flatMap((k): ExportCell[] => {
      const x = c.byCategory[k];
      return x ? [x.headcount, x.etp4 === null ? ETP_ND : x.etp4] : ["", ""];
    });
    const total: ExportCell[] = [all.reduce((n, x) => n + x.headcount, 0), all.some((x) => x.etp4 === null) ? TOTAL_ND : all.reduce((n, x) => n + (x.etp4 ?? 0), 0)];
    return [c.month, ...cells, ...total, c.lowerBound ? `Effectifs : ${LOWER}` : ""];
  });
  const note = `Fin de mois ; catégorie sans contrat ce mois-là : cellule vide.${opts.scope ? ` ${opts.scope}` : ""}`;
  return { name: "Par catégorie", columns, rows, note };
}

// --- Effectifs mensuels ---------------------------------------------------------------------------------------------------------

export type EffectifsGridIn = {
  months: string[];
  groups: string[];
  layers: Map<string, "reel" | "projete">;
  cell: (group: string, month: string) => Cell;
  total: (month: string) => Cell;
};
const gridCell = (c: Cell): ExportCell => (c.kind === "value" ? c.v : c.kind === "nd" ? { nd: c.reason } : "");
export const monthHeader = (m: string, layer: "reel" | "projete" | undefined) => `${monthShortLabel(m)} ${m.slice(0, 4)}${layer === "projete" ? " (projeté)" : ""}`;

// Répartition mensuelle : une ligne par groupe de l'axe, une colonne par mois, puis le total ; unité de la rubrique. La grille reçue est
// celle de l'écran, déjà masquée par le seuil de confidentialité : mêmes cellules n.d., même raison (en commentaire de la cellule).
export function effectifsGridSheet(grid: EffectifsGridIn, unit: "etp" | "nombre" | "eur"): SheetSpec {
  const columns: ColumnSpec[] = [{ header: "Groupe", key: "groupe", kind: "text", width: 28 }, ...grid.months.map((m): ColumnSpec => ({ header: monthHeader(m, grid.layers.get(m)), key: m, kind: unit })), { header: "Observations", key: "observations", kind: "text" }];
  const rows: ExportCell[][] = [...grid.groups.map((g) => [g, ...grid.months.map((m) => gridCell(grid.cell(g, m))), ""]), ["Total", ...grid.months.map((m) => gridCell(grid.total(m))), ""]];
  return { name: "Répartition mensuelle", columns, rows, note: unit === "eur" ? "Montants en euros." : unit === "etp" ? "ETP affichés au centième." : "Nombres." };
}

// Répartition par groupe (stocks au dernier mois connu, flux sur le cumul des mois connus) et part de chaque groupe. Un groupe masqué
// par le seuil de confidentialité (v null) est n.d. avec la même raison que l'écran, valeur et part ; le total reste.
export function effectifsShareSheet(repart: { items: { group: string; v: number | null; reason?: string | null }[]; total: number }, unit: "etp" | "nombre" | "eur", basis: string): SheetSpec {
  const share = (v: number): ExportCell => (repart.total > 0 ? { exact: exactRatio(v, repart.total) } : { nd: "total nul : une part n'est pas définie" });
  const row = (it: { group: string; v: number | null; reason?: string | null }): ExportCell[] => (it.v === null ? [it.group, { nd: it.reason ?? "non affiché" }, { nd: it.reason ?? "non affiché" }, ""] : [it.group, it.v, share(it.v), ""]);
  return {
    name: "Répartition",
    columns: [{ header: "Groupe", key: "groupe", kind: "text", width: 28 }, { header: "Valeur", key: "valeur", kind: unit }, { header: "Part", key: "part", kind: "pourcent" }, { header: "Observations", key: "observations", kind: "text" }],
    rows: [...repart.items.map(row), ["Total", repart.total, share(repart.total), ""]],
    note: `Base : ${basis}.`,
  };
}
