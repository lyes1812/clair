import { groupsOfContracts, maskRelations, type MaskCell, type MaskStatus } from "@/lib/croisee/structure";
import { projectedGroupCell } from "./groups";
import type { PersonsOfContracts } from "./persons";

// Statut CANONIQUE d'une cellule publiée : le même quel que soit l'écran qui la publie, la fenêtre choisie et l'ordre d'affichage.
// Une cellule masquée sur un écran et affichée sur un autre se reconstituerait par différence ; chaque cellule d'une répartition reçoit
// donc son statut d'UNE colonne (les groupes d'un même mois dont le total est publié), formée de la même façon par tous les écrans.
// Fonctions pures, sans base ni horloge ; le masquage est celui du moteur unique (maskRelations), rien n'est recodé ici.

// Ordre canonique des groupes d'une colonne : par libellé, en ordre des points de code (indépendant de la langue de l'environnement),
// les groupes « reste » en dernier (Non ventilé, Non classé, Hors salarié, … n.d.). Le moteur départage deux cellules de même valeur
// par leur ordre (la première) : deux écrans qui listent les groupes dans un ordre différent obtiennent ainsi les mêmes statuts.
const TAIL = new Set(["Non ventilé", "Non classé", "Hors salarié"]);
const isTail = (label: string): boolean => TAIL.has(label) || label.endsWith("n.d.");
export function canonicalCompare(a: string, b: string): number {
  return Number(isTail(a)) - Number(isTail(b)) || (a < b ? -1 : a > b ? 1 : 0);
}

// Une colonne d'une répartition : la cellule de chaque groupe (MaskCell), dans l'ordre canonique de leurs libellés. Relation : la
// colonne entière, total fixe (total de l'entreprise ou du périmètre, jamais masqué) quand il est publié ; sinon masquage principal
// seul. Un groupe qui ne décrit rien (taille 0 et valeur 0 : aucun contrat, aucune embauche, aucun montant) reste hors de la
// relation : son 0 est réel, il ne désigne personne et n'est jamais masqué, que l'écran le liste ou non.
export type ColumnEntry<K> = { key: K; label: string; cell: MaskCell };
export function maskColumn<K>(entries: readonly ColumnEntry<K>[], seuil: number, totalPublished: boolean): Map<K, MaskStatus> {
  const sorted = [...entries].sort((x, y) => canonicalCompare(x.label, y.label));
  const cells = sorted.map((e) => e.cell);
  const relation = cells.flatMap((c, i) => (c.size === 0 && c.value === 0 ? [] : [i]));
  const st = maskRelations(cells, totalPublished && relation.length > 0 ? [{ cells: relation }] : [], seuil);
  return new Map(sorted.map((e, i) => [e.key, st[i]]));
}

// Statut d'une valeur affichée lu dans une colonne : la valeur n.d. garde sa propre raison ; un groupe absent de la colonne ne porte
// rien (affiché à 0) ; s'il porte une valeur non nulle (rattachements divergents entre la valeur et les contrats), il n'est pas
// vérifiable (l'appelant le place aussi dans la colonne, voir stockColumn).
export function columnStatus<K>(col: ReadonlyMap<K, MaskStatus>, key: K, value: number | null): MaskStatus {
  if (value === null) return "nd";
  return col.get(key) ?? (value === 0 ? "shown" : "unverifiable");
}

// Statut d'une fenêtre (période, N-1, cumul de l'année, toute somme de mois) déduit de ses mois, sans aucune relation propre. Une
// fenêtre dont la valeur est n.d. pour une autre raison (un mois hors de la lecture, par exemple) garde la sienne (valueNd : aucun
// nombre n'est publié) ; sinon elle est n.d. dès qu'un de ses mois est masqué (raison du seuil : secondary), non vérifiable si seuls
// des mois non vérifiables le sont, affichée sinon (sa valeur est alors une somme de mois publiés ; masquée, elle combine des mois
// déjà protégés par leurs colonnes).
export function windowStatus(months: readonly MaskStatus[], valueNd = false): MaskStatus {
  if (valueNd) return "nd";
  if (months.some((s) => s === "masked" || s === "secondary")) return "secondary";
  if (months.some((s) => s === "unverifiable")) return "unverifiable";
  return "shown";
}

// --- Stock de fin de mois (effectif et ETP) d'une répartition -----------------------------------------------------------------------
// UNE passe par fin de mois, partagée par KPI RH › Effectifs mensuels (mesures ETP et inscrits), le tableau « Effectif et ETP par
// catégorie » du Suivi et la croisée 02 « Où sont les effectifs ». Groupe : les contrats présents en fin de mois (comptés dans
// l'effectif) rangés dans le groupe, vus par leur personne (personnes reliées distinctes, contrats non reliés) ; contracts : leur
// nombre, l'effectif affiché (« inscrits ») ; hires : embauches prévues présentes (mois projeté d'un scénario). Valeur d'ordre :
// l'effectif (contrats + embauches), JAMAIS l'ETP ; le statut vaut pour le couple (effectif, ETP) du groupe, masqué ensemble.
export type StockGroup = PersonsOfContracts & { contracts?: number; hires?: number };
// Effectif d'un groupe : ses contrats (à défaut de leur nombre, ses personnes reliées et ses contrats non reliés) et ses embauches.
export const stockCount = (g: StockGroup): number => (g.contracts ?? g.persons.length + g.unlinked) + (g.hires ?? 0);

// Groupes d'une fin de mois depuis ses contrats : group, libellé du groupe ; contract, identifiant ou jeton du contrat (un contrat cité
// deux fois compte une fois) ; person, jeton de sa personne (null : contrat non relié).
export function stockGroups(items: readonly { group: string; contract: string; person: string | null }[]): Record<string, StockGroup> {
  const persons = groupsOfContracts(items);
  const contracts = new Map<string, Set<string>>();
  for (const x of items) {
    let s = contracts.get(x.group);
    if (!s) contracts.set(x.group, (s = new Set()));
    s.add(x.contract);
  }
  return Object.fromEntries(Object.entries(persons).map(([g, p]) => [g, { ...p, contracts: contracts.get(g)!.size }]));
}

// Statuts d'une fin de mois. groups : groupe de chaque libellé (null : effectif non dénombré, non vérifiable) ; valued : libellés qui
// portent une valeur affichée non nulle (un libellé absent de groups y entre comme non vérifiable). Cellule : projectedGroupCell
// (personnes reliées ; contrat non relié jamais protecteur ; embauches seules : taille 0), valeur = effectif ; total du mois publié.
export function stockColumn(groups: Readonly<Record<string, StockGroup | null>>, seuil: number, valued: readonly string[] = []): Map<string, MaskStatus> {
  const entries: ColumnEntry<string>[] = Object.entries(groups).map(([label, g]) => {
    const cell: MaskCell = g === null ? { size: null, value: 0 } : projectedGroupCell(g, seuil, stockCount(g), stockCount(g) > 0);
    return { key: label, label, cell };
  });
  for (const label of valued) if (!(label in groups)) entries.push({ key: label, label, cell: { size: null, value: 0 } });
  return maskColumn(entries, seuil, true);
}
