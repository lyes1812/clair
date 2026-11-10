import { isMonth } from "@/lib/connectors/months";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { monthlyList, natureOfMonth, type MonthlyRow } from "./headcount";
import type { FieldNd, Provenance, RhBuildData, RhSource } from "./referential/types";

// Projections documentaires du même périmètre mensuel que Collaborateurs. Les comptes décrivent les lignes de la liste,
// pas un effectif légal. Les noms sont des libellés : seules les clés de personne/contrat servent aux unions.
export type ExplorationAxis = "team" | "nature" | "establishment" | "state";
export type ExplorationCategory = { key: string; label: string; value: string | null };
export type ExplorationTrace = { source: RhSource; date: string | null; period: string | null; collection: string; path: string };
export type ExplorationMeasure = { value: number | null; reason: string | null; trace: ExplorationTrace | null };
export type ExplorationRow = {
  id: string;
  contractKey: string;
  contractLabel: string;
  personKey: string | null;
  personName: string | null;
  startDate: string | null;
  endDate: string | null;
  team: ExplorationCategory;
  nature: ExplorationCategory;
  establishment: ExplorationCategory;
  state: ExplorationCategory;
  inScope: boolean;
  paidTime: ExplorationMeasure;
  workedTime: ExplorationMeasure;
  timeUnit: string | null;
  timeUnitLabel: string;
  fteAtRead: ExplorationMeasure;
  notes: string[];
};
export type ExplorationCount = { contracts: number; persons: number; withoutPerson: number; observations: number; rowIds: string[] };
export type ExplorationOptions = { natures: string[]; establishments?: string[]; q?: string; team?: string; nature?: string; state?: string };
export type ExplorationModel = {
  source: RhSource;
  month: string;
  referenceDate: string | null;
  gate: FieldNd | null;
  coverageKind: "exact" | "lower_bound" | "nd";
  notices: string[];
  rows: ExplorationRow[];
  total: ExplorationCount;
  teams: ExplorationCategory[];
  natures: ExplorationCategory[];
};
export type ExplorationPivot = {
  rowAxis: ExplorationAxis;
  columnAxis: ExplorationAxis;
  rowCategories: ExplorationCategory[];
  columnCategories: ExplorationCategory[];
  cells: ({ rowKey: string; columnKey: string } & ExplorationCount)[];
  rowTotals: ({ key: string } & ExplorationCount)[];
  columnTotals: ({ key: string } & ExplorationCount)[];
  total: ExplorationCount;
};
export type ExplorationTreeNode = {
  axis: ExplorationAxis | null;
  category: ExplorationCategory | null;
  count: ExplorationCount;
  children: ExplorationTreeNode[];
  rowIds: string[];
};

const STATE_LABELS: Record<MonthlyRow["state"]["code"], string> = {
  present: "Présent en fin de mois",
  entered: "Entré dans le mois",
  exited: "Sorti dans le mois",
  entered_exited: "Entré et sorti dans le mois",
  not_declared: "Non déclaré ce mois",
  declared_after_end: "Déclaré après sa fin",
  before_start: "Déclaré avant son début",
  out_of_scope: "Hors natures comptées",
  absent: "Absent en fin de mois",
};
const FLAG_LABELS: Record<string, string> = {
  negative_time: "Temps négatif dans la source",
  time_missing: "Ligne de temps absente",
  time_outside_contract: "Temps hors période du contrat",
  declared_before_start: "Déclaré avant le début du contrat",
  declared_after_end: "Déclaré après la fin du contrat",
  not_declared: "Contrat non déclaré ce mois",
};
const validText = (v: string | null | undefined): string | null => typeof v === "string" && v.trim() ? v : null;
const category = (axis: ExplorationAxis, value: string | null, label?: string): ExplorationCategory => ({
  key: value === null ? `${axis}:missing` : `${axis}:value:${JSON.stringify(value)}`,
  value,
  label: label ?? value ?? "Non renseigné",
});
const categories = (rows: ExplorationRow[], axis: ExplorationAxis): ExplorationCategory[] =>
  [...new Map(rows.map((r) => [r[axis].key, r[axis]])).values()].sort((a, b) =>
    Number(a.value === null) - Number(b.value === null) || a.label.localeCompare(b.label, "fr") || a.key.localeCompare(b.key));

function count(rows: ExplorationRow[]): ExplorationCount {
  const contracts = new Set(rows.map((r) => r.contractKey));
  const persons = new Set(rows.flatMap((r) => r.personKey === null ? [] : [r.personKey]));
  const withoutPerson = new Set(rows.filter((r) => r.personKey === null).map((r) => r.contractKey));
  return { contracts: contracts.size, persons: persons.size, withoutPerson: withoutPerson.size, observations: rows.length, rowIds: rows.map((r) => r.id) };
}

function traceOf(data: RhBuildData, p: Provenance | undefined): ExplorationTrace | null {
  return p ? { source: data.build.source, date: data.build.referenceDate, period: p.period, collection: p.collection, path: p.path } : null;
}

function measure(data: RhBuildData, value: number | null, reason: string | undefined, provenance: Provenance | undefined): ExplorationMeasure {
  const known = value !== null && Number.isFinite(value);
  return { value: known ? value : null, reason: known ? null : reason ?? "Valeur absente de la source", trace: traceOf(data, provenance) };
}

function unitLabel(unit: string | null, source: RhSource): string {
  if (unit === null) return "";
  if (source === "payfit") return unit === "hours" ? "h" : unit === "days" ? "j" : unit;
  return unit === "10" ? "h" : unit === "12" ? "j" : `unité ${unit}`;
}

function project(data: RhBuildData, row: MonthlyRow): ExplorationRow {
  const { contract: c, month: m, person: p } = row;
  const name = validText([p?.familyName, p?.givenNames].filter(Boolean).join(" "));
  const team = validText(p?.teamName);
  const nature = natureOfMonth(c, m);
  const notes = m.flags.map((flag) => FLAG_LABELS[flag] ?? flag);
  if (!p) notes.push("Contrat sans collaborateur rattaché");
  if (p && !name) notes.push("Nom du collaborateur non renseigné");
  if (!team) notes.push(data.build.source === "dsn" ? "Équipe non portée par la DSN" : "Équipe non renseignée dans la lecture PayFit");
  if (!row.inScope) notes.push("Contrat hors des natures comptées dans l'effectif");
  if (row.state.label !== STATE_LABELS[row.state.code]) notes.push(row.state.label);
  if (m.paidTime !== null && m.paidTime < 0 || m.workedTime !== null && m.workedTime < 0) notes.push("Temps négatif dans la source");
  if (m.timeUnit === null && (m.paidTime !== null || m.workedTime !== null)) notes.push("Unité de temps non renseignée");
  return {
    id: JSON.stringify([c.contractKey, m.establishmentId]),
    contractKey: c.contractKey,
    contractLabel: c.externalId,
    personKey: p?.personKey ?? null,
    personName: name,
    startDate: c.startDate,
    endDate: c.endDate,
    team: category("team", team),
    // Même règle que la liste mensuelle : nature déclarée du mois DSN, ou fiche PayFit datée (non historisée).
    nature: category("nature", nature, nature === null ? "Non renseignée" : contractNatureLabel(nature)),
    establishment: category("establishment", validText(m.establishmentId)),
    state: category("state", row.state.code, STATE_LABELS[row.state.code]),
    inScope: row.inScope,
    paidTime: measure(data, m.paidTime, m.fieldsNd.paidTime?.reason, m.provenance.paidTime),
    workedTime: measure(data, m.workedTime, m.fieldsNd.workedTime?.reason, m.provenance.workedTime),
    timeUnit: m.timeUnit,
    timeUnitLabel: unitLabel(m.timeUnit, data.build.source),
    fteAtRead: data.build.source === "payfit"
      ? measure(data, c.fteAtRead, c.fieldsNd.fteAtRead?.reason, c.provenance.fteAtRead)
      : { value: null, reason: "La DSN porte des quotités mensuelles ; aucune valeur ETP de lecture", trace: null },
    notes: [...new Set(notes)],
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
const matchesCategory = (c: ExplorationCategory, requested: string | undefined) => !requested || requested === c.key || requested === c.value;

export function buildExploration(data: RhBuildData, month: string, opts: ExplorationOptions): ExplorationModel {
  const initial = { source: data.build.source, month, referenceDate: data.build.referenceDate };
  const empty = (gate: FieldNd): ExplorationModel => ({ ...initial, gate, coverageKind: "nd", notices: [gate.reason], rows: [], total: count([]), teams: [], natures: [] });
  if (!isMonth(month)) return empty({ code: "month-not-covered", reason: "Mois invalide : choisissez un mois au format AAAA-MM" });
  const list = monthlyList(data, month, { natures: opts.natures, establishments: opts.establishments });
  // Une période non couverte n'emprunte aucune identité ni mesure à un autre mois.
  if (list.gate) return empty(list.gate);
  const rows0 = list.rows.map((row) => project(data, row));
  const q = fold((opts.q ?? "").trim().slice(0, 80));
  const rows = rows0.filter((r) => matchesCategory(r.team, opts.team) && matchesCategory(r.nature, opts.nature) && matchesCategory(r.state, opts.state) &&
    (!q || fold([r.personName, r.contractLabel, r.team.label, r.nature.label, r.nature.value, r.establishment.label, r.state.label, ...r.notes].filter(Boolean).join(" ")).includes(q)));
  const lower = list.coverage.filter((c) => c.presenceStatus === "lower_bound");
  const notices = lower.map((c) => c.presenceReason ?? "Couverture historique en borne basse");
  if (data.build.source === "payfit") {
    notices.push(`Équipes, natures de contrat et quotités à la date de lecture (${data.build.referenceDate ?? "n.d."}), sans historique d'affectation PayFit`);
  } else notices.push("Équipes non portées par la DSN ; les catégories inconnues restent séparées");
  return { ...initial, gate: null, coverageKind: lower.length ? "lower_bound" : "exact", notices: [...new Set(notices)], rows, total: count(rows), teams: categories(rows0, "team"), natures: categories(rows0, "nature") };
}

export function explorationPivot(model: ExplorationModel, rowAxis: ExplorationAxis, columnAxis: ExplorationAxis): ExplorationPivot {
  const rowCategories = categories(model.rows, rowAxis);
  const columnCategories = categories(model.rows, columnAxis);
  const cells = rowCategories.flatMap((r) => columnCategories.map((c) => ({
    rowKey: r.key,
    columnKey: c.key,
    ...count(model.rows.filter((row) => row[rowAxis].key === r.key && row[columnAxis].key === c.key)),
  })));
  return {
    rowAxis, columnAxis, rowCategories, columnCategories, cells,
    rowTotals: rowCategories.map((c) => ({ key: c.key, ...count(model.rows.filter((row) => row[rowAxis].key === c.key)) })),
    columnTotals: columnCategories.map((c) => ({ key: c.key, ...count(model.rows.filter((row) => row[columnAxis].key === c.key)) })),
    total: count(model.rows),
  };
}

export function explorationTree(model: ExplorationModel, axes: ExplorationAxis[] = ["team", "nature"]): ExplorationTreeNode {
  const distinctAxes = [...new Set(axes)];
  function node(rows: ExplorationRow[], level: number, axis: ExplorationAxis | null, group: ExplorationCategory | null): ExplorationTreeNode {
    const next = distinctAxes[level];
    return {
      axis,
      category: group,
      count: count(rows),
      rowIds: rows.map((r) => r.id),
      children: next ? categories(rows, next).map((c) => node(rows.filter((r) => r[next].key === c.key), level + 1, next, c)) : [],
    };
  }
  return node(model.rows, 0, null, null);
}

// Soustraction des écritures décimales de source, sans artefact 0,3 − 0,1. Aucun arrondi de temps ou conversion d'unité.
function decimal(value: number): { n: bigint; scale: number } {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa.split(".");
  let n = BigInt(integer + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) { n *= 10n ** BigInt(-scale); scale = 0; }
  return { n, scale };
}

export function explorationTimeGap(row: ExplorationRow): ExplorationMeasure {
  const nd = (reason: string): ExplorationMeasure => ({ value: null, reason, trace: null });
  const paid = row.paidTime;
  const worked = row.workedTime;
  if (paid.value === null || worked.value === null) return nd("Temps payé ou travaillé absent : écart non calculable");
  if (!["hours", "days", "10", "12"].includes(row.timeUnit ?? "")) return nd("Unité de temps absente ou non interprétée : écart non calculable");
  if (!paid.trace || !worked.trace || !paid.trace.date || !paid.trace.period || !isMonth(paid.trace.period) || paid.trace.source !== worked.trace.source || paid.trace.date !== worked.trace.date || paid.trace.period !== worked.trace.period || paid.trace.collection !== worked.trace.collection) {
    return nd("Sources ou périodes des temps non concordantes : écart non calculable");
  }
  if (!Number.isFinite(paid.value) || !Number.isFinite(worked.value)) return nd("Temps non fini : écart non calculable");
  const a = decimal(worked.value);
  const b = decimal(paid.value);
  const scale = Math.max(a.scale, b.scale);
  const n = a.n * 10n ** BigInt(scale - a.scale) - b.n * 10n ** BigInt(scale - b.scale);
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, "0");
  const text = `${n < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return nd("Écart hors limite numérique");
  const v = decimal(value);
  const common = Math.max(v.scale, scale);
  if (v.n * 10n ** BigInt(common - v.scale) !== n * 10n ** BigInt(common - scale)) return nd("Écart non représentable exactement");
  return { value: Object.is(value, -0) ? 0 : value, reason: null, trace: { ...paid.trace, path: "workedTime − paidTime" } };
}
