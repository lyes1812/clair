import { monthRange } from "@/lib/connectors/months";
import { gap, total, type Gap, type Series, type Total } from "./series";

// Règle unique de l'atterrissage face au budget saisi, partagée par la Synthèse du Studio RH et par la Masse salariale croisée
// (Synthèse et 06 · Budget & prévisions) :
// - scénario retenu : le plus récemment créé parmi ceux qui couvrent l'année ; aucun : n.d. « aucun scénario ne couvre <année> » ;
// - comparaison sur les seuls mois de l'année dotés d'un montant de budget saisi, de part et d'autre (atterrissage de ces mois −
//   budget de ces mois = écart) ; les mois sans montant sont exclus et nommés ; aucun mois doté : budget n.d.
// Fonctions pures, montants en centimes ; un n.d. garde sa raison, jamais zéro. Les totaux et l'écart sont ceux du module
// budgétaire (series.ts) : rien n'est recalculé ici.

export type ScenarioSpan = { firstMonth: string; lastMonth: string; createdAt: Date };
// Un scénario couvre une année dès qu'un de ses mois (premier → dernier) en fait partie.
export const scenarioCovers = (s: ScenarioSpan, year: string): boolean => s.firstMonth.slice(0, 4) <= year && year <= s.lastMonth.slice(0, 4);

export type CoveringScenario<T> = { kind: "value"; row: T } | { kind: "nd"; reason: string };
// Le plus récemment créé des scénarios qui couvrent l'année (ordre de création décroissant, quel que soit l'ordre reçu).
export function coveringScenario<T extends { scenario: ScenarioSpan }>(rows: readonly T[], year: string): CoveringScenario<T> {
  const covering = rows.filter((r) => scenarioCovers(r.scenario, year)).sort((a, b) => b.scenario.createdAt.getTime() - a.scenario.createdAt.getTime());
  return covering.length ? { kind: "value", row: covering[0] } : { kind: "nd", reason: `aucun scénario ne couvre ${year}` };
}

export type LandingCompare = {
  withBudget: string[]; // mois de l'année dotés d'un montant de budget saisi (un montant de 0 € est un montant)
  excluded: string[]; // mois de l'année sans montant de budget : exclus des deux côtés
  budget: Total; // budget saisi des mois dotés d'un montant ; n.d. quand aucun mois n'en a
  gap: Gap | null; // atterrissage − budget sur ces mêmes mois ; null quand l'atterrissage est n.d. ou qu'aucun mois n'a de montant
};
// scenario : série du scénario (réel figé, mois du parent, projection) ; landingKnown : l'atterrissage des douze mois est calculé.
export function compareLanding(scenario: Series, landingKnown: boolean, budget: { name: string; series: Series }, year: string): LandingCompare {
  const months = monthRange(`${year}-01`, `${year}-12`);
  const withBudget = months.filter((m) => budget.series.points.get(m)?.kind === "value");
  const excluded = months.filter((m) => !withBudget.includes(m));
  if (withBudget.length === 0) return { withBudget, excluded, budget: { kind: "nd", reason: `aucun montant de budget saisi « ${budget.name} » pour ${year}` }, gap: null };
  return { withBudget, excluded, budget: total(budget.series, withBudget), gap: landingKnown ? gap(scenario, budget.series, withBudget) : null };
}
