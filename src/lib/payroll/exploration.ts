import { isMonth, monthBounds, monthRange } from "@/lib/connectors/months";
import { buildPayfitPayrollItems, formatPayrollItemCents, type PayrollItemsRh } from "@/lib/rh/payroll-items";
import { axisOf, type JournalInput, type LedgerLine } from "./engine";
import { classify, gridRubrics, RUBRICS, type RubricRole } from "./grid";

export type PayrollCell = { kind: "value"; cents: number; occurrences: number } | { kind: "nd"; reason: string };
export type PayrollMetric = "brut" | "cotisations" | "masse" | "horsMasse" | "nonClasse";
export type PayrollTotals = Record<PayrollMetric, PayrollCell>;
export type PayrollRatio = { num: string; den: string };
export type PayrollCompare = { a: PayrollCell; b: PayrollCell; delta: PayrollCell; pct: PayrollRatio | null; pctReason: string | null };
export type PayrollCompareCell = PayrollCompare;
export type PayrollCompareTotals = Record<PayrollMetric, PayrollCompare>;
export type PayrollExplorationInput = {
  source: "payfit" | "dsn" | null;
  journal: JournalInput | null;
  read: { syncId: string; readAt: string; closedMonths: string[]; closureReasons?: Record<string, string> } | null;
  rh: PayrollItemsRh | null;
  unavailable: string | null;
};
export type PayrollExplorationSource = { provider: PayrollExplorationInput["source"]; syncId: string | null; readAt: string | null; currency: "EUR" };
export type PayrollDetailLine = {
  id: string; month: string; accountId: string; accountLabel: string | null;
  rubricKey: string; rubricLabel: string; role: RubricRole | "non-classe";
  sourceContractId: string | null; attachment: "linked" | "no-contract" | "unlinked";
  contractKey: string | null; personKey: string | null; personLabel: string | null; contractLabel: string | null;
  amount: PayrollCell; analyticValues: string[];
  provenance: { syncId: string | null; recordKey: string; month: string };
};
export type PayrollAccountSummary = {
  key: string; accountId: string; label: string; rubricKey: string; rubricLabel: string;
  role: PayrollDetailLine["role"]; amount: PayrollCell; lineIds: string[];
};
export type PayrollContractIdentity = Pick<PayrollDetailLine, "sourceContractId" | "attachment" | "contractKey" | "personKey" | "personLabel" | "contractLabel">;
export type PayrollContractSummary = PayrollContractIdentity & { key: string; totals: PayrollTotals; lineIds: string[] };
export type PayrollPeriod = { months: string[]; monthly: { month: string; totals: PayrollTotals }[]; totals: PayrollTotals };
export type PayrollOrganisationGroup = {
  key: string; kind: "code" | "unallocated" | "ambiguous"; label: string;
  totals: PayrollTotals; monthly: PayrollPeriod["monthly"];
  accounts: PayrollAccountSummary[]; contracts: PayrollContractSummary[]; lineIds: string[];
};
export type PayrollOrganisationModel = PayrollPeriod & {
  kind: "value" | "nd"; reason: string | null; source: PayrollExplorationSource;
  axis: string | null; axes: string[]; groups: PayrollOrganisationGroup[]; lines: PayrollDetailLine[]; notices: string[];
};
export type PayrollRubricComparison = PayrollCompare & { key: string; label: string; role: PayrollDetailLine["role"]; lineIdsA: string[]; lineIdsB: string[] };
export type PayrollAccountComparison = PayrollCompare & { key: string; accountId: string; label: string; rubricKey: string; rubricLabel: string; role: PayrollDetailLine["role"]; lineIdsA: string[]; lineIdsB: string[] };
export type PayrollContractComparison = PayrollContractIdentity & { key: string; totals: PayrollCompareTotals; lineIdsA: string[]; lineIdsB: string[] };
export type ActualGapModel = {
  kind: "value" | "nd"; reason: string | null; source: PayrollExplorationSource;
  periodA: PayrollPeriod; periodB: PayrollPeriod; totals: PayrollCompareTotals;
  monthly: { monthA: string; monthB: string; totals: PayrollCompareTotals }[];
  rubrics: PayrollRubricComparison[]; accounts: PayrollAccountComparison[]; contracts: PayrollContractComparison[];
  lines: PayrollDetailLine[]; notices: string[];
};

const METRICS: PayrollMetric[] = ["brut", "cotisations", "masse", "horsMasse", "nonClasse"];
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const UNSAFE = "Montant hors de la précision entière prise en charge.";
const nd = (reason: string): PayrollCell => ({ kind: "nd", reason });
const cell = (n: bigint, occurrences: number): PayrollCell => n < -MAX || n > MAX ? nd(UNSAFE) : { kind: "value", cents: Number(n), occurrences };
const ndTotals = (reason: string): PayrollTotals => Object.fromEntries(METRICS.map((m) => [m, nd(reason)])) as PayrollTotals;
const sourceOf = (input: PayrollExplorationInput): PayrollExplorationSource => ({ provider: input.source, syncId: input.read?.syncId ?? null, readAt: input.read?.readAt ?? null, currency: "EUR" });
export const formatPayrollExplorationMoney = formatPayrollItemCents;

// Ratios en entiers décimaux sérialisés : calcul et arrondi au centième de pourcent
// en BigInt, sans flottant même pour un rapport très grand.
export function formatPayrollPercent(ratio: PayrollRatio | null, signed = true): string {
  if (!ratio || !/^-?\d{1,100}$/.test(ratio.num) || !/^\d{1,100}$/.test(ratio.den)) return "n.d.";
  const num = BigInt(ratio.num), den = BigInt(ratio.den);
  if (den <= 0n) return "n.d.";
  const absolute = (num < 0n ? -num : num) * 10_000n;
  const scaled = (absolute * 2n + den) / (2n * den);
  const sign = scaled === 0n ? "" : num < 0n ? "−" : signed ? "+" : "";
  return `${sign}${new Intl.NumberFormat("fr-FR").format(scaled / 100n)},${String(scaled % 100n).padStart(2, "0")}\u00a0%`;
}

function sum(lines: PayrollDetailLine[], reason: string | null = null): PayrollCell {
  if (reason) return nd(reason);
  let total = 0n;
  for (const line of lines) {
    if (line.amount.kind === "nd") return nd(line.amount.reason);
    if (!Number.isSafeInteger(line.amount.cents)) return nd(UNSAFE);
    total += BigInt(line.amount.cents);
  }
  // Ce zéro structurel signifie : journal complet et aucune ligne correspondante.
  // occurrences=0 le distingue d'un zéro effectivement écrit dans la source.
  return cell(total, lines.length);
}
function totals(lines: PayrollDetailLine[], reason: string | null = null): PayrollTotals {
  if (reason) return ndTotals(reason);
  const pick = (roles: PayrollDetailLine["role"][]) => sum(lines.filter((l) => roles.includes(l.role)));
  return { brut: pick(["brut"]), cotisations: pick(["cotisations"]), masse: pick(["brut", "cotisations"]), horsMasse: pick(["hors-masse"]), nonClasse: pick(["non-classe"]) };
}
function compare(a: PayrollCell, b: PayrollCell): PayrollCompare {
  if (a.kind === "nd" || b.kind === "nd") {
    const reason = a.kind === "nd" ? `Période A : ${a.reason}` : b.kind === "nd" ? `Période B : ${b.reason}` : "Période indisponible.";
    return { a, b, delta: nd(reason), pct: null, pctReason: reason };
  }
  const difference = BigInt(a.cents) - BigInt(b.cents);
  const delta = cell(difference, a.occurrences + b.occurrences);
  if (delta.kind === "nd") return { a, b, delta, pct: null, pctReason: delta.reason };
  if (b.cents === 0) return { a, b, delta, pct: null, pctReason: "Référence nulle : pourcentage non défini." };
  const base = BigInt(b.cents);
  return { a, b, delta, pct: { num: String(base < 0n ? -difference : difference), den: String(base < 0n ? -base : base) }, pctReason: null };
}
function compareTotals(a: PayrollTotals, b: PayrollTotals): PayrollCompareTotals {
  return Object.fromEntries(METRICS.map((m) => [m, compare(a[m], b[m])])) as PayrollCompareTotals;
}

function periodError(months: string[]): string | null {
  if (!months.length || months.length > 120 || !months.every(isMonth)) return "Période invalide : choisis des mois valides.";
  const ordered = [...new Set(months)].sort();
  if (ordered.length !== months.length || ordered.some((m, i) => m !== months[i])) return "Période invalide : les mois doivent être distincts et ordonnés.";
  if (monthRange(ordered[0], ordered.at(-1)!).length !== months.length) return "Période invalide : les mois doivent être consécutifs.";
  return null;
}
function parisDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function sourceError(input: PayrollExplorationInput): string | null {
  if (input.source === "dsn") return "Source RH DSN : le coût chargé et sa ventilation comptable ne sont pas extraits par l’import actuel.";
  if (input.source !== "payfit" || !input.journal) return input.unavailable ?? "Journal comptable PayFit non disponible.";
  if (!input.read?.syncId || !parisDate(input.read.readAt)) return input.unavailable ?? "Lecture PayFit ou date de référence indisponible : clôture non vérifiable.";
  return null;
}

type Prepared = { input: PayrollExplorationInput; lines: PayrollDetailLine[]; originals: Map<string, LedgerLine>; reasons: Map<string, string>; axes: string[]; notices: string[] };
export function payrollExplorationAxes(input: PayrollExplorationInput): string[] {
  const journal = input.journal;
  if (!journal) return [];
  const rules = gridRubrics(journal.grid);
  return [...new Set(journal.lines.filter((line) => {
    const classified = classify(line.accountId, rules);
    return classified.rubric !== null || classified.payroll;
  }).flatMap((line) => (line.analytic ?? []).map(axisOf)))].sort();
}
function prepare(input: PayrollExplorationInput, requested: string[]): Prepared {
  const sharedReason = sourceError(input);
  const reasons = new Map<string, string>();
  const lines: PayrollDetailLine[] = [];
  const originals = new Map<string, LedgerLine>();
  const notices = ["Rubriques comptables du journal PayFit et grille de comptes de l’espace ; aucun bulletin de paie n’est reconstitué.",
    "Un zéro avec aucune occurrence signifie qu’aucune ligne ne correspond dans un journal complet ; un mois indisponible reste n.d.",
    "Les identités affichées sont celles de la photographie PayFit courante ; aucune affectation RH historique n’est déduite."];
  const journal = input.journal;
  const rules = journal ? gridRubrics(journal.grid) : [];
  const axes = payrollExplorationAxes(input);
  for (const month of [...new Set(requested)]) {
    let reason = sharedReason;
    if (!reason && !isMonth(month)) reason = "Mois invalide.";
    if (!reason && !journal!.months.includes(month)) reason = "Mois hors de la lecture PayFit appliquée.";
    if (!reason && journal!.openMonths.includes(month)) reason = "Paie non clôturée à la lecture.";
    if (!reason && !input.read!.closedMonths.includes(month)) reason = input.read!.closureReasons?.[month] ?? "Aucune clôture completed explicite n’est disponible pour ce mois.";
    if (!reason && monthBounds(month).end > parisDate(input.read!.readAt)!) reason = "Mois non terminé à la date de lecture PayFit (calendrier de Paris).";
    const sourceLines = journal?.lines.filter((l) => l.month === month) ?? [];
    if (!reason && !sourceLines.length) reason = "Journal de paie non renvoyé pour ce mois.";
    if (!journal || !isMonth(month)) { reasons.set(month, reason ?? "Journal indisponible."); continue; }
    const identities = buildPayfitPayrollItems({ month, input: journal, rh: input.rh, syncId: input.read?.syncId, readAt: input.read?.readAt });
    const items = new Map(identities.rows.map((r) => [r.id, r]));
    if (identities.notices.some((n) => n.includes("même lecture PayFit"))) notices.push("Le référentiel RH ne correspond pas à la même lecture que le journal : montants conservés sans rattachement nominatif. Recharge la page.");
    for (const original of sourceLines) {
      const item = items.get(original.key);
      if (!item) continue;
      const classified = classify(original.accountId, rules);
      const amount: PayrollCell = item.amount.kind === "value" ? { ...item.amount, occurrences: 1 } : item.amount;
      if (!reason && amount.kind === "nd") reason = amount.reason;
      lines.push({ id: original.key, month, accountId: item.accountId!, accountLabel: item.accountLabel, rubricKey: item.rubricKey, rubricLabel: item.rubricLabel,
        role: classified.rubric?.role ?? "non-classe", sourceContractId: original.contractId, attachment: item.attachment, contractKey: item.contractKey,
        personKey: item.personKey, personLabel: item.personLabel, contractLabel: item.contractLabel, amount, analyticValues: [],
        provenance: { syncId: input.read?.syncId ?? null, recordKey: original.key, month } });
      originals.set(original.key, original);
    }
    if (!reason) {
      const overflow = Object.values(totals(lines.filter((l) => l.month === month))).find((c) => c.kind === "nd");
      if (overflow?.kind === "nd") reason = overflow.reason;
    }
    if (reason) reasons.set(month, reason);
  }
  // Un mois interdit ou incomplet ne réapparaît pas comme du réalisé via le détail.
  for (const line of lines) { const reason = reasons.get(line.month); if (reason) line.amount = nd(reason); }
  return { input, lines, originals, reasons, axes, notices: [...new Set(notices)] };
}
function windowReason(p: Prepared, months: string[]): string | null {
  return periodError(months) ?? (months.map((m) => p.reasons.has(m) ? `${m} : ${p.reasons.get(m)}` : null).filter(Boolean).join(" ; ") || null);
}
function period(p: Prepared, months: string[], lines = p.lines): PayrollPeriod {
  const selected = new Set(months);
  return { months: [...months], monthly: months.map((month) => ({ month, totals: totals(lines.filter((l) => l.month === month), p.reasons.get(month) ?? null) })),
    totals: totals(lines.filter((l) => selected.has(l.month)), windowReason(p, months)) };
}
const contractKey = (line: PayrollDetailLine) => JSON.stringify(["contract", line.sourceContractId]);
const accountKey = (line: PayrollDetailLine) => JSON.stringify(["account", line.accountId, line.rubricKey]);
function groupBy(lines: PayrollDetailLine[], key: (l: PayrollDetailLine) => string): Map<string, PayrollDetailLine[]> {
  const groups = new Map<string, PayrollDetailLine[]>();
  for (const line of lines) { const k = key(line); const group = groups.get(k); if (group) group.push(line); else groups.set(k, [line]); }
  return groups;
}
const identity = (line: PayrollDetailLine): PayrollContractIdentity => ({ sourceContractId: line.sourceContractId, attachment: line.attachment, contractKey: line.contractKey,
  personKey: line.personKey, personLabel: line.personLabel, contractLabel: line.contractLabel });
const labelOf = (lines: PayrollDetailLine[]) => [...new Set(lines.map((l) => l.accountLabel).filter((s): s is string => Boolean(s)))].sort().join(" · ") || "Libellé n.d.";
function accountSummaries(p: Prepared, lines: PayrollDetailLine[], months: string[]): PayrollAccountSummary[] {
  const reason = windowReason(p, months);
  return [...groupBy(lines, accountKey)].map(([key, ls]) => ({ key, accountId: ls[0].accountId, label: labelOf(ls), rubricKey: ls[0].rubricKey, rubricLabel: ls[0].rubricLabel, role: ls[0].role,
    amount: sum(ls, reason), lineIds: ls.map((l) => l.id) })).sort((a, b) => a.accountId.localeCompare(b.accountId));
}
function contractSummaries(p: Prepared, lines: PayrollDetailLine[], months: string[]): PayrollContractSummary[] {
  return [...groupBy(lines, contractKey)].map(([key, ls]) => ({ key, ...identity(ls[0]), totals: period(p, months, ls).totals, lineIds: ls.map((l) => l.id) }));
}

function analyticGroup(line: LedgerLine, axis: string): { key: string; kind: PayrollOrganisationGroup["kind"]; label: string; values: string[] } {
  const entries = (line.analytic ?? []).filter((a) => axisOf(a) === axis);
  const values = [...new Set(entries.map((a) => a.code || a.value || null).filter((s): s is string => s !== null && s.trim().length > 0))].sort();
  if (!values.length) return { key: JSON.stringify(["unallocated"]), kind: "unallocated", label: "Non ventilé", values };
  if (values.length > 1 || entries.length > 1 && entries.some((a) => !a.code && !a.value)) return { key: JSON.stringify(["ambiguous"]), kind: "ambiguous", label: "Affectation ambiguë", values };
  return { key: JSON.stringify(["code", values[0]]), kind: "code", label: values[0], values };
}

export function buildPayrollOrganisation(input: PayrollExplorationInput, options: { months: string[]; axis: string | null }): PayrollOrganisationModel {
  const p = prepare(input, options.months);
  const snapshot = period(p, options.months);
  const error = sourceError(input) ?? periodError(options.months) ?? (!options.axis ? "Choisis explicitement un axe analytique présent dans le journal." : !p.axes.includes(options.axis) ? "Axe analytique absent de cette lecture PayFit." : null);
  const groups: PayrollOrganisationGroup[] = [];
  if (!error && options.axis) {
    const indexed = new Map<string, { description: ReturnType<typeof analyticGroup>; lines: PayrollDetailLine[] }>();
    for (const line of p.lines) {
      const description = analyticGroup(p.originals.get(line.id)!, options.axis);
      line.analyticValues = description.values;
      const group = indexed.get(description.key);
      if (group) group.lines.push(line); else indexed.set(description.key, { description, lines: [line] });
    }
    for (const [key, group] of indexed) groups.push({ key, kind: group.description.kind, label: group.description.label,
      ...period(p, options.months, group.lines), accounts: accountSummaries(p, group.lines, options.months), contracts: contractSummaries(p, group.lines, options.months), lineIds: group.lines.map((l) => l.id) });
    groups.sort((a, b) => ({ code: 0, ambiguous: 1, unallocated: 2 }[a.kind] - { code: 0, ambiguous: 1, unallocated: 2 }[b.kind]) || a.label.localeCompare(b.label, "fr"));
  }
  const missingTotal = Object.values(snapshot.totals).find((c) => c.kind === "nd");
  const reason = error ?? windowReason(p, options.months) ?? (missingTotal?.kind === "nd" ? missingTotal.reason : null);
  return { ...snapshot, kind: reason ? "nd" : "value", reason, source: sourceOf(input), axis: options.axis, axes: p.axes, groups, lines: p.lines,
    notices: [...p.notices, "Chaque ligne appartient à un seul groupe : plusieurs codes contradictoires sur l’axe choisi restent dans Affectation ambiguë, sans répartition.",
      "Lignes sans code de l’axe : Non ventilé. Le choix de l’axe ne modifie aucun paramètre de l’espace."] };
}

export function buildActualGap(input: PayrollExplorationInput, options: { monthsA: string[]; monthsB: string[] }): ActualGapModel {
  const { monthsA, monthsB } = options;
  const selected = [...new Set([...monthsA, ...monthsB])];
  const p = prepare(input, selected);
  const periodA = period(p, monthsA), periodB = period(p, monthsB);
  const setA = new Set(monthsA), setB = new Set(monthsB);
  const a = p.lines.filter((l) => setA.has(l.month)), b = p.lines.filter((l) => setB.has(l.month));
  const reasonA = windowReason(p, monthsA), reasonB = windowReason(p, monthsB);
  const mismatch = monthsA.length !== monthsB.length ? "Les deux périodes doivent avoir le même nombre de mois."
    : monthsA.some((m, i) => m.slice(5) !== monthsB[i]?.slice(5)) ? "Les deux périodes doivent porter sur les mêmes mois calendaires." : null;
  const error = sourceError(input) ?? periodError(monthsA) ?? periodError(monthsB) ?? mismatch;
  const rubricDefinitions = [...RUBRICS.map((r) => ({ key: r.id as string, label: r.label, role: r.role as PayrollDetailLine["role"] })), { key: "non-classe", label: "Charges de personnel non classées", role: "non-classe" as const }];
  const rubrics: PayrollRubricComparison[] = rubricDefinitions.map((r) => {
    const la = a.filter((l) => l.rubricKey === r.key), lb = b.filter((l) => l.rubricKey === r.key);
    return { ...r, ...compare(sum(la, error ?? reasonA), sum(lb, error ?? reasonB)), lineIdsA: la.map((l) => l.id), lineIdsB: lb.map((l) => l.id) };
  });
  const accounts: PayrollAccountComparison[] = [...groupBy(p.lines, accountKey)].map(([key, ls]) => {
    const la = ls.filter((l) => setA.has(l.month)), lb = ls.filter((l) => setB.has(l.month));
    return { key, accountId: ls[0].accountId, label: labelOf(ls), rubricKey: ls[0].rubricKey, rubricLabel: ls[0].rubricLabel, role: ls[0].role,
      ...compare(sum(la, error ?? reasonA), sum(lb, error ?? reasonB)), lineIdsA: la.map((l) => l.id), lineIdsB: lb.map((l) => l.id) };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));
  const contracts: PayrollContractComparison[] = [...groupBy(p.lines, contractKey)].map(([key, ls]) => {
    const ta = period(p, monthsA, ls).totals, tb = period(p, monthsB, ls).totals;
    return { key, ...identity(ls[0]), totals: compareTotals(error ? ndTotals(error) : ta, error ? ndTotals(error) : tb),
      lineIdsA: ls.filter((l) => setA.has(l.month)).map((l) => l.id), lineIdsB: ls.filter((l) => setB.has(l.month)).map((l) => l.id) };
  });
  const comparisonTotals = compareTotals(error ? ndTotals(error) : periodA.totals, error ? ndTotals(error) : periodB.totals);
  const unavailableDelta = Object.values(comparisonTotals).find((c) => c.delta.kind === "nd");
  const reason = error ?? reasonA ?? reasonB ?? (unavailableDelta?.delta.kind === "nd" ? unavailableDelta.delta.reason : null);
  return { kind: reason ? "nd" : "value", reason, source: sourceOf(input), periodA, periodB,
    totals: comparisonTotals,
    monthly: monthsA.map((monthA, i) => ({ monthA, monthB: monthsB[i] ?? "", totals: compareTotals(
      error ? ndTotals(error) : periodA.monthly[i].totals, error ? ndTotals(error) : periodB.monthly[i]?.totals ?? ndTotals("Mois de référence absent.")) })),
    rubrics, accounts, contracts, lines: p.lines, notices: [...p.notices,
      "Écart réel = période A − période B, mêmes mois calendaires et même grille comptable. Les rubriques hors masse et non classées restent séparées.",
      "Le pourcentage vaut l’écart divisé par B ; une référence nulle ne définit aucun pourcentage."] };
}
