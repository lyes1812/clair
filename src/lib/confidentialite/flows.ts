import { groupsOfContracts, type MaskStatus } from "@/lib/croisee/structure";
import type { EventContribution, MonthMovements } from "@/lib/rh/kpi/types";
import { maskColumn } from "./columns";
import { projectedGroupCell } from "./groups";
import type { PersonsOfContracts } from "./persons";

// Entrées et sorties d'un mois réparties par une caractéristique (nature de contrat, établissement) pour le seuil de confidentialité :
// UNE seule convention pour KPI RH › Effectifs mensuels, la Masse salariale croisée (chapitre 02, cellules « dont <nature> » du journal
// des mouvements) et KPI RH (entrées et sorties du périmètre retenu par un filtre Nature ou Établissement). Les mouvements sont ceux que
// le total du mois compte (monthMovements, règles du turnover) ; chaque contrat est vu par sa personne (clé de personne du référentiel ;
// un contrat sans personne est non relié et ne protège jamais). Les groupes sont formés par splits.ts ; leur statut est celui de la
// colonne canonique du mois (flowColumn → maskColumn) : rien n'est recodé ici. Fonctions pures, sans base ni horloge.

// Mouvements comptés d'un mois (ceux du total du mois), d'un sens ou des deux.
export const countedMovements = (mv: MonthMovements, kind?: "entry" | "exit"): EventContribution[] => mv.events.filter((x) => x.why === "counted" && (kind === undefined || x.row.event.kind === kind));

// Mouvements d'un groupe : nombre de mouvements (valeur affichée) et groupe en personnes reliées distinctes (une personne présente dans
// deux groupes masqués y compte une fois) et contrats non reliés.
export type FlowCount = PersonsOfContracts & { contracts: number };

// Mouvements par groupe : group (libellé de la nature, de l'établissement…), contract (identifiant ou jeton du contrat), person (jeton
// ou clé de sa personne, null : contrat non relié).
export function flowCounts(items: readonly { group: string; contract: string; person: string | null }[]): Record<string, FlowCount> {
  const groups = groupsOfContracts(items);
  const out: Record<string, FlowCount> = {};
  for (const x of items) out[x.group] = { contracts: (out[x.group]?.contracts ?? 0) + 1, ...groups[x.group] };
  return out;
}

// Statuts de la colonne d'un flux du mois (groupes indexés par leur libellé) : la colonne canonique (maskColumn : groupes dans l'ordre
// canonique de leurs libellés, « … n.d. » en dernier ; un groupe sans mouvement hors de la relation, affiché à 0). Cellule de chaque
// groupe : projectedGroupCell, celle de la grille des Effectifs mensuels (gridMask) ; valeur d'ordre : le nombre de mouvements.
// totalPublished : le total du mois est publié (exact), masquage secondaire dans la colonne ; sinon masquage principal seul. Le statut
// d'une cellule se lit par columnStatus (un groupe absent de la colonne, sans mouvement, est affiché à 0).
export function flowColumn(groups: Readonly<Record<string, FlowCount>>, seuil: number, totalPublished: boolean): Map<string, MaskStatus> {
  return maskColumn(
    Object.entries(groups).map(([label, g]) => ({ key: label, label, cell: projectedGroupCell(g, seuil, g.contracts) })),
    seuil,
    totalPublished,
  );
}
