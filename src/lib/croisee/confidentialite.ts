import { confidentialiteSettingReason, linkFromReferential, maskSize, personsOfContracts, type ConfidentialiteSetting, type MaskInput, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { monthPayroll, serviceOf, type JournalInput } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { labelTotals } from "@/lib/payroll/lot2";
import type { RhBuildData } from "@/lib/rh/referential/types";

// Seuil de confidentialité dans la Masse salariale croisée : les chapitres lisent ici le seuil de l'espace (module partagé
// src/lib/confidentialite, une seule clé, aucune valeur par défaut) et y forment les groupes du journal de paie en PERSONNES DISTINCTES :
// chaque contrat du journal est relié à sa personne par le référentiel Collaborateurs ; un contrat non relié ne protège jamais. Le
// masquage lui-même (principal et secondaire) est celui du module partagé (maskGroups / maskRelations) : rien n'est recodé ici.
// Fonctions pures, sans base ni horloge.

// Seuil utilisable, ou la raison de son absence (non défini, illisible), jamais une valeur de repli.
export type Confidentialite = { kind: "set"; value: number } | { kind: "nd"; reason: string };
export function confidentialiteOf(s: ConfidentialiteSetting): Confidentialite {
  const reason = confidentialiteSettingReason(s);
  return reason === null && s.kind === "set" ? { kind: "set", value: s.value } : { kind: "nd", reason: reason ?? "seuil de confidentialité non défini (Paramètres)" };
}

// Lien contrat → personne de la croisée. Les groupes du journal de paie désignent un contrat par son identifiant dans la source
// (contractId des lignes = externalId du référentiel) ; les paliers de la cascade d'ETP et les contributions de la projection, par sa
// clé de référentiel (contractKey). Les deux clés mènent au même jeton de personne, propre à la lecture (rang de la clé de personne,
// triée) : aucune clé de personne n'entre dans les modèles, les jetons servent seulement à compter des personnes distinctes. Un contrat
// sans personne rattachée n'y figure pas : il est « non relié ».
export function croiseeLink(data: Pick<RhBuildData, "contracts">): PersonLink {
  const byExternal = linkFromReferential(data);
  const token = new Map([...new Set(byExternal.values())].sort().map((p, i) => [p, `personne-${i + 1}`] as const));
  const link = new Map<string, string>();
  for (const c of data.contracts) {
    if (c.personKey === null) continue;
    const t = token.get(c.personKey);
    if (t === undefined) continue;
    link.set(c.externalId, t);
    link.set(c.contractKey, t);
  }
  return link;
}

// Aucun contrat : le groupe ne désigne personne.
export const NO_GROUP: PersonsOfContracts = { persons: [], unlinked: 0 };

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

// Personnes de plusieurs groupes réunis (distinctes), contrats non reliés additionnés.
export function unionGroups(...groups: readonly PersonsOfContracts[]): PersonsOfContracts {
  return { persons: [...new Set(groups.flatMap((g) => g.persons))].sort(), unlinked: groups.reduce((s, g) => s + g.unlinked, 0) };
}

// --- Groupes du journal de paie ------------------------------------------------------------------------------------------------

// Contrats d'un mois qui portent la valeur affichée, la masse salariale chargée : contrats distincts qui portent au moins une ligne
// d'une rubrique de rôle brut ou cotisations (celles que monthPayroll additionne dans la masse : salaires, primes, gratifications de
// stage, indemnités et avantages, cotisations patronales, taxes), dans le journal restreint au service (input.serviceFilter). Ce sont
// les contrats observés de zoomOf (rubrique « masse »). Une ligne sans contrat n'ajoute aucun contrat ; nonZero : une ligne de masse
// du mois, avec ou sans contrat, a un solde non nul. Les rubriques hors masse (provisions, autres charges de personnel) et les
// comptes 63/64 non classés ne comptent pas. null : mois n.d. (monthPayroll), effectif non dénombré.
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

// Personnes de chaque libellé de paie (clé de labelTotals : rubrique + libellé normalisé) sur des mois : contrats qui portent au moins
// une ligne de brut de ce libellé, reliés à leur personne. Un libellé porté seulement par des lignes sans contrat n'y figure pas (aucun
// contrat : groupInput le rend non vérifiable dès que sa valeur n'est pas nulle).
export function labelGroups(input: JournalInput, months: readonly string[], link: PersonLink): Record<string, PersonsOfContracts> {
  const byContract = new Map<string, typeof input.lines>();
  for (const l of input.lines) {
    if (!l.contractId || !months.includes(l.month)) continue;
    byContract.set(l.contractId, [...(byContract.get(l.contractId) ?? []), l]);
  }
  const contracts = new Map<string, Set<string>>();
  for (const [cid, lines] of byContract) {
    for (const t of labelTotals({ ...input, lines }, [...months])) {
      let s = contracts.get(t.key);
      if (!s) contracts.set(t.key, (s = new Set()));
      s.add(cid);
    }
  }
  return Object.fromEntries([...contracts].map(([k, ids]) => [k, personsOfContracts(ids, link)]));
}
