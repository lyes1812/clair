import { serviceOf, type JournalInput, type LedgerLine } from "./engine";
import { classify, gridRubrics, type AccountGrid, type RubricId } from "./grid";

// Lot 2 de la Masse salariale : fixe et variable par libellé de paie, provision de congés payés, rapprochement avec la
// comptabilité. Calculs purs sur les lignes du journal de paie (et de la comptabilité), en centimes, débit − crédit.

const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const balance = (l: LedgerLine) => (l.debitCents ?? 0) - (l.creditCents ?? 0);
const inService = (input: JournalInput, l: LedgerLine) => !input.serviceFilter || serviceOf(l, input.serviceAxis) === input.serviceFilter.value;

// --- Fixe et variable : soldes par rubrique du brut et par libellé de ligne PayFit (ex. « Primes sur objectif »).
export type LabelTotal = { rubric: RubricId; label: string; cents: number };
export function labelTotals(input: JournalInput, months: string[]): LabelTotal[] {
  const rubrics = gridRubrics(input.grid);
  const out = new Map<string, LabelTotal>();
  for (const l of input.lines) {
    if (!months.includes(l.month) || !inService(input, l)) continue;
    const c = classify(l.accountId, rubrics);
    if (!c.rubric || c.rubric.role !== "brut") continue;
    const label = (l.accountName ?? "").trim() || `compte ${l.accountId}`;
    const k = `${c.rubric.id}\u0000${norm(label)}`;
    const t = out.get(k) ?? { rubric: c.rubric.id, label, cents: 0 };
    t.cents += balance(l);
    out.set(k, t);
  }
  return [...out.values()].sort((a, b) => a.rubric.localeCompare(b.rubric) || a.label.localeCompare(b.label));
}

// --- Provision de congés payés à fin de mois (méthode PayFit d'extourne mensuelle) : chaque mois, la provision du mois
// passé est reprise et le stock du mois est doté. Stock fin de mois = solde des lignes de dotation « Mois courant » des
// comptes de la rubrique « Provisions de congés payés » : 6412 = congés payés, autres préfixes = charges sociales.
export const PROVISION_MARKER = "mois courant";
export type ProvisionMonth = { month: string; kind: "value"; conges: number; charges: number; total: number } | { month: string; kind: "nd"; reason: string };
export function provisionMonth(input: JournalInput, month: string): ProvisionMonth {
  if (!input.months.includes(month)) return { month, kind: "nd", reason: `mois ${month} hors de la lecture PayFit` };
  const all = input.lines.filter((l) => l.month === month);
  if (!all.length) return { month, kind: "nd", reason: `journal de paie ${month} non renvoyé par PayFit` };
  const rubrics = gridRubrics(input.grid);
  const lines = all.filter((l) => classify(l.accountId, rubrics).rubric?.id === "provisions-cp");
  const dotation = lines.filter((l) => norm(l.accountName).includes(PROVISION_MARKER));
  if (!dotation.length) return { month, kind: "nd", reason: lines.length ? `aucune ligne de dotation « Mois courant » en ${month} (méthode de provision non reconnue)` : `aucune ligne de provision de congés payés en ${month}` };
  let conges = 0;
  let charges = 0;
  for (const l of dotation) {
    if (!inService(input, l)) continue;
    if (l.accountId.startsWith("6412")) conges += balance(l);
    else charges += balance(l);
  }
  return { month, kind: "value", conges, charges, total: conges + charges };
}

// --- Rapprochement avec la comptabilité (FEC ou API Pennylane) : mêmes rubriques (même grille), mêmes mois.
export type ComptaLine = { month: string; accountId: string; debitCents: number | null; creditCents: number | null };
export type ReconRow = { rubric: RubricId | "non-classe"; journal: number; compta: number; ecart: number };
export type Reconciliation = { kind: "value"; rows: ReconRow[]; journal: number; compta: number; ecart: number; months: { month: string; journal: number; compta: number }[] } | { kind: "nd"; reason: string };

const payrollKey = (accountId: string, grid: AccountGrid): RubricId | "non-classe" | null => {
  const c = classify(accountId, gridRubrics(grid));
  return c.rubric ? c.rubric.id : c.payroll ? "non-classe" : null;
};

export function reconcile(input: JournalInput, compta: ComptaLine[], comptaMonths: string[], months: string[]): Reconciliation {
  const notRead = months.filter((m) => !input.months.includes(m) || !input.lines.some((l) => l.month === m));
  if (notRead.length) return { kind: "nd", reason: `journal de paie absent pour ${notRead.join(", ")}` };
  const missing = months.filter((m) => !comptaMonths.includes(m));
  if (missing.length) return { kind: "nd", reason: `comptabilité non lue pour ${missing.join(", ")}` };
  const rows = new Map<string, ReconRow>();
  const perMonth = new Map(months.map((m) => [m, { month: m, journal: 0, compta: 0 }]));
  const add = (key: RubricId | "non-classe", side: "journal" | "compta", month: string, cents: number) => {
    const r = rows.get(key) ?? { rubric: key, journal: 0, compta: 0, ecart: 0 };
    r[side] += cents;
    r.ecart = r.journal - r.compta;
    rows.set(key, r);
    perMonth.get(month)![side] += cents;
  };
  for (const l of input.lines) {
    if (!months.includes(l.month)) continue;
    const k = payrollKey(l.accountId, input.grid);
    if (k) add(k, "journal", l.month, balance(l));
  }
  for (const l of compta) {
    if (!months.includes(l.month)) continue;
    const k = payrollKey(l.accountId, input.grid);
    if (k) add(k, "compta", l.month, (l.debitCents ?? 0) - (l.creditCents ?? 0));
  }
  const order = gridRubrics(input.grid).map((r) => r.id as string);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const list = [...rows.values()].sort((a, b) => rank(a.rubric) - rank(b.rubric));
  const journal = list.reduce((s, r) => s + r.journal, 0);
  const comptaTotal = list.reduce((s, r) => s + r.compta, 0);
  return { kind: "value", rows: list, journal, compta: comptaTotal, ecart: journal - comptaTotal, months: [...perMonth.values()] };
}

// Produits d'exploitation (comptes 70 à 75), solde crédit − débit, depuis la comptabilité.
export function operatingRevenue(compta: ComptaLine[], months: string[]): number {
  return compta.filter((l) => months.includes(l.month) && /^7[0-5]/.test(l.accountId)).reduce((s, l) => s + (l.creditCents ?? 0) - (l.debitCents ?? 0), 0);
}
