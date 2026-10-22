import { classify, gridRubrics, type AccountGrid, type Rubric, type RubricId } from "./grid";

// Masse salariale réelle, lue telle que le journal de paie la renvoie : solde = débit − crédit, en centimes entiers.
// Masse salariale chargée = rubriques « brut » + rubriques « cotisations ». Aucune valeur reconstituée : un mois sans
// journal ou une ligne sans montant rend le mois n.d., jamais zéro.
export type LedgerLine = { key: string; month: string; accountId: string; accountName: string | null; debitCents: number | null; creditCents: number | null; contractId: string | null };
export type JournalInput = {
  lines: LedgerLine[];
  months: string[]; // mois lus (périmètre de la lecture)
  openMonths: string[]; // paie non clôturée à la lecture
  grid: AccountGrid;
};
export type Nd = { code: "not-read" | "no-journal" | "amount-missing" | "month-nd" | "etp-nd" | "zero-base"; reason: string; months?: string[] };

export type AccountTotal = { accountId: string; accountName: string | null; rubric: Rubric | null; debitCents: number; creditCents: number; balanceCents: number; lines: number };
export type MonthPayroll =
  | { month: string; kind: "nd"; nd: Nd; open: boolean }
  | {
      month: string;
      kind: "value";
      open: boolean; // paie non clôturée : montants provisoires
      brut: number;
      cotisations: number;
      masse: number;
      byRubric: Record<RubricId, number>;
      accounts: AccountTotal[]; // comptes de charges de personnel (63/64) et comptes classés
      unclassified: AccountTotal[]; // comptes 63/64 sans rubrique : hors masse, signalés
    };

const zeroRubrics = (): Record<RubricId, number> => ({ salaires: 0, primes: 0, indemnites: 0, cotisations: 0, "provisions-cp": 0, "autres-charges": 0, taxes: 0 });

const cache = new WeakMap<JournalInput, Map<string, MonthPayroll>>();

export function monthPayroll(input: JournalInput, month: string): MonthPayroll {
  let byMonth = cache.get(input);
  if (!byMonth) {
    byMonth = new Map();
    cache.set(input, byMonth);
  }
  const hit = byMonth.get(month);
  if (hit) return hit;
  const result = computeMonth(input, month);
  byMonth.set(month, result);
  return result;
}

function computeMonth(input: JournalInput, month: string): MonthPayroll {
  const open = input.openMonths.includes(month);
  if (!input.months.includes(month)) return { month, kind: "nd", open, nd: { code: "not-read", reason: `mois ${month} hors de la lecture PayFit appliquée` } };
  const lines = input.lines.filter((l) => l.month === month);
  if (!lines.length) return { month, kind: "nd", open, nd: { code: "no-journal", reason: `journal de paie ${month} non renvoyé par PayFit (mois non clôturé ou hors historique)` } };
  const rubrics = gridRubrics(input.grid);
  const accounts = new Map<string, AccountTotal & { payroll: boolean }>();
  for (const l of lines) {
    const c = classify(l.accountId, rubrics);
    const payroll = c.rubric !== null || c.payroll;
    if (!payroll) continue; // contrepartie (tiers, produits) : hors masse salariale
    if (l.debitCents === null && l.creditCents === null) {
      return { month, kind: "nd", open, nd: { code: "amount-missing", reason: `ligne ${l.key} du compte ${l.accountId} sans montant (ni débit ni crédit)` } };
    }
    const a = accounts.get(l.accountId) ?? { accountId: l.accountId, accountName: l.accountName, rubric: c.rubric, debitCents: 0, creditCents: 0, balanceCents: 0, lines: 0, payroll };
    a.debitCents += l.debitCents ?? 0;
    a.creditCents += l.creditCents ?? 0;
    a.balanceCents = a.debitCents - a.creditCents;
    a.lines += 1;
    if (!a.accountName && l.accountName) a.accountName = l.accountName;
    accounts.set(l.accountId, a);
  }
  const byRubric = zeroRubrics();
  const all = [...accounts.values()].sort((x, y) => x.accountId.localeCompare(y.accountId));
  for (const a of all) if (a.rubric) byRubric[a.rubric.id] += a.balanceCents;
  const sumRole = (role: Rubric["role"]) => all.filter((a) => a.rubric?.role === role).reduce((s, a) => s + a.balanceCents, 0);
  const brut = sumRole("brut");
  const cotisations = sumRole("cotisations");
  const strip = ({ payroll: _p, ...a }: AccountTotal & { payroll: boolean }): AccountTotal => a;
  return { month, kind: "value", open, brut, cotisations, masse: brut + cotisations, byRubric, accounts: all.map(strip), unclassified: all.filter((a) => !a.rubric).map(strip) };
}

// Somme d'une fenêtre de mois : n.d. si un mois l'est (mois nommés), sinon totaux exacts ; mois provisoires listés.
export type PayrollWindow =
  | { kind: "nd"; nd: Nd; months: MonthPayroll[] }
  | { kind: "value"; brut: number; cotisations: number; masse: number; byRubric: Record<RubricId, number>; months: MonthPayroll[]; openMonths: string[] };

export function windowPayroll(input: JournalInput, months: string[]): PayrollWindow {
  const rows = months.map((m) => monthPayroll(input, m));
  const nd = rows.filter((r): r is Extract<MonthPayroll, { kind: "nd" }> => r.kind === "nd");
  if (nd.length) return { kind: "nd", months: rows, nd: { code: "month-nd", reason: nd.map((r) => `${r.month} : ${r.nd.reason}`).join(" ; "), months: nd.map((r) => r.month) } };
  const ok = rows as Extract<MonthPayroll, { kind: "value" }>[];
  const byRubric = zeroRubrics();
  for (const r of ok) for (const k of Object.keys(byRubric) as RubricId[]) byRubric[k] += r.byRubric[k];
  return {
    kind: "value",
    brut: ok.reduce((s, r) => s + r.brut, 0),
    cotisations: ok.reduce((s, r) => s + r.cotisations, 0),
    masse: ok.reduce((s, r) => s + r.masse, 0),
    byRubric,
    months: rows,
    openMonths: ok.filter((r) => r.open).map((r) => r.month),
  };
}

export const shiftYear = (month: string, years: number) => `${Number(month.slice(0, 4)) + years}${month.slice(4)}`;

// Évolution N / N-1 en centimes et en fraction exacte ; n.d. si l'une des deux périodes l'est ou si N-1 vaut zéro.
export type Evolution = { kind: "value"; deltaCents: number; ratio: { num: number; den: number } } | { kind: "nd"; nd: Nd };
export function evolution(current: PayrollWindow, previous: PayrollWindow, pick: (w: Extract<PayrollWindow, { kind: "value" }>) => number): Evolution {
  if (current.kind === "nd") return { kind: "nd", nd: { code: "month-nd", reason: `période n.d. (${current.nd.reason})` } };
  if (previous.kind === "nd") return { kind: "nd", nd: { code: "month-nd", reason: `N-1 n.d. (${previous.nd.reason})` } };
  const a = pick(current);
  const b = pick(previous);
  if (b === 0) return { kind: "nd", nd: { code: "zero-base", reason: "N-1 vaut zéro : évolution en % non définie" } };
  return { kind: "value", deltaCents: a - b, ratio: { num: a - b, den: b } };
}

// Coût par ETP-mois : masse chargée de la période ÷ somme des ETP fin de mois (ETP contractuels du module KPI RH).
export type EtpMonth = { month: string; etp4: number | null; reason: string | null };
export type CostPerEtp = { kind: "value"; costCents: { num: number; den: number }; etpMonths4: number } | { kind: "nd"; nd: Nd };
export function costPerEtp(w: PayrollWindow, etp: EtpMonth[]): CostPerEtp {
  if (w.kind === "nd") return { kind: "nd", nd: { code: "month-nd", reason: w.nd.reason } };
  const missing = etp.filter((e) => e.etp4 === null);
  if (missing.length) return { kind: "nd", nd: { code: "etp-nd", reason: missing.map((e) => `ETP fin ${e.month} : ${e.reason ?? "n.d."}`).join(" ; "), months: missing.map((e) => e.month) } };
  const etpMonths4 = etp.reduce((s, e) => s + (e.etp4 ?? 0), 0);
  if (etpMonths4 === 0) return { kind: "nd", nd: { code: "zero-base", reason: "aucun ETP sur la période" } };
  return { kind: "value", costCents: { num: w.masse * 10000, den: etpMonths4 }, etpMonths4 };
}
