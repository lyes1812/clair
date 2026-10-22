import { addMonths, addMonthsToDate, formatDate, isActiveOn, monthEnd, monthOf, monthStart, monthsBetween, overlapsMonth } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { PAYFIT_ARCHIVED_RETENTION_MONTHS } from "./referential/build-payfit";
import { nd, type ContractDraft, type ContractMonthDraft, type CoverageDraft, type EventDraft, type FieldNd, type FindingDraft, type PersonDraft, type RhBuildData } from "./referential/types";

// Règles d'effectif (§ 6), fonctions pures sur un référentiel : exactes sur les mois complets, « borne basse » sur les
// mois PayFit antérieurs à la fenêtre de conservation, « n.d. » avec raison partout ailleurs. Jamais de différence
// entre deux mois, jamais d'horloge : la date de référence est celle du référentiel.
export type HeadcountOpts = { natures: string[]; establishments?: string[] };

export type Presence = { state: "present" } | { state: "absent"; reason: string } | { state: "nd"; nd: FieldNd };

export type BySiret = Record<string, { persons: number; contracts: number }>;
export type HeadcountResult =
  | {
      kind: "exact" | "lower_bound";
      persons: number;
      contracts: number;
      allContracts: number;
      byNature: Record<string, number>;
      outOfScope: { byNature: Record<string, number>; withoutPerson: number; unpositioned: number };
      declaredAfterEnd: number;
      declaredAfterEndKeys: string[]; // contrats de natures comptées déclarés ce mois après leur fin (non comptés)
      contractKeys: string[];
      qualifiers: string[];
      bySiret: BySiret;
    }
  | { kind: "nd"; nd: FieldNd };

export type Count = { kind: "exact" | "lower_bound"; value: number; qualifiers: string[] } | { kind: "nd"; nd: FieldNd };

export type EventRow = { event: EventDraft; contract: ContractDraft; person: PersonDraft | null; inScope: boolean };

export type RowState = { code: "present" | "entered" | "exited" | "entered_exited" | "not_declared" | "declared_after_end" | "before_start" | "out_of_scope" | "absent"; label: string };
export type MonthlyRow = { month: ContractMonthDraft; contract: ContractDraft; person: PersonDraft | null; state: RowState; inScope: boolean };
export type MonthlyList = {
  month: string;
  coverage: CoverageDraft[];
  gate: FieldNd | null;
  headcountStart: HeadcountResult;
  headcountEnd: HeadcountResult;
  presentAnyDay: { kind: "exact" | "lower_bound"; persons: number; contracts: number; qualifiers: string[] } | { kind: "nd"; nd: FieldNd };
  entries: EventRow[];
  exits: EventRow[];
  entriesCount: Count;
  exitsCount: Count;
  rows: MonthlyRow[];
  outOfScope: { otherNatures: MonthlyRow[]; withoutPerson: ContractDraft[]; unpositioned: ContractDraft[]; personsWithoutContract: PersonDraft[] };
  disappeared: ContractDraft[];
  findings: FindingDraft[];
};

export type Movements = {
  entries: EventRow[];
  exits: EventRow[];
  upcoming: EventRow[];
  unplaced: ContractDraft[];
  disappeared: ContractDraft[];
  notes: { month: string; reason: string }[];
};

export type StripCell = { month: string; state: "present" | "absent" | "nd"; reason: string | null };
export type AnnualRow = {
  person: PersonDraft;
  contracts: ContractDraft[];
  presentJan1: Presence;
  presentDec31: Presence;
  entries: EventDraft[];
  exits: EventDraft[];
  strip: StripCell[];
  monthsPresent: number;
  monthsCovered: number;
  establishments: string[];
  findings: FindingDraft[];
};
export type AnnualList = {
  year: number;
  months: string[];
  coverage: Record<string, CoverageDraft[]>;
  coveredMonths: string[];
  uncovered: { month: string; reason: string }[];
  headcountJan1: HeadcountResult;
  headcountDec31: HeadcountResult;
  entriesCount: Count;
  exitsCount: Count;
  rows: AnnualRow[];
  withoutPerson: ContractDraft[];
  personsWithoutContract: PersonDraft[];
};

// --- Index et garde-fous

type Index = {
  persons: Map<string, PersonDraft>;
  contracts: Map<string, ContractDraft>;
  declared: Map<string, ContractMonthDraft[]>; // `${month}` → lignes déclarées (DSN) ou par dates (PayFit)
};
const indexes = new WeakMap<RhBuildData, Index>();
function index(data: RhBuildData): Index {
  let ix = indexes.get(data);
  if (!ix) {
    ix = { persons: new Map(data.persons.map((p) => [p.personKey, p])), contracts: new Map(data.contracts.map((c) => [c.contractKey, c])), declared: new Map() };
    for (const m of data.months) ix.declared.set(m.month, [...(ix.declared.get(m.month) ?? []), m]);
    indexes.set(data, ix);
  }
  return ix;
}

const inEst = (establishments: string[] | undefined, id: string | null) => !establishments || (id !== null && establishments.includes(id));

// PayFit (hypothèse B4, confirmée sur le compte pilote) : un contrat présent à la date D ne peut manquer que s'il a pris fin
// plus de `rétention` mois avant la lecture ; l'effectif à D est donc exact dès que D ≥ date de lecture − rétention, même
// dans un mois dont la couverture est en borne basse (ses entrées et sorties, elles, restent incomplètes).
export function payfitExactFrom(data: RhBuildData): string | null {
  if (data.build.source !== "payfit" || PAYFIT_ARCHIVED_RETENTION_MONTHS === null || !data.build.referenceDate) return null;
  if (!data.coverage.some((c) => c.presenceStatus === "lower_bound")) return null; // aucun mois limité (ou mode brut)
  return addMonthsToDate(data.build.referenceDate, -PAYFIT_ARCHIVED_RETENTION_MONTHS);
}
const exactAt = (data: RhBuildData, date: string) => {
  const from = payfitExactFrom(data);
  return from !== null && date >= from;
};

export function coverageAt(data: RhBuildData, month: string, establishments?: string[]): CoverageDraft[] {
  return data.coverage.filter((c) => c.month === month && inEst(establishments, c.establishmentId));
}

const coverageLabel = (data: RhBuildData) => (data.build.presenceFrom && data.build.presenceTo ? `${data.build.presenceFrom} → ${data.build.presenceTo}` : "aucun mois complet");

// Pourquoi une date ne peut pas être évaluée : date de référence, bornes de couverture, mois non complet.
export function gateAt(data: RhBuildData, date: string, establishments?: string[]): { nd: FieldNd | null; coverage: CoverageDraft[] } {
  const M = monthOf(date);
  const cov = coverageAt(data, M, establishments);
  const ref = data.build.referenceDate;
  if (data.build.unavailableReason) return { nd: nd("source-unavailable", data.build.unavailableReason), coverage: cov };
  if (!ref) return { nd: nd("month-not-covered", "aucun mois complet dans la source retenue"), coverage: cov };
  if (date > ref) return { nd: nd("after-reference", `période postérieure à la date de référence (${formatDate(ref)}) ; voir Mouvements › À venir`), coverage: cov };
  if (cov.length) {
    // Un mois qui a une ligne de couverture porte sa propre raison (incomplet, bloqué, manquant), même avant le premier mois complet.
    const bad = cov.filter((c) => c.presenceStatus === "blocked" || c.presenceStatus === "incomplete" || c.presenceStatus === "missing");
    if (bad.length) {
      const code = bad.some((c) => c.presenceStatus === "blocked") ? "coverage-blocked" : bad.some((c) => c.presenceStatus === "incomplete") ? "coverage-incomplete" : "month-not-covered";
      return { nd: nd(code, bad.map((c) => c.presenceReason ?? `mois ${c.month} non couvert (SIRET ${c.establishmentId})`).join(" ")), coverage: cov };
    }
    return { nd: null, coverage: cov };
  }
  if (data.build.presenceFrom && M < data.build.presenceFrom) return { nd: nd("before-coverage", `période non couverte par la source retenue (couverture : ${coverageLabel(data)})`), coverage: cov };
  return { nd: nd("month-not-covered", `aucune déclaration appliquée pour ${M}${establishments ? ` (SIRET ${establishments.join(", ")})` : ""}`), coverage: cov };
}

// Présence d'un contrat à une date (définition 1) : bornes incluses ; DSN : déclaré ce mois, mois complet.
export function presenceAt(data: RhBuildData, c: ContractDraft, date: string, establishments?: string[]): Presence {
  if (c.startDate === null) return { state: "nd", nd: c.fieldsNd.startDate ?? nd("no-start-date", "date de début absente") };
  const g = gateAt(data, date, establishments);
  if (g.nd) return { state: "nd", nd: g.nd };
  if (c.startDate > date) return { state: "absent", reason: "début postérieur" };
  const M = monthOf(date);
  const rows = (index(data).declared.get(M) ?? []).filter((m) => m.contractKey === c.contractKey && inEst(establishments, m.establishmentId));
  if (c.endDate !== null && c.endDate < date) {
    return rows.some((m) => m.flags.includes("declared_after_end")) ? { state: "absent", reason: "déclaré après sa fin" } : { state: "absent", reason: "fin antérieure" };
  }
  if (data.build.source === "dsn") {
    if (!rows.some((m) => m.presenceBasis === "declared")) return { state: "absent", reason: "non déclaré ce mois" };
    if (rows.every((m) => m.flags.includes("declared_before_start"))) return { state: "absent", reason: "début postérieur" };
  } else if (establishments && !inEst(establishments, c.establishmentId)) return { state: "absent", reason: "autre établissement" };
  return { state: "present" };
}

// Nature retenue pour un mois : DSN, celle déclarée ce mois-là (S21.G00.40.007 de la ligne du mois, un CDD transformé en CDI
// sous le même numéro reste un CDD pour ses mois de CDD) ; PayFit, celle du contrat (non historisée par PayFit).
export const natureOfMonth = (c: ContractDraft, m: ContractMonthDraft): string | null => (m.presenceBasis === "declared" ? m.nature : c.nature);

type Active = { contract: ContractDraft; establishmentId: string; nature: string | null };

function activeAt(data: RhBuildData, date: string, establishments?: string[]): Active[] {
  const M = monthOf(date);
  const out: Active[] = [];
  if (data.build.source === "dsn") {
    // Une ligne par (contrat, établissement déclarant) : le détail par SIRET les voit toutes, les totaux dédoublonnent par clé.
    for (const m of index(data).declared.get(M) ?? []) {
      if (m.presenceBasis !== "declared" || !inEst(establishments, m.establishmentId)) continue;
      const c = index(data).contracts.get(m.contractKey);
      if (!c || c.startDate === null || !isActiveOn(c.startDate, c.endDate, date)) continue;
      if (m.flags.includes("declared_before_start")) continue;
      out.push({ contract: c, establishmentId: m.establishmentId, nature: m.nature });
    }
    return out;
  }
  for (const c of data.contracts) {
    if (c.startDate === null || !isActiveOn(c.startDate, c.endDate, date) || !inEst(establishments, c.establishmentId)) continue;
    out.push({ contract: c, establishmentId: c.establishmentId ?? "n.d.", nature: c.nature });
  }
  return out;
}

const natureKey = (n: string | null) => n ?? "nd";

// Effectif à une date (définitions 2 à 4) : personnes distinctes et contrats, natures comptées ; le reste à part.
export function headcountAt(data: RhBuildData, date: string, opts: HeadcountOpts): HeadcountResult {
  const g = gateAt(data, date, opts.establishments);
  if (g.nd) return { kind: "nd", nd: g.nd };
  const all = activeAt(data, date, opts.establishments);
  const isCounted = (r: Active) => r.nature !== null && opts.natures.includes(r.nature);
  // Détail par établissement : toutes les lignes déclarées (C5) ; totaux : une seule présence par contrat.
  const bySiret: BySiret = {};
  const siretPersons = new Map<string, Set<string>>();
  for (const r of all) {
    if (!isCounted(r)) continue;
    const s = (bySiret[r.establishmentId] ??= { persons: 0, contracts: 0 });
    s.contracts += 1;
    if (r.contract.personKey !== null) {
      const sp = siretPersons.get(r.establishmentId) ?? new Set<string>();
      sp.add(r.contract.personKey);
      siretPersons.set(r.establishmentId, sp);
    }
  }
  for (const [siret, sp] of siretPersons) bySiret[siret].persons = sp.size;
  const seen = new Set<string>();
  const rows = all.filter((r) => (seen.has(r.contract.contractKey) ? false : (seen.add(r.contract.contractKey), true)));
  const counted = rows.filter(isCounted);
  const byNature: Record<string, number> = {};
  const outByNature: Record<string, number> = {};
  const persons = new Set<string>();
  let withoutPerson = 0;
  for (const r of rows) {
    const k = natureKey(r.nature);
    if (!isCounted(r)) {
      outByNature[k] = (outByNature[k] ?? 0) + 1;
      continue;
    }
    byNature[k] = (byNature[k] ?? 0) + 1;
    if (r.contract.personKey === null) withoutPerson += 1;
    else persons.add(r.contract.personKey);
  }
  const M = monthOf(date);
  const lower = exactAt(data, date) ? [] : g.coverage.filter((c) => c.presenceStatus === "lower_bound");
  // Contrat déclaré ce mois-ci après sa fin (DSN, natures comptées) : hors effectif et compté à part. Cas courant d'un versement
  // après le départ (régularisation, prime) ; une rupture annulée n'est connue qu'au dépôt d'une nouvelle fin (limite écrite).
  const afterEnd = [
    ...new Set(
      (index(data).declared.get(M) ?? []).filter((m) => m.flags.includes("declared_after_end") && inEst(opts.establishments, m.establishmentId) && m.nature !== null && opts.natures.includes(m.nature)).map((m) => m.contractKey),
    ),
  ].sort();
  return {
    kind: lower.length ? "lower_bound" : "exact",
    persons: persons.size,
    contracts: counted.length,
    allContracts: rows.length,
    byNature,
    outOfScope: { byNature: outByNature, withoutPerson, unpositioned: data.contracts.filter((c) => c.startDate === null).length },
    declaredAfterEnd: afterEnd.length,
    declaredAfterEndKeys: afterEnd,
    contractKeys: counted.map((r) => r.contract.contractKey).sort(),
    qualifiers: [
      ...new Set(lower.map((c) => c.presenceReason).filter((r): r is string => r !== null)),
      ...(afterEnd.length ? [`${afterEnd.length} contrat(s) déclaré(s) après leur fin, non compté(s) : versement après départ (rupture déclarée acquise)`] : []),
    ],
    bySiret,
  };
}

function eventRow(data: RhBuildData, e: EventDraft, natures: string[]): EventRow | null {
  const ix = index(data);
  const contract = ix.contracts.get(e.contractKey);
  if (!contract) return null;
  return { event: e, contract, person: e.personKey ? (ix.persons.get(e.personKey) ?? null) : null, inScope: e.nature !== null && natures.includes(e.nature) };
}

// Entrées / sorties d'un mois (définition 6) : faits de source, qualifiés selon la couverture du mois.
function monthCount(data: RhBuildData, month: string, kind: "entry" | "exit", opts: HeadcountOpts): { rows: EventRow[]; count: Count } {
  const ref = data.build.referenceDate;
  const rows = data.events
    .filter((e) => e.kind === kind && e.month === month && inEst(opts.establishments, e.establishmentId))
    .map((e) => eventRow(data, e, opts.natures))
    .filter((r): r is EventRow => r !== null)
    .sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : a.contract.contractKey.localeCompare(b.contract.contractKey)));
  const value = rows.filter((r) => r.inScope && (!ref || r.event.date <= ref)).length;
  if (ref && monthStart(month) > ref) return { rows, count: { kind: "nd", nd: nd("after-reference", `période postérieure à la date de référence (${formatDate(ref)}) ; voir Mouvements › À venir`) } };
  const cov = coverageAt(data, month, opts.establishments);
  if (!cov.length) return { rows, count: { kind: "nd", nd: nd("month-not-covered", `période non couverte par la source retenue (couverture : ${coverageLabel(data)})`) } };
  const blocked = cov.filter((c) => c.presenceStatus === "blocked");
  if (blocked.length) return { rows, count: { kind: "nd", nd: nd("coverage-blocked", blocked.map((c) => c.presenceReason ?? `mois ${c.month} bloqué`).join(" ")) } };
  // Qualificatifs courts : la raison complète est portée par la couverture du mois (bandeau à l'écran).
  const lower = cov.filter((c) => c.presenceStatus === "lower_bound");
  if (lower.length) {
    if (kind === "exit") return { rows, count: { kind: "nd", nd: nd("coverage-incomplete", `sorties de ${month} inconnues : contrats archivés depuis plus de ${PAYFIT_ARCHIVED_RETENTION_MONTHS ?? "n.d."} mois absents de PayFit (hypothèse à confirmer)`) } };
    return { rows, count: { kind: "lower_bound", value, qualifiers: ["borne basse (PayFit)"] } };
  }
  const bad = cov.filter((c) => c.presenceStatus !== "complete");
  if (bad.length) return { rows, count: { kind: "lower_bound", value, qualifiers: [`au moins les mouvements connus : ${bad.map((c) => c.presenceReason ?? `mois ${c.presenceStatus} (SIRET ${c.establishmentId})`).join(" ")}`] } };
  // Mois de la date de référence non écoulé : le total du mois n'est pas connaissable.
  if (ref && monthOf(ref) === month && ref < monthEnd(month)) return { rows, count: { kind: "lower_bound", value, qualifiers: [`mois en cours à la date de référence : connu jusqu'au ${formatDate(ref)}`] } };
  return { rows, count: { kind: "exact", value, qualifiers: [] } };
}

function rowState(c: ContractDraft, m: ContractMonthDraft, natures: string[]): RowState {
  if (m.presenceBasis === "not_declared") return { code: "not_declared", label: "non déclaré ce mois" };
  if (m.flags.includes("declared_after_end")) return { code: "declared_after_end", label: `déclaré ce mois, fin le ${formatDate(c.endDate)} (antérieure)` };
  if (m.flags.includes("declared_before_start")) return { code: "before_start", label: `déclaré avant son début (${formatDate(c.startDate)})` };
  const nature = natureOfMonth(c, m);
  if (nature === null || !natures.includes(nature)) return { code: "out_of_scope", label: `hors effectif : nature ${contractNatureLabel(nature)}` };
  const startIn = c.startDate !== null && monthOf(c.startDate) === m.month;
  const endIn = c.endDate !== null && monthOf(c.endDate) === m.month;
  if (startIn && endIn) return { code: "entered_exited", label: `entré le ${formatDate(c.startDate)}, sorti le ${formatDate(c.endDate)}` };
  if (endIn) return { code: "exited", label: `sorti le ${formatDate(c.endDate)}` };
  if (startIn) return { code: "entered", label: `entré le ${formatDate(c.startDate)}` };
  if (!m.presentMonthEnd) return { code: "absent", label: "absent en fin de mois" };
  return { code: "present", label: "présent" };
}

const personSort = (a: PersonDraft | null, b: PersonDraft | null) => (a?.familyName ?? "").localeCompare(b?.familyName ?? "") || (a?.givenNames ?? "").localeCompare(b?.givenNames ?? "");

export function monthlyList(data: RhBuildData, month: string, opts: HeadcountOpts): MonthlyList {
  const ix = index(data);
  const endDate = monthEnd(month);
  const g = gateAt(data, endDate, opts.establishments);
  const headcountEnd = headcountAt(data, endDate, opts);
  const headcountStart = headcountAt(data, monthStart(month), opts);
  const monthRows = (ix.declared.get(month) ?? []).filter((m) => inEst(opts.establishments, m.establishmentId));

  let presentAnyDay: MonthlyList["presentAnyDay"];
  if (g.nd) presentAnyDay = { kind: "nd", nd: g.nd };
  else {
    const seen = new Set<string>();
    const persons = new Set<string>();
    for (const m of monthRows) {
      const c = ix.contracts.get(m.contractKey);
      const n = c ? natureOfMonth(c, m) : null;
      if (!m.presentAnyDay || !c || n === null || !opts.natures.includes(n) || seen.has(c.contractKey)) continue;
      seen.add(c.contractKey);
      if (c.personKey) persons.add(c.personKey);
    }
    const lower = exactAt(data, monthStart(month)) ? [] : g.coverage.filter((c) => c.presenceStatus === "lower_bound");
    presentAnyDay = { kind: lower.length ? "lower_bound" : "exact", persons: persons.size, contracts: seen.size, qualifiers: lower.map((c) => c.presenceReason ?? "borne basse") };
  }
  const entries = monthCount(data, month, "entry", opts);
  const exits = monthCount(data, month, "exit", opts);
  const rows: MonthlyRow[] = monthRows
    .map((m) => {
      const contract = ix.contracts.get(m.contractKey);
      if (!contract) return null;
      const state = rowState(contract, m, opts.natures);
      return { month: m, contract, person: contract.personKey ? (ix.persons.get(contract.personKey) ?? null) : null, state, inScope: state.code !== "out_of_scope" };
    })
    .filter((r): r is MonthlyRow => r !== null)
    .sort((a, b) => personSort(a.person, b.person) || a.contract.contractKey.localeCompare(b.contract.contractKey) || a.month.establishmentId.localeCompare(b.month.establishmentId));
  const keysOfMonth = new Set(rows.map((r) => r.contract.contractKey));
  const findings = data.findings.filter((f) => f.month === month || (f.month === null && f.contractKeys.some((k) => keysOfMonth.has(k))));
  return {
    month,
    coverage: g.coverage,
    gate: g.nd,
    headcountStart,
    headcountEnd,
    presentAnyDay,
    entries: entries.rows,
    exits: exits.rows,
    entriesCount: entries.count,
    exitsCount: exits.count,
    rows,
    outOfScope: {
      otherNatures: rows.filter((r) => r.state.code === "out_of_scope"),
      withoutPerson: data.contracts.filter((c) => c.personKey === null && c.startDate !== null && overlapsMonth(c.startDate, c.endDate, month)),
      unpositioned: data.contracts.filter((c) => c.startDate === null),
      personsWithoutContract: data.persons.filter((p) => !p.hasContract),
    },
    disappeared: data.contracts.filter((c) => c.endStatus === "disappeared"),
    findings,
  };
}

export function movements(data: RhBuildData, from: string, to: string, opts: HeadcountOpts): Movements {
  const ref = data.build.referenceDate;
  const inRange = (e: EventDraft) => e.month >= from && e.month <= to && inEst(opts.establishments, e.establishmentId);
  const isFuture = (e: EventDraft) => e.flags.includes("future") || (ref !== null && e.date > ref);
  const rowsOf = (kind: "entry" | "exit", keep: (e: EventDraft) => boolean) =>
    data.events
      .filter((e) => e.kind === kind && keep(e))
      .map((e) => eventRow(data, e, opts.natures))
      .filter((r): r is EventRow => r !== null)
      .sort((a, b) => a.event.date.localeCompare(b.event.date) || a.contract.contractKey.localeCompare(b.contract.contractKey));
  const notes: Movements["notes"] = [];
  for (const M of monthsBetween(from, to)) {
    if (ref && monthStart(M) > ref) {
      notes.push({ month: M, reason: `n.d. — période postérieure à la date de référence (${formatDate(ref)}) ; voir À venir` });
      continue;
    }
    const cov = coverageAt(data, M, opts.establishments);
    if (!cov.length) {
      notes.push({ month: M, reason: `n.d. — période non couverte par la source retenue (couverture : ${coverageLabel(data)})` });
      continue;
    }
    const blocked = cov.filter((c) => c.presenceStatus === "blocked");
    if (blocked.length) {
      notes.push({ month: M, reason: `n.d. — ${blocked.map((c) => c.presenceReason ?? "mois bloqué").join(" ")}` });
      continue;
    }
    const lower = cov.filter((c) => c.presenceStatus === "lower_bound");
    if (lower.length) notes.push({ month: M, reason: `entrées : au moins celles connues ; sorties : n.d. — ${lower[0].presenceReason ?? "borne basse"}` });
    const bad = cov.filter((c) => c.presenceStatus !== "complete" && c.presenceStatus !== "lower_bound");
    if (bad.length) notes.push({ month: M, reason: `au moins les mouvements connus — ${bad.map((c) => c.presenceReason ?? c.presenceStatus).join(" ")} ; un contrat commencé et fini dans le mois serait invisible` });
    if (ref && monthOf(ref) === M && ref < monthEnd(M) && !lower.length && !bad.length) notes.push({ month: M, reason: `mois en cours à la date de référence : mouvements connus jusqu'au ${formatDate(ref)}` });
  }
  const upcomingOf = (e: EventDraft) => isFuture(e) && inEst(opts.establishments, e.establishmentId);
  return {
    entries: rowsOf("entry", (e) => inRange(e) && !isFuture(e)),
    exits: rowsOf("exit", (e) => inRange(e) && !isFuture(e)),
    upcoming: [...rowsOf("entry", upcomingOf), ...rowsOf("exit", upcomingOf)].sort((a, b) => a.event.date.localeCompare(b.event.date)),
    unplaced: data.contracts.filter((c) => c.startDate === null),
    disappeared: data.contracts.filter((c) => c.endStatus === "disappeared"),
    notes,
  };
}

function mergePresence(list: Presence[], none: string): Presence {
  if (list.some((p) => p.state === "present")) return { state: "present" };
  const ndP = list.find((p): p is { state: "nd"; nd: FieldNd } => p.state === "nd");
  if (ndP) return ndP;
  const absent = list.find((p): p is { state: "absent"; reason: string } => p.state === "absent");
  return absent ?? { state: "absent", reason: none };
}

// Plages de mois contiguës (« 2025-01 → 2025-03, 2025-07 ») : jamais une plage reconstituée entre deux mois isolés.
export function monthRanges(months: string[]): string {
  const out: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  for (const m of months) {
    if (start === null) start = m;
    else if (prev !== null && addMonths(prev, 1) !== m) {
      out.push(start === prev ? start : `${start} → ${prev}`);
      start = m;
    }
    prev = m;
  }
  if (start !== null && prev !== null) out.push(start === prev ? start : `${start} → ${prev}`);
  return out.join(", ");
}

export function annualList(data: RhBuildData, year: number, opts: HeadcountOpts): AnnualList {
  const ix = index(data);
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const coverage: Record<string, CoverageDraft[]> = {};
  const uncovered: AnnualList["uncovered"] = [];
  const coveredMonths: string[] = [];
  for (const M of months) {
    coverage[M] = coverageAt(data, M, opts.establishments);
    const g = gateAt(data, monthEnd(M), opts.establishments);
    if (g.nd) uncovered.push({ month: M, reason: g.nd.reason });
    else coveredMonths.push(M);
  }
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const inYear = (c: ContractDraft) => c.startDate !== null && c.startDate <= yearEnd && (c.endDate === null || c.endDate >= yearStart);
  const declaredInYear = new Set(data.months.filter((m) => m.month.startsWith(`${year}-`) && m.presenceBasis === "declared" && inEst(opts.establishments, m.establishmentId)).map((m) => m.contractKey));
  const concerns = (c: ContractDraft) =>
    data.build.source === "dsn"
      ? declaredInYear.has(c.contractKey) || (!opts.establishments && inYear(c))
      : inYear(c) && inEst(opts.establishments, c.establishmentId);
  const byPerson = new Map<string, ContractDraft[]>();
  for (const c of data.contracts) {
    if (!c.personKey || !concerns(c)) continue;
    byPerson.set(c.personKey, [...(byPerson.get(c.personKey) ?? []), c]);
  }
  const rows: AnnualRow[] = [];
  for (const [personKey, contracts] of byPerson) {
    const person = ix.persons.get(personKey);
    if (!person) continue;
    const counted = contracts.filter((c) => c.nature !== null && opts.natures.includes(c.nature));
    const none = counted.length === 0 ? `hors natures comptées : ${[...new Set(contracts.map((c) => contractNatureLabel(c.nature)))].join(", ")}` : "aucun contrat";
    const presence = (date: string): Presence => {
      // La couverture prime : au-delà de la date de référence ou hors couverture, la cellule est n.d. quelle que soit la nature.
      const g = gateAt(data, date, opts.establishments);
      if (g.nd) return { state: "nd", nd: g.nd };
      return mergePresence(counted.map((c) => presenceAt(data, c, date, opts.establishments)), none);
    };
    const strip: StripCell[] = months.map((M) => {
      const p = presence(monthEnd(M));
      return p.state === "present" ? { month: M, state: "present", reason: null } : p.state === "nd" ? { month: M, state: "nd", reason: p.nd.reason } : { month: M, state: "absent", reason: p.reason };
    });
    const keys = new Set(contracts.map((c) => c.contractKey));
    // Événements de l'année connus à la date de référence ; les suivants sont dans Mouvements › À venir.
    const ref = data.build.referenceDate;
    const events = data.events.filter((e) => keys.has(e.contractKey) && e.month.startsWith(`${year}-`) && (!ref || e.date <= ref)).sort((a, b) => a.date.localeCompare(b.date));
    rows.push({
      person,
      contracts: [...contracts].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.contractKey.localeCompare(b.contractKey)),
      presentJan1: presence(yearStart),
      presentDec31: presence(yearEnd),
      entries: events.filter((e) => e.kind === "entry"),
      exits: events.filter((e) => e.kind === "exit"),
      strip,
      monthsPresent: strip.filter((s) => s.state === "present").length,
      monthsCovered: strip.filter((s) => s.state !== "nd").length,
      establishments: [...new Set(contracts.map((c) => c.establishmentId).filter((e): e is string => e !== null))].sort(),
      findings: data.findings.filter((f) => f.personKeys.includes(personKey) || f.contractKeys.some((k) => keys.has(k))),
    });
  }
  rows.sort((a, b) => personSort(a.person, b.person) || a.person.personKey.localeCompare(b.person.personKey));
  const yearCount = (kind: "entry" | "exit"): Count => {
    let value = 0;
    const qualifiers = new Set<string>();
    const ndMonths: string[] = [];
    let lower = false;
    for (const M of months) {
      const c = monthCount(data, M, kind, opts).count;
      if (c.kind === "nd") {
        ndMonths.push(M);
        continue;
      }
      value += c.value;
      if (c.kind === "lower_bound") {
        lower = true;
        for (const q of c.qualifiers) qualifiers.add(q);
      }
    }
    if (ndMonths.length === 12) return { kind: "nd", nd: nd("month-not-covered", `aucun mois de ${year} couvert par la source retenue (couverture : ${coverageLabel(data)})`) };
    const covered = 12 - ndMonths.length;
    if (ndMonths.length) qualifiers.add(`${value} sur les mois couverts (${covered}/12) ; n.d. : ${monthRanges(ndMonths)}`);
    return { kind: lower || covered < 12 ? "lower_bound" : "exact", value, qualifiers: [...qualifiers] };
  };
  return {
    year,
    months,
    coverage,
    coveredMonths,
    uncovered,
    headcountJan1: headcountAt(data, yearStart, opts),
    headcountDec31: headcountAt(data, yearEnd, opts),
    entriesCount: yearCount("entry"),
    exitsCount: yearCount("exit"),
    rows,
    withoutPerson: data.contracts.filter((c) => c.personKey === null && concerns(c)),
    personsWithoutContract: data.persons.filter((p) => !p.hasContract),
  };
}
