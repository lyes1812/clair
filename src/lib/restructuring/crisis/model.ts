import { isIsoDate } from "@/lib/dates";

// Cap 13, lot 1 — position de trésorerie et dettes comptabilisées à une date, lues dans un exercice du FEC.
// Analyse exacte : chaque montant est un solde de compte (ou de compte auxiliaire) du FEC, en centimes entiers.
// Ce que ce calcul ne fait pas : il ne dit pas si une dette est échue. Le FEC ne porte aucune date d'échéance ;
// l'exigibilité relève de l'échéancier saisi (lot 2), jamais d'une déduction.

export type CrisisLine = {
  accountId: string;
  accountName: string | null;
  auxiliary: string | null;
  auxiliaryLabel: string | null;
  date: string;
  debitCents: number | null;
  creditCents: number | null;
};

export const DEBT_NATURES = [
  { id: "suppliers", label: "Fournisseurs", accounts: "comptes 40" },
  { id: "staff", label: "Personnel", accounts: "comptes 42" },
  { id: "social", label: "Organismes sociaux", accounts: "comptes 43" },
  { id: "tax", label: "État et collectivités", accounts: "comptes 44" },
  { id: "financial", label: "Emprunts et dettes financières", accounts: "comptes 16 et 17" },
  { id: "banks", label: "Concours bancaires et banques créditrices", accounts: "compte 519 et soldes créditeurs des comptes de trésorerie" },
  { id: "partners", label: "Associés et groupe", accounts: "comptes 45" },
  { id: "other", label: "Autres dettes", accounts: "comptes 419 et 46" },
] as const;
export type DebtNatureId = typeof DEBT_NATURES[number]["id"];

export const RANKS = [
  { id: "superprivilege", label: "Superprivilège des salaires" },
  { id: "privilege", label: "Privilégié" },
  { id: "surete", label: "Garanti par une sûreté" },
  { id: "chirographaire", label: "Chirographaire" },
] as const;
export type RankId = typeof RANKS[number]["id"];
/** Rang choisi par l'utilisateur pour chaque nature ; une nature absente n'a pas de rang (aucun rang par défaut). */
export type RankSettings = Partial<Record<DebtNatureId, RankId>>;

export type Amount = { cents: number | null; reason: string | null };
export type CrisisItem = { accountId: string; accountName: string | null; auxiliary: string | null; auxiliaryLabel: string | null; cents: number };
export type NatureBlock = {
  id: DebtNatureId; label: string; accounts: string; rank: RankId | null;
  /** Somme des soldes créditeurs : la dette de la nature. */
  debt: Amount;
  /** Somme des soldes débiteurs des mêmes comptes (avances, acomptes, crédits de TVA…), jamais déduite de la dette. */
  debitBalances: Amount;
  items: CrisisItem[];
  debitItems: CrisisItem[];
};
export type RankTotal = { id: RankId; label: string; total: Amount; natures: string[] };
export type CrisisPosition =
  | { kind: "nd"; reason: string }
  | {
    kind: "value"; asOf: string; lineCount: number;
    cash: {
      available: Amount; items: CrisisItem[];
      /** Soldes nets des comptes de trésorerie, découverts compris (hors compte 519) : solde de départ de la trésorerie à 13 semaines. */
      net: Amount;
    };
    securities: Amount;
    natures: NatureBlock[];
    totalDebt: Amount;
    /** Disponibilités − dettes comptabilisées. Un indicateur de couverture, pas un solde de trésorerie prévisionnel. */
    coverage: Amount;
    ranks: { kind: "value"; totals: RankTotal[] } | { kind: "nd"; reason: string };
    warnings: string[];
  };

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const nd = (reason: string): Amount => ({ cents: null, reason });
const exact = (value: bigint): Amount => value > MAX || value < -MAX ? nd("Montant hors des centimes entiers sûrs.") : { cents: Number(value), reason: null };

/** Comptes de trésorerie : banques, établissements financiers, caisse (51 hors 519, 53, 54). */
export const isCashAccount = (account: string) => /^(?:51[0-8]|53|54)/.test(account);
export const isSecuritiesAccount = (account: string) => account.startsWith("50");

/** Nature d'une dette d'après le plan comptable général. Les comptes 41 (hors 419), 47, 48 et 49 ne sont pas des dettes lues ici. */
export function natureOf(account: string): DebtNatureId | null {
  if (account.startsWith("519")) return "banks";
  if (account.startsWith("419")) return "other";
  if (account.startsWith("40")) return "suppliers";
  if (account.startsWith("42")) return "staff";
  if (account.startsWith("43")) return "social";
  if (account.startsWith("44")) return "tax";
  if (account.startsWith("45")) return "partners";
  if (account.startsWith("46")) return "other";
  if (account.startsWith("16") || account.startsWith("17")) return "financial";
  return null;
}

type Group = { accountId: string; accountName: string | null; auxiliary: string | null; auxiliaryLabel: string | null; balance: bigint; broken: boolean };
const order = (a: CrisisItem, b: CrisisItem) => b.cents - a.cents || a.accountId.localeCompare(b.accountId) || (a.auxiliary ?? "").localeCompare(b.auxiliary ?? "");

/**
 * Position à la date `asOf` à partir des écritures d'UN exercice (à-nouveaux compris). Les lignes datées après `asOf`
 * sont ignorées. Un solde créditeur et un solde débiteur ne sont jamais compensés entre comptes ou entre tiers.
 */
export function buildCrisisPosition(lines: CrisisLine[], asOf: string, ranks: RankSettings | null): CrisisPosition {
  if (!isIsoDate(asOf)) return { kind: "nd", reason: "Date d’arrêté invalide." };
  const groups = new Map<string, Group>();
  let lineCount = 0;
  let securities = 0n;
  let securitiesBroken = false;
  for (const line of lines) {
    if (!isIsoDate(line.date)) return { kind: "nd", reason: "Une écriture comptable n’a pas de date lisible ; aucun solde partiel n’est présenté." };
    if (line.date > asOf) continue;
    const cash = isCashAccount(line.accountId);
    const sec = isSecuritiesAccount(line.accountId);
    if (!cash && !sec && natureOf(line.accountId) === null) continue;
    lineCount++;
    const valid = line.debitCents !== null && line.creditCents !== null && Number.isSafeInteger(line.debitCents) && Number.isSafeInteger(line.creditCents);
    const movement = valid ? BigInt(line.debitCents!) - BigInt(line.creditCents!) : 0n;
    if (sec) { securities += movement; securitiesBroken ||= !valid; continue; }
    const key = JSON.stringify([line.accountId, line.auxiliary]);
    const group = groups.get(key) ?? { accountId: line.accountId, accountName: line.accountName, auxiliary: line.auxiliary, auxiliaryLabel: line.auxiliaryLabel, balance: 0n, broken: false };
    group.balance += movement; // solde débiteur positif
    group.broken ||= !valid;
    group.accountName ??= line.accountName;
    group.auxiliaryLabel ??= line.auxiliaryLabel;
    groups.set(key, group);
  }
  if (!lineCount) return { kind: "nd", reason: "Aucune écriture de trésorerie ou de dette (comptes 16, 17, 4 et 5) jusqu’à cette date dans l’exercice lu." };

  const BROKEN = "Débit ou crédit manquant sur au moins une écriture ; aucun total partiel.";
  const item = (g: Group, sign: 1n | -1n): CrisisItem | null => {
    const cents = exact(g.balance * sign);
    return cents.cents === null ? null : { accountId: g.accountId, accountName: g.accountName, auxiliary: g.auxiliary, auxiliaryLabel: g.auxiliaryLabel, cents: cents.cents };
  };
  const sum = (list: Group[], sign: 1n | -1n): Amount => list.some((g) => g.broken) ? nd(BROKEN) : exact(list.reduce((total, g) => total + g.balance * sign, 0n));
  const items = (list: Group[], sign: 1n | -1n) => list.flatMap((g) => g.broken ? [] : [item(g, sign)].filter((x): x is CrisisItem => x !== null)).sort(order);

  const all = [...groups.values()];
  const cashGroups = all.filter((g) => isCashAccount(g.accountId));
  // Un compte de trésorerie créditeur est un découvert : il rejoint les dettes bancaires, il ne réduit pas les disponibilités.
  const cashBroken = cashGroups.some((g) => g.broken);
  const positive = cashGroups.filter((g) => g.balance > 0n);
  const overdrawn = cashGroups.filter((g) => g.balance < 0n);
  const available = cashBroken ? nd(BROKEN) : sum(positive, 1n);

  const natures: NatureBlock[] = DEBT_NATURES.map((nature) => {
    const own = all.filter((g) => !isCashAccount(g.accountId) && natureOf(g.accountId) === nature.id);
    const broken = own.some((g) => g.broken) || (nature.id === "banks" && cashBroken);
    const creditors = [...own.filter((g) => g.balance < 0n), ...(nature.id === "banks" ? overdrawn : [])];
    const debtors = own.filter((g) => g.balance > 0n);
    return {
      id: nature.id, label: nature.label, accounts: nature.accounts, rank: ranks?.[nature.id] ?? null,
      debt: broken ? nd(BROKEN) : sum(creditors, -1n),
      debitBalances: broken ? nd(BROKEN) : sum(debtors, 1n),
      items: broken ? [] : items(creditors, -1n),
      debitItems: broken ? [] : items(debtors, 1n),
    };
  });

  const totalDebt = natures.some((n) => n.debt.cents === null)
    ? nd("Total des dettes non calculable : au moins une nature est n.d. ; aucun total partiel.")
    : exact(natures.reduce((total, n) => total + BigInt(n.debt.cents!), 0n));
  const coverage = available.cents === null || totalDebt.cents === null
    ? nd("Couverture non calculable : disponibilités ou dettes n.d.")
    : exact(BigInt(available.cents) - BigInt(totalDebt.cents));

  const owing = natures.filter((n) => n.debt.cents !== 0);
  const unranked = owing.filter((n) => n.rank === null);
  let rankView: Extract<CrisisPosition, { kind: "value" }>["ranks"];
  if (totalDebt.cents === null) rankView = { kind: "nd", reason: "Répartition par rang non calculable : le total des dettes est n.d." };
  else if (unranked.length) rankView = { kind: "nd", reason: `Rang non choisi pour : ${unranked.map((n) => n.label).join(", ")}. Aucun rang n’est supposé.` };
  else rankView = {
    kind: "value",
    totals: RANKS.map((rank) => {
      const members = owing.filter((n) => n.rank === rank.id);
      return { id: rank.id, label: rank.label, natures: members.map((n) => n.label), total: exact(members.reduce((total, n) => total + BigInt(n.debt.cents!), 0n)) };
    }),
  };

  const warnings: string[] = [];
  const suppliers = all.filter((g) => natureOf(g.accountId) === "suppliers" && !g.accountId.startsWith("408") && !g.accountId.startsWith("409"));
  if (suppliers.length && suppliers.every((g) => g.auxiliary === null)) warnings.push("Comptes fournisseurs sans compte auxiliaire dans ce FEC : le solde est lu par compte collectif, où les soldes débiteurs et créditeurs des tiers sont déjà compensés.");
  if (all.some((g) => g.accountId.startsWith("408") && g.balance !== 0n)) warnings.push("Les factures non parvenues (compte 408) sont incluses dans les dettes fournisseurs : ce sont des charges à payer, pas des factures reçues.");
  if (overdrawn.length) warnings.push("Au moins un compte de trésorerie est créditeur : il est classé en dette bancaire et ne réduit pas les disponibilités.");

  return {
    kind: "value", asOf, lineCount,
    cash: { available, items: cashBroken ? [] : items(positive, 1n), net: cashBroken ? nd(BROKEN) : sum(cashGroups, 1n) },
    securities: securitiesBroken ? nd(BROKEN) : exact(securities),
    natures, totalDebt, coverage, ranks: rankView, warnings,
  };
}
