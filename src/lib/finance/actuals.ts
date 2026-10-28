import { isMonth } from "@/lib/connectors/months";
import type { ComptaSource } from "@/lib/payroll/context";
import { FINANCE_ROWS, type FinanceAccount, type FinanceActuals, type FinanceCell, type FinanceMapping, type FinanceMonth, type FinanceRowId } from "./types";

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const ROWS = new Map(FINANCE_ROWS.map((row) => [row.id, row]));
type Sum = { cents: bigint; lineCount: number; missing: boolean; invalid: boolean };
type AccountSums = { account: string; row: FinanceRowId; months: Map<string, Sum> };

const empty = (): Sum => ({ cents: 0n, lineCount: 0, missing: false, invalid: false });
const nd = (reason: string): FinanceCell => ({ cents: null, reason });
const safeCents = (cents: bigint): FinanceCell => cents > MAX_CENTS || cents < -MAX_CENTS
  ? nd("total comptable hors des centimes entiers sûrs")
  : { cents: Number(cents), reason: null };

function sumCell(sum: Sum, emptyReason: string): FinanceCell {
  if (sum.missing) return nd("débit ou crédit manquant sur une écriture comptable");
  if (sum.invalid) return nd("montant comptable hors des centimes entiers sûrs");
  if (!sum.lineCount) return { cents: 0, reason: emptyReason };
  return safeCents(sum.cents);
}

/** Correspondance initiale PCG, sans modifier ni rapprocher les codes de comptes. */
export function defaultFinanceRow(account: string): FinanceRowId | null {
  if (account.startsWith("70")) return "revenue";
  if (account.startsWith("64")) return "personnel";
  if (account.startsWith("6")) return "other-expenses";
  if (account.startsWith("7")) return "other-income";
  return null;
}

/** Réel comptable en centimes : aucun accès aux sources, aucune conversion de devise, aucune hypothèse de projection. */
export function buildActuals(source: ComptaSource, months: string[], mappings: FinanceMapping[]): FinanceActuals {
  const requested = [...new Set(months)].sort();
  const wanted = new Set(requested);
  const covered = new Set(source.months);
  const overrides = new Map(mappings
    .filter((mapping) => defaultFinanceRow(mapping.account) !== null && ROWS.has(mapping.row))
    .map((mapping) => [mapping.account, mapping.row]));
  const accounts = new Map<string, AccountSums>();
  const monthCounts = new Map<string, number>();

  for (const line of source.lines) {
    if (!wanted.has(line.month)) continue;
    const initial = defaultFinanceRow(line.accountId);
    if (initial === null) continue;
    const row = overrides.get(line.accountId) ?? initial;
    let account = accounts.get(line.accountId);
    if (!account) {
      account = { account: line.accountId, row, months: new Map() };
      accounts.set(line.accountId, account);
    }
    const sum = account.months.get(line.month) ?? empty();
    sum.lineCount++;
    monthCounts.set(line.month, (monthCounts.get(line.month) ?? 0) + 1);
    if (line.debitCents === null || line.creditCents === null) sum.missing = true;
    else if (!Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents)) sum.invalid = true;
    else {
      const debit = BigInt(line.debitCents);
      const credit = BigInt(line.creditCents);
      // Le sens suit la ligne de gestion : une reclassification ne change pas le résultat comptable.
      sum.cents += ROWS.get(row)!.kind === "income" ? credit - debit : debit - credit;
    }
    account.months.set(line.month, sum);
  }

  const blocked = new Map<string, string>();
  for (const month of requested) {
    let reason: string | null = null;
    if (!isMonth(month)) reason = "mois comptable invalide";
    else if (source.error) reason = "lecture comptable indisponible";
    else if (source.source === null) reason = "aucune source comptable retenue";
    // Les raisons brutes peuvent contenir un nom de fichier : ne pas les recopier dans le modèle financier.
    else if (Object.hasOwn(source.nd, month)) reason = "mois comptable non exploitable selon la couverture de la source";
    else if (!covered.has(month)) reason = "mois hors de la couverture comptable lue";
    else if (!monthCounts.get(month)) reason = "aucune écriture de charges ou de produits (classes 6 et 7) lue pour ce mois";
    if (reason) blocked.set(month, reason);
  }

  const accountList = [...accounts.values()].sort((a, b) => a.account < b.account ? -1 : a.account > b.account ? 1 : 0);
  const monthList: FinanceMonth[] = requested.map((month) => {
    const sums = new Map(FINANCE_ROWS.map((row) => [row.id, empty()]));
    for (const account of accountList) {
      const sum = account.months.get(month);
      if (!sum) continue;
      const row = sums.get(account.row)!;
      row.cents += sum.cents;
      row.lineCount += sum.lineCount;
      row.missing ||= sum.missing;
      row.invalid ||= sum.invalid;
    }
    const reason = blocked.get(month);
    const cells = Object.fromEntries(FINANCE_ROWS.map((row) => [row.id, reason ? nd(reason) : sumCell(sums.get(row.id)!, "aucune écriture affectée à cette ligne dans le mois comptable lu")])) as Record<FinanceRowId, FinanceCell>;
    let result: FinanceCell;
    if (reason) result = nd(reason);
    else if (FINANCE_ROWS.some((row) => cells[row.id].cents === null)) result = nd("résultat non calculable : au moins une ligne de produits ou de charges est n.d.");
    else result = safeCents(FINANCE_ROWS.reduce((total, row) => total + (row.kind === "income" ? sums.get(row.id)!.cents : -sums.get(row.id)!.cents), 0n));
    return { month, cells, result, lineCount: monthCounts.get(month) ?? 0 };
  });

  const accountOutput: FinanceAccount[] = accountList.map((account) => {
    const values = requested.map((month) => {
      const reason = blocked.get(month);
      return [month, reason ? nd(reason) : sumCell(account.months.get(month) ?? empty(), "aucune écriture de ce compte dans le mois comptable lu")] as const;
    });
    const total = values.some(([, cell]) => cell.cents === null)
      ? nd("total du compte non calculable : au moins un mois est n.d.")
      : safeCents(values.reduce((sum, [, cell]) => sum + BigInt(cell.cents!), 0n));
    return { account: account.account, row: account.row, months: Object.fromEntries(values), total, lineCount: [...account.months.values()].reduce((sum, value) => sum + value.lineCount, 0) };
  });
  return { months: monthList, accounts: accountOutput };
}
