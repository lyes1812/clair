import { createHash } from "node:crypto";
import { normalizeLabel } from "@/lib/bank/model";
import { addDays } from "@/lib/dates";
import type { AgedInvoice } from "@/lib/aged/parser";
import { DEBT_NATURES, RANKS, type CrisisItem, type CrisisPosition, type DebtNatureId, type RankId, type RankSettings } from "./model";

// Cap 13, lot L3 — passif par créance (cahier des charges, section 6). Étape 1 : une créance par facture de la balance
// âgée, puis une par solde créditeur de compte (ou de compte auxiliaire) du FEC, hors fournisseurs déjà couverts par la
// balance. Étape 2 : nature par compte (celle du lot 1) ; rang hérité du choix fait pour la nature, modifiable créance par
// créance, jamais supposé. Étape 3 : exigibilité d'après l'échéance lue ou saisie, n.d. sans échéance. Étape 4 :
// rapprochement balance âgée ↔ FEC ↔ banque par les règles 1 (n° de facture et montant) et 2 (tiers, montant, ± 60 jours).
// La règle 3 (proposition IA) relève du lot L4.

export const MATCH_SIMILARITY = 0.85;
export const MATCH_WINDOW_DAYS = 60;
export const HORIZON_WEEKS = 13;
export const AGED_GAP_PERMILLE = 20; // 2 %
export const AGED_GAP_CENTS = 500_000; // 5 000 €

export type ClaimFecLine = {
  accountId: string; auxiliary: string | null; auxiliaryLabel: string | null; date: string;
  pieceRef: string | null; label: string | null; debitCents: number | null; creditCents: number | null;
};
export type BankDebit = { date: string; amountCents: number; label: string; counterparty: string | null; reference: string | null };
export type ClaimOverride = { rank?: RankId; dueDate?: string };
export type ClaimOverrides = Record<string, ClaimOverride>;

export type Exigibility =
  | { kind: "echu" }
  | { kind: "semaine"; week: number }
  | { kind: "au_dela" }
  | { kind: "nd"; reason: string }
  | { kind: "non_exigible"; reason: string }
  | { kind: "payee"; date: string };
export type AgingBucket = "non_echu" | "0_30" | "31_60" | "61_90" | "plus_90" | "nd";
export const AGING_LABELS: Record<AgingBucket, string> = { non_echu: "Non échu", "0_30": "Échu 0 à 30 j", "31_60": "31 à 60 j", "61_90": "61 à 90 j", plus_90: "Plus de 90 j", nd: "Sans échéance (n.d.)" };

export type ClaimMatch = { rule: 1 | 2; date: string; pieceRef: string | null; cents: number };
export type Claim = {
  key: string;
  source: "balance" | "fec";
  nature: DebtNatureId;
  natureLabel: string;
  creditor: string;
  auxiliary: string | null;
  accountId: string | null;
  invoice: string | null;
  invoiceDate: string | null;
  amountCents: number;
  dueDate: string | null;
  dueOrigin: "lue" | "saisie" | null;
  exigibility: Exigibility;
  aging: AgingBucket | null;
  rank: RankId | null;
  rankOrigin: "nature" | "creance" | null;
  /** Balance âgée : écriture du FEC rapprochée (règle 1 ou 2), null si aucune. */
  fecMatch: ClaimMatch | null;
  /** Débit bancaire postérieur à la date d'arrêté rapproché : la facture est « payée depuis », hors passif exigible. */
  paid: (ClaimMatch & { label: string }) | null;
};
export type SupplierGap = { creditor: string; auxiliary: string | null; agedCents: number; fecCents: number; gapCents: number };
export type AgedControl =
  | { kind: "nd"; reason: string }
  | { kind: "value"; agedCents: number; fecCents: number; gapCents: number; strong: boolean; lines: SupplierGap[] };
export type ClaimTotals = {
  passifCents: number; exigibleCents: number; echuCents: number; weeks: number[]; auDelaCents: number; ndCents: number; nonExigibleCents: number; payeeCents: number;
};
export type ClaimsView =
  | { kind: "nd"; reason: string }
  | {
    kind: "value"; asOf: string; claims: Claim[]; totals: ClaimTotals;
    reconciliation: { fecDebtCents: number; coveredFecCents: number; agedCents: number; passifCents: number };
    control: AgedControl; aging: { bucket: AgingBucket; cents: number; count: number }[];
    unranked: number; warnings: string[];
  };

// --- Texte : normalisation et similarité trigramme (comme pg_trgm).
export const normalizeName = (s: string) => normalizeLabel(s.replace(/Œ/g, "OE").replace(/œ/g, "oe").replace(/Æ/g, "AE").replace(/æ/g, "ae"));
const compact = (s: string) => normalizeName(s).replace(/ /g, "");
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeName(s).split(" ").filter(Boolean)) {
    const w = `  ${word.toLowerCase()} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}
/** N° de facture présent dans un texte (pièce, libellé), espaces et ponctuation ignorés ; 3 caractères au moins. */
export function containsInvoice(text: string, invoice: string): boolean {
  const inv = compact(invoice);
  return inv.length >= 3 && compact(text).includes(inv);
}
const sameAux = (a: string | null, b: string | null) => a !== null && b !== null && compact(a) === compact(b) && compact(a) !== "";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function agingOf(dueDate: string | null, asOf: string): AgingBucket {
  if (!dueDate) return "nd";
  if (dueDate > asOf) return "non_echu";
  const late = daysBetween(dueDate, asOf);
  return late <= 30 ? "0_30" : late <= 60 ? "31_60" : late <= 90 ? "61_90" : "plus_90";
}

/** Premier jour de la semaine `week` : semaine 1 = lundi qui suit la date d'arrêté, ou ce lundi même s'il en est un (section 7). */
export function weekStartOf(asOf: string, week: number): string {
  const day = new Date(`${asOf}T00:00:00Z`).getUTCDay(); // 0 dimanche … 1 lundi
  const monday1 = addDays(asOf, day === 1 ? 0 : (8 - day) % 7);
  return addDays(monday1, (week - 1) * 7);
}

/**
 * Exigibilité : échu si l'échéance est au plus tard à la date d'arrêté ; sinon semaine 1 à 13 du calendrier lundi → dimanche
 * (les jours entre la date d'arrêté et le premier lundi sont rattachés à la semaine 1) ; au-delà ensuite ; n.d. sans échéance.
 */
export function exigibilityOf(dueDate: string | null, asOf: string): Exigibility {
  if (!dueDate) return { kind: "nd", reason: "Échéance inconnue : à saisir." };
  if (dueDate <= asOf) return { kind: "echu" };
  const monday1 = weekStartOf(asOf, 1);
  const week = dueDate < monday1 ? 1 : Math.floor(daysBetween(monday1, dueDate) / 7) + 1;
  return week <= HORIZON_WEEKS ? { kind: "semaine", week } : { kind: "au_dela" };
}

/** Charges à payer (408, 4282, 4286) : non exigibles, gardées à échoir (cahier des charges, section 6). */
export const isAccrual = (accountId: string) => /^(408|4282|4286)/.test(accountId);
const isSupplierInvoiceAccount = (accountId: string) => /^40[134]/.test(accountId);

export const claimKey = (...parts: (string | null)[]) => `c-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;

/** Un tiers de la balance âgée et un compte du FEC désignent le même fournisseur : n° auxiliaire, sinon nom à 0,85. */
function sameTier(inv: { supplier: string; auxiliary: string | null }, aux: string | null, auxLabel: string | null): boolean {
  if (sameAux(inv.auxiliary, aux)) return true;
  if (inv.auxiliary && aux) return false;
  return auxLabel !== null && similarity(inv.supplier, auxLabel) >= MATCH_SIMILARITY;
}

export type ClaimsInput = {
  asOf: string;
  position: CrisisPosition;
  /** Balance âgée en vigueur, arrêtée à `asOf` ; null si aucune n'est appliquée à cette date. */
  invoices: AgedInvoice[] | null;
  supplierLines: ClaimFecLine[];
  bankDebits: BankDebit[];
  ranks: RankSettings | null;
  overrides: ClaimOverrides;
};

export function buildClaims(input: ClaimsInput): ClaimsView {
  const { asOf, position, invoices, ranks, overrides } = input;
  if (position.kind === "nd") return { kind: "nd", reason: position.reason };
  if (position.totalDebt.cents === null) return { kind: "nd", reason: position.totalDebt.reason ?? "Dettes du FEC n.d." };
  const natureLabel = (id: DebtNatureId) => DEBT_NATURES.find((n) => n.id === id)!.label;
  const rankFor = (key: string, nature: DebtNatureId): Pick<Claim, "rank" | "rankOrigin"> => {
    const own = overrides[key]?.rank;
    if (own) return { rank: own, rankOrigin: "creance" };
    const inherited = ranks?.[nature];
    return inherited ? { rank: inherited, rankOrigin: "nature" } : { rank: null, rankOrigin: null };
  };
  const dueFor = (key: string, read: string | null): Pick<Claim, "dueDate" | "dueOrigin"> => {
    const own = overrides[key]?.dueDate;
    if (own) return { dueDate: own, dueOrigin: "saisie" };
    return read ? { dueDate: read, dueOrigin: "lue" } : { dueDate: null, dueOrigin: null };
  };

  const claims: Claim[] = [];
  const warnings: string[] = [];
  const supplierItems = position.natures.find((n) => n.id === "suppliers")!;
  const covers = (item: CrisisItem) => invoices !== null && isSupplierInvoiceAccount(item.accountId) && invoices.some((inv) => sameTier(inv, item.auxiliary, item.auxiliaryLabel ?? item.accountName));
  const coveredItems = supplierItems.items.filter(covers);
  const coveredDebitItems = supplierItems.debitItems.filter(covers);

  // Étape 1a et 4 : une créance par facture, rapprochée du FEC puis de la banque.
  const usedFec = new Set<number>();
  const usedBank = new Set<number>();
  const credits = input.supplierLines.map((l, i) => ({ l, i, net: (l.creditCents ?? 0) - (l.debitCents ?? 0) })).filter((x) => isSupplierInvoiceAccount(x.l.accountId) && x.l.creditCents !== null && x.l.debitCents !== null && x.net > 0);
  for (const inv of invoices ?? []) {
    const key = claimKey("balance", inv.auxiliary ?? normalizeName(inv.supplier), inv.invoice, inv.invoiceDate);
    const due = dueFor(key, inv.dueDate);
    let fecMatch: ClaimMatch | null = null;
    const r1 = credits.find((x) => !usedFec.has(x.i) && x.net === inv.amountCents && containsInvoice(`${x.l.pieceRef ?? ""} ${x.l.label ?? ""}`, inv.invoice));
    const r2 = r1 ?? credits.find((x) => !usedFec.has(x.i) && x.net === inv.amountCents && sameTier(inv, x.l.auxiliary, x.l.auxiliaryLabel) && Math.abs(daysBetween(inv.invoiceDate, x.l.date)) <= MATCH_WINDOW_DAYS);
    if (r2) { usedFec.add(r2.i); fecMatch = { rule: r1 ? 1 : 2, date: r2.l.date, pieceRef: r2.l.pieceRef, cents: r2.net }; }
    let paid: Claim["paid"] = null;
    if (inv.amountCents > 0) {
      const debits = input.bankDebits.map((d, i) => ({ d, i })).filter((x) => !usedBank.has(x.i) && x.d.date > asOf && -x.d.amountCents === inv.amountCents);
      const b1 = debits.find((x) => containsInvoice(`${x.d.label} ${x.d.reference ?? ""}`, inv.invoice));
      const anchor = due.dueDate ?? inv.invoiceDate;
      const b2 = b1 ?? debits.find((x) => {
        const name = x.d.counterparty ?? "";
        const named = (name && similarity(name, inv.supplier) >= MATCH_SIMILARITY) || compact(x.d.label).includes(compact(inv.supplier));
        return named && Math.abs(daysBetween(anchor, x.d.date)) <= MATCH_WINDOW_DAYS;
      });
      if (b2) { usedBank.add(b2.i); paid = { rule: b1 ? 1 : 2, date: b2.d.date, pieceRef: null, cents: -b2.d.amountCents, label: b2.d.label }; }
    }
    claims.push({
      key, source: "balance", nature: "suppliers", natureLabel: natureLabel("suppliers"), creditor: inv.supplier, auxiliary: inv.auxiliary, accountId: null,
      invoice: inv.invoice, invoiceDate: inv.invoiceDate, amountCents: inv.amountCents, ...due,
      exigibility: paid ? { kind: "payee", date: paid.date } : exigibilityOf(due.dueDate, asOf), aging: agingOf(due.dueDate, asOf),
      ...rankFor(key, "suppliers"), fecMatch, paid,
    });
  }

  // Étape 1b : soldes créditeurs du FEC, hors fournisseurs couverts par la balance âgée.
  for (const nature of position.natures) {
    for (const item of nature.items) {
      if (nature.id === "suppliers" && coveredItems.includes(item)) continue;
      const key = claimKey("fec", item.accountId, item.auxiliary);
      const due = dueFor(key, null);
      claims.push({
        key, source: "fec", nature: nature.id, natureLabel: nature.label, creditor: item.auxiliaryLabel ?? item.accountName ?? item.accountId, auxiliary: item.auxiliary, accountId: item.accountId,
        invoice: null, invoiceDate: null, amountCents: item.cents, ...due,
        exigibility: isAccrual(item.accountId) ? { kind: "non_exigible", reason: "Charge à payer : non exigible, gardée à échoir." } : exigibilityOf(due.dueDate, asOf),
        aging: null, ...rankFor(key, nature.id), fecMatch: null, paid: null,
      });
    }
  }

  // Totaux exacts en BigInt, puis contrôle de la plage sûre.
  const sum = (list: Claim[]) => list.reduce((t, c) => t + BigInt(c.amountCents), 0n);
  const big = {
    passif: sum(claims),
    echu: sum(claims.filter((c) => c.exigibility.kind === "echu")),
    auDela: sum(claims.filter((c) => c.exigibility.kind === "au_dela")),
    nd: sum(claims.filter((c) => c.exigibility.kind === "nd")),
    nonExigible: sum(claims.filter((c) => c.exigibility.kind === "non_exigible")),
    payee: sum(claims.filter((c) => c.exigibility.kind === "payee")),
    weeks: Array.from({ length: HORIZON_WEEKS }, (_, w) => sum(claims.filter((c) => c.exigibility.kind === "semaine" && c.exigibility.week === w + 1))),
  };
  const fecDebt = BigInt(position.totalDebt.cents);
  const covered = coveredItems.reduce((t, i) => t + BigInt(i.cents), 0n);
  const aged = (invoices ?? []).reduce((t, i) => t + BigInt(i.amountCents), 0n);
  const all = [big.passif, big.echu, big.auDela, big.nd, big.nonExigible, big.payee, ...big.weeks, fecDebt, covered, aged];
  if (all.some((v) => v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER))) return { kind: "nd", reason: "Montants hors des centimes entiers sûrs." };
  const n = Number;
  const totals: ClaimTotals = {
    passifCents: n(big.passif), exigibleCents: n(big.passif - big.nonExigible - big.payee), echuCents: n(big.echu), weeks: big.weeks.map(n),
    auDelaCents: n(big.auDela), ndCents: n(big.nd), nonExigibleCents: n(big.nonExigible), payeeCents: n(big.payee),
  };

  // Contrôle : total de la balance âgée = solde créditeur net des comptes 401 du FEC à la même date.
  let control: AgedControl;
  if (invoices === null) control = { kind: "nd", reason: "Aucune balance âgée appliquée à cette date." };
  else {
    const fec401 = [...supplierItems.items.filter((i) => i.accountId.startsWith("401")).map((i) => ({ ...i, cents: i.cents })), ...supplierItems.debitItems.filter((i) => i.accountId.startsWith("401")).map((i) => ({ ...i, cents: -i.cents }))];
    const fecCents = fec401.reduce((t, i) => t + i.cents, 0);
    const agedCents = n(aged);
    const gapCents = agedCents - fecCents;
    const groups = new Map<string, SupplierGap>();
    for (const inv of invoices) {
      const k = inv.auxiliary ? `a:${compact(inv.auxiliary)}` : `n:${normalizeName(inv.supplier)}`;
      const g = groups.get(k) ?? { creditor: inv.supplier, auxiliary: inv.auxiliary, agedCents: 0, fecCents: 0, gapCents: 0 };
      g.agedCents += inv.amountCents;
      groups.set(k, g);
    }
    for (const item of fec401) {
      const label = item.auxiliaryLabel ?? item.accountName ?? item.accountId;
      const hit = [...groups.values()].find((g) => sameTier({ supplier: g.creditor, auxiliary: g.auxiliary }, item.auxiliary, label));
      if (hit) hit.fecCents += item.cents;
      else {
        const k = `f:${item.accountId}:${item.auxiliary ?? ""}`;
        const g = groups.get(k) ?? { creditor: label, auxiliary: item.auxiliary, agedCents: 0, fecCents: 0, gapCents: 0 };
        g.fecCents += item.cents;
        groups.set(k, g);
      }
    }
    const lines = [...groups.values()].map((g) => ({ ...g, gapCents: g.agedCents - g.fecCents })).filter((g) => g.gapCents !== 0).sort((a, b) => Math.abs(b.gapCents) - Math.abs(a.gapCents) || a.creditor.localeCompare(b.creditor));
    const strong = Math.abs(gapCents) > AGED_GAP_CENTS || (fecCents !== 0 ? Math.abs(gapCents) * 1000 > Math.abs(fecCents) * AGED_GAP_PERMILLE : gapCents !== 0);
    control = { kind: "value", agedCents, fecCents, gapCents, strong, lines };
  }

  const aging = (["non_echu", "0_30", "31_60", "61_90", "plus_90", "nd"] as AgingBucket[]).map((bucket) => {
    const members = claims.filter((c) => c.source === "balance" && c.aging === bucket);
    return { bucket, cents: members.reduce((t, c) => t + c.amountCents, 0), count: members.length };
  });
  if (coveredDebitItems.length) warnings.push(`${coveredDebitItems.length} fournisseur(s) couvert(s) par la balance âgée ont un solde débiteur dans le FEC (avance, avoir) : il n'est pas déduit du passif.`);
  if (claims.some((c) => c.nature === "other" && c.source === "fec")) warnings.push("Des dettes « Autres » (comptes 419 et 46) sont à qualifier : nature et rang à préciser créance par créance.");
  const unranked = claims.filter((c) => c.rank === null && c.exigibility.kind !== "non_exigible" && c.exigibility.kind !== "payee").length;

  claims.sort((a, b) => b.amountCents - a.amountCents || a.creditor.localeCompare(b.creditor) || (a.invoice ?? "").localeCompare(b.invoice ?? ""));
  return {
    kind: "value", asOf, claims, totals,
    reconciliation: { fecDebtCents: n(fecDebt), coveredFecCents: n(covered), agedCents: n(aged), passifCents: n(big.passif) },
    control, aging, unranked, warnings,
  };
}

// --- Saisies par créance (rang, échéance), enregistrées dans les paramètres de l'espace.
export const CLAIMS_KEY = "restructuring.crisis.claims";
const RANK_IDS = new Set<string>(RANKS.map((r) => r.id));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (v: string) => ISO.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Lecture stricte : une valeur inconnue rend l'ensemble illisible (null), rien n'est appliqué à moitié. */
export function parseClaimOverrides(value: unknown): ClaimOverrides | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out: ClaimOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^c-[0-9a-f]{16}$/.test(key) || raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (Object.keys(o).some((k) => k !== "rank" && k !== "dueDate")) return null;
    if (o.rank !== undefined && (typeof o.rank !== "string" || !RANK_IDS.has(o.rank))) return null;
    if (o.dueDate !== undefined && (typeof o.dueDate !== "string" || !validIso(o.dueDate))) return null;
    out[key] = { ...(o.rank ? { rank: o.rank as RankId } : {}), ...(o.dueDate ? { dueDate: o.dueDate as string } : {}) };
  }
  return out;
}

/**
 * Formulaire : `claim` (clé), `rank-<clé>` et `due-<clé>` pour chaque créance affichée. Une valeur vide retire la saisie ;
 * les créances absentes du formulaire gardent leurs saisies.
 */
export function overridesFromForm(form: FormData, current: ClaimOverrides): ClaimOverrides {
  const next: ClaimOverrides = { ...current };
  for (const key of form.getAll("claim").map(String)) {
    if (!/^c-[0-9a-f]{16}$/.test(key)) throw new Error("Créance inconnue.");
    const rank = String(form.get(`rank-${key}`) ?? "").trim();
    const due = String(form.get(`due-${key}`) ?? "").trim();
    if (rank && !RANK_IDS.has(rank)) throw new Error("Rang inconnu.");
    if (due && !validIso(due)) throw new Error("Échéance invalide (JJ/MM/AAAA).");
    const o: ClaimOverride = { ...(rank ? { rank: rank as RankId } : {}), ...(due ? { dueDate: due } : {}) };
    if (Object.keys(o).length) next[key] = o; else delete next[key];
  }
  return next;
}

export const exigibilityLabel = (e: Exigibility, asOf: string) =>
  e.kind === "echu" ? "Échu" : e.kind === "semaine" ? `Semaine ${e.week} (${weekStartOf(asOf, e.week).split("-").reverse().join("/")})` : e.kind === "au_dela" ? "Au-delà de 13 semaines" : e.kind === "payee" ? "Payée depuis" : e.kind === "non_exigible" ? "Non exigible" : "n.d.";

/** Passif exigible par rang (hors charges à payer et factures payées depuis). Les créances sans rang restent à part : jamais classées d'office. */
export function claimsByRank(claims: Claim[]): { totals: { id: RankId; label: string; cents: number; count: number }[]; unrankedCents: number; unrankedCount: number } {
  const exigible = claims.filter((c) => c.exigibility.kind !== "non_exigible" && c.exigibility.kind !== "payee");
  const totals = RANKS.map((r) => {
    const members = exigible.filter((c) => c.rank === r.id);
    return { id: r.id, label: r.label, cents: members.reduce((t, c) => t + c.amountCents, 0), count: members.length };
  });
  const unranked = exigible.filter((c) => c.rank === null);
  return { totals, unrankedCents: unranked.reduce((t, c) => t + c.amountCents, 0), unrankedCount: unranked.length };
}

/**
 * Indicateur affiché (section 6) : disponibilités rapportées au passif exigible échu, en centièmes arrondis au plus proche.
 * Jamais une qualification de cessation des paiements. Autorisations de découvert non tirées : non saisies en V1, donc exclues.
 */
export function cashToOverdue(cashCents: number | null, echuCents: number): { kind: "nd"; reason: string } | { kind: "value"; hundredths: number } {
  if (cashCents === null) return { kind: "nd", reason: "Disponibilités n.d." };
  if (echuCents <= 0) return { kind: "nd", reason: "Aucun passif échu connu à la date d’arrêté." };
  return { kind: "value", hundredths: Number((BigInt(cashCents) * 200n + BigInt(echuCents)) / (2n * BigInt(echuCents))) };
}
