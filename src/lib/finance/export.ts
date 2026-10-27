import { monthRange } from "@/lib/connectors/months";
import { safeText } from "@/lib/export/safe-text";
import type { ColumnSpec, ExportCell, SheetSpec, WorkbookSpec } from "@/lib/export/xlsx";
import type { loadFinanceContext } from "./context";
import { FINANCE_ROWS, type FinanceAccount, type FinanceActuals, type FinanceCell, type FinanceMonth, type FinancePlan, type FinanceRowId } from "./types";

export type FinanceExportContext = Pick<Awaited<ReturnType<typeof loadFinanceContext>>,
  "workspaceName" | "year" | "from" | "to" | "actuals" | "previous" | "selectedPlan" | "projection" | "selectedBudget" | "budgetMonths" | "mappings" | "revision" | "source"
> & { generatedAt: string };

type RowId = FinanceRowId | "result";
type Fact = {
  section: string; month: string; label: string;
  actual?: FinanceCell; previous?: FinanceCell; plan?: FinanceCell; budget?: FinanceCell; gap?: FinanceCell;
  note?: string;
};
const ROWS = [...FINANCE_ROWS, { id: "result", label: "Résultat", kind: "result" }] as const;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const nd = (reason: string): FinanceCell => ({ cents: null, reason });
const checked = (cell: FinanceCell | undefined): FinanceCell => cell?.cents === null || cell === undefined
  ? nd(cell?.reason || "Donnée financière non disponible pour ce mois.")
  : Number.isSafeInteger(cell.cents)
    ? { cents: cell.cents === 0 ? 0 : cell.cents, reason: cell.reason }
    : nd("Montant hors des centimes entiers sûrs.");
const safeSum = (value: bigint, reason: string): FinanceCell => value > MAX || value < -MAX
  ? nd(reason) : { cents: Number(value), reason: null };

function sum(cells: FinanceCell[]): FinanceCell {
  const values = cells.map(checked);
  if (!values.length || values.some((cell) => cell.cents === null)) return nd("Total non calculable : au moins un mois est n.d. ; aucun total partiel.");
  return safeSum(values.reduce((total, cell) => total + BigInt(cell.cents!), 0n), "Total hors des centimes entiers sûrs.");
}

function difference(real: FinanceCell, budget: FinanceCell): FinanceCell {
  const a = checked(real), b = checked(budget);
  if (a.cents === null || b.cents === null) return nd("Écart non calculable : réel ou budget n.d.");
  return safeSum(BigInt(a.cents) - BigInt(b.cents), "Écart hors des centimes entiers sûrs.");
}

const at = (months: FinanceMonth[] | null, month: string, row: RowId): FinanceCell => {
  const value = months?.find((entry) => entry.month === month);
  return checked(row === "result" ? value?.result : value?.cells[row]);
};
const previousMonth = (month: string) => `${Number(month.slice(0, 4)) - 1}-${month.slice(5)}`;
const periodLabel = (months: string[]) => `Total ${months[0] ?? "période"} → ${months.at(-1) ?? "période"}`;
const rowLabel = (row: FinanceRowId) => FINANCE_ROWS.find((entry) => entry.id === row)!.label;

function financialFacts(ctx: FinanceExportContext, months: string[]): Fact[] {
  const facts: Fact[] = [];
  for (const month of months) for (const row of ROWS) {
    const actual = at(ctx.actuals.months, month, row.id);
    const budget = ctx.selectedBudget ? at(ctx.budgetMonths, month, row.id) : undefined;
    facts.push({
      section: "Compte de résultat", month, label: row.label, actual,
      previous: at(ctx.previous.months, previousMonth(month), row.id),
      plan: ctx.selectedPlan ? at(ctx.projection, month, row.id) : undefined,
      budget, gap: budget ? difference(actual, budget) : undefined,
    });
  }
  return [...facts, ...ROWS.map((row): Fact => {
    const values = facts.filter((fact) => fact.label === row.label);
    return {
      section: "Compte de résultat", month: periodLabel(months), label: row.label,
      actual: sum(values.map((value) => value.actual!)), previous: sum(values.map((value) => value.previous!)),
      plan: ctx.selectedPlan ? sum(values.map((value) => value.plan!)) : undefined,
      budget: ctx.selectedBudget ? sum(values.map((value) => value.budget!)) : undefined,
      gap: ctx.selectedBudget ? sum(values.map((value) => value.gap!)) : undefined,
    };
  })];
}

function accountCell(model: FinanceActuals, account: FinanceAccount | undefined, month: string): FinanceCell {
  if (account) return checked(account.months[month]);
  const completeMonth = at(model.months, month, "result");
  return completeMonth.cents === null ? nd("Compte sans activité identifiable dans un mois comptable n.d.")
    : { cents: 0, reason: "Aucune écriture de ce compte dans le mois comptable lu." };
}

function accountFacts(ctx: FinanceExportContext, months: string[]): Fact[] {
  const codes = [...new Set([...ctx.actuals.accounts, ...ctx.previous.accounts].map((account) => account.account))].sort();
  return codes.flatMap((code) => {
    const current = ctx.actuals.accounts.find((account) => account.account === code);
    const prior = ctx.previous.accounts.find((account) => account.account === code);
    const label = `${code} · ${rowLabel((current ?? prior)!.row)}`;
    const facts: Fact[] = months.map((month) => ({
      section: "Comptes détaillés", month, label,
      actual: accountCell(ctx.actuals, current, month), previous: accountCell(ctx.previous, prior, previousMonth(month)),
    }));
    return [...facts, {
      section: "Comptes détaillés", month: periodLabel(months), label,
      actual: sum(facts.map((fact) => fact.actual!)), previous: sum(facts.map((fact) => fact.previous!)),
    }];
  });
}

function annualFacts(ctx: FinanceExportContext): Fact[] {
  if (!ctx.selectedPlan) return [];
  const months = monthRange(`${ctx.selectedPlan.year}-01`, `${ctx.selectedPlan.year}-12`);
  const facts: Fact[] = months.flatMap((month) => ROWS.map((row) => {
    const model = ctx.projection?.find((entry) => entry.month === month);
    const origin = model?.origin === "actual" ? "réel comptable" : model?.origin === "plan" ? "hypothèses du plan" : "origine indisponible";
    const personnel = model?.personnelOrigin === "rh" ? "scénario RH" : model?.personnelOrigin === "manual" ? "saisie manuelle" : model?.personnelOrigin === "accounting" ? "comptabilité" : "indisponible";
    return { section: "Plan annuel — janvier à décembre", month, label: row.label, plan: at(ctx.projection, month, row.id), note: `Origine : ${origin} ; personnel : ${personnel}.` };
  }));
  return [...facts, ...ROWS.map((row): Fact => ({
    section: "Plan annuel — janvier à décembre", month: `Total annuel ${ctx.selectedPlan!.year}-01 → ${ctx.selectedPlan!.year}-12`, label: row.label,
    plan: sum(facts.filter((fact) => fact.label === row.label).map((fact) => fact.plan!)),
  }))];
}

function observations(fact: Fact): string {
  const labels = { actual: "Réel", previous: "N-1", plan: "Plan", budget: "Budget", gap: "Écart" } as const;
  return [...Object.entries(labels).flatMap(([key, label]) => {
    const cell = fact[key as keyof typeof labels];
    const reason = cell && checked(cell).reason;
    return reason ? [`${label} : ${reason}`] : [];
  }), ...(fact.note ? [fact.note] : [])].join(" | ");
}

const money = (cell: FinanceCell | undefined): ExportCell => cell === undefined ? "" : checked(cell).cents ?? { nd: checked(cell).reason! };
const moneyColumn = (header: string, key: string): ColumnSpec => ({ header, key, kind: "eur", width: 20 });
const textColumn = (header: string, key: string, width = 26): ColumnSpec => ({ header, key, kind: "text", width });

function factSheet(name: string, facts: Fact[], keys: ("actual" | "previous" | "plan" | "budget" | "gap")[], note: string): SheetSpec {
  const labels = { actual: "Réel EUR", previous: "N-1 EUR", plan: "Plan sélectionné EUR", budget: "Budget EUR", gap: "Écart réel − budget EUR" };
  return {
    name, note,
    columns: [textColumn("Mois / total", "month"), textColumn("Ligne / compte", "line", 38), ...keys.map((key) => moneyColumn(labels[key], key)), textColumn("Observations", "observations", 70)],
    rows: facts.map((fact) => [fact.month, fact.label, ...keys.map((key) => money(fact[key])), observations(fact)]),
  };
}

function planDetail(plan: FinancePlan): string {
  return `${plan.name} ; ${plan.kind === "budget" ? "budget" : "prévision"} ${plan.year} ; bascule : ${plan.firstForecastMonth ?? "sans objet (budget annuel)"} ; personnel : ${plan.personnelSource === "rh" ? `scénario RH ${plan.rhScenarioId ?? "non renseigné"}` : "saisie manuelle"}.`;
}

function sourceLabel(ctx: FinanceExportContext): string {
  const names = { pennylane: "Pennylane", fec: "Upload FEC", payfit: "PayFit", dsn: "Upload DSN" };
  return ctx.source.chosen ? names[ctx.source.chosen] : "Aucune source retenue";
}

const appliedAt = (ctx: FinanceExportContext): string | null => ctx.source.appliedAt && Number.isFinite(ctx.source.appliedAt.getTime()) ? ctx.source.appliedAt.toISOString() : null;
const SIGN_RULE = "Produits : crédit − débit ; charges : débit − crédit ; résultat : chiffre d’affaires + autres produits − personnel − autres charges. Le sens suit la ligne de destination après correspondance.";
const COVERAGE_RULE = "La couverture d’un mois indique une lecture appliquée, pas une clôture comptable. Aucun axe par service n’est fourni par cette lecture.";
const UNKNOWN_RULE = "n.d. n’est jamais zéro. Un zéro n’est admis que dans un mois comptable lu sans activité sur la ligne. Aucun total partiel si un mois est n.d.";

function mappingRows(ctx: FinanceExportContext): string[][] {
  return [
    ["Défaut", "70…", "Chiffre d’affaires", "crédit − débit"],
    ["Défaut", "64…", "Charges de personnel", "débit − crédit"],
    ["Défaut", "6… hors 64…", "Autres charges", "débit − crédit"],
    ["Défaut", "7… hors 70…", "Autres produits", "crédit − débit"],
    ...ctx.mappings.map((mapping) => ["Compte exact (prioritaire)", mapping.account, rowLabel(mapping.row), FINANCE_ROWS.find((row) => row.id === mapping.row)!.kind === "income" ? "crédit − débit" : "débit − crédit"]),
  ];
}

/** Description pure : les mêmes modèles que l’écran, sans lecture de base ni horloge interne. */
export function financeWorkbook(ctx: FinanceExportContext): WorkbookSpec {
  const months = monthRange(ctx.from, ctx.to);
  const period = financialFacts(ctx, months);
  const keys: ("actual" | "previous" | "plan" | "budget" | "gap")[] = ["actual", "previous", ...(ctx.selectedPlan ? ["plan" as const] : [])];
  const sheets: SheetSpec[] = [
    factSheet("Réel et comparaison", period, keys, `Période ${ctx.from} → ${ctx.to} ; N-1 : ${previousMonth(ctx.from)} → ${previousMonth(ctx.to)}. ${SIGN_RULE}`),
    factSheet("Comptes détaillés", accountFacts(ctx, months), ["actual", "previous"], "Uniquement les comptes de classes 6 et 7 réellement présents dans les modèles des deux années. Totaux limités à la période sélectionnée, sans comptes créés par les correspondances."),
  ];
  if (ctx.selectedBudget) sheets.push(factSheet("Budget et écarts", period, ["actual", "budget", "gap"], `Budget choisi : ${ctx.selectedBudget.name}. Écart = réel − budget, sans qualification favorable ou défavorable implicite.`));
  if (ctx.selectedPlan) sheets.push(factSheet("Plan annuel", annualFacts(ctx), ["plan"], `Périmètre annuel distinct des filtres : janvier à décembre ${ctx.selectedPlan.year}. ${planDetail(ctx.selectedPlan)}`));
  sheets.push({ name: "Modèle", columns: [textColumn("Règle", "rule"), textColumn("Compte / préfixe", "account"), textColumn("Ligne de gestion", "row", 38), textColumn("Sens", "sign")], rows: mappingRows(ctx), note: `Révision ${ctx.revision}. Une correspondance exacte est prioritaire ; les comptes de bilan (classes 1 à 5) restent exclus. Aucune correspondance ne crée de compte.` });
  return {
    title: "Studio Finance — réel, comparaison et plans", workspaceName: ctx.workspaceName, generatedAt: ctx.generatedAt,
    filters: [
      { label: "Période", value: `${ctx.from} → ${ctx.to}` }, { label: "Comparaison N-1", value: `${previousMonth(ctx.from)} → ${previousMonth(ctx.to)}` },
      { label: "Devise", value: "EUR" }, { label: "Révision du modèle", value: String(ctx.revision) },
      { label: "Plan", value: ctx.selectedPlan ? planDetail(ctx.selectedPlan) : "Aucun plan sélectionné" },
      { label: "Budget comparatif", value: ctx.selectedBudget ? planDetail(ctx.selectedBudget) : "Aucun budget sélectionné" },
      ...(ctx.selectedPlan ? [{ label: "Feuille Plan annuel", value: `${ctx.selectedPlan.year}-01 → ${ctx.selectedPlan.year}-12 (périmètre distinct)` }] : []),
    ], sheets,
    sources: [
      { label: "Lecture comptable appliquée", detail: `${sourceLabel(ctx)} — source retenue dans Données. ${COVERAGE_RULE}`, syncedAt: appliedAt(ctx), status: ctx.source.chosen && appliedAt(ctx) ? "Lecture appliquée" : "Lecture non datée ou indisponible" },
      { label: "Modèle de gestion", detail: `Révision ${ctx.revision} ; ${ctx.mappings.length} correspondance(s) exacte(s). Voir la feuille Modèle.`, syncedAt: null, status: "Règles appliquées aux deux années" },
      ...(ctx.selectedPlan ? [{ label: "Plan sélectionné", detail: planDetail(ctx.selectedPlan), syncedAt: ctx.selectedPlan.updatedAt, status: "Version explicitement choisie" }] : []),
      ...(ctx.selectedBudget ? [{ label: "Budget comparatif", detail: planDetail(ctx.selectedBudget), syncedAt: ctx.selectedBudget.updatedAt, status: "Version explicitement choisie" }] : []),
    ],
    definitions: [
      { term: "Signes et résultat", definition: SIGN_RULE, formula: "Résultat = CA + autres produits − personnel − autres charges" },
      { term: "Écart en montant", definition: "Valeur signée sans qualification favorable/défavorable implicite ; non calculable si un des termes manque.", formula: "Réel − budget sélectionné" },
      { term: "Couverture", definition: COVERAGE_RULE }, { term: "Données absentes et totaux", definition: UNKNOWN_RULE },
      { term: "Prévision annuelle", definition: "Avant la bascule du plan : réel comptable, même incomplet ; à partir de la bascule : hypothèses. La feuille annuelle couvre janvier à décembre, séparément de la période filtrée." },
      { term: "Lien RH", definition: "Le scénario RH explicitement choisi remplace uniquement la ligne de personnel projetée ; il ne s’ajoute ni au personnel saisi ni au réel comptable. Son identifiant figure dans les sources du plan." },
      { term: "Unités", definition: "Tous les montants sont en EUR, au centime. Les nombres Excel restent numériques ; l’affichage arrondi du site ne change pas cet export." },
    ],
  };
}

function decimal(cell: FinanceCell | undefined): string {
  if (cell === undefined) return "";
  const value = checked(cell).cents;
  if (value === null) return "n.d.";
  const integer = BigInt(value), absolute = integer < 0n ? -integer : integer;
  return `${integer < 0n ? "-" : ""}${absolute / 100n},${String(absolute % 100n).padStart(2, "0")}`;
}
const csvText = (value: string) => `"${safeText(value).replaceAll('"', '""')}"`;

/** CSV long unique : les colonnes numériques restent en EUR au centime, jamais en k€. */
export function financeCsv(ctx: FinanceExportContext): string {
  const spec = financeWorkbook(ctx);
  const facts: Fact[] = [
    ...financialFacts(ctx, monthRange(ctx.from, ctx.to)), ...accountFacts(ctx, monthRange(ctx.from, ctx.to)), ...annualFacts(ctx),
    { section: "Provenance", month: "", label: "Espace", note: ctx.workspaceName },
    { section: "Provenance", month: "", label: "Généré le", note: ctx.generatedAt },
    ...spec.filters.map((filter): Fact => ({ section: "Filtres", month: "", label: filter.label, note: filter.value })),
    ...spec.sources.map((source): Fact => ({ section: "Provenance", month: "", label: source.label, note: `${source.detail} Date appliquée : ${source.syncedAt ?? "n.d."}. Statut : ${source.status}.` })),
    ...mappingRows(ctx).map(([rule, account, row, sign]): Fact => ({ section: "Modèle", month: "", label: `${rule} · ${account}`, note: `${row} ; ${sign}` })),
    ...spec.definitions.map((definition): Fact => ({ section: "Règles", month: "", label: definition.term, note: `${definition.definition}${definition.formula ? ` Formule : ${definition.formula}.` : ""}` })),
  ];
  const header = ["section", "mois", "ligne", "réel EUR", "N-1 EUR", "plan EUR", "budget EUR", "écart EUR", "raison"];
  const rows = facts.map((fact) => [fact.section, fact.month, fact.label, decimal(fact.actual), decimal(fact.previous), decimal(fact.plan), decimal(fact.budget), decimal(fact.gap), observations(fact)]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvText).join(";")).join("\r\n")}\r\n`;
}
