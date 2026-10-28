// Masse salariale croisée, chapitre 06 · Budget & prévisions : partition des contrats observés sur deux périodes (N-1 et N). Les
// éléments non récurrents de l'atterrissage retraité (« Déjà comptabilisés », « Prévus ») sont des totaux de l'entreprise publiés
// ailleurs (tuile « Coûts identifiés » de la Masse salariale, atterrissage retraité des Hypothèses budgétaires) : ni contributeurs ni
// masque ici (décision par défaut du lot 12, soumise à Lyes). Fonctions pures. L'entrée est le détail par
// clé d'observation que calcule déjà zoomOf (src/lib/budget/zoom.ts) sur chaque période : clé = contrat de paie du journal, valeur =
// montant de la période en centimes. La sortie ne contient que des nombres, des montants et des jetons de personne (lien contrat →
// jeton, src/lib/croisee/confidentialite.ts), jamais une clé de contrat : aucune identité ne sort de cette fonction.
//
// Trois groupes : clés observées seulement en N-1, seulement en N, dans les deux périodes. Une clé « observée » a au moins une
// ligne dans la période (même si ses lignes se compensent à 0). Les lignes sans clé (clé `outsideKey`, par exemple les lignes du
// journal sans contrat) ne sont pas des personnes : elles forment une ligne à part, pour que la somme des contributions soit égale
// à l'écart total. Contribution d'un groupe = montant N − montant N-1 (un groupe absent d'une période n'y a aucune ligne).
// Chaque groupe porte aussi ses personnes distinctes (contrats reliés par le référentiel), le nombre de ses contrats non reliés et le
// nombre de ses embauches prévisionnelles (clés « embauche:… » d'un scénario, isHireKey) : c'est en personnes que le seuil de
// confidentialité le compte (maskCohorts). Décision du lot 12 (à confirmer par Lyes) : une embauche prévue ne décrit aucune personne
// réelle ; un groupe porté seulement par des embauches prévues est affiché, ne protège jamais et n'est masqué qu'avec toute sa
// relation quand celle-ci ne peut pas être protégée ; un groupe qui mêle embauches et contrats réels se juge sur ses contrats réels
// (projectedGroupCell du module partagé, la même fonction pour toute l'application, appliquée ici à des groupes déjà reliés).

import { maskRelations, type MaskCell, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { projectedGroup, projectedGroupCell } from "@/lib/confidentialite/groups";

// Groupe de contrats reliés par le référentiel, plus ses embauches prévisionnelles.
export type LinkedGroup = PersonsOfContracts & { hires: number };
export function linkedGroup(keys: readonly string[], link: PersonLink): LinkedGroup {
  return projectedGroup(keys, link);
}
// Cellule de masquage d'un tel groupe : celle du module partagé (projectedGroupCell : embauches prévues seules → taille 0, affichée,
// jamais protectrice, masquée avec toute la relation ; sinon groupInput sur ses contrats réels, valeur absolue).
export function linkedGroupCell(g: LinkedGroup, seuil: number, value: number | null, nonZero?: boolean): MaskCell {
  return projectedGroupCell(g, seuil, value, nonZero);
}

export type CohortGroup = LinkedGroup & { count: number; prev: number; cur: number; delta: number };
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

const safe = (n: number) => Number.isSafeInteger(n);

// link : lien contrat (clé d'observation) → jeton de personne ; absent, aucun contrat n'est relié (le groupe n'est alors jamais
// dénombré en personnes : non vérifiable sous le seuil).
export function partitionCohorts(prev: ReadonlyMap<string, number>, cur: ReadonlyMap<string, number>, outsideKey?: string, link: PersonLink = new Map()): CohortPartition {
  for (const [, v] of [...prev, ...cur]) if (!safe(v)) return { kind: "nd", reason: "montant hors des entiers de centimes" };
  const keys = { onlyPrev: [] as string[], onlyCur: [] as string[], both: [] as string[] };
  const sums = { onlyPrev: { prev: 0, cur: 0 }, onlyCur: { prev: 0, cur: 0 }, both: { prev: 0, cur: 0 } };
  for (const [k, p] of prev) {
    if (k === outsideKey) continue;
    const c = cur.get(k);
    if (c === undefined) {
      keys.onlyPrev.push(k);
      sums.onlyPrev.prev += p;
    } else {
      keys.both.push(k);
      sums.both.prev += p;
      sums.both.cur += c;
    }
  }
  for (const [k, c] of cur) {
    if (k === outsideKey || prev.has(k)) continue;
    keys.onlyCur.push(k);
    sums.onlyCur.cur += c;
  }
  const group = (id: "onlyPrev" | "onlyCur" | "both"): CohortGroup => ({ count: keys[id].length, ...sums[id], delta: sums[id].cur - sums[id].prev, ...linkedGroup(keys[id], link) });
  const onlyPrev = group("onlyPrev");
  const onlyCur = group("onlyCur");
  const both = group("both");
  const op = outsideKey !== undefined ? prev.get(outsideKey) : undefined;
  const oc = outsideKey !== undefined ? cur.get(outsideKey) : undefined;
  const outside: CohortOutside | null = op === undefined && oc === undefined ? null : { prev: op ?? null, cur: oc ?? null, delta: (oc ?? 0) - (op ?? 0) };
  const totalPrev = onlyPrev.prev + both.prev + (outside?.prev ?? 0);
  const totalCur = onlyCur.cur + both.cur + (outside?.cur ?? 0);
  const total: CohortGroup = {
    count: onlyPrev.count + onlyCur.count + both.count,
    prev: totalPrev,
    cur: totalCur,
    delta: totalCur - totalPrev,
    ...linkedGroup([...keys.onlyPrev, ...keys.onlyCur, ...keys.both], link),
  };
  if (![onlyPrev, onlyCur, both, total].every((g) => safe(g.prev) && safe(g.cur) && safe(g.delta)) || (outside && !safe(outside.delta))) return { kind: "nd", reason: "somme hors des entiers de centimes" };
  return { kind: "value", onlyPrev, onlyCur, both, outside, total };
}

// --- Seuil de confidentialité (rh.confidentialite.seuil, compté en personnes distinctes) -------------------------------------------
//
// Chaque ligne de la partition est masquée d'un bloc (nombre et montants) : une ligne dont le nombre et deux montants sont connus
// donne le troisième (contribution = coût N − coût N-1). Masquage principal : un groupe de 1 à (seuil − 1) personnes reliées ; un
// groupe qui compte des contrats non reliés sans atteindre le seuil en personnes reliées n'est pas dénombré (n.d. « seuil de
// confidentialité non vérifiable »). La ligne des lignes sans contrat ne décrit aucun contrat : avec un montant non nul (N-1, N ou
// contribution), son effectif n'est pas vérifiable, quel que soit le seuil ; avec des montants nuls, elle ne désigne personne (taille
// 0). Le total (toute la population lue) n'est jamais masqué. Masquage secondaire : chaque colonne dont le total est affiché est une
// relation de la fonction partagée maskRelations, chaque ligne un bloc ; les personnes des lignes masquées sont comptées une fois
// (une personne qui change de contrat entre les deux périodes est dans deux groupes). L'ensemble masqué de chaque colonne compte au
// moins « seuil » personnes distinctes et deux lignes qui décrivent quelqu'un ; aucune valeur masquée ne se retrouve par différence
// d'une colonne.
export type CohortRowId = "onlyPrev" | "onlyCur" | "both" | "outside";
export type CohortRowStatus = "shown" | "masked" | "secondary" | "unverifiable";
export type CohortMask = Record<CohortRowId, CohortRowStatus>;
export const COHORT_ROWS: readonly CohortRowId[] = ["onlyPrev", "onlyCur", "both", "outside"];

export function maskCohorts(p: Extract<CohortPartition, { kind: "value" }>, seuil: number): CohortMask {
  const o = p.outside;
  const outsideSize = o && [o.prev, o.cur, o.delta].some((v) => v !== null && v !== 0) ? null : 0;
  // Entrée d'une cellule : la ligne sans contrat (taille 0 ou non dénombrée), ou le groupe en personnes reliées (linkedGroupCell :
  // embauches prévues seules de taille 0 ; la valeur n'est jamais nulle pour un groupe qui compte des contrats, sa taille vient des
  // personnes).
  const input = (id: CohortRowId, v: number): MaskCell => (id === "outside" ? { size: outsideSize, value: Math.abs(v) } : linkedGroupCell(p[id], seuil, v, p[id].count > 0));
  // Colonnes : lignes qui y ont une cellule (une ligne vide par construction n'y figure pas) et leur valeur dans la colonne.
  const columns: [CohortRowId, number][][] = [
    [["onlyPrev", p.onlyPrev.count], ["onlyCur", p.onlyCur.count], ["both", p.both.count]],
    [["onlyPrev", p.onlyPrev.prev], ["both", p.both.prev], ...(o && o.prev !== null ? [["outside", o.prev] as [CohortRowId, number]] : [])],
    [["onlyCur", p.onlyCur.cur], ["both", p.both.cur], ...(o && o.cur !== null ? [["outside", o.cur] as [CohortRowId, number]] : [])],
    [["onlyPrev", p.onlyPrev.delta], ["onlyCur", p.onlyCur.delta], ["both", p.both.delta], ...(o ? [["outside", o.delta] as [CohortRowId, number]] : [])],
  ];
  const cells: (MaskCell & { row: CohortRowId })[] = [];
  const relations = columns.map((col) => ({ cells: col.map(([row, v]) => cells.push({ row, ...input(row, v), block: row }) - 1) }));
  const st = maskRelations(cells, relations, seuil);
  // Statut d'une ligne : celui de ses cellules (masquées en bloc) ; une ligne sans cellule reste affichée.
  const out: CohortMask = { onlyPrev: "shown", onlyCur: "shown", both: "shown", outside: "shown" };
  cells.forEach((c, i) => {
    if (out[c.row] === "shown" && st[i] !== "shown" && st[i] !== "nd") out[c.row] = st[i] as CohortRowStatus;
  });
  return out;
}

