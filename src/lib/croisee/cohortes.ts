// Masse salariale croisée, chapitre 06 · Budget & prévisions : partition des personnes observées sur deux périodes (N-1 et N).
// Fonction pure. L'entrée est le détail par clé d'observation que calcule déjà zoomOf (src/lib/budget/zoom.ts) sur chaque période :
// clé = contrat de paie du journal, valeur = montant de la période en centimes. La sortie ne contient que des nombres et des montants,
// jamais une clé : aucune identité ne sort de cette fonction.
//
// Trois groupes : clés observées seulement en N-1, seulement en N, dans les deux périodes. Une clé « observée » a au moins une
// ligne dans la période (même si ses lignes se compensent à 0). Les lignes sans clé (clé `outsideKey`, par exemple les lignes du
// journal sans contrat) ne sont pas des personnes : elles forment une ligne à part, pour que la somme des contributions soit égale
// à l'écart total. Contribution d'un groupe = montant N − montant N-1 (un groupe absent d'une période n'y a aucune ligne).

export type CohortGroup = { count: number; prev: number; cur: number; delta: number };
export type CohortOutside = { prev: number | null; cur: number | null; delta: number }; // null : aucune ligne sans clé dans la période
export type CohortPartition =
  | {
      kind: "value";
      onlyPrev: CohortGroup; // cur = 0 par construction (aucune ligne en N)
      onlyCur: CohortGroup; // prev = 0 par construction (aucune ligne en N-1)
      both: CohortGroup;
      outside: CohortOutside | null; // null : aucune ligne sans clé dans les deux périodes
      total: CohortGroup; // count = nombre de clés distinctes (hors lignes sans clé)
    }
  | { kind: "nd"; reason: string };

const empty = (): CohortGroup => ({ count: 0, prev: 0, cur: 0, delta: 0 });
const safe = (n: number) => Number.isSafeInteger(n);

export function partitionCohorts(prev: ReadonlyMap<string, number>, cur: ReadonlyMap<string, number>, outsideKey?: string): CohortPartition {
  for (const [, v] of [...prev, ...cur]) if (!safe(v)) return { kind: "nd", reason: "montant hors des entiers de centimes" };
  const onlyPrev = empty();
  const onlyCur = empty();
  const both = empty();
  for (const [k, p] of prev) {
    if (k === outsideKey) continue;
    const c = cur.get(k);
    if (c === undefined) {
      onlyPrev.count += 1;
      onlyPrev.prev += p;
    } else {
      both.count += 1;
      both.prev += p;
      both.cur += c;
    }
  }
  for (const [k, c] of cur) {
    if (k === outsideKey || prev.has(k)) continue;
    onlyCur.count += 1;
    onlyCur.cur += c;
  }
  for (const g of [onlyPrev, onlyCur, both]) g.delta = g.cur - g.prev;
  const op = outsideKey !== undefined ? prev.get(outsideKey) : undefined;
  const oc = outsideKey !== undefined ? cur.get(outsideKey) : undefined;
  const outside: CohortOutside | null = op === undefined && oc === undefined ? null : { prev: op ?? null, cur: oc ?? null, delta: (oc ?? 0) - (op ?? 0) };
  const totalPrev = onlyPrev.prev + both.prev + (outside?.prev ?? 0);
  const totalCur = onlyCur.cur + both.cur + (outside?.cur ?? 0);
  const total: CohortGroup = { count: onlyPrev.count + onlyCur.count + both.count, prev: totalPrev, cur: totalCur, delta: totalCur - totalPrev };
  if (![onlyPrev, onlyCur, both, total].every((g) => safe(g.prev) && safe(g.cur) && safe(g.delta)) || (outside && !safe(outside.delta))) return { kind: "nd", reason: "somme hors des entiers de centimes" };
  return { kind: "value", onlyPrev, onlyCur, both, outside, total };
}
