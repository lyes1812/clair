import { hireKey } from "@/lib/budget/engine";
import type { MaskCell, MaskInput } from "@/lib/croisee/structure";
import { monthPayroll, serviceOf, type JournalInput } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { maskSize, personsOfContracts, type PersonLink, type PersonsOfContracts } from "./persons";

// Groupes du journal de paie pour le seuil de confidentialité : UNE SEULE convention pour toute l'application (Masse salariale, Masse
// salariale croisée, Écart budgétaire, Analyse des écarts). Un groupe est l'ensemble des contrats (identifiant de la source) qui
// portent une ligne de MASSE (rubrique de rôle brut ou cotisations : celles que monthPayroll additionne dans la masse chargée) dans
// le journal, restreint au service le cas échéant ; chaque contrat est relié à sa personne par le référentiel Collaborateurs
// (src/lib/confidentialite/persons.ts). Un contrat qui ne porte qu'une ligne de cotisations compte donc comme un contrat rémunéré :
// la masse qu'il décrit est la même grandeur. Un contrat non relié ne protège jamais. Les membres d'une cellule n.d. ou non
// dénombrée ne sont pas transmis au moteur : une telle cellule n'apporte aucune personne comptée (masquage secondaire).
// Fonctions pures, sans base ni horloge. Le masquage lui-même est celui de src/lib/croisee/structure.ts (maskGroups /
// maskRelations) : rien n'est recodé ici.

// Contrats d'un mois qui portent la valeur affichée, la masse salariale chargée : contrats distincts qui portent au moins une ligne
// d'une rubrique de rôle brut ou cotisations (salaires, primes, gratifications de stage, indemnités et avantages, cotisations
// patronales, taxes), dans le journal restreint au service (input.serviceFilter). Une ligne sans contrat n'ajoute aucun contrat ;
// nonZero : une ligne de masse du mois, avec ou sans contrat, a un solde non nul. Les rubriques hors masse (provisions, autres charges
// de personnel) et les comptes 63/64 non classés ne comptent pas. null : mois n.d. (monthPayroll), effectif non dénombré.
export type MasseMonthGroup = { contracts: string[]; nonZero: boolean };
export function masseContracts(input: JournalInput, month: string): MasseMonthGroup | null {
  if (monthPayroll(input, month).kind !== "value") return null;
  const rubrics = gridRubrics(input.grid);
  const f = input.serviceFilter;
  const ids = new Set<string>();
  let nonZero = false;
  for (const l of input.lines) {
    if (l.month !== month) continue;
    if (f && serviceOf(l, input.serviceAxis) !== f.value) continue;
    const role = classify(l.accountId, rubrics).rubric?.role;
    if (role !== "brut" && role !== "cotisations") continue;
    if (l.contractId) ids.add(l.contractId);
    if ((l.debitCents ?? 0) - (l.creditCents ?? 0) !== 0) nonZero = true;
  }
  return { contracts: [...ids].sort(), nonZero };
}

// Groupe d'un journal (restreint au service, le cas échéant) sur un ou plusieurs mois : personnes reliées et contrats non reliés des
// contrats qui portent une ligne de masse, et présence d'une ligne de masse de solde non nul. null : un mois n.d.
export type JournalGroup = PersonsOfContracts & { nonZero: boolean };
export function masseGroup(input: JournalInput, months: readonly string[], link: PersonLink): JournalGroup | null {
  const ids = new Set<string>();
  let nonZero = false;
  for (const m of months) {
    const g = masseContracts(input, m);
    if (!g) return null;
    for (const c of g.contracts) ids.add(c);
    if (g.nonZero) nonZero = true;
  }
  return { ...personsOfContracts(ids, link), nonZero };
}

// Groupes d'une fenêtre de mois et de chacun de ses mois, en une seule lecture des lignes : la fenêtre est la réunion de ses mois
// (null dès qu'un mois est n.d.), chaque mois garde son propre groupe (null : mois n.d.).
export type MasseWindowGroups = { window: JournalGroup | null; months: (JournalGroup | null)[] };
export function masseWindow(input: JournalInput, months: readonly string[], link: PersonLink): MasseWindowGroups {
  const perMonth = months.map((m) => masseContracts(input, m));
  const ids = new Set<string>();
  let nonZero = false;
  let nd = false;
  for (const g of perMonth) {
    if (!g) {
      nd = true;
      continue;
    }
    for (const c of g.contracts) ids.add(c);
    if (g.nonZero) nonZero = true;
  }
  return {
    window: nd ? null : { ...personsOfContracts(ids, link), nonZero },
    months: perMonth.map((g) => (g ? { ...personsOfContracts(g.contracts, link), nonZero: g.nonZero } : null)),
  };
}

// Entrée de masquage (maskGroups / maskRelations) d'un groupe de contrats du journal : taille = personnes reliées (maskSize : null,
// effectif non dénombré, quand des contrats non reliés existent et que les personnes reliées sont sous le seuil) ; null aussi quand
// aucun contrat ne décrit une valeur non nulle (lignes sans contrat : rien ne permet de vérifier le seuil). value : la valeur affichée
// (null : déjà n.d. pour une autre raison). members : les personnes, comptées une fois d'une cellule masquée à l'autre ; une cellule
// n.d. ou non dénombrée n'apporte aucune personne comptée (règle du masquage secondaire) : ses membres ne sont pas transmis.
export function groupInput(g: PersonsOfContracts, seuil: number, value: number | null, nonZero: boolean = value !== null && value !== 0): MaskInput {
  const s = maskSize(g, seuil);
  const size = s === 0 && nonZero ? null : s;
  return { size, value, members: size === null || value === null ? [] : g.persons };
}

// Cellule de masquage d'un groupe du journal pour la valeur affichée (montant d'un service, d'un mois, d'un libellé, d'une
// provision) : groupInput sur le groupe, ou cellule non dénombrée quand le groupe l'est (fenêtre n.d.). La valeur est prise en valeur
// absolue : elle ne sert qu'à ordonner le masquage secondaire (la plus petite cellule affichée d'abord), jamais à calculer.
export function groupCell(g: JournalGroup | null, seuil: number, value: number | null): MaskCell {
  const v = value === null ? null : Math.abs(value);
  return g ? groupInput(g, seuil, v, g.nonZero) : { size: null, value: v };
}

// --- Embauches prévisionnelles d'un scénario (décision du lot 12, à confirmer par Lyes) ---------------------------------------------
// Une embauche prévue (clé « embauche:… », hireKey du moteur de projection) ne décrit aucune personne réelle : une cellule ou un
// palier porté seulement par des embauches prévues est EXEMPT du masquage (affiché, MaskCell.exempt) et n'apporte aucune personne
// protectrice ; une cellule qui mêle embauches et contrats réels se juge sur ses seuls contrats réels (reliés par le référentiel ;
// un contrat réel non relié ne protège jamais). Aucune clé de personne n'est interprétée ici.
const HIRE_PREFIX = hireKey("");
export const isHireKey = (key: string): boolean => key.startsWith(HIRE_PREFIX);
export function projectedCell(keys: Iterable<string>, link: PersonLink, seuil: number, value: number | null): MaskCell {
  const real: string[] = [];
  let hires = 0;
  for (const k of keys) {
    if (isHireKey(k)) hires += 1;
    else real.push(k);
  }
  const v = value === null ? null : Math.abs(value);
  if (real.length === 0 && hires > 0) return { size: 0, value: v, members: [], exempt: true };
  return groupInput(personsOfContracts(real, link), seuil, v);
}
