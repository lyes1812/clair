import { enteredAfter } from "./engine";
import type { BaseSnapshot, PresentPerson, Projection } from "./types";

// Entrées et sorties d'un scénario par différence de deux fins de mois : entrée = compté présent le dernier jour du mois
// et non présent le dernier jour du précédent ; sortie = l'inverse. Le premier mois se compare à la base figée (contrats
// comptés présents fin du mois de référence). L'égalité début + entrées − sorties = fin tient par construction.
export type MonthFlow = { month: string; kind: "value"; start: string[]; end: string[]; entrees: string[]; sorties: string[] } | { month: string; kind: "nd"; reason: string };

export function basePresent(base: BaseSnapshot): Record<string, PresentPerson> {
  return Object.fromEntries(base.contracts.filter((c) => c.counted && !enteredAfter(base, c)).map((c) => [c.contractKey, { etp4: c.etp4, category: c.category ?? null, service: c.service }]));
}

export function flowsOf(base: BaseSnapshot, proj: Projection): MonthFlow[] {
  if (proj.kind === "error") return [];
  let prev: Record<string, PresentPerson> | null = basePresent(base);
  return proj.months.map((m): MonthFlow => {
    if (m.kind === "nd") {
      prev = null;
      return { month: m.month, kind: "nd", reason: m.reasons.join(" ; ") };
    }
    const cur = m.people ?? {};
    if (prev === null) {
      // Mois précédent n.d. : l'entrée et la sortie ne se déduisent pas.
      prev = cur;
      return { month: m.month, kind: "nd", reason: "mois précédent n.d. : entrées et sorties non déduites" };
    }
    const flow: MonthFlow = { month: m.month, kind: "value", start: Object.keys(prev), end: Object.keys(cur), entrees: Object.keys(cur).filter((k) => !(k in prev!)), sorties: Object.keys(prev).filter((k) => !(k in cur)) };
    prev = cur;
    return flow;
  });
}
