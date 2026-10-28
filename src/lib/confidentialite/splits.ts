import { contractNatureLabel } from "@/lib/dsn/labels";
import { headcountAt, type HeadcountOpts } from "@/lib/rh/headcount";
import type { MonthMovements } from "@/lib/rh/kpi/types";
import type { EventDraft, RhBuildData } from "@/lib/rh/referential/types";
import { countedMovements } from "./flows";

// Répartitions par NATURE de contrat et par ÉTABLISSEMENT : UNE convention pour les écrans qui les publient — KPI RH › Effectifs
// mensuels (axes « Contrat (nature) » et « Établissement »), la croisée 02 (journal des mouvements, cellules « dont <nature> ») et la
// garde des filtres Nature et Établissement de KPI RH (flow-guard.ts pour les entrées et les sorties, scopeGuard pour l'effectif et
// l'ETP de fin de mois). Les groupes sont ceux que les filtres de KPI RH retiennent (moteur des effectifs) :
// - un mouvement (entrée, sortie) se range par la caractéristique du MOUVEMENT : nature déclarée à l'entrée ou avec la fin,
//   établissement déclarant (monthlyList) ;
// - un contrat présent en fin de mois se range par la caractéristique DÉCLARÉE CE MOIS-LÀ (headcountAt restreint à la valeur) ; un
//   contrat déclaré par deux établissements le même mois figure dans les deux.
// Libellé d'un groupe (clé et ordre canonique de la colonne, maskColumn) : contractNatureLabel pour une nature, l'identifiant de
// l'établissement (SIRET : le libellé de la grille des Effectifs mensuels) ; sans valeur, « Nature n.d. » ou « Établissement n.d. »
// (groupes « reste », en dernier). Fonctions pures, sans base ni horloge.
export type SplitAxis = "nature" | "etablissement";
export const NATURE_ND = "Nature n.d.";
export const ETABLISSEMENT_ND = "Établissement n.d.";
export const splitLabel = (axis: SplitAxis, value: string | null): string => (axis === "nature" ? (value ? contractNatureLabel(value) : NATURE_ND) : (value ?? ETABLISSEMENT_ND));
// Valeur d'un mouvement sur l'axe : celle du mouvement lui-même (jamais la caractéristique actuelle de son contrat).
export const movementValue = (e: Pick<EventDraft, "nature" | "establishmentId">, axis: SplitAxis): string | null => (axis === "nature" ? e.nature : e.establishmentId);

// Élément d'une répartition : libellé du groupe, contrat (clé du référentiel) et sa personne (null : contrat non relié). Les groupes
// se forment par flowCounts (flux) ou stockGroups (stocks).
export type SplitItem = { group: string; contract: string; person: string | null };

// Mouvements comptés d'un mois, d'un sens, rangés par la caractéristique du mouvement.
export function movementItems(mv: MonthMovements, kind: "entry" | "exit", axis: SplitAxis): SplitItem[] {
  return countedMovements(mv, kind).map((x) => ({ group: splitLabel(axis, movementValue(x.row.event, axis)), contract: x.row.contract.contractKey, person: x.row.contract.personKey }));
}

// Contrats comptés dans l'effectif à une date (opts : natures comptées et établissements du périmètre), rangés par la caractéristique
// déclarée ce mois-là : pour chaque valeur présente, les contrats de l'effectif restreint à cette valeur (exactement la population d'un
// filtre de KPI RH). Un contrat compté qu'aucune valeur ne retient (établissement non renseigné) rejoint le groupe « … n.d. ». null :
// effectif n.d. (aucun total publié).
export function headcountItems(data: RhBuildData, date: string, opts: HeadcountOpts, axis: SplitAxis): SplitItem[] | null {
  const h = headcountAt(data, date, opts);
  if (h.kind === "nd") return null;
  const person = new Map(data.contracts.map((c) => [c.contractKey, c.personKey]));
  const seen = new Set<string>();
  const out: SplitItem[] = [];
  for (const v of Object.keys(axis === "nature" ? h.byNature : h.bySiret).sort()) {
    const g = headcountAt(data, date, axis === "nature" ? { ...opts, natures: [v] } : { ...opts, establishments: [v] });
    if (g.kind === "nd") continue;
    for (const k of g.contractKeys) {
      seen.add(k);
      out.push({ group: splitLabel(axis, v), contract: k, person: person.get(k) ?? null });
    }
  }
  for (const k of h.contractKeys) if (!seen.has(k)) out.push({ group: splitLabel(axis, null), contract: k, person: person.get(k) ?? null });
  return out;
}
