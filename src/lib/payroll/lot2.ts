import { monthPayroll, serviceOf, windowPayroll, type JournalInput, type LedgerLine } from "./engine";
import { monthBounds, monthRange } from "@/lib/connectors/months";
import { classify, gridRubrics, type AccountGrid, type RubricId } from "./grid";

// Lot 2 de la Masse salariale : fixe et variable par libellé de paie, provision de congés payés, rapprochement avec la
// comptabilité. Calculs purs sur les lignes du journal de paie (et de la comptabilité), en centimes, débit − crédit.

const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const balance = (l: LedgerLine) => (l.debitCents ?? 0) - (l.creditCents ?? 0);
const inService = (input: JournalInput, l: LedgerLine) => !input.serviceFilter || serviceOf(l, input.serviceAxis) === input.serviceFilter.value;

// --- Fixe et variable : soldes par rubrique du brut et par libellé de ligne PayFit (ex. « Primes sur objectif »).
// Clé de regroupement : rubrique + libellé sans accents ni casse (« Prime d'été » = « Prime d'ete »).
export type LabelTotal = { rubric: RubricId; key: string; label: string; cents: number };
export function labelTotals(input: JournalInput, months: string[]): LabelTotal[] {
  const rubrics = gridRubrics(input.grid);
  const out = new Map<string, LabelTotal>();
  for (const l of input.lines) {
    if (!months.includes(l.month) || !inService(input, l)) continue;
    const c = classify(l.accountId, rubrics);
    if (!c.rubric || c.rubric.role !== "brut") continue;
    const label = (l.accountName ?? "").trim() || `compte ${l.accountId}`;
    const k = `${c.rubric.id}\u0000${norm(label)}`;
    const t = out.get(k) ?? { rubric: c.rubric.id, key: k, label, cents: 0 };
    t.cents += balance(l);
    out.set(k, t);
  }
  return [...out.values()].sort((a, b) => a.rubric.localeCompare(b.rubric) || a.label.localeCompare(b.label));
}

// --- Provision de congés payés à fin de mois (méthode PayFit d'extourne mensuelle) : chaque mois, la provision du mois
// passé est reprise et le stock du mois est doté. Stock fin de mois = solde des lignes de dotation « Mois courant » des
// comptes de la rubrique « Provisions de congés payés » : 6412 = congés payés, autres préfixes = charges sociales.
// Une part (congés ou charges) sans ligne de dotation dans le mois, ou non ventilée sur l'axe quand un service est
// filtré, est n.d. (null) avec sa raison ; le total est alors n.d. aussi, jamais complété par un 0.
export const PROVISION_MARKER = "mois courant";
export const CONGES_PREFIX = "6412";
export type ProvisionMonth =
  | { month: string; kind: "value"; conges: number | null; charges: number | null; total: number | null; missing: string[] }
  | { month: string; kind: "nd"; reason: string };
export function provisionMonth(input: JournalInput, month: string): ProvisionMonth {
  // Mêmes contrôles que la synthèse : mois lu, journal renvoyé, aucune ligne sans montant (dans le service filtré).
  const base = monthPayroll(input, month);
  if (base.kind === "nd") return { month, kind: "nd", reason: base.nd.reason };
  const rubrics = gridRubrics(input.grid);
  const lines = input.lines.filter((l) => l.month === month && classify(l.accountId, rubrics).rubric?.id === "provisions-cp");
  const dotation = lines.filter((l) => norm(l.accountName).includes(PROVISION_MARKER));
  if (!dotation.length) return { month, kind: "nd", reason: lines.length ? `aucune ligne de dotation « Mois courant » en ${month} (méthode de provision non reconnue)` : `aucune ligne de provision de congés payés en ${month}` };
  const f = input.serviceFilter;
  const missing: string[] = [];
  const part = (name: string, accounts: string, pick: (l: LedgerLine) => boolean): number | null => {
    const all = dotation.filter(pick);
    if (!all.length) {
      missing.push(`${name} : aucune ligne ${accounts} « Mois courant » en ${month}`);
      return null;
    }
    // Service nommé et aucune ligne de la part ne porte l'axe : la part n'est pas ventilée (tout est « Non ventilé »).
    if (f && f.value !== null && all.every((l) => serviceOf(l, input.serviceAxis) === null)) {
      missing.push(`${name} : lignes ${month} sans code analytique ${input.serviceAxis ?? ""}, non ventilées par service`);
      return null;
    }
    return all.filter((l) => inService(input, l)).reduce((s, l) => s + balance(l), 0);
  };
  const conges = part("congés payés", CONGES_PREFIX, (l) => l.accountId.startsWith(CONGES_PREFIX));
  const charges = part("charges sociales", `hors ${CONGES_PREFIX}`, (l) => !l.accountId.startsWith(CONGES_PREFIX));
  return { month, kind: "value", conges, charges, total: conges !== null && charges !== null ? conges + charges : null, missing };
}

// --- Rapprochement avec la comptabilité (FEC ou API Pennylane) : mêmes rubriques (même grille), mêmes mois.
export type ComptaLine = { month: string; accountId: string; debitCents: number | null; creditCents: number | null };
export type ReconRow = { rubric: RubricId | "non-classe"; journal: number; compta: number; ecart: number };
export type Reconciliation = { kind: "value"; rows: ReconRow[]; journal: number; compta: number; ecart: number; months: { month: string; journal: number; compta: number }[] } | { kind: "nd"; reason: string };

const payrollKey = (accountId: string, grid: AccountGrid): RubricId | "non-classe" | null => {
  const c = classify(accountId, gridRubrics(grid));
  return c.rubric ? c.rubric.id : c.payroll ? "non-classe" : null;
};

// Mois comptables exploitables. Pennylane : mois de la lecture, sauf ceux non terminés à la date de lecture.
// FEC : mois des exercices déposés (première → dernière écriture) ; un mois couvert par deux fichiers est en double, un
// mois postérieur à la clôture ou le dernier mois d'un FEC arrêté en cours de mois (clôture inconnue ou postérieure) est
// incomplet. Les mois écartés sont n.d. avec leur raison.
export type ComptaCoverage = { months: string[]; nd: Record<string, string> };
export function pennylaneCoverage(scope: string[], readOn: string): ComptaCoverage {
  const nd: Record<string, string> = {};
  const months: string[] = [];
  for (const m of [...scope].sort()) {
    if (readOn <= monthBounds(m).end) nd[m] = `mois non terminé à la lecture Pennylane du ${readOn}`;
    else months.push(m);
  }
  return { months, nd };
}
export function fecCoverage(exercises: { filename: string; firstDate: string; lastDate: string; closingDate: string | null }[]): ComptaCoverage {
  const nd: Record<string, string> = {};
  const files = new Map<string, string[]>();
  const afterClosing = new Map<string, string>();
  for (const e of exercises) {
    const lastMonth = e.lastDate.slice(0, 7);
    const endOfMonth = e.lastDate === monthBounds(lastMonth).end;
    if (!endOfMonth && !e.closingDate) nd[lastMonth] = `FEC ${e.filename} : dernière écriture au ${e.lastDate}, date de clôture inconnue (nom de fichier hors norme) : mois peut-être incomplet`;
    else if (!endOfMonth && e.closingDate && e.lastDate < e.closingDate) nd[lastMonth] = `FEC ${e.filename} arrêté au ${e.lastDate} (exercice clos le ${e.closingDate}) : mois incomplet`;
    for (const m of monthRange(e.firstDate.slice(0, 7), lastMonth)) {
      files.set(m, [...(files.get(m) ?? []), e.filename]);
      if (e.closingDate && m > e.closingDate.slice(0, 7)) afterClosing.set(m, `FEC ${e.filename} : écritures postérieures à la clôture du ${e.closingDate}`);
    }
  }
  for (const [m, f] of files) if (f.length > 1) nd[m] = `FEC en double (${f.join(", ")})`;
  for (const [m, r] of afterClosing) nd[m] = r;
  return { months: [...files.keys()].filter((m) => !nd[m]).sort(), nd };
}

// Un mois couvert sans aucune écriture de classe 6 ou 7 lue n'est pas saisi : n.d., jamais 0.
export function withEntries(cov: ComptaCoverage, lines: ComptaLine[]): ComptaCoverage {
  const has = new Set(lines.map((l) => l.month));
  const nd = { ...cov.nd };
  for (const m of cov.months) if (!has.has(m)) nd[m] = "aucune écriture de charges ou de produits (classes 6 et 7) lue pour ce mois";
  return { months: cov.months.filter((m) => has.has(m)), nd };
}

// Mois de la période sans comptabilité exploitable, regroupés par raison (non lue, FEC en double, mois incomplet…).
export function comptaGap(comptaMonths: string[], comptaNd: Record<string, string>, months: string[]): string | null {
  const byReason = new Map<string, string[]>();
  for (const m of months) {
    if (comptaMonths.includes(m)) continue;
    const r = comptaNd[m] ?? "comptabilité non lue";
    byReason.set(r, [...(byReason.get(r) ?? []), m]);
  }
  return byReason.size ? [...byReason].map(([r, ms]) => `${r} pour ${ms.join(", ")}`).join(" ; ") : null;
}

export function reconcile(input: JournalInput, compta: ComptaLine[], comptaMonths: string[], months: string[], comptaNd: Record<string, string> = {}): Reconciliation {
  // Journal : mêmes contrôles que la synthèse (mois lu, journal renvoyé, aucune ligne sans montant).
  const w = windowPayroll(input, months);
  if (w.kind === "nd") return { kind: "nd", reason: `journal de paie : ${w.nd.reason}` };
  const gap = comptaGap(comptaMonths, comptaNd, months);
  if (gap) return { kind: "nd", reason: gap };
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
