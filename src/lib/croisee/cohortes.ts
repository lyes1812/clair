// Masse salariale croisée, chapitre 06 · Budget & prévisions : partition des personnes observées sur deux périodes (N-1 et N).
// Fonction pure. L'entrée est le détail par clé d'observation que calcule déjà zoomOf (src/lib/budget/zoom.ts) sur chaque période :
// clé = contrat de paie du journal, valeur = montant de la période en centimes. La sortie ne contient que des nombres et des montants,
// jamais une clé : aucune identité ne sort de cette fonction.
//
// Trois groupes : clés observées seulement en N-1, seulement en N, dans les deux périodes. Une clé « observée » a au moins une
// ligne dans la période (même si ses lignes se compensent à 0). Les lignes sans clé (clé `outsideKey`, par exemple les lignes du
// journal sans contrat) ne sont pas des personnes : elles forment une ligne à part, pour que la somme des contributions soit égale
// à l'écart total. Contribution d'un groupe = montant N − montant N-1 (un groupe absent d'une période n'y a aucune ligne).

import { maskGroups } from "./structure";

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

// --- Seuil de confidentialité (rh.croisee.confidentialite) ----------------------------------------------------------------------
//
// Chaque ligne de la partition est masquée d'un bloc (nombre et montants) : une ligne dont le nombre et deux montants sont connus
// donne le troisième (contribution = coût N − coût N-1). Masquage principal : un groupe de 1 à (seuil − 1) contrats. La ligne des
// lignes sans contrat ne décrit aucune personne : jamais masquée au premier tour, elle peut l'être au masquage secondaire. Le total
// (toute la population lue) n'est jamais masqué. Masquage secondaire : chaque colonne dont le total est affiché est un ensemble de
// lignes ; la fonction partagée maskGroups (structure.ts) y désigne la plus petite ligne affichée (en valeur absolue) quand une seule
// est masquée, jusqu'à ce que plus rien ne change. Aucune valeur masquée ne se retrouve par différence d'une colonne.
export type CohortRowId = "onlyPrev" | "onlyCur" | "both" | "outside";
export type CohortRowStatus = "shown" | "masked" | "secondary";
export type CohortMask = Record<CohortRowId, CohortRowStatus>;
export const COHORT_ROWS: readonly CohortRowId[] = ["onlyPrev", "onlyCur", "both", "outside"];

export function maskCohorts(p: Extract<CohortPartition, { kind: "value" }>, seuil: number): CohortMask {
  const size = (id: CohortRowId): number => (id === "outside" ? 0 : p[id].count);
  const st: CohortMask = { onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" };
  for (const id of COHORT_ROWS) if (size(id) > 0 && size(id) < seuil) st[id] = "masked";
  // Colonnes : lignes qui y ont une cellule (une ligne vide par construction n'y figure pas) et leur valeur dans la colonne.
  const o = p.outside;
  const columns: [CohortRowId, number][][] = [
    [["onlyPrev", p.onlyPrev.count], ["onlyCur", p.onlyCur.count], ["both", p.both.count]],
    [["onlyPrev", p.onlyPrev.prev], ["both", p.both.prev], ...(o && o.prev !== null ? [["outside", o.prev] as [CohortRowId, number]] : [])],
    [["onlyCur", p.onlyCur.cur], ["both", p.both.cur], ...(o && o.cur !== null ? [["outside", o.cur] as [CohortRowId, number]] : [])],
    [["onlyPrev", p.onlyPrev.delta], ["onlyCur", p.onlyCur.delta], ["both", p.both.delta], ...(o ? [["outside", o.delta] as [CohortRowId, number]] : [])],
  ];
  for (let changed = true; changed; ) {
    changed = false;
    for (const col of columns) {
      // Une ligne masquée au masquage secondaire compte comme une ligne à protéger (effectif « non vérifiable » pour maskGroups).
      const out = maskGroups(
        col.map(([id, v]) => ({ size: st[id] === "secondary" ? null : size(id), value: Math.abs(v) })),
        seuil,
        true,
      );
      out.forEach((s, k) => {
        const id = col[k][0];
        if (s === "secondary" && st[id] === "shown") {
          st[id] = "secondary";
          changed = true;
        }
      });
    }
  }
  return st;
}
