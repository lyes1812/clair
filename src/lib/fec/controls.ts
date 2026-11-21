import type { AccountLedger } from "@/lib/bank/ledger";
import { addDays, addMonthsToDate, formatDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { FecError, parseFec, parseFecFilename, type FecLine, type FecParseResult, type FecRejectedRow } from "./parser";

// Contrôles F01 à F09 du cahier des charges Cap 13 (section 4). Les contrôles F01 à F05, F07 et F09 ne dépendent que du
// fichier : ils sont calculés au dépôt et conservés avec l'exercice. F06 (fraîcheur) dépend de la date de référence et
// F08 (banque) des relevés appliqués : ils sont recalculés à chaque affichage.
export type FecCheckCode = "F01" | "F02" | "F03" | "F04" | "F05" | "F06" | "F07" | "F08" | "F09";
/** blocking : le fichier est refusé ; strong : avertissement fort ; warning : avertissement ; info : information. */
export type FecSeverity = "blocking" | "strong" | "warning" | "info";
export type FecCheck = {
  code: FecCheckCode;
  label: string;
  severity: FecSeverity;
  /** ok : contrôle passé ; fail : constat ; nd : contrôle impossible, avec sa raison. */
  status: "ok" | "fail" | "nd";
  detail: string;
  gapCents?: number;
  missing?: string[];
};

export const FEC_CHECK_LABELS: Record<FecCheckCode, string> = {
  F01: "En-tête : 18 colonnes de la norme (ou variante Montant/Sens)",
  F02: "Lignes lisibles : nombre de champs, dates et montants",
  F03: "Chaque écriture (JournalCode + EcritureNum) équilibrée au centime",
  F04: "Total des débits = total des crédits sur le fichier",
  F05: "Dates d'écriture dans un seul exercice de 12 mois au plus (24 pour un premier exercice)",
  F06: "Fraîcheur : dernière écriture à 45 jours au plus de la date de référence",
  F07: "Comptes 401, 421, 431, 44x, 512 et 164 présents",
  F08: "Solde 512 du FEC = solde des relevés bancaires à la même date, à 1 € près",
  F09: "Fournisseurs : solde par compte auxiliaire et part non lettrée",
};
export const FEC_SEVERITY_LABELS: Record<FecSeverity, string> = { blocking: "Bloquant", strong: "Avertissement fort", warning: "Avertissement", info: "Information" };

export const FEC_MAX_AGE_DAYS = 45;
export const FEC_BANK_TOLERANCE_CENTS = 100;
const EXPECTED_ACCOUNTS: { prefix: string; label: string; test: (a: string) => boolean }[] = [
  { prefix: "401", label: "fournisseurs", test: (a) => a.startsWith("401") },
  { prefix: "421", label: "personnel, rémunérations dues", test: (a) => a.startsWith("421") },
  { prefix: "431", label: "sécurité sociale", test: (a) => a.startsWith("431") },
  { prefix: "44x", label: "État et collectivités", test: (a) => a.startsWith("44") },
  { prefix: "512", label: "banques", test: (a) => a.startsWith("512") },
  { prefix: "164", label: "emprunts auprès des établissements de crédit", test: (a) => a.startsWith("164") },
];
// F09 : comptes fournisseurs lus (401 fournisseurs, 404 fournisseurs d'immobilisations).
export const SUPPLIER_ACCOUNTS = /^40[14]/;
const TOP_SUPPLIERS = 50;
const MAX_LISTED_ROWS = 100;

export type FecSupplier = { auxiliary: string | null; label: string | null; balanceCents: number; unletteredCents: number; lines: number };
export type FecSuppliers = { count: number; balanceCents: number; unletteredCents: number; unletteredPermille: number | null; top: FecSupplier[] };
export type FecStoredControls = {
  version: 1;
  checks: FecCheck[];
  rejectedRows: FecRejectedRow[];
  rejectedCount: number;
  excludedEntries: number;
  excludedLines: number;
  suppliers: FecSuppliers | null;
  /** Solde cumulé des comptes 512 (débit − crédit) en fin de chaque jour mouvementé : [date, centimes]. */
  bank512: [string, number][];
};

const check = (code: FecCheckCode, severity: FecSeverity, status: FecCheck["status"], detail: string, extra: Partial<FecCheck> = {}): FecCheck =>
  ({ code, label: FEC_CHECK_LABELS[code], severity, status, detail, ...extra });
const permille = (p: number) => `${Math.floor(p / 10)},${p % 10} %`;

export function periodCheck(firstDate: string, lastDate: string, closingDate: string | null): FecCheck {
  const end = closingDate && closingDate > lastDate ? closingDate : lastDate;
  const within = (months: number) => end <= addDays(addMonthsToDate(firstDate, months), -1);
  const span = `du ${formatDate(firstDate)} au ${formatDate(end)}${end !== lastDate ? " (date de clôture du nom de fichier)" : ""}`;
  if (within(12)) return check("F05", "warning", "ok", `Écritures ${span}.`);
  if (within(24)) return check("F05", "warning", "fail", `Écritures ${span} : plus de 12 mois, admis seulement pour un premier exercice.`);
  return check("F05", "warning", "fail", `Écritures ${span} : plus de 24 mois, le fichier couvre plusieurs exercices.`);
}

export function freshnessCheck(lastDate: string, referenceDate: string): FecCheck {
  const days = Math.round((Date.parse(`${referenceDate}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000);
  const base = `Dernière écriture le ${formatDate(lastDate)}, date de référence ${formatDate(referenceDate)}`;
  if (days > FEC_MAX_AGE_DAYS) return check("F06", "strong", "fail", `${base} : ${days} jours d'écart, au-delà de ${FEC_MAX_AGE_DAYS} jours. Les soldes lus ne reflètent pas la situation du jour.`);
  return check("F06", "strong", "ok", `${base}${days > 0 ? ` : ${days} jour(s)` : ""}.`);
}

function accountsCheck(lines: FecLine[]): FecCheck {
  const ids = new Set(lines.map((l) => l.accountId));
  const missing = EXPECTED_ACCOUNTS.filter((e) => ![...ids].some(e.test));
  if (!missing.length) return check("F07", "warning", "ok", "Tous les comptes attendus sont présents.", { missing: [] });
  return check("F07", "warning", "fail", missing.map((m) => `Compte ${m.prefix} (${m.label}) absent.`).join(" "), { missing: missing.map((m) => m.prefix) });
}

export function supplierSummary(lines: FecLine[]): FecSuppliers {
  const byAux = new Map<string, FecSupplier>();
  for (const l of lines) {
    if (!SUPPLIER_ACCOUNTS.test(l.accountId)) continue;
    const key = l.auxiliaryAccount ?? "";
    const s = byAux.get(key) ?? { auxiliary: l.auxiliaryAccount, label: l.auxiliaryLabel, balanceCents: 0, unletteredCents: 0, lines: 0 };
    const credit = l.creditCents - l.debitCents;
    s.balanceCents += credit;
    if (!l.lettering) s.unletteredCents += credit;
    s.lines += 1;
    if (!s.label && l.auxiliaryLabel) s.label = l.auxiliaryLabel;
    byAux.set(key, s);
  }
  const all = [...byAux.values()].sort((a, b) => b.balanceCents - a.balanceCents || (a.auxiliary ?? "").localeCompare(b.auxiliary ?? ""));
  const balanceCents = all.reduce((t, s) => t + s.balanceCents, 0);
  const unletteredCents = all.reduce((t, s) => t + s.unletteredCents, 0);
  return { count: all.length, balanceCents, unletteredCents, unletteredPermille: balanceCents > 0 ? Math.round((unletteredCents * 1000) / balanceCents) : null, top: all.slice(0, TOP_SUPPLIERS) };
}

function suppliersCheck(s: FecSuppliers): FecCheck {
  if (s.count === 0) return check("F09", "info", "nd", "Aucune ligne sur les comptes fournisseurs 401 ou 404.");
  const share = s.unletteredPermille === null ? "part non lettrée n.d. (solde fournisseurs nul ou débiteur)" : `dont ${formatEuros(s.unletteredCents)} non lettrés (${permille(s.unletteredPermille)})`;
  const noAux = s.top.some((x) => x.auxiliary === null) ? " Des lignes fournisseurs n'ont pas de compte auxiliaire : elles sont regroupées." : "";
  return check("F09", "info", "ok", `${s.count} compte(s) fournisseur(s), solde créditeur total ${formatEuros(s.balanceCents)}, ${share}.${noAux}`);
}

function bank512Series(lines: FecLine[]): [string, number][] {
  const byDay = new Map<string, number>();
  for (const l of lines) if (l.accountId.startsWith("512")) byDay.set(l.entryDate, (byDay.get(l.entryDate) ?? 0) + l.debitCents - l.creditCents);
  let balance = 0;
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([d, net]) => [d, (balance += net)]);
}

/**
 * F08 : solde 512 du FEC comparé au total des soldes de clôture des relevés à une même date, la plus récente commune
 * à tous les comptes et comprise dans la période du FEC.
 */
export function bankCheck(series: [string, number][], exercise: { firstDate: string; lastDate: string }, ledger: AccountLedger[]): FecCheck {
  if (!ledger.length) return check("F08", "warning", "nd", "Aucun relevé bancaire appliqué dans Données : comparaison impossible.");
  if (!series.length) return check("F08", "warning", "nd", "Aucune écriture sur un compte 512 dans ce FEC.");
  const dates = ledger.map((a) => new Set(a.statements.flatMap((s) => (s.closing && s.closing.date >= exercise.firstDate && s.closing.date <= exercise.lastDate ? [s.closing.date] : []))));
  const common = [...dates[0]].filter((d) => dates.every((set) => set.has(d))).sort();
  const date = common[common.length - 1];
  if (!date) return check("F08", "warning", "nd", `Aucun solde de relevé à une même date pour ${ledger.length > 1 ? "tous les comptes" : "le compte"}, entre le ${formatDate(exercise.firstDate)} et le ${formatDate(exercise.lastDate)}.`);
  const bankCents = ledger.reduce((t, a) => t + a.statements.find((s) => s.closing?.date === date)!.closing!.cents, 0);
  const point = series.filter(([d]) => d <= date).at(-1);
  const fecCents = point ? point[1] : 0;
  const gapCents = fecCents - bankCents;
  const base = `Au ${formatDate(date)} : FEC ${formatEuros(fecCents)}, relevés ${formatEuros(bankCents)}`;
  if (Math.abs(gapCents) <= FEC_BANK_TOLERANCE_CENTS) return check("F08", "warning", "ok", `${base}${gapCents ? `, écart ${formatEuros(gapCents)} dans la tolérance de 1 €` : ""}.`, { gapCents });
  return check("F08", "warning", "fail", `${base} : écart de ${formatEuros(Math.abs(gapCents))} (${gapCents > 0 ? "FEC supérieur" : "FEC inférieur"} aux relevés). Chèques non encaissés, écritures manquantes ou à-nouveaux absents ?`, { gapCents });
}

function blockedBeforeReading(e: FecError): FecStoredControls {
  const nd = (code: FecCheckCode, severity: FecSeverity) => check(code, severity, "nd", "Non contrôlé : fichier refusé.");
  const rejected = e.rows?.rejected ?? [];
  const checks = e.rows
    ? [check("F01", "blocking", "ok", "En-tête conforme."), check("F02", "blocking", "fail", `${rejected.length} ligne(s) illisible(s) sur ${e.rows.dataRows}, au-delà de 0,1 % : fichier refusé. ${e.message}`)]
    : [check("F01", "blocking", "fail", e.message), nd("F02", "blocking")];
  checks.push(nd("F03", "blocking"), nd("F04", "blocking"), nd("F05", "warning"), nd("F07", "warning"), nd("F09", "info"));
  return { version: 1, checks, rejectedRows: rejected.slice(0, MAX_LISTED_ROWS), rejectedCount: rejected.length, excludedEntries: 0, excludedLines: 0, suppliers: null, bank512: [] };
}

export function controlsOf(parsed: FecParseResult, closingDate: string | null): FecStoredControls {
  const checks: FecCheck[] = [check("F01", "blocking", "ok", `En-tête conforme (${parsed.amountFormat === "montant-sens" ? "variante Montant/Sens" : "Debit/Credit"}, séparateur ${parsed.delimiter === "tab" ? "tabulation" : "« | »"}, ${parsed.encoding}).`)];
  const r = parsed.rejectedRows.length;
  checks.push(r
    ? check("F02", "warning", "fail", `${r} ligne(s) illisible(s) sur ${parsed.dataRows} (0,1 % au plus) : rejetée(s) et listée(s) ; ${parsed.excludedEntries} écriture(s) écartée(s) en entier, dont ${parsed.excludedLines} autre(s) ligne(s).`)
    : check("F02", "blocking", "ok", `${parsed.dataRows} ligne(s) lue(s).`));
  if (parsed.unbalancedEntries) {
    const sample = parsed.unbalancedSample.map((e) => `${e.journal} ${e.number} (${formatEuros(e.gapCents)})`).join(", ");
    checks.push(check("F03", "blocking", "fail", `${parsed.unbalancedEntries} écriture(s) déséquilibrée(s) : ${sample}${parsed.unbalancedEntries > parsed.unbalancedSample.length ? "…" : ""}.`));
  } else checks.push(check("F03", "blocking", "ok", `${parsed.entryCount} écriture(s) équilibrée(s).`));
  const gap = parsed.totalDebitCents - parsed.totalCreditCents;
  checks.push(gap
    ? check("F04", "blocking", "fail", `Total débit ${formatEuros(parsed.totalDebitCents)}, total crédit ${formatEuros(parsed.totalCreditCents)} : écart de ${formatEuros(Math.abs(gap))}.`, { gapCents: Math.abs(gap) })
    : check("F04", "blocking", "ok", `Total débit = total crédit = ${formatEuros(parsed.totalDebitCents)}.`, { gapCents: 0 }));
  checks.push(periodCheck(parsed.firstDate, parsed.lastDate, closingDate), accountsCheck(parsed.lines));
  const suppliers = supplierSummary(parsed.lines);
  checks.push(suppliersCheck(suppliers));
  return {
    version: 1, checks, rejectedRows: parsed.rejectedRows.slice(0, MAX_LISTED_ROWS), rejectedCount: r,
    excludedEntries: parsed.excludedEntries, excludedLines: parsed.excludedLines, suppliers, bank512: bank512Series(parsed.lines),
  };
}

export const isBlocking = (checks: FecCheck[]) => checks.some((c) => c.severity === "blocking" && c.status === "fail");

/** Lecture et contrôle d'un FEC. `parsed` est null quand F01 ou F02 refusent le fichier avant toute lecture. */
export function controlFec(bytes: Uint8Array, filename?: string): { parsed: FecParseResult | null; controls: FecStoredControls; blocked: boolean } {
  const closingDate = filename ? parseFecFilename(filename)?.closingDate ?? null : null;
  try {
    const parsed = parseFec(bytes);
    const controls = controlsOf(parsed, closingDate);
    return { parsed, controls, blocked: isBlocking(controls.checks) };
  } catch (e) {
    if (!(e instanceof FecError) || !["headers", "row", "empty"].includes(e.code)) throw e;
    return { parsed: null, controls: blockedBeforeReading(e), blocked: true };
  }
}

const ORDER: FecCheckCode[] = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09"];
/** Rapport complet F01 à F09 : contrôles conservés au dépôt, plus F06 et F08 calculés maintenant. */
export function fecReport(stored: FecStoredControls, exercise: { firstDate: string; lastDate: string }, live: { referenceDate: string; ledger: AccountLedger[] }): FecCheck[] {
  const all = [...stored.checks, freshnessCheck(exercise.lastDate, live.referenceDate), bankCheck(stored.bank512, exercise, live.ledger)];
  return ORDER.map((code) => all.find((c) => c.code === code)!);
}
