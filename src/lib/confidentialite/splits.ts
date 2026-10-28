import { maskRelations, type MaskCell, type MaskRelation, type MaskStatus } from "@/lib/croisee/structure";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { headcountAt, type HeadcountOpts } from "@/lib/rh/headcount";
import type { MonthMovements } from "@/lib/rh/kpi/types";
import type { EventDraft, RhBuildData } from "@/lib/rh/referential/types";
import { canonicalCompare, stockColumn, stockCount, stockGroups, type StockGroup } from "./columns";
import { countedMovements, flowColumn, flowCounts, type FlowCount } from "./flows";
import { projectedGroupCell } from "./groups";

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

// --- Filtres Établissement + Nature combinés (KPI RH) : tableau établissement × nature d'un mois ------------------------------------
// Sous les deux filtres, la valeur affichée (entrées, sorties, effectif de fin de mois) est une cellule du tableau établissement × nature
// du mois. Ses marges sont publiées ailleurs : la ligne d'un établissement a pour total la cellule de l'établissement (filtre
// Établissement seul, grille des Effectifs mensuels), la colonne d'une nature la cellule de la nature (filtre Nature seul, grille, croisée
// 02 pour les flux). Masquer chaque partition seule laisserait reconstituer une cellule par différence d'un filtre à l'autre ; le tableau
// complet (une cellule par croisement présent) est donc masqué en UNE passe du moteur (maskRelations) : une relation par établissement et
// une par nature, chaque marge avec le statut de sa colonne canonique (celui des filtres seuls et de la grille) :
// - marge affichée : somme fixe, total publié ; si ses cellules ne peuvent pas être protégées, toute la ligne (ou la colonne) intérieure
//   est masquée (règle du moteur). Une ligne (ou une colonne) qui n'a qu'une cellule égale sa marge publiée : la cellule est publiée
//   par elle (exempt, hors des relations ; elle ne protège donc aucune autre cellule) ;
// - marge masquée (principal, secondaire ou non vérifiable) : ce n'est pas un total publié, mais ses cellules ne restent pas toutes
//   affichées, leur somme la redonnerait (relation au total masqué) ; marge absente : traitée comme masquée ;
// - marge n.d. : aucune relation.
// Ordre canonique : libellé d'établissement, puis libellé de nature ; relations des marges affichées d'abord. Clé d'une cellule :
// crossKey(libellé d'établissement, libellé de nature), libellés de splitLabel. Le statut affiché se lit par columnStatus.
export const crossKey = (etablissement: string, nature: string): string => JSON.stringify([etablissement, nature]);
const crossLabels = (key: string): [string, string] => JSON.parse(key) as [string, string];
export type CrossMargins = { etablissement: ReadonlyMap<string, MaskStatus>; nature: ReadonlyMap<string, MaskStatus> };
export function crossMask(cells: Readonly<Record<string, MaskCell>>, margins: CrossMargins, seuil: number): Map<string, MaskStatus> {
  const keys = Object.keys(cells)
    .map((key) => ({ key, labels: crossLabels(key) }))
    .sort((x, y) => canonicalCompare(x.labels[0], y.labels[0]) || canonicalCompare(x.labels[1], y.labels[1]));
  const all: MaskCell[] = keys.map((k) => ({ ...cells[k.key] }));
  // Lignes (axe 0, établissements) et colonnes (axe 1, natures) : cellules qui décrivent quelqu'un ou portent une valeur (une cellule
  // vide ne désigne personne, comme dans maskColumn).
  const lines = (axis: 0 | 1, statuses: ReadonlyMap<string, MaskStatus>) => {
    const by = new Map<string, number[]>();
    keys.forEach((k, i) => {
      if (all[i].size === 0 && all[i].value === 0) return;
      by.set(k.labels[axis], [...(by.get(k.labels[axis]) ?? []), i]);
    });
    return [...by].map(([label, idx]) => ({ idx, st: statuses.get(label) }));
  };
  const both = [...lines(0, margins.etablissement), ...lines(1, margins.nature)];
  // Seule cellule d'une marge affichée : publiée par la marge (jamais une cellule que le masquage principal retiendrait).
  const primaryShown = (c: MaskCell): boolean => c.value !== null && c.size !== null && !(c.size > 0 && c.size < seuil);
  for (const l of both) if (l.st === "shown" && l.idx.length === 1 && primaryShown(all[l.idx[0]])) all[l.idx[0]].exempt = true;
  const fixed: MaskRelation[] = [];
  const hiddenTotal: MaskRelation[] = [];
  for (const l of both) {
    if (l.st === "nd") continue;
    if (l.st === "shown") fixed.push({ cells: l.idx });
    else {
      // Total masqué : cellule hors du tableau, non vérifiable (elle ne protège personne et n'est jamais affichée).
      all.push({ size: null, value: 0 });
      hiddenTotal.push({ cells: l.idx, total: all.length - 1 });
    }
  }
  const st = maskRelations(all, [...fixed, ...hiddenTotal], seuil);
  return new Map(keys.map((k, i) => [k.key, st[i]]));
}

// Flux d'un mois, d'un sens : mouvements comptés de l'entrée SANS filtre, rangés par établissement déclarant ET nature du mouvement
// (counts : nombre de mouvements de chaque croisement, la valeur des deux filtres quand aucun contrat continu n'est neutralisé autrement) ;
// cellule de flowColumn ; marges : colonnes canoniques par établissement et par nature (flowColumn, total publié si le total du mois
// est exact).
export function crossFlowColumn(mv: MonthMovements, kind: "entry" | "exit", seuil: number, totalPublished: boolean): { counts: Record<string, FlowCount>; status: Map<string, MaskStatus> } {
  const items = countedMovements(mv, kind).map((x) => ({
    group: crossKey(splitLabel("etablissement", movementValue(x.row.event, "etablissement")), splitLabel("nature", movementValue(x.row.event, "nature"))),
    contract: x.row.contract.contractKey,
    person: x.row.contract.personKey,
  }));
  const counts = flowCounts(items);
  const margins: CrossMargins = {
    etablissement: flowColumn(flowCounts(movementItems(mv, kind, "etablissement")), seuil, totalPublished),
    nature: flowColumn(flowCounts(movementItems(mv, kind, "nature")), seuil, totalPublished),
  };
  const cells = Object.fromEntries(Object.entries(counts).map(([k, g]) => [k, projectedGroupCell(g, seuil, g.contracts)]));
  return { counts, status: crossMask(cells, margins, seuil) };
}

// Contrats comptés dans l'effectif à une date (opts : celles de l'entrée sans filtre), rangés par établissement ET nature déclarés ce
// mois-là : la cellule (E, N) est exactement la population des deux filtres (headcountAt restreint à E et à N) ; un contrat qu'aucun
// établissement ne retient rejoint « Établissement n.d. » sous sa nature (groupe de headcountItems). La ligne d'un établissement est
// ainsi son groupe de headcountItems ; un contrat déclaré par deux établissements le même mois figure dans les deux lignes. null :
// effectif n.d. (aucun total publié).
export function crossHeadcountItems(data: RhBuildData, date: string, opts: HeadcountOpts): SplitItem[] | null {
  const h = headcountAt(data, date, opts);
  if (h.kind === "nd") return null;
  const person = new Map(data.contracts.map((c) => [c.contractKey, c.personKey]));
  const natureOf = new Map((headcountItems(data, date, opts, "nature") ?? []).map((x) => [x.contract, x.group]));
  const seen = new Set<string>();
  const out: SplitItem[] = [];
  for (const e of Object.keys(h.bySiret).sort())
    for (const n of [...opts.natures].sort()) {
      const g = headcountAt(data, date, { ...opts, natures: [n], establishments: [e] });
      if (g.kind === "nd") continue;
      for (const k of g.contractKeys) {
        seen.add(k);
        out.push({ group: crossKey(splitLabel("etablissement", e), splitLabel("nature", n)), contract: k, person: person.get(k) ?? null });
      }
    }
  for (const k of h.contractKeys) if (!seen.has(k)) out.push({ group: crossKey(ETABLISSEMENT_ND, natureOf.get(k) ?? NATURE_ND), contract: k, person: person.get(k) ?? null });
  return out;
}

// Stock d'une fin de mois : groupes du tableau (stockGroups ; valeur d'ordre : l'effectif, effectif et ETP masqués ensemble), cellule de
// stockColumn ; marges : colonnes canoniques des stocks par établissement et par nature (stockColumn sur headcountItems). null : effectif
// n.d. (aucun total publié).
export function crossStockColumn(data: RhBuildData, date: string, opts: HeadcountOpts, seuil: number): { groups: Record<string, StockGroup>; status: Map<string, MaskStatus> } | null {
  const cross = crossHeadcountItems(data, date, opts);
  const byEtab = headcountItems(data, date, opts, "etablissement");
  const byNature = headcountItems(data, date, opts, "nature");
  if (!cross || !byEtab || !byNature) return null;
  const groups = stockGroups(cross);
  const cells = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, projectedGroupCell(g, seuil, stockCount(g), stockCount(g) > 0)]));
  return { groups, status: crossMask(cells, { etablissement: stockColumn(stockGroups(byEtab), seuil), nature: stockColumn(stockGroups(byNature), seuil) }, seuil) };
}
