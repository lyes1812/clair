import { groupsOfContracts, maskGroups, type MaskStatus } from "@/lib/croisee/structure";
import type { EventContribution, MonthMovements } from "@/lib/rh/kpi/types";
import { groupInput } from "./groups";
import type { PersonsOfContracts } from "./persons";

// Entrées et sorties d'un mois réparties par une caractéristique (nature de contrat, établissement) pour le seuil de confidentialité :
// UNE seule convention pour la Masse salariale croisée (chapitre 02, cellules « dont <nature> » du journal des mouvements) et KPI RH
// (entrées et sorties du périmètre retenu par un filtre Nature ou Établissement). Les mouvements sont ceux que le total du mois compte
// (monthMovements, règles du turnover) ; chaque contrat est vu par sa personne (clé de personne du référentiel ; un contrat sans
// personne est non relié et ne protège jamais). Le masquage est celui du moteur partagé (maskGroups) : rien n'est recodé ici.
// Fonctions pures, sans base ni horloge.

// Mouvements comptés d'un mois (ceux du total du mois), d'un sens ou des deux.
export const countedMovements = (mv: MonthMovements, kind?: "entry" | "exit"): EventContribution[] => mv.events.filter((x) => x.why === "counted" && (kind === undefined || x.row.event.kind === kind));

// Mouvements d'un groupe : nombre de mouvements (valeur affichée) et groupe en personnes reliées distinctes (une personne présente dans
// deux groupes masqués y compte une fois) et contrats non reliés.
export type FlowCount = PersonsOfContracts & { contracts: number };
const NO_FLOW: FlowCount = { contracts: 0, persons: [], unlinked: 0 };

// Mouvements par groupe : group (nature, établissement…), contract (identifiant ou jeton du contrat), person (jeton ou clé de sa
// personne, null : contrat non relié).
export function flowCounts(items: readonly { group: string; contract: string; person: string | null }[]): Record<string, FlowCount> {
  const groups = groupsOfContracts(items);
  const out: Record<string, FlowCount> = {};
  for (const x of items) out[x.group] = { contracts: (out[x.group]?.contracts ?? 0) + 1, ...groups[x.group] };
  return out;
}

// Statuts des cellules d'une partition d'un flux du mois : une cellule par valeur, dans l'ordre donné (valeur sans mouvement : 0, ne
// désigne personne), puis le reste éventuel (mouvements d'aucune valeur de la liste). Valeur d'ordre du masquage secondaire : le nombre
// de mouvements. totalShown : le total du mois est publié (exact), masquage secondaire dans la partition ; sinon masquage principal seul.
export function flowPartitionStatus(counts: Readonly<Record<string, FlowCount>>, values: readonly string[], seuil: number, totalShown: boolean, rest: FlowCount | null = null): MaskStatus[] {
  const cells = [...values.map((v) => counts[v] ?? NO_FLOW), ...(rest ? [rest] : [])];
  return maskGroups(
    cells.map((c) => groupInput(c, seuil, c.contracts)),
    seuil,
    totalShown,
  );
}
