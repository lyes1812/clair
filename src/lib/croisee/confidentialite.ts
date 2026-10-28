import { confidentialiteSettingReason, linkFromReferential, type ConfidentialiteSetting, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
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

// Les groupes du journal de paie (masseContracts, masseGroup), l'entrée de masquage d'un groupe (groupInput) et la cellule d'une
// composition projetée (projectedCell : embauches prévues exemptes) sont ceux du module partagé src/lib/confidentialite/groups.ts : une
// seule convention pour la Masse salariale, la croisée, l'Écart budgétaire et l'Analyse des écarts. Ré-exportés ici pour les chapitres.
export { groupCell, groupInput, isHireKey, masseContracts, masseGroup, masseWindow, projectedCell, type JournalGroup, type MasseMonthGroup, type MasseWindowGroups } from "@/lib/confidentialite/groups";

// La garde du filtre Service est celle de src/lib/payroll/service-rows.ts (serviceGuardOnWindows : lignes par service du journal
// entier, masquées par le moteur unique, masquage secondaire compris), la même que la Synthèse de la Masse salariale, l'Écart
// budgétaire et l'Analyse des écarts. Ré-exportée pour les chapitres 01, 04, 06, 07 et 08.
export { serviceGuardOnWindows, type ServiceGuard } from "@/lib/payroll/service-rows";

// Personnes de plusieurs groupes réunis (distinctes), contrats non reliés additionnés.
export function unionGroups(...groups: readonly PersonsOfContracts[]): PersonsOfContracts {
  return { persons: [...new Set(groups.flatMap((g) => g.persons))].sort(), unlinked: groups.reduce((s, g) => s + g.unlinked, 0) };
}
