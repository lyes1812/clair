import { isMonth } from "@/lib/connectors/months";
import { classify, gridRubrics, type RubricRole } from "@/lib/payroll/grid";
import type { JournalInput } from "@/lib/payroll/engine";
import type { CoverageRow } from "@/lib/dsn/selection";
import type { ContractDraft, PersonDraft, RhSource } from "./referential/types";

// Exploration du réalisé individuel. Les familles comptables PayFit et les types de
// rémunération DSN restent distincts : aucun détail de bulletin n'est reconstitué.
export type PayrollItemMoney = { kind: "value"; cents: number } | { kind: "nd"; reason: string };
export type PayrollItemRubric = { key: string; label: string; role: RubricRole | "non-classe" | "dsn" };
export type PayrollItemProvenance = { recordId: string; syncId: string | null; period: string; path: string };
export type PayrollItemRow = {
  id: string;
  attachment: "linked" | "no-contract" | "unlinked";
  personKey: string | null;
  personLabel: string | null;
  contractKey: string | null;
  contractLabel: string | null;
  rubricKey: string;
  rubricLabel: string;
  amount: PayrollItemMoney;
  operationDate: string | null;
  paymentDate: string | null;
  startDate: string | null;
  endDate: string | null;
  accountId: string | null;
  accountLabel: string | null;
  provenance: PayrollItemProvenance[];
};
export type PayrollItemsModel = {
  source: RhSource | null;
  month: string;
  kind: "value" | "nd";
  reason: string | null;
  readAt: string | null;
  currency: "EUR";
  coverage: { status: "complete" | "incomplete" | "blocked" | "missing"; reason: string | null };
  rubrics: PayrollItemRubric[];
  rows: PayrollItemRow[];
  totals: { rubricKey: string; label: string; amount: PayrollItemMoney }[];
  notices: string[];
  sourceRows: number;
  filter: { q: string; rubricKey: string };
};
export type PayrollItemsRh = {
  source?: RhSource;
  build?: { source: RhSource; inputs?: { source: RhSource; syncId?: string } };
  persons: Pick<PersonDraft, "personKey" | "familyName" | "givenNames" | "provenance">[];
  contracts: Pick<ContractDraft, "contractKey" | "externalId" | "personKey">[];
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const nd = (reason: string): PayrollItemMoney => ({ kind: "nd", reason });
const value = (n: bigint): PayrollItemMoney => n > MAX_SAFE || n < -MAX_SAFE
  ? nd("Montant hors de la précision entière prise en charge.") : { kind: "value", cents: Number(n) };
const exact = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

// La conversion centimes / 100 en nombre flottant peut perdre un centime près de
// MAX_SAFE_INTEGER. Le format individuel reste exact, y compris à cette borne.
export function formatPayrollItemCents(cents: number): string {
  if (!exact(cents)) return "n.d.";
  const integer = BigInt(cents);
  const absolute = integer < 0n ? -integer : integer;
  return `${integer < 0n ? "−" : ""}${new Intl.NumberFormat("fr-FR").format(absolute / 100n)},${String(absolute % 100n).padStart(2, "0")}\u00a0€`;
}

export function sumPayrollItemAmounts(rows: readonly Pick<PayrollItemRow, "amount">[]): PayrollItemMoney {
  if (!rows.length) return nd("Aucune occurrence source pour cette sélection.");
  let total = 0n;
  for (const row of rows) {
    if (row.amount.kind === "nd") return nd(row.amount.reason);
    if (!exact(row.amount.cents)) return nd("Montant hors de la précision entière prise en charge.");
    total += BigInt(row.amount.cents);
  }
  return value(total);
}

function totalsFor(rows: PayrollItemRow[], rubrics: PayrollItemRubric[]): PayrollItemsModel["totals"] {
  const grouped = new Map<string, PayrollItemRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.rubricKey);
    if (group) group.push(row);
    else grouped.set(row.rubricKey, [row]);
  }
  return rubrics.map((rubric) => ({ rubricKey: rubric.key, label: rubric.label,
    amount: rubric.key === "dsn:nd" ? nd("Type de rémunération absent : agrégation impossible.") : sumPayrollItemAmounts(grouped.get(rubric.key) ?? []) }));
}

export function payrollItemsUnavailable(source: RhSource | null, month: string, reason: string, status: PayrollItemsModel["coverage"]["status"] = "missing"): PayrollItemsModel {
  return { source, month, kind: "nd", reason, readAt: null, currency: "EUR", coverage: { status, reason },
    rubrics: [], rows: [], totals: [], notices: [], sourceRows: 0, filter: { q: "", rubricKey: "" } };
}

function attachmentResolver(rh: PayrollItemsRh | null, source: RhSource) {
  const empty = { personKey: null, personLabel: null, contractKey: null, contractLabel: null };
  const contracts = new Map<string, PayrollItemsRh["contracts"][number] | null>();
  const persons = new Map<string, PayrollItemsRh["persons"][number] | null>();
  if (rh && (rh.source ?? rh.build?.source) === source) {
    for (const c of rh.contracts) contracts.set(c.contractKey, contracts.has(c.contractKey) ? null : c);
    for (const p of rh.persons) persons.set(p.personKey, persons.has(p.personKey) ? null : p);
  }
  return (sourceContract: string | null, sourcePerson?: string | null): Pick<PayrollItemRow, "attachment" | "personKey" | "personLabel" | "contractKey" | "contractLabel"> => {
  if (!sourceContract) return { ...empty, attachment: "no-contract" };
  // Le constructeur DSN utilise l'identifiant interne du contrat dans contractKey,
  // et son numéro lisible dans externalId. Ces deux valeurs ne sont pas interchangeables.
  const contract = contracts.get(`${source}:${sourceContract}`);
  if (!contract || (source === "payfit" && contract.externalId !== sourceContract)) return { ...empty, attachment: "unlinked" };
  if (!contract.personKey || (source === "dsn" && (!sourcePerson || contract.personKey !== `dsn:${sourcePerson}`))) return { ...empty, attachment: "unlinked" };
  const person = persons.get(contract.personKey);
  if (!person) return { ...empty, attachment: "unlinked" };
  // Un stub créé à partir d'un contrat ne prouve pas qu'une fiche individuelle a
  // été lue. On conserve alors la ligne au journal, sans rattachement nominatif.
  const origin = Object.values(person.provenance).some((p) => p.collection === (source === "payfit" ? "collaborators" : "people"));
  if (!origin) return { ...empty, attachment: "unlinked" };
  return { attachment: "linked", personKey: person.personKey,
    personLabel: [person.familyName, person.givenNames].filter(Boolean).join(" ") || null,
    contractKey: contract.contractKey, contractLabel: contract.externalId };
  };
}

function modelOf(source: RhSource, month: string, rows: PayrollItemRow[], rubrics: PayrollItemRubric[], readAt: string | null, notices: string[]): PayrollItemsModel {
  return { source, month, kind: rows.length ? "value" : "nd", reason: rows.length ? null : "Aucune occurrence de rémunération dans les sources retenues pour ce mois.",
    readAt, currency: "EUR", coverage: { status: "complete", reason: null }, rubrics, rows,
    totals: totalsFor(rows, rubrics), notices, sourceRows: rows.length, filter: { q: "", rubricKey: "" } };
}

export function buildPayfitPayrollItems(input: { month: string; input: JournalInput | null; rh: PayrollItemsRh | null; readAt?: string | null; syncId?: string | null; unavailable?: string | null }): PayrollItemsModel {
  const { month, rh } = input;
  if (!isMonth(month)) return payrollItemsUnavailable("payfit", month, "Mois invalide.");
  const journal = input.input;
  if (!journal) return payrollItemsUnavailable("payfit", month, input.unavailable ?? "Journal comptable PayFit non disponible.");
  if (!journal.months.includes(month)) return payrollItemsUnavailable("payfit", month, "Mois hors de la lecture PayFit appliquée.");
  const monthLines = journal.lines.filter((line) => line.month === month);
  if (!monthLines.length) return payrollItemsUnavailable("payfit", month, "Journal de paie non renvoyé pour ce mois.");
  const rules = gridRubrics(journal.grid);
  const sameRead = Boolean(input.syncId && rh?.build?.source === "payfit" && rh.build.inputs?.source === "payfit" && rh.build.inputs.syncId === input.syncId);
  const attach = attachmentResolver(sameRead ? rh : null, "payfit");
  const known = new Map<string, PayrollItemRubric>();
  const rows: PayrollItemRow[] = [];
  for (const line of monthLines) {
    const classified = classify(line.accountId, rules);
    if (!classified.rubric && !classified.payroll) continue;
    const rubric: PayrollItemRubric = classified.rubric
      ? { key: classified.rubric.id, label: classified.rubric.label, role: classified.rubric.role }
      : { key: "non-classe", label: "Charges de personnel non classées", role: "non-classe" };
    known.set(rubric.key, rubric);
    const amount = line.debitCents === null && line.creditCents === null ? nd("Ligne source sans débit ni crédit.")
      : (line.debitCents !== null && !exact(line.debitCents)) || (line.creditCents !== null && !exact(line.creditCents)) ? nd("Montant hors de la précision entière prise en charge.")
        : value(BigInt(line.debitCents ?? 0) - BigInt(line.creditCents ?? 0));
    rows.push({ id: line.key, ...attach(line.contractId), rubricKey: rubric.key, rubricLabel: rubric.label, amount,
      operationDate: null, paymentDate: null, startDate: null, endDate: null, accountId: line.accountId, accountLabel: line.accountName,
      provenance: [{ recordId: line.key, syncId: input.syncId ?? null, period: month, path: "debitCents − creditCents" }] });
  }
  const rubrics = [...known.values()].sort((a, b) => {
    const order = [...rules.map((r) => r.id), "non-classe"];
    return order.indexOf(a.key) - order.indexOf(b.key);
  });
  const notices = ["Rubriques comptables de la grille de l’espace ; elles ne constituent pas le détail des rubriques de bulletin.",
    "Une ligne sans contrat ou sans correspondance exacte reste affichée sans ventilation individuelle."];
  if (!sameRead) notices.push("Le référentiel RH et le journal ne correspondent pas à la même lecture PayFit vérifiable. Les montants restent non rattachés ; recharge la page.");
  if (journal.openMonths.includes(month)) notices.push("Paie non clôturée à la lecture : montants provisoires.");
  return modelOf("payfit", month, rows, rubrics, input.readAt ?? null, notices);
}

// Entrées minimales, réservées au serveur. declarationKey/personId/contractId ne
// sont jamais recopiés vers le DTO en dehors des clés RH déjà autorisées.
export type DsnPayrollItemRecord = {
  id: string; syncId: string; declarationKey: string; month: string;
  personId: string | null; contractId: string | null; type: string | null;
  amountCents: number | string | null; paymentDate: string | null; startDate: string | null; endDate: string | null;
};
export type DsnPayrollItemCoverage = Pick<CoverageRow, "month" | "status"> & { selected: { key: string; sourceId: string }[] };

function dsnAmount(cents: DsnPayrollItemRecord["amountCents"]): PayrollItemMoney {
  if (cents === null) return nd("Montant de rémunération absent.");
  if (exact(cents)) return value(BigInt(cents));
  if (typeof cents === "string" && cents.length <= 100 && /^-?\d+$/.test(cents)) return value(BigInt(cents));
  return nd("Montant hors de la précision entière prise en charge.");
}

export function buildDsnPayrollItems(input: { month: string; records: DsnPayrollItemRecord[]; coverage: DsnPayrollItemCoverage[]; rh: PayrollItemsRh | null; readAt?: string | null }): PayrollItemsModel {
  const { month } = input;
  if (!isMonth(month)) return payrollItemsUnavailable("dsn", month, "Mois invalide.");
  const coverage = input.coverage.filter((c) => c.month === month);
  if (!coverage.length) return payrollItemsUnavailable("dsn", month, "Aucune DSN appliquée ne couvre ce mois.");
  if (coverage.some((c) => c.status === "blocked")) return payrollItemsUnavailable("dsn", month, "Couverture DSN bloquée : aucune rémunération partielle n’est présentée comme un réalisé complet.", "blocked");
  if (coverage.some((c) => c.status !== "complete" || !c.selected.length)) return payrollItemsUnavailable("dsn", month, "Couverture DSN incomplète : les rémunérations partielles ne sont pas agrégées.", "incomplete");
  const selected = new Set(coverage.flatMap((c) => c.selected.map((d) => `${d.sourceId}\u0000${d.key}`)));
  const rubrics = new Map<string, PayrollItemRubric>();
  const attach = attachmentResolver(input.rh, "dsn");
  const rows: PayrollItemRow[] = [];
  const seen = new Set<string>();
  for (const record of input.records) {
    if (record.month !== month || !selected.has(`${record.syncId}\u0000${record.declarationKey}`)) continue;
    // Seule une même occurrence physique reçue deux fois est dédupliquée. Des
    // versements ou fractions distincts, même de montants égaux, restent distincts.
    const identity = `${record.syncId}\u0000${record.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const type = record.type && /^\d{3}$/.test(record.type) ? record.type : null;
    const rubric: PayrollItemRubric = { key: `dsn:${type ?? "nd"}`, label: type === "001" ? "001 · Rémunération brute non plafonnée" : type ? `${type} · Rémunération DSN (S21.G00.51)` : "Type de rémunération DSN n.d.", role: "dsn" };
    rubrics.set(rubric.key, rubric);
    rows.push({ id: record.id, ...attach(record.contractId, record.personId),
      rubricKey: rubric.key, rubricLabel: rubric.label, amount: dsnAmount(record.amountCents),
      operationDate: null, paymentDate: record.paymentDate, startDate: record.startDate, endDate: record.endDate, accountId: null, accountLabel: null,
      provenance: [{ recordId: record.id, syncId: record.syncId, period: month, path: "S21.G00.51.013" }] });
  }
  return modelOf("dsn", month, rows, [...rubrics.values()].sort((a, b) => a.key.localeCompare(b.key)), input.readAt ?? null,
    ["Rémunérations S21.G00.51 des déclarations retenues ; chaque type est présenté séparément et les types ne sont jamais additionnés.",
      "Période de rémunération et date de versement sont conservées : le mois déclaré peut contenir une régularisation.",
      "Primes S21.G00.52 et cotisations non extraites par l’import actuel."]);
}

const searchable = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
export function filterPayrollItems(model: PayrollItemsModel, filters: { q?: string; query?: string; rubricKey?: string }): PayrollItemsModel {
  const q = (filters.q ?? filters.query ?? "").trim().slice(0, 80);
  const rubricKey = filters.rubricKey ?? "";
  const exists = !rubricKey || model.rubrics.some((r) => r.key === rubricKey);
  if (!exists) return { ...model, kind: "nd", reason: "Rubrique absente de la source pour ce mois.", rows: [], totals: [], filter: { q, rubricKey } };
  const query = searchable(q);
  const rows = model.rows.filter((r) => (!rubricKey || r.rubricKey === rubricKey) && (!query || searchable([
    r.personLabel, r.contractLabel, r.rubricLabel, r.accountId, r.accountLabel, r.paymentDate, r.startDate, r.endDate,
    r.attachment === "no-contract" ? "Sans contrat" : r.attachment === "unlinked" ? "Contrat non rattaché" : "",
  ].filter(Boolean).join(" ")).includes(query)));
  return { ...model, rows, totals: totalsFor(rows, model.rubrics.filter((r) => !rubricKey || r.key === rubricKey)), filter: { q, rubricKey } };
}
