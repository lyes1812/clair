import { isMonth } from "@/lib/connectors/months";
import { sumPayrollItemAmounts, type PayrollItemMoney, type PayrollItemRow, type PayrollItemRubric, type PayrollItemsModel } from "./payroll-items";

export type SalaryAnalysisPerson = {
  personKey: string;
  contractKeys: string[];
  sourceRows: number;
  amount: PayrollItemMoney;
};

export type SalaryAnalysis = {
  kind: "value" | "partial" | "nd";
  reason: string | null;
  source: PayrollItemsModel["source"];
  month: string;
  currency: "EUR";
  rubricKey: string;
  label: string;
  rubrics: Pick<PayrollItemRubric, "key" | "label">[];
  coverage: {
    status: PayrollItemsModel["coverage"]["status"];
    selectedRows: number;
    linkedRows: number;
    unlinkedRows: number;
    missingAmountRows: number;
    unknownTypeRows: number;
    persons: number;
    valuedPersons: number;
  };
  persons: SalaryAnalysisPerson[];
  totalSource: PayrollItemMoney;
  totalLinked: PayrollItemMoney;
  mean: PayrollItemMoney;
  median: PayrollItemMoney;
};

const nd = (reason: string): PayrollItemMoney => ({ kind: "nd", reason });
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const precise = (n: bigint): PayrollItemMoney => n > MAX_SAFE || n < -MAX_SAFE
  ? nd("Montant hors de la précision entière prise en charge.")
  : { kind: "value", cents: Number(n) };
const hasAmount = (row: PayrollItemRow) => row.amount.kind === "value" && Number.isSafeInteger(row.amount.cents);
const linked = (row: PayrollItemRow) => row.attachment === "linked" && Boolean(row.personKey) && Boolean(row.contractKey);

// Division exacte puis arrondi au centime le plus proche ; les demis s'éloignent
// de zéro. L'intermédiaire reste entier, même aux bornes des nombres sûrs JS.
function rounded(num: bigint, den: bigint): PayrollItemMoney {
  const abs = num < 0n ? -num : num;
  const whole = abs / den;
  const rest = abs % den;
  return precise((num < 0n ? -1n : 1n) * (whole + (rest * 2n >= den ? 1n : 0n)));
}

/**
 * Rémunérations mensuelles observées, regroupées par personne exactement liée.
 * PayFit : seulement les rubriques « brut » de la grille ; DSN : seulement 001.
 * Les occurrences/fractions distinctes et tous les contrats restent additionnés.
 * Il n'y a ni annualisation, ni division par ETP, ni salaire de base reconstitué.
 * Le constructeur source a déjà sélectionné et dédupliqué les occurrences DSN.
 */
export function salaryAnalysis(model: PayrollItemsModel, rubricKey = ""): SalaryAnalysis {
  const rubrics = model.rubrics.filter((r) => model.source === "payfit" ? r.role === "brut" : model.source === "dsn" && r.key === "dsn:001")
    .map(({ key, label }) => ({ key, label }));
  const selected = rubrics.find((r) => r.key === rubricKey);
  const result: SalaryAnalysis = {
    kind: "nd", reason: null, source: model.source, month: model.month, currency: "EUR", rubricKey,
    label: selected?.label ?? (model.source === "dsn" ? "001 · Rémunération brute non plafonnée" : "Ensemble du brut observé"), rubrics,
    coverage: { status: model.coverage.status, selectedRows: 0, linkedRows: 0, unlinkedRows: 0, missingAmountRows: 0, unknownTypeRows: 0, persons: 0, valuedPersons: 0 },
    persons: [], totalSource: nd("Aucune occurrence source pour cette sélection."), totalLinked: nd("Aucune personne rattachée pour cette sélection."),
    mean: nd("Aucune personne rattachée pour cette sélection."), median: nd("Aucune personne rattachée pour cette sélection."),
  };
  const unavailable = (reason: string): SalaryAnalysis => ({ ...result, reason,
    totalSource: nd(reason), totalLinked: nd(reason), mean: nd(reason), median: nd(reason) });

  if (model.source !== "payfit" && model.source !== "dsn") return unavailable(model.reason ?? "Aucune source RH retenue pour cette analyse.");
  if (model.coverage.status !== "complete") return unavailable(model.coverage.reason ?? "Couverture source incomplète : l’analyse des rémunérations n’est pas calculée.");
  if (model.kind !== "value") return unavailable(model.reason ?? "Aucune rémunération disponible pour ce mois.");
  if (!isMonth(model.month)) return unavailable("Mois invalide.");
  if (rubricKey && !selected) return unavailable(model.source === "dsn"
    ? "Seule la rémunération brute non plafonnée DSN (001) peut être analysée ; les types ne sont pas additionnés."
    : "Rubrique brute absente de la source pour ce mois.");

  const keys = new Set(rubricKey ? [rubricKey] : rubrics.map((r) => r.key));
  const rows = model.rows.filter((r) => keys.has(r.rubricKey));
  result.coverage.unknownTypeRows = model.source === "dsn" ? model.rows.filter((r) => r.rubricKey === "dsn:nd").length : 0;
  if (!rows.length) return unavailable(result.coverage.unknownTypeRows
    ? "Type de rémunération absent dans la DSN : aucune occurrence 001 connue, l’analyse exhaustive est impossible."
    : "Aucune occurrence de rémunération brute pour cette sélection. L’absence d’occurrence ne vaut pas zéro.");

  const linkedRows = rows.filter(linked);
  const groups = new Map<string, PayrollItemRow[]>();
  for (const row of linkedRows) {
    const group = groups.get(row.personKey!);
    if (group) group.push(row);
    else groups.set(row.personKey!, [row]);
  }
  result.persons = [...groups].map(([personKey, personRows]) => ({ personKey,
    contractKeys: [...new Set(personRows.map((r) => r.contractKey!))].sort(), sourceRows: personRows.length,
    amount: sumPayrollItemAmounts(personRows),
  })).sort((a, b) => a.personKey.localeCompare(b.personKey));
  result.coverage = { ...result.coverage, selectedRows: rows.length, linkedRows: linkedRows.length,
    unlinkedRows: rows.length - linkedRows.length, missingAmountRows: rows.filter((r) => !hasAmount(r)).length,
    persons: result.persons.length, valuedPersons: result.persons.filter((p) => p.amount.kind === "value").length };
  result.totalSource = sumPayrollItemAmounts(rows);
  result.totalLinked = sumPayrollItemAmounts(linkedRows);

  // Un sous-ensemble connu ne représente jamais silencieusement toute la
  // population : les totaux lisibles restent identifiés, les statistiques ferment.
  const reasons: string[] = [];
  if (result.coverage.unknownTypeRows) reasons.push("Type de rémunération absent pour certaines occurrences DSN : l’exhaustivité du type 001 ne peut pas être établie.");
  if (result.coverage.unlinkedRows) reasons.push(`${result.coverage.unlinkedRows} ligne(s) sans rattachement certain à une personne et à un contrat.`);
  if (result.coverage.missingAmountRows) reasons.push(`${result.coverage.missingAmountRows} ligne(s) sans montant entier exploitable.`);
  if (!result.persons.length) reasons.push("Aucune personne rattachée pour cette sélection.");
  if (result.coverage.valuedPersons !== result.coverage.persons && !result.coverage.missingAmountRows) reasons.push("Un total individuel dépasse la précision entière prise en charge.");
  if (result.totalSource.kind === "nd" && !result.coverage.missingAmountRows) reasons.push(result.totalSource.reason);
  if (result.totalLinked.kind === "nd" && result.persons.length && !result.coverage.missingAmountRows && result.totalSource.kind !== "nd") reasons.push(result.totalLinked.reason);
  if (reasons.length) {
    const reason = [...new Set(reasons)].join(" ");
    return { ...result, kind: "partial", reason, mean: nd(reason), median: nd(reason) };
  }

  const amounts: bigint[] = [];
  for (const person of result.persons) {
    if (person.amount.kind !== "value") return { ...result, kind: "partial", reason: person.amount.reason, mean: person.amount, median: person.amount };
    amounts.push(BigInt(person.amount.cents));
  }
  amounts.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  // L'absence de personne et les montants n.d. sont déjà bloqués ci-dessus.
  const middle = Math.floor(amounts.length / 2);
  result.mean = rounded(amounts.reduce((sum, amount) => sum + amount, 0n), BigInt(amounts.length));
  result.median = amounts.length % 2 ? precise(amounts[middle]) : rounded(amounts[middle - 1] + amounts[middle], 2n);
  return { ...result, kind: "value", reason: null };
}
