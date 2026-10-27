import type { RhBuildData } from "@/lib/rh/referential/types";

// Unité du seuil de confidentialité : les PERSONNES DISTINCTES (clé de personne du référentiel Collaborateurs). Un groupe issu du
// journal de paie est un ensemble de contrats (identifiant de la source) : chaque contrat est relié à sa personne par le référentiel
// (externalId → personKey). Un contrat non relié ne protège jamais : il n'apporte aucune personne comptée, et le groupe n'est pas
// dénombré quand les personnes reliées ne suffisent pas (voir maskSize). Fonctions pures, sans base ni horloge.

// Lien contrat (identifiant dans la source) → personne, construit depuis le référentiel Collaborateurs ; un contrat sans personne
// rattachée n'y figure pas.
export type PersonLink = ReadonlyMap<string, string>;
export function linkFromReferential(data: Pick<RhBuildData, "contracts">): Map<string, string> {
  const link = new Map<string, string>();
  for (const c of data.contracts) if (c.personKey !== null) link.set(c.externalId, c.personKey);
  return link;
}

// Personnes distinctes (triées) décrites par un groupe de contrats, et nombre de contrats distincts non reliés. Un contrat présent
// deux fois dans le groupe compte une fois ; deux contrats d'une même personne comptent une personne.
export type PersonsOfContracts = { persons: string[]; unlinked: number };
export function personsOfContracts(contractIds: Iterable<string>, link: PersonLink): PersonsOfContracts {
  const persons = new Set<string>();
  const seen = new Set<string>();
  let unlinked = 0;
  for (const id of contractIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = link.get(id);
    if (p === undefined) unlinked += 1;
    else persons.add(p);
  }
  return { persons: [...persons].sort(), unlinked };
}

// Taille du groupe telle que la reçoit le masquage (MaskInput.size de maskGroups / maskRelations) : le nombre de personnes reliées ;
// null (effectif non dénombré, raison SEUIL_NON_VERIFIABLE) quand des contrats non reliés existent et que les personnes reliées
// sont sous le seuil. Au moins « seuil » personnes reliées suffisent à afficher le groupe, quels que soient les contrats non reliés.
export function maskSize(g: PersonsOfContracts, seuil: number): number | null {
  return g.unlinked > 0 && g.persons.length < seuil ? null : g.persons.length;
}

// Entrée de masquage d'un groupe : taille (maskSize), valeur affichée (null si déjà n.d. pour une autre raison) et personnes
// (comptées une seule fois d'une cellule masquée à l'autre).
export function maskInput(g: PersonsOfContracts, seuil: number, value: number | null): { size: number | null; value: number | null; members: string[] } {
  return { size: maskSize(g, seuil), value, members: g.persons };
}
