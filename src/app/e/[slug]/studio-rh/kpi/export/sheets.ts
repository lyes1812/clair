import type { CategoryMonth } from "@/lib/budget/categories";
import type { Cell } from "@/lib/budget/versions";
import { exactRatio, type ColumnKind, type ColumnSpec, type ExportCell, type SheetSpec } from "@/lib/export/xlsx";
import type { Count } from "@/lib/rh/headcount";
import { ETP_PRORATED_LABEL } from "@/lib/rh/kpi/etp-prorata";
import type { KpiDashboard, Kind, Ratio } from "@/lib/rh/kpi/types";
import type { PayfitHistoryLimit } from "@/lib/rh/raw-history";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { monthShortLabel } from "@/lib/viz/kpi";
import { coverageShown, SUIVI_COLUMNS, suiviColumnOn, type SuiviColumn } from "../suivi-data";
import type { KpiVue } from "../tabs";

// Feuilles Excel de KPI RH, construites depuis les mêmes objets que l'écran (aucun recalcul, aucun accès base) : une valeur
// exacte est un vrai nombre, une borne basse garde sa valeur avec la mention « borne basse » dans Observations, un n.d. est
// « n.d. » avec sa raison. Les demi-journées sont écrites en jours (valeur exacte, comme l'écran : « 12,5 j »).

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

// Une cellule et, pour une borne basse, la mention à porter en observation.
type Out = { cell: ExportCell; lower: boolean };
function out<T extends Value>(v: T, reason: (x: Extract<T, { kind: "nd" }>) => string, value: (x: Exclude<T, { kind: "nd" }>) => ExportCell): Out {
  if (v.kind === "nd") return { cell: { nd: reason(v as Extract<T, { kind: "nd" }>) }, lower: false };
  return { cell: value(v as Exclude<T, { kind: "nd" }>), lower: v.kind === "lower_bound" };
}
const ndOf = (x: { nd: { reason: string } }) => x.nd.reason;
const count = (c: Count): Out => out(c, ndOf, (x) => x.value);

export type SuiviSheetIn = { dash: KpiDashboard; data: RhBuildData; establishments?: string[]; rawLimit: PayfitHistoryLimit | null; vue: KpiVue };

// Colonnes visibles de l'écran pour l'entrée choisie, dans le même ordre.
export const suiviColumns = (vue: KpiVue): SuiviColumn[] => SUIVI_COLUMNS.filter((c) => suiviColumnOn(vue, c));

// Tableau « Mois par mois » : une ligne par mois de la fenêtre, puis la ligne « Période » (moyennes et totaux de l'écran).
export function suiviSheet({ dash, data, establishments, rawLimit, vue }: SuiviSheetIn): SheetSpec {
  const cols = suiviColumns(vue);
  const t = dash.tiles;
  const rows: ExportCell[][] = [];
  const line = (label: string, cells: Partial<Record<SuiviColumn, Out>>, extra: string[] = []) => {
    const notes = [...extra, ...cols.filter((c) => cells[c]?.lower).map((c) => `${SUIVI_HEADERS[c].header} : ${LOWER}`)];
    rows.push([label, ...cols.map((c) => cells[c]?.cell ?? ""), notes.join(" ; ")]);
  };
  for (const r of dash.rows) {
    const cov = coverageShown(data, r.month, establishments, rawLimit);
    const covCell: Out = cov.kind === "nd" ? { cell: { nd: cov.text.replace(ND_PREFIX, "") }, lower: false } : { cell: cov.text, lower: false };
    line(
      r.month,
      {
        coverage: covCell,
        headcount: out(r.headcount, ndOf, (x) => x.persons),
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
  line(
    "Période",
    {
      headcount: out(t.headcountAverage.current, ndOf, (x) => exact(x.ratio)),
      etp: out(t.etpAverage.current, ndOf, (x) => exact(x.ratio)),
      entries: out(dash.movements.entries, ndOf, (x) => ({ exact: x.value })),
      exits: out(dash.movements.exits, ndOf, (x) => ({ exact: x.value })),
      theoretical: out(dash.theoretical, ndOf, (x) => days(x.half)),
      "absence-days": out(absCur, ndOf, (x) => days(x.ratio.num)),
      absenteeism: out(absCur, ndOf, (x) => exact(x.ratio)),
      "etp-n1": out(t.etpAverage.previous, ndOf, (x) => exact(x.ratio)),
      "absenteeism-n1": out(t.absenteeism.previous, ndOf, (x) => exact(x.ratio)),
    },
    [`${dash.window.label} : moyennes (effectif, ETP) et totaux (entrées, sorties, jours)`],
  );
  const columns: ColumnSpec[] = [
    { header: "Mois", key: "mois", kind: "text", width: 12 },
    ...cols.map((c): ColumnSpec => ({ header: SUIVI_HEADERS[c].header, key: c, kind: SUIVI_HEADERS[c].kind, ...(SUIVI_HEADERS[c].width ? { width: SUIVI_HEADERS[c].width } : {}) })),
    { header: "Observations", key: "observations", kind: "text" },
  ];
  return {
    name: "Mois par mois",
    columns,
    rows,
    // La ligne « Période » porte des moyennes : ses cellules d'effectif s'affichent au centième, comme à l'écran.
    rowKinds: rows.map((_, i) => (i === rows.length - 1 ? "etp" : undefined)),
    note: "ETP, jours et pourcentages affichés au centième, valeur exacte conservée dans la cellule. Colonnes N-1 : même mois un an plus tôt.",
  };
}

// Tableau « Effectif et ETP par catégorie » (Suivi) : contrats et ETP de fin de mois de chaque catégorie, puis le total.
export function categoriesSheet(months: CategoryMonth[], keys: string[], labels: Record<string, string>): SheetSpec {
  const label = (k: string) => labels[k] ?? k;
  const ETP_ND = { nd: "quotité d'au moins un contrat de la catégorie n.d." };
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
    const total: ExportCell[] = [all.reduce((n, x) => n + x.headcount, 0), all.some((x) => x.etp4 === null) ? ETP_ND : all.reduce((n, x) => n + (x.etp4 ?? 0), 0)];
    return [c.month, ...cells, ...total, c.lowerBound ? `Effectifs : ${LOWER}` : ""];
  });
  return { name: "Par catégorie", columns, rows, note: "Fin de mois ; catégorie sans contrat ce mois-là : cellule vide." };
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

// Répartition mensuelle : une ligne par groupe de l'axe, une colonne par mois, puis le total ; unité de la rubrique.
export function effectifsGridSheet(grid: EffectifsGridIn, unit: "etp" | "nombre" | "eur"): SheetSpec {
  const columns: ColumnSpec[] = [{ header: "Groupe", key: "groupe", kind: "text", width: 28 }, ...grid.months.map((m): ColumnSpec => ({ header: monthHeader(m, grid.layers.get(m)), key: m, kind: unit })), { header: "Observations", key: "observations", kind: "text" }];
  const rows: ExportCell[][] = [...grid.groups.map((g) => [g, ...grid.months.map((m) => gridCell(grid.cell(g, m))), ""]), ["Total", ...grid.months.map((m) => gridCell(grid.total(m))), ""]];
  return { name: "Répartition mensuelle", columns, rows, note: unit === "eur" ? "Montants en euros." : unit === "etp" ? "ETP affichés au centième." : "Nombres." };
}

// Répartition par groupe (stocks au dernier mois connu, flux sur le cumul des mois connus) et part de chaque groupe.
export function effectifsShareSheet(repart: { items: { group: string; v: number }[]; total: number }, unit: "etp" | "nombre" | "eur", basis: string): SheetSpec {
  const share = (v: number): ExportCell => (repart.total > 0 ? { exact: exactRatio(v, repart.total) } : { nd: "total nul : une part n'est pas définie" });
  return {
    name: "Répartition",
    columns: [{ header: "Groupe", key: "groupe", kind: "text", width: 28 }, { header: "Valeur", key: "valeur", kind: unit }, { header: "Part", key: "part", kind: "pourcent" }, { header: "Observations", key: "observations", kind: "text" }],
    rows: [...repart.items.map((it) => [it.group, it.v, share(it.v), ""]), ["Total", repart.total, share(repart.total), ""]],
    note: `Base : ${basis}.`,
  };
}
