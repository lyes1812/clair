import { addDays, isIsoDate, monthOf } from "@/lib/dates";

// Échéances de contrat (Masse salariale croisée, chapitre 02) : fins de contrat et entrées déjà enregistrées dans la source RH qui
// tombent dans l'horizon défini dans les Paramètres, compté en jours à partir de la date de la lecture RH appliquée. Fonction pure,
// sans base ni horloge : la date de départ est celle de la lecture, jamais « aujourd'hui ». Aucun nom ni identifiant : un nombre de
// contrats par mois et par nature.
//
// Fenêtre : du lendemain de la date de lecture au jour « lecture + horizon » inclus. Un mouvement daté du jour de la lecture est
// déjà connu de la lecture (même règle que les mouvements « à venir » : date postérieure à la date de référence). Seuls les contrats
// d'une nature comptée dans l'effectif (Paramètres des KPI) sont retenus.

export type EcheanceContract = { startDate: string | null; endDate: string | null; nature: string | null };
export type EcheanceLine = { month: string; nature: string; fins: number; entrees: number };
export type Echeances =
  | { kind: "value"; from: string; to: string; horizon: number; lines: EcheanceLine[]; fins: number; entrees: number; undated: number }
  | { kind: "nd"; reason: string };

export function contractEcheances(p: { referenceDate: string | null; horizonDays: number; natures: readonly string[]; contracts: readonly EcheanceContract[] }): Echeances {
  const ref = p.referenceDate;
  if (!ref || !isIsoDate(ref)) return { kind: "nd", reason: "date de lecture de la source RH absente" };
  if (!Number.isSafeInteger(p.horizonDays) || p.horizonDays < 1) return { kind: "nd", reason: "horizon des échéances illisible : à ré-enregistrer (Paramètres)" };
  const to = addDays(ref, p.horizonDays);
  const inWindow = (d: string | null): d is string => d !== null && isIsoDate(d) && d > ref && d <= to;
  const byKey = new Map<string, EcheanceLine>();
  const line = (date: string, nature: string) => {
    const k = `${monthOf(date)}|${nature}`;
    let l = byKey.get(k);
    if (!l) byKey.set(k, (l = { month: monthOf(date), nature, fins: 0, entrees: 0 }));
    return l;
  };
  let fins = 0;
  let entrees = 0;
  let undated = 0;
  for (const c of p.contracts) {
    if (c.nature === null || !p.natures.includes(c.nature)) continue;
    if (c.startDate === null) undated += 1;
    if (inWindow(c.startDate)) {
      line(c.startDate, c.nature).entrees += 1;
      entrees += 1;
    }
    if (inWindow(c.endDate)) {
      line(c.endDate, c.nature).fins += 1;
      fins += 1;
    }
  }
  const lines = [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.nature.localeCompare(b.nature));
  return { kind: "value", from: addDays(ref, 1), to, horizon: p.horizonDays, lines, fins, entrees, undated };
}
