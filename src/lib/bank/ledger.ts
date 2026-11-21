import { createHash } from "node:crypto";
import { addDays, addMonthsToDate, formatDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { normalizeLabel, type BankBalance, type BankFormat, type BankMovement, type BankStatement } from "./model";

// Relevés empilés : les mouvements de tous les dépôts appliqués sont réunis par compte, sans doublon, et contrôlés.
// Fonctions pures : la lecture en base est faite dans store.ts.

export const MIN_HISTORY_MONTHS = 6;
export const MAX_GAP_BUSINESS_DAYS = 5;
export const MAX_START_AGE_DAYS = 3;

/** Clé de dédoublonnage : SHA-256 de (compte, date d'opération, montant, libellé normalisé, rang le même jour). */
export function dedupKey(accountKey: string, m: Pick<BankMovement, "bookingDate" | "amountCents" | "label">, rank: number): string {
  return createHash("sha256").update([accountKey, m.bookingDate, String(m.amountCents), normalizeLabel(m.label), String(rank)].join("\u0000")).digest("hex");
}

export type Continuity =
  | { kind: "ok" }
  | { kind: "gap"; gapCents: number }
  | { kind: "nd"; reason: string };

/** Solde d'ouverture + mouvements = solde de clôture, au centime, par relevé. */
export function continuityOf(s: Pick<BankStatement, "opening" | "closing" | "movements" | "rowBreaks">, format: BankFormat): Continuity {
  if (s.rowBreaks && s.rowBreaks.length) return { kind: "gap", gapCents: s.rowBreaks.reduce((t, b) => t + b.gapCents, 0) };
  if (!s.opening || !s.closing) {
    const reason = format === "ofx" ? "OFX : le fichier ne porte pas de solde d'ouverture." : format === "csv" ? "CSV sans colonne de solde complète." : "Solde d'ouverture ou de clôture absent du relevé.";
    return { kind: "nd", reason };
  }
  const gap = s.closing.cents - (s.opening.cents + s.movements.reduce((t, m) => t + m.amountCents, 0));
  return gap === 0 ? { kind: "ok" } : { kind: "gap", gapCents: gap };
}

// Formes stockées (source_record, collections bank_accounts / bank_statements / bank_movements).
export type AccountRecord = { accountKey: string; masked: string; identifierKind: "iban" | "national"; bank: string | null };
export type StatementRecord = { accountKey: string; filename: string; format: BankFormat; from: string; to: string; opening: BankBalance | null; closing: BankBalance | null; movementCount: number; netCents: number; continuity: Continuity };
export type MovementRecord = { key: string; accountKey: string; bookingDate: string; valueDate: string | null; amountCents: number; label: string; counterparty: string | null; reference: string | null; filename: string };

/** Jours ouvrés (lundi à vendredi) strictement entre deux dates ; les jours fériés ne sont pas retirés. */
export function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export type AccountLedger = AccountRecord & {
  movements: MovementRecord[];
  statements: StatementRecord[];
  from: string; to: string;
  /** Dernier solde de clôture lu, tous relevés confondus ; null si aucun relevé n'en porte. */
  lastClosing: BankBalance | null;
  gaps: { after: string; before: string; businessDays: number }[];
  historyOk: boolean;
  duplicates: number;
  warnings: string[];
};

export function buildBankLedger(accounts: AccountRecord[], statements: StatementRecord[], movements: MovementRecord[]): AccountLedger[] {
  const byKey = new Map(accounts.map((a) => [a.accountKey, a]));
  return [...byKey.values()].map((account) => {
    const own = statements.filter((s) => s.accountKey === account.accountKey).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const seen = new Map<string, MovementRecord>();
    let duplicates = 0;
    for (const m of movements) {
      if (m.accountKey !== account.accountKey) continue;
      if (seen.has(m.key)) duplicates++; else seen.set(m.key, m);
    }
    const unique = [...seen.values()].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.key.localeCompare(b.key));
    const from = own[0]?.from ?? unique[0]?.bookingDate ?? "";
    const to = own.reduce((m, s) => (s.to > m ? s.to : m), unique[unique.length - 1]?.bookingDate ?? "");
    const gaps: AccountLedger["gaps"] = [];
    let coveredTo = own[0]?.to ?? "";
    for (const s of own.slice(1)) {
      if (s.from > coveredTo) {
        const days = businessDaysBetween(coveredTo, s.from);
        if (days > MAX_GAP_BUSINESS_DAYS) gaps.push({ after: coveredTo, before: s.from, businessDays: days });
      }
      if (s.to > coveredTo) coveredTo = s.to;
    }
    const closings = own.flatMap((s) => (s.closing ? [s.closing] : [])).sort((a, b) => a.date.localeCompare(b.date));
    const lastClosing = closings[closings.length - 1] ?? null;
    const historyOk = Boolean(from && to) && addMonthsToDate(from, MIN_HISTORY_MONTHS) <= addDays(to, 1);
    const warnings: string[] = [];
    for (const s of own) if (s.continuity.kind === "gap") warnings.push(`Relevé ${s.filename} (${formatDate(s.from)} → ${formatDate(s.to)}) : continuité des soldes rompue, écart de ${formatEuros(s.continuity.gapCents)}.`);
    for (const g of gaps) warnings.push(`Trou de ${g.businessDays} jours ouvrés entre le ${formatDate(g.after)} et le ${formatDate(g.before)} : aucun relevé.`);
    if (!historyOk) warnings.push(`Historique inférieur à ${MIN_HISTORY_MONTHS} mois (${from ? formatDate(from) : "n.d."} → ${to ? formatDate(to) : "n.d."}) : les flux récurrents ne pourront pas être détectés de façon fiable.`);
    return { ...account, movements: unique, statements: own, from, to, lastClosing, gaps, historyOk, duplicates, warnings };
  }).sort((a, b) => a.masked.localeCompare(b.masked));
}

export type BankStart =
  | { kind: "value"; date: string; cents: number; accounts: { masked: string; date: string; cents: number }[] }
  | { kind: "nd"; reason: string };

/**
 * Solde de départ lu dans les relevés : somme, par compte, du dernier solde de clôture connu. La date retenue est la plus
 * récente ; un compte dont le dernier solde date de plus de 3 jours avant elle rend la somme « n.d. » (solde du jour à saisir).
 */
export function bankStart(ledger: AccountLedger[], upTo: string | null = null): BankStart {
  if (!ledger.length) return { kind: "nd", reason: "Aucun relevé bancaire appliqué dans Données." };
  const last = ledger.map((a) => {
    const closings = a.statements.flatMap((s) => (s.closing && (upTo === null || s.closing.date <= upTo) ? [s.closing] : [])).sort((x, y) => x.date.localeCompare(y.date));
    return { masked: a.masked, closing: closings[closings.length - 1] ?? null };
  });
  const missing = last.find((a) => !a.closing);
  if (missing) return { kind: "nd", reason: `Compte ${missing.masked} : aucun solde de clôture lu dans ses relevés${upTo ? ` au ${formatDate(upTo)}` : ""}.` };
  const date = last.reduce((m, a) => (a.closing!.date > m ? a.closing!.date : m), "");
  const stale = last.find((a) => a.closing!.date < addDays(date, -MAX_START_AGE_DAYS));
  if (stale) return { kind: "nd", reason: `Compte ${stale.masked} : dernier solde lu le ${formatDate(stale.closing!.date)}, plus de ${MAX_START_AGE_DAYS} jours avant le ${formatDate(date)}. Saisis le solde du jour.` };
  return { kind: "value", date, cents: last.reduce((t, a) => t + a.closing!.cents, 0), accounts: last.map((a) => ({ masked: a.masked, date: a.closing!.date, cents: a.closing!.cents })) };
}
