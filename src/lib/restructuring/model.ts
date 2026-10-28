import { isMonth, monthRange } from "@/lib/connectors/months";
import { hireKey, project } from "@/lib/budget/engine";
import type { BaseSnapshot, Contribution, Conventions, Hypothesis, ProjectedMonth } from "@/lib/budget/types";

export type RestructuringScenario = {
  id: string; name: string; status: string; firstMonth: string; lastMonth: string;
  baseHash: string; base: BaseSnapshot; hypotheses: Hypothesis[]; conventions: Conventions;
};
export type Metric = { value: number | null; reason: string | null };
export type RestructuringMonth = {
  month: string; referenceCost: Metric; proposalCost: Metric; savings: Metric; cumulative: Metric;
  transitionCost: Metric; exitCost: Metric; replacementCost: Metric; referenceEtp4: Metric; proposalEtp4: Metric;
};
export type RestructuringModel = {
  kind: "value" | "nd"; reason: string | null; warnings: string[]; months: RestructuringMonth[];
  totals: { referenceCost: Metric; proposalCost: Metric; savings: Metric; transitionCost: Metric; exitCost: Metric; replacementCost: Metric };
  payback: { month: string | null; reason: string }; endEtpDelta: Metric;
};
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const missing = (reason: string): Metric => ({ value: null, reason });
const known = (value: number): Metric => Number.isSafeInteger(value)
  ? { value: value === 0 ? 0 : value, reason: null }
  : missing("Montant ou effectif hors des entiers sûrs.");
const bounded = (value: bigint): Metric => value > MAX || value < -MAX
  ? missing("Résultat hors des entiers sûrs.") : known(Number(value));
function add(values: Metric[]): Metric {
  if (!values.length || values.some((value) => value.value === null)) return missing("Total non calculable : au moins un mois est n.d. ; aucun total partiel.");
  return bounded(values.reduce((sum, value) => sum + BigInt(value.value!), 0n));
}
function subtract(a: Metric, b: Metric): Metric {
  if (a.value === null || b.value === null) return missing("Écart non calculable : référence ou projet n.d.");
  return bounded(BigInt(a.value) - BigInt(b.value));
}
function refused(reason: string): RestructuringModel {
  return {
    kind: "nd", reason, warnings: [], months: [],
    totals: { referenceCost: missing(reason), proposalCost: missing(reason), savings: missing(reason), transitionCost: missing(reason), exitCost: missing(reason), replacementCost: missing(reason) },
    payback: { month: null, reason }, endEtpDelta: missing(reason),
  };
}

type ReadMonth = { cost: Metric; transition: Metric; exit: Metric; replacement: Metric; etp4: Metric };
function projectionMoneyIssue(month: Extract<ProjectedMonth, { kind: "value" }>): string | null {
  if (!Number.isSafeInteger(month.cost) || month.contributions.some((entry) =>
    !Number.isSafeInteger(entry.cost)
    || entry.brut !== null && !Number.isSafeInteger(entry.brut)
    || entry.charges !== null && !Number.isSafeInteger(entry.charges)
    || entry.nonRecurringCents !== undefined && !Number.isSafeInteger(entry.nonRecurringCents))) return "Projection hors des centimes entiers sûrs.";
  const exactCost = month.contributions.reduce((total, entry) => total + BigInt(entry.cost), 0n);
  return exactCost !== BigInt(month.cost) ? "Agrégat du moteur incohérent avec ses contributions entières." : null;
}

function readMonth(month: ProjectedMonth | undefined, scenario: RestructuringScenario, key: string): ReadMonth {
  const empty = (reason: string): ReadMonth => ({ cost: missing(reason), transition: missing(reason), exit: missing(reason), replacement: missing(reason), etp4: missing(reason) });
  if (!month) return empty("Mois hors de la projection du scénario.");
  if (month.kind === "nd") return empty("Mois non calculable par le moteur de projection : base de coût non renseignée.");
  // Le moteur existant agrège des nombres. Aucune valeur perdant sa précision n'est présentée comme un montant exact.
  const issue = projectionMoneyIssue(month);
  if (issue) return empty(issue);
  const exactCost = month.contributions.reduce((total, entry) => total + BigInt(entry.cost), 0n);
  const replacementKeys = new Set(scenario.hypotheses.flatMap((hypothesis) => hypothesis.kind === "embauche" && hypothesis.replaces !== null ? [hireKey(hypothesis.id)] : []));
  const sum = (pick: (entry: Contribution) => number) => bounded(month.contributions.reduce((total, entry) => total + BigInt(pick(entry)), 0n));
  const unspecifiedExit = scenario.hypotheses.some((hypothesis) => hypothesis.kind === "depart" && hypothesis.lastPaidDate.slice(0, 7) === key && hypothesis.exitCost === null);
  const reason = "Coût de sortie non saisi (exitCost) pour ce mois ; saisir un montant ou un zéro explicite.";
  return {
    cost: unspecifiedExit ? missing(reason) : bounded(exactCost),
    transition: unspecifiedExit ? missing(reason) : sum((entry) => entry.nonRecurringCents ?? 0),
    exit: unspecifiedExit ? missing(reason) : sum((entry) => entry.kind === "sortie" ? entry.cost : 0),
    replacement: sum((entry) => entry.contractKey !== null && replacementKeys.has(entry.contractKey) ? entry.cost : 0),
    etp4: month.etp4 === null ? missing("ETP de fin de mois non renseigné dans la projection.") : known(month.etp4),
  };
}

function payback(months: RestructuringMonth[]): RestructuringModel["payback"] {
  if (!months.length || months.some((month) => month.cumulative.value === null)) return { month: null, reason: "Point mort non calculable : au moins un cumul mensuel est n.d." };
  let hadDeficit = false;
  for (let index = 0; index < months.length; index++) {
    if (months[index].cumulative.value! < 0) hadDeficit = true;
    else if (hadDeficit && months.slice(index).every((month) => month.cumulative.value! >= 0)) {
      return { month: months[index].month, reason: "Premier mois après un déficit cumulé où les économies cumulées restent positives ou nulles jusqu’à la fin de l’horizon comparé." };
    }
  }
  return { month: null, reason: hadDeficit ? "Le déficit cumulé n’est pas résorbé durablement sur l’horizon comparé." : "Aucun déficit cumulé sur l’horizon : pas de délai d’amortissement à calculer." };
}

/** Deux scénarios explicitement choisis ; aucun mouvement supprimé, aucune hypothèse juridique ou indemnité calculée. */
export function buildRestructuring(reference: RestructuringScenario | null, proposal: RestructuringScenario | null): RestructuringModel {
  if (!reference || !proposal) return refused("Choisir explicitement un scénario de référence et un scénario projet.");
  if (reference.id === proposal.id) return refused("Choisir deux scénarios distincts ; dupliquer la référence pour préparer le projet.");
  if (!reference.baseHash || reference.baseHash !== proposal.baseHash) return refused("Les bases figées sont différentes ; dupliquer le scénario de référence pour conserver la même base.");
  if (reference.base.currency !== "EUR" || proposal.base.currency !== "EUR") return refused("La comparaison exige deux scénarios en EUR.");
  if (!isMonth(reference.firstMonth) || !isMonth(reference.lastMonth) || reference.firstMonth > reference.lastMonth
    || reference.firstMonth !== proposal.firstMonth || reference.lastMonth !== proposal.lastMonth) return refused("Les horizons doivent être identiques et valides ; dupliquer le scénario de référence.");
  if (reference.conventions.prorata !== proposal.conventions.prorata) return refused("Les conventions de prorata doivent être identiques ; dupliquer le scénario de référence.");
  let a: ReturnType<typeof project>, b: ReturnType<typeof project>;
  try {
    a = project(reference.base, reference.firstMonth, reference.lastMonth, reference.hypotheses, reference.conventions);
    b = project(proposal.base, proposal.firstMonth, proposal.lastMonth, proposal.hypotheses, proposal.conventions);
  } catch {
    return refused("La projection est refusée : une valeur du scénario ne permet pas un calcul entier sûr.");
  }
  if (a.kind === "error" || b.kind === "error") return refused("La projection de référence ou de projet est refusée par le moteur ; corriger les hypothèses dans le scénario concerné.");
  const warnings: string[] = [];
  for (const [scenario, label] of [[reference, "référence"], [proposal, "projet"]] as const) {
    const exits = scenario.hypotheses.filter((hypothesis) => hypothesis.kind === "depart" && hypothesis.exitCost === null);
    if (exits.some((hypothesis) => hypothesis.kind === "depart" && hypothesis.lastPaidDate.slice(0, 7) >= reference.firstMonth && hypothesis.lastPaidDate.slice(0, 7) <= reference.lastMonth)) warnings.push(`Scénario ${label} : coût de sortie non saisi ; une absence de saisie n’est pas un zéro.`);
    if (exits.some((hypothesis) => hypothesis.kind === "depart" && hypothesis.lastPaidDate.slice(0, 7) > reference.lastMonth)) warnings.push(`Scénario ${label} : coût de sortie non saisi après l’horizon ; il n’est pas évalué dans cette comparaison.`);
  }
  const months: RestructuringMonth[] = [];
  for (const month of monthRange(reference.firstMonth, reference.lastMonth)) {
    const ref = readMonth(a.months.find((entry) => entry.month === month), reference, month);
    const prop = readMonth(b.months.find((entry) => entry.month === month), proposal, month);
    const savings = subtract(ref.cost, prop.cost);
    months.push({
      month, referenceCost: ref.cost, proposalCost: prop.cost, savings,
      cumulative: add([...months.map((entry) => entry.savings), savings]),
      transitionCost: subtract(prop.transition, ref.transition), exitCost: prop.exit, replacementCost: prop.replacement,
      referenceEtp4: ref.etp4, proposalEtp4: prop.etp4,
    });
  }
  if (months.some((month) => [month.referenceCost, month.proposalCost, month.savings, month.transitionCost, month.exitCost, month.replacementCost].some((value) => value.value === null))) warnings.push("Certaines valeurs sont n.d. ; aucun total partiel ni point mort reconstitué n’est affiché.");
  const final = months.at(-1)!;
  return {
    kind: "value", reason: null, warnings, months,
    totals: {
      referenceCost: add(months.map((month) => month.referenceCost)), proposalCost: add(months.map((month) => month.proposalCost)),
      savings: add(months.map((month) => month.savings)), transitionCost: add(months.map((month) => month.transitionCost)),
      exitCost: add(months.map((month) => month.exitCost)), replacementCost: add(months.map((month) => month.replacementCost)),
    },
    payback: payback(months), endEtpDelta: subtract(final.referenceEtp4, final.proposalEtp4),
  };
}

export type BreakdownId = "licenciement" | "rupture-conventionnelle" | "autres-departs" | "autres-non-recurrents";
export type BreakdownRow = { id: BreakdownId; label: string; events: number; total: Metric; months: { month: string; amount: Metric }[] };
const BREAKDOWN_CATEGORIES: { id: BreakdownId; label: string }[] = [
  { id: "licenciement", label: "Licenciements" },
  { id: "rupture-conventionnelle", label: "Ruptures conventionnelles" },
  { id: "autres-departs", label: "Autres départs" },
  { id: "autres-non-recurrents", label: "Autres éléments non récurrents" },
];
type Departure = Extract<Hypothesis, { kind: "depart" }>;
function departureCategory(departure: Departure | undefined): BreakdownId {
  const motif = (departure?.motif ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
  if (motif.startsWith("licenciement")) return "licenciement";
  if (motif.startsWith("rupture conventionnelle")) return "rupture-conventionnelle";
  return "autres-departs";
}

/** Détail descriptif de coûts déjà inclus dans la projection ; aucune indemnité juridique n’est calculée ni ajoutée. */
export function nonRecurringBreakdown(scenario: RestructuringScenario | null): BreakdownRow[] {
  const unavailable = (reason: string): BreakdownRow[] => BREAKDOWN_CATEGORIES.map((category) => ({ ...category, events: 0, total: missing(reason), months: [] }));
  if (!scenario) return unavailable("Choisir un scénario pour détailler ses éléments non récurrents.");
  if (scenario.base.currency !== "EUR" || !isMonth(scenario.firstMonth) || !isMonth(scenario.lastMonth) || scenario.firstMonth > scenario.lastMonth) return unavailable("Le scénario doit avoir un horizon valide et des montants en EUR.");
  const horizon = monthRange(scenario.firstMonth, scenario.lastMonth);
  const departures = new Map(scenario.hypotheses.filter((hypothesis): hypothesis is Departure => hypothesis.kind === "depart").map((departure) => [departure.id, departure]));
  const scheduled = [...departures.values()].filter((departure) => departure.lastPaidDate.slice(0, 7) >= scenario.firstMonth && departure.lastPaidDate.slice(0, 7) <= scenario.lastMonth);
  const rows: BreakdownRow[] = BREAKDOWN_CATEGORIES.map((category) => ({
    ...category, events: scheduled.filter((departure) => departureCategory(departure) === category.id).length, total: known(0), months: [],
  }));
  const otherEvents = new Set<string>();
  let projection: ReturnType<typeof project>;
  try { projection = project(scenario.base, scenario.firstMonth, scenario.lastMonth, scenario.hypotheses, scenario.conventions); }
  catch { projection = { kind: "error", errors: [] }; }
  for (const key of horizon) {
    const month = projection.kind === "value" ? projection.months.find((entry) => entry.month === key) : undefined;
    const issue = projection.kind === "error" ? "Projection refusée par le moteur : éléments non récurrents n.d."
      : !month ? "Mois hors de la projection du scénario."
        : month.kind === "nd" ? "Mois non calculable par le moteur de projection : éléments non récurrents n.d."
          : projectionMoneyIssue(month);
    if (issue || !month || month.kind !== "value") {
      for (const row of rows) row.months.push({ month: key, amount: missing(issue ?? "Projection mensuelle n.d.") });
      continue;
    }
    const sums: Record<BreakdownId, bigint> = { licenciement: 0n, "rupture-conventionnelle": 0n, "autres-departs": 0n, "autres-non-recurrents": 0n };
    for (const entry of month.contributions) {
      if (entry.kind === "sortie") sums[departureCategory(departures.get(entry.hypothesisId ?? ""))] += BigInt(entry.cost);
      else if (entry.nonRecurringCents !== undefined) {
        sums["autres-non-recurrents"] += BigInt(entry.nonRecurringCents);
        if (entry.nonRecurringCents !== 0 && entry.hypothesisId !== null) otherEvents.add(entry.hypothesisId);
      }
    }
    for (const row of rows) {
      const unspecified = scheduled.some((departure) => departure.lastPaidDate.slice(0, 7) === key && departureCategory(departure) === row.id && departure.exitCost === null);
      row.months.push({ month: key, amount: unspecified
        ? missing("Coût de sortie non saisi (exitCost) dans cette catégorie ; saisir un montant ou un zéro explicite.")
        : bounded(sums[row.id]) });
    }
  }
  for (const row of rows) {
    row.total = add(row.months.map((month) => month.amount));
    if (row.id === "autres-non-recurrents") row.events = otherEvents.size;
  }
  return rows;
}
