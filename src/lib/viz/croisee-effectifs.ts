import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ChartSeries } from "@/components/charts/shared";
import { categoryOfContract, getCategoryNatures, getContractCategories, type CategoryNatures, type ContractCategories } from "@/lib/budget/categories";
import { AXES, monthlyGrid, UNAVAILABLE_AXES, type Axis, type Grid, type RealSource } from "@/lib/budget/monthly";
import { CATEGORY_LABELS } from "@/lib/budget/types";
import { nd as ndCell, val } from "@/lib/budget/versions";
import { contractEcheances, type EcheanceContract } from "@/lib/croisee/echeances";
import { memoPublicModel as memoByContext } from "@/lib/croisee/public";
import { confidentialiteHref, isHidden, maskGroups, maskReason, type PersonsOfContracts } from "@/lib/confidentialite";
import { countedMovements, flowCounts, flowPartitionStatus, type FlowCount } from "@/lib/confidentialite/flows";
import { columnStatus, stockColumn, stockGroups, type StockGroup } from "@/lib/confidentialite/columns";
import { confidentialiteOf, groupInput, NO_GROUP } from "@/lib/croisee/confidentialite";
import { effectifStructure, groupsOfContracts, personOf, type Confidentialite, type StructureContract } from "@/lib/croisee/structure";
import { croiseeSettingReason, croiseeSettingsHref, settingValue, seuilNote, type CroiseeSetting, type CroiseeSettingKey, type CroiseeSettings, type CroiseeSettingValues, type SeuilEffectif } from "@/lib/croisee/settings-format";
import { formatDate, monthEnd, monthsBetween } from "@/lib/dates";
import { contractNatureLabel, endReasonLabel } from "@/lib/dsn/labels";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { buildContractServiceMap } from "@/lib/payroll/service-map";
import { headcountAt } from "@/lib/rh/headcount";
import { headcountAverage } from "@/lib/rh/kpi/average";
import { compareWindows, delta, etpValue } from "@/lib/rh/kpi/compare";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { ETP_PRORATED_LABEL, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { ratio, sub } from "@/lib/rh/kpi/fraction";
import { civilWindow, countedOpts, rollingWindow } from "@/lib/rh/kpi/period";
import { monthMovements, turnover, windowMovements } from "@/lib/rh/kpi/turnover";
import { kpiNd, type Delta, type EventWhy, type Ratio } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { plainVariation, sparkValues, type AlertSpec, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeRow, type CroiseeTable, type TileSpec, type TileVariation } from "@/lib/viz/croisee";
import { etpProratedNotes, headcountSeries, monthAxis, monthLongLabel, movementSeries, splitAxisLabel, type CountIn, type EtpProratedIn, type RowIn } from "@/lib/viz/kpi";
import { capital, monthShortYear } from "@/lib/viz/masse";
import { averageTile, deltaView, etpTile, headcountTile, kpiRefusal, MONTH_NAMES, nd as ndTile, periodLabel, rateTile, windowOf, type AverageIn, type EtpIn, type HeadcountIn, type RateIn, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 02 · Effectifs & mouvements. buildEffectifs est une fonction PURE : elle met en forme des
// résultats déjà calculés par le moteur des KPI RH (kpiDashboard, moyennes, turnover, mouvements), par la grille des effectifs
// mensuels (monthlyGrid) et par deux fonctions pures du chapitre (structure de l'effectif, échéances de contrat). L'écran, le CSV et
// l'Excel partent du même modèle (effectifsModel, un calcul par requête). loadEffectifsInput lit les sources par les lecteurs du
// contexte et appelle ces fonctions : aucun nouveau moteur de calcul. Un n.d. reste n.d. (raison écrite) jusqu'au tableau et au
// graphique.
//
// Confidentialité : aucun nom ni identifiant de personne, de contrat ou d'absence dans le modèle (raisons du moteur qui en citent
// remplacées par une raison générique, journal agrégé par mois et par nature). Seuil de confidentialité (Paramètres) sur toute
// répartition (service, catégorie, statut, nature, motif de sortie, structure) avec masquage secondaire, la taille d'un groupe étant
// toujours un nombre de personnes distinctes (clé de personne du référentiel RH) ; un contrat sans personne rattachée est NON RELIÉ :
// jamais compté comme une personne, il ne protège pas, et un groupe qui en compte sous le seuil n'est pas dénombré (règle du module
// partagé src/lib/confidentialite : personsOfContracts, groupInput) ; les totaux de toute l'entreprise ne sont pas masqués.

// --- Entrée ------------------------------------------------------------------------------------------------------------------------

export type Action = { href: string; label: string };
// Bloc (ou partie de bloc) non calculable : la raison, et l'action qui y remédie (Paramètres, Données).
export type BlockNd = { label?: string; reason: string; action?: Action };

type Compare<T> = { current: T; previous: T; delta: Delta };
export type MovementIn = { kind: "exact" | "lower_bound"; value: number } | { kind: "nd"; nd: { reason: string } };
// Mouvement compté dans le turnover, sans date exacte, sans service ni identifiant : mois, sens, nature, motif de sortie déclaré ;
// contract : jeton du contrat propre à la lecture ; person : jeton de sa personne (null : contrat non relié) ; aucune clé de la source.
export type JournalEventIn = { month: string; kind: "entry" | "exit"; nature: string | null; endReason: string | null; contract: string; person: string | null };
export type JournalMonthIn = { month: string; entries: CountIn; exits: CountIn };
export type GridAxis = Extract<Axis, "service" | "categorie" | "statut">;
// sizes : groupe de chaque ligne à la fin du mois, en personnes reliées distinctes (jetons de personne propres à la lecture, aucune clé
// de la source), contrats non reliés et nombre de contrats (stockGroups du module partagé). Les personnes sont la taille passée au
// seuil de confidentialité ; les jetons font compter une fois une personne présente dans deux groupes masqués ; le nombre de contrats
// (l'effectif) est la valeur d'ordre du masquage. null : effectif non dénombré (seuil non vérifiable).
export type GroupSizes = { cur: Record<string, StockGroup> | null; prev: Record<string, StockGroup> | null };
export type GridsIn = { axis: GridAxis; inscrit: { cur: Grid; prev: Grid }; etp: { cur: Grid; prev: Grid }; sizes: GroupSizes };
// Raison du moteur qui cite des identifiants (texte exact) et son remplacement générique (mois et nombre seulement).
export type ReasonSwap = { raw: string; text: string };

export type EffectifsData = {
  source: "payfit" | "dsn";
  referenceDate: string | null; // date de la lecture RH appliquée
  rows: RowIn[]; // lignes du tableau de bord des KPI (kpiDashboard) pour chaque mois de la période
  prevRows: RowIn[]; // mêmes mois un an plus tôt (N-1)
  headcountDelta: Delta; // effectif de fin de période face à N-1 (delta du moteur des KPI)
  etpEnd: Compare<EtpIn>;
  // qualifier : qualifieur obligatoire du moteur (etpProratedQualifier) ; qualifiers : remarques du moteur quand la valeur existe.
  etpProrated: Compare<EtpProratedIn> & { qualifier: string; qualifiers?: string[] };
  etpAverage: Compare<AverageIn>;
  headcountAverage: Compare<AverageIn>;
  movements: { current: { entries: MovementIn; exits: MovementIn }; previous: { entries: MovementIn; exits: MovementIn } };
  turnover: Compare<RateIn> & { label: string; entries: number | null; exits: number | null };
  annual: { prevYear: number; prev: AverageIn; curMonths: string[]; cur: AverageIn }; // effectif moyen de l'année N-1, et de N à date
  grids: GridsIn[];
  journal: { from: string; to: string; months: JournalMonthIn[]; total: { entries: MovementIn; exits: MovementIn }; events: JournalEventIn[] };
  population: { kind: "value"; lower: boolean; contracts: StructureContract[] } | { kind: "nd"; reason: string }; // effectif de fin de période
  natures: string[]; // natures comptées dans l'effectif (Paramètres des KPI)
  contracts: EcheanceContract[]; // contrats du référentiel (jeton de personne, dates, nature, fin non renseignée) : aucune clé de la source
  reasonSwaps: ReasonSwap[];
};

export type EffectifsInput = {
  links: { parametres: string; confidentialite: string; donnees: string; mouvements: string; tableau: string }; // parametres : réglages de la croisée ; confidentialite : seuil
  // labels : libellés de période du contexte (ctx.labels), repris tels quels dans les titres, les en-têtes et les exports.
  period: { months: string[]; prevMonths: string[]; labels: { period: string; prev: string } } | null;
  service: { value: string | null | undefined; label: string }; // value undefined : tous les services
  settings: CroiseeSettings;
  nd: BlockNd | null; // chapitre entier non calculable (période, source RH, paramètres des KPI)
  data: EffectifsData | null;
};

// --- Modèle ------------------------------------------------------------------------------------------------------------------------

export type EffectifsBlockId = "cartes" | "effectif" | "mouvements" | "repartition" | "journal" | "structure" | "echeances" | "seuils" | "non-disponibles";
export type PrevuItem = { label: string; reason: string };
// Un bloc de l'écran : ses graphiques et tableaux (identifiants dans model.charts / model.tables), ses n.d. et ses mentions « Prévu ».
// Un tableau de model.tables absent de tous les blocs est la forme exportable d'un bloc n.d. (une ligne, sa raison).
// graph : bloc de graphique (affiché aussi dans l'affichage « Graphiques », même n.d.) ; les autres blocs sont des tableaux.
export type EffectifsBlock = { id: EffectifsBlockId; title: string; term?: string; graph?: boolean; nd: BlockNd[]; charts: string[]; tables: string[]; prevu: PrevuItem[]; link?: Action };
export type EffectifsModel = ChapterModel & { blocks: EffectifsBlock[] };

export const NON_FILTRABLE = "non filtrable par service";
export const MOTIF_PAYFIT = "PayFit n'expose pas le motif de fin";
export const DSN_ECHEANCES = "la DSN ne déclare ni les entrées ni les fins à venir";
export const REPARTITION_BORNE = "répartition non publiée : total du mois en borne basse";
export const NON_VENTILE = "Non ventilé";

const SEXE_REASON = UNAVAILABLE_AXES.find((a) => a.label === "Sexe")?.reason ?? "sexe absent du référentiel Collaborateurs lu";
// Caractéristiques de l'effectif que Clair ne lit pas : « Prévu », avec la raison de la matrice (aucune valeur reconstituée).
export const PREVU_STRUCTURE: PrevuItem[] = [
  { label: "Femmes et hommes", reason: SEXE_REASON },
  { label: "Âge moyen et tranches d'âge", reason: "date de naissance non lue par Clair" },
  { label: "Cadres et non-cadres", reason: "PayFit ne fournit à Clair que l'indicateur « cadre dirigeant », pas le statut cadre" },
  { label: "Ancienneté moyenne et tranches d'ancienneté", reason: "règle de continuité de présence non paramétrée" },
];
const CADRES_DSN: PrevuItem = { label: "Cadres et non-cadres", reason: "statut catégoriel de la DSN non lu par Clair" };
export const prevuStructure = (source: "payfit" | "dsn"): PrevuItem[] => (source === "dsn" ? PREVU_STRUCTURE.map((x) => (x.label === CADRES_DSN.label ? CADRES_DSN : x)) : PREVU_STRUCTURE);
export const PREVU_INDICATEURS: PrevuItem[] = [
  { label: "Écart d'ETP au budget", reason: "le budget saisi ne porte pas d'ETP" },
  { label: "Postes ouverts non pourvus", reason: "aucun budget par poste" },
  { label: "Fins de période d'essai", reason: "date de fin de période d'essai non lue par Clair" },
];
export const PREVU_PROJECTION: PrevuItem = { label: "Projection du dernier trimestre", reason: "effectif projeté d'un scénario non repris dans ce chapitre" };
export const PREVU_MOTIFS_PAYFIT: PrevuItem = { label: "Récapitulatif des motifs de sortie", reason: MOTIF_PAYFIT };

const TERMS = {
  effectif: "headcount-persons",
  inscrits: "headcount-contracts",
  etpFin: T.etpFinMois,
  etpProratise: T.etpProratise,
  etpMoyen: T.etpMoyen,
  effectifMoyen: "headcount-average",
  mouvements: "movements",
  turnover: "turnover",
} as const;
export const EFFECTIFS_TERMS: string[] = [
  TERMS.effectif,
  TERMS.inscrits,
  TERMS.etpFin,
  TERMS.etpProratise,
  TERMS.etpMoyen,
  TERMS.effectifMoyen,
  TERMS.mouvements,
  TERMS.turnover,
  T.repartitionEffectifs,
  T.journalMouvements,
  T.structureEffectif,
  T.confidentialite,
  T.echeancesContrat,
  T.seuilsEffectif,
];

// --- Petites mises en forme (aucun calcul) -----------------------------------------------------------------------------------------

const nf = new Intl.NumberFormat("fr-FR");
const monthName = (m: string) => capital(MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m);
const fin = (m: string) => `fin ${monthLongLabel(m)}`;
const plural = (n: number, one: string, more: string) => `${nf.format(n)} ${n > 1 ? more : one}`;
const isNum = (c: CroiseeCell): c is number => typeof c === "number";
const ndOf = (c: CroiseeCell): { nd: string } | null => (typeof c === "object" && c !== null && "nd" in c ? c : null);

const prevLine = (v: TileValue): TileVariation => plainVariation("N-1", v.kind === "nd" ? null : v.text, v.kind === "nd" ? v.reason : null);
// Écart du moteur ; un écart de personnes entier s'écrit sans décimales (« +2 personnes »).
const deltaLine = (d: Delta): TileVariation => {
  if (d.kind === "exact" && d.unit === "persons" && d.value.den === 1) {
    const n = d.value.num;
    return plainVariation("Écart", `${n > 0 ? "+" : ""}${fmtFixed(d.value, 0)} personne${Math.abs(n) > 1 ? "s" : ""}`);
  }
  const v = deltaView(d);
  return plainVariation("Écart", v.text, v.reason);
};
const movementTile = (m: MovementIn): TileValue =>
  m.kind === "nd" ? ndTile(m.nd.reason) : m.kind === "lower_bound" ? { text: `≥ ${nf.format(m.value)}`, kind: "lower", reason: null } : { text: nf.format(m.value), kind: "value", reason: null };

// Cellules : un n.d. reste { nd: raison } ; une borne basse s'écrit « ≥ x » (jamais une valeur exacte) ; zéro seulement s'il est réel.
const headcountCell = (h: HeadcountIn): CroiseeCell => (h.kind === "nd" ? { nd: h.nd.reason } : h.kind === "lower_bound" ? `≥ ${nf.format(h.persons)}` : h.persons);
const countCell = (c: CountIn | MovementIn): CroiseeCell => (c.kind === "nd" ? { nd: c.nd.reason } : c.kind === "lower_bound" ? `≥ ${nf.format(c.value)}` : c.value);
const exactOf = (r: Ratio): CroiseeCell => ({ exact: r.num / r.den });
const averageCell = (a: AverageIn): CroiseeCell => (a.kind === "nd" ? { nd: a.nd.reason } : a.kind === "lower_bound" ? `≥ ${fmtFixed(a.ratio)}` : exactOf(a.ratio));
const gridCell = (g: Grid, group: string | null, m: string): CroiseeCell => {
  if (g.kind === "nd") return { nd: g.reason };
  const c = group === null ? g.total(m) : g.cell(group, m);
  return c.kind === "value" ? c.v : c.kind === "nd" ? { nd: c.reason } : "";
};
// Écart N − N-1 de deux cellules entières (effectif, dix-millièmes d'ETP) : n.d. avec la raison de la cellule qui manque (une cellule
// masquée garde la raison de confidentialité : l'écart ne la révèle pas).
export function gapCell(cur: CroiseeCell, prev: CroiseeCell): CroiseeCell {
  if (isNum(cur) && isNum(prev)) return cur - prev;
  const r = ndOf(cur) ?? ndOf(prev);
  return r ? { nd: r.nd } : "";
}

const text = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "text", ...extra });
const num = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "nombre", ...extra });

// Forme exportable d'un bloc n.d. : une ligne, la raison (jamais un tableau vide qui se lirait comme « aucun »).
export function ndTable(id: string, title: string, reason: string): CroiseeTable {
  return { id, title, columns: [text("bloc", "Bloc"), text("valeur", "Valeur")], rows: [{ cells: [title, { nd: reason }] }] };
}

// Réglage de la Masse salariale croisée : valeur, ou n.d. avec la raison écrite et le lien vers les Paramètres (jamais de défaut).
type SettingOut<K extends CroiseeSettingKey> = { value: CroiseeSettingValues[K] } | { nd: BlockNd };
function setting<K extends CroiseeSettingKey>(settings: CroiseeSettings, key: K, parametres: string): SettingOut<K> {
  const s = settings[key] as CroiseeSetting<unknown>;
  const v = settingValue(s) as CroiseeSettingValues[K] | null;
  if (v !== null) return { value: v };
  return { nd: { reason: croiseeSettingReason(key, s) ?? "paramètre non défini (Paramètres)", action: { href: parametres, label: "Paramètres" } } };
}

// --- Identifiants retirés des raisons (D2) -----------------------------------------------------------------------------------------

export const continuityText = (n: number, month: string): string =>
  n > 1 ? `${nf.format(n)} contrats continus non vérifiables en ${month} (détail dans KPI RH)` : `1 contrat continu non vérifiable en ${month} (détail dans KPI RH)`;

type MovementCount = { kind: string; nd?: { code: string; reason: string } };
type MonthMovementsLike = { month: string; entries: MovementCount; exits: MovementCount; events: readonly { why: EventWhy; row: { event: { kind: "entry" | "exit" } } }[] };
// Raisons « contrats continus non vérifiables » du moteur (elles listent les identifiants des contrats) : texte exact → raison générique
// qui garde le mois et le nombre de contrats. Une raison du même code sans contrat continu en cause (contrats archivés PayFit) ne cite
// aucun identifiant : elle est gardée.
export function continuitySwaps(list: readonly MonthMovementsLike[]): ReasonSwap[] {
  const out: ReasonSwap[] = [];
  for (const mv of list) {
    for (const kind of ["entry", "exit"] as const) {
      const c = kind === "entry" ? mv.entries : mv.exits;
      if (c.kind !== "nd" || c.nd?.code !== "coverage-incomplete") continue;
      const n = mv.events.filter((x) => x.why === "continuity-unknown" && x.row.event.kind === kind).length;
      if (n > 0 && !out.some((s) => s.raw === c.nd!.reason)) out.push({ raw: c.nd.reason, text: continuityText(n, mv.month) });
    }
  }
  return out;
}

// Filet de sécurité : une liste de contrats entre parenthèses après « contrats continus non vérifiables » (texte du moteur repris sous
// une autre forme, ou coupé) est retirée.
const CONTINUITY_LIST = /contrats continus non vérifiables \([^()]*(\)|$)/g;
export function scrubText(s: string, swaps: readonly ReasonSwap[]): string {
  let out = s;
  for (const w of swaps) if (out.includes(w.raw)) out = out.split(w.raw).join(w.text);
  return out.replace(CONTINUITY_LIST, "contrats continus non vérifiables (détail dans KPI RH)");
}
// Chaque texte du modèle (cartes, tableaux, séries, notes, alertes) passe par scrubText ; le modèle n'a que des données simples.
export function scrubModel<T>(x: T, swaps: readonly ReasonSwap[]): T {
  if (typeof x === "string") return scrubText(x, swaps) as T;
  if (Array.isArray(x)) return x.map((v) => scrubModel(v, swaps)) as T;
  if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrubModel(v, swaps)])) as T;
  return x;
}

// --- Seuils d'effectif ---------------------------------------------------------------------------------------------------------------

// Écart exact entre un effectif moyen (fraction) et un seuil (entier) : effectif moyen − seuil, positif au-dessus du seuil.
export function seuilGap(a: AverageIn, valeur: number): CroiseeCell {
  if (a.kind === "nd") return { nd: a.nd.reason };
  if (a.kind === "lower_bound") return { nd: "effectif moyen en borne basse : écart non calculable" };
  return exactOf(sub(a.ratio, ratio(valeur, 1)));
}

// Repère « Effectif proche d'un seuil » : le prochain seuil strictement supérieur à l'effectif moyen est à une distance inférieure ou
// égale à la marge d'alerte (comparaison exacte en fractions, aucune tolérance). Sans seuil ou sans marge : aucune alerte.
export function seuilAlerts(list: { id: string; label: string; avg: AverageIn }[], seuils: readonly SeuilEffectif[], marge: number): AlertSpec[] {
  const out: AlertSpec[] = [];
  for (const x of list) {
    if (x.avg.kind !== "exact") continue;
    const { num: n, den: d } = x.avg.ratio;
    const next = [...seuils].sort((a, b) => a.valeur - b.valeur).find((s) => s.valeur * d > n);
    if (!next || next.valeur * d - n > marge * d) continue;
    out.push({
      id: `effectifs-seuil-${x.id}`,
      level: "repere",
      label: "Effectif proche d'un seuil",
      text: `${x.label} : ${fmtFixed(x.avg.ratio)} pour le seuil « ${next.libelle} » (${nf.format(next.valeur)}) ; marge d'alerte : ${nf.format(marge)}.`,
      href: "#cx-effectifs-seuils",
      linkLabel: "Voir les seuils",
    });
  }
  return out;
}

// --- Répartitions masquées (seuil de confidentialité) -------------------------------------------------------------------------------

// Contrat compté à une fin de mois, vu par sa personne : identifiant du contrat dans la source (il ne sort pas de la fonction) et
// jeton de sa personne (null : contrat non relié).
export type CountedContract = { id: string; person: string | null };

// Groupe de chaque service à une fin de mois (personnes reliées distinctes, contrats non reliés et nombre de contrats, stockGroups) :
// contrats qui portent l'ETP de fin de mois, rangés par le service de leurs lignes de paie du mois (règle de l'ETP par service), sans
// ligne : « Non ventilé » ; une personne qui a deux contrats dans un même service y figure une fois.
export function serviceSizes(contracts: readonly CountedContract[], serviceOf: (contractId: string) => string | null): Record<string, StockGroup> {
  return stockGroups(contracts.map((c) => ({ group: serviceOf(c.id) ?? NON_VENTILE, contract: c.id, person: c.person })));
}

// Groupe d'un contrat sur l'axe catégorie ou statut : même règle que la grille des effectifs mensuels (budget/monthly.ts) —
// catégorie de la table de l'espace, corrigée contrat par contrat (« Non classé » sans catégorie) ; cadre dirigeant ou non (« Statut
// n.d. » quand la source ne le dit pas).
export type AxisContract = { externalId: string; nature: string | null; executive: boolean | null };
export function axisGroup(c: AxisContract, axis: Exclude<GridAxis, "service">, natures: CategoryNatures, overrides: ContractCategories): string {
  if (axis === "categorie") {
    const id = categoryOfContract(c.externalId, c.nature, natures, overrides);
    return id ? CATEGORY_LABELS[id] : "Non classé";
  }
  return c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : "Statut n.d.";
}

type AxisRow = { group: string; cells: CroiseeCell[] }; // inscrits N, inscrits N-1, écart, ETP N, ETP N-1, écart
// Inscrits et ETP de fin de mois d'un axe, N et N-1, avec le seuil de confidentialité : le statut de chaque groupe à une fin de mois est
// celui de la passe partagée des stocks (stockColumn, la même que KPI RH › Effectifs mensuels et le tableau par catégorie du Suivi :
// mêmes groupes, formés de tous les contrats présents en fin de mois et non des seuls groupes affichés ; valeur d'ordre : l'effectif,
// jamais l'ETP ; même départage des égalités) ; le couple (inscrits, ETP) est masqué ensemble. Le total de l'entreprise n'est pas
// masqué. L'écart d'un groupe masqué est n.d. avec la même raison. Un groupe qui porte des inscrits ou de l'ETP sans aucune personne
// dénombrée (rattachements divergents, contrats non reliés sous le seuil) n'est pas vérifiable : il n'est pas affiché.
export function maskedAxis(g: GridsIn, groups: readonly string[], to: string, prevTo: string, seuil: number): { rows: AxisRow[]; foot: CroiseeCell[] } {
  const side = (which: "cur" | "prev", m: string) => {
    const ins = groups.map((grp) => gridCell(g.inscrit[which], grp, m));
    const etp = groups.map((grp) => gridCell(g.etp[which], grp, m));
    const sizes = g.sizes[which];
    const totIns = gridCell(g.inscrit[which], null, m);
    const totEtp = gridCell(g.etp[which], null, m);
    // Valeur affichée d'un groupe (inscrits, à défaut ETP) ; une valeur non nulle sans contrat du groupe est non vérifiable ; effectif
    // non dénombré pour toute la fin de mois (sizes null) : chaque groupe qui porte une valeur est non vérifiable.
    const value = (i: number): number | null => (isNum(ins[i]) ? (ins[i] as number) : isNum(etp[i]) ? (etp[i] as number) : null);
    const valued = groups.filter((_, i) => [ins[i], etp[i]].some((c) => isNum(c) && c !== 0));
    const col = sizes ? stockColumn(sizes, seuil, valued) : stockColumn(Object.fromEntries(groups.flatMap((grp, i) => (value(i) === null ? [] : [[grp, null]]))), seuil);
    const status = groups.map((grp, i) => columnStatus(col, grp, value(i)));
    // Seule une valeur est masquée : une cellule déjà n.d. garde sa propre raison.
    const hide = (c: CroiseeCell, i: number): CroiseeCell => (isHidden(status[i]) && isNum(c) ? { nd: maskReason(status[i], seuil)! } : c);
    return { ins: ins.map(hide), etp: etp.map(hide), totIns, totEtp };
  };
  const cur = side("cur", to);
  const prev = side("prev", prevTo);
  const rows = groups.map((group, i) => ({ group, cells: [cur.ins[i], prev.ins[i], gapCell(cur.ins[i], prev.ins[i]), cur.etp[i], prev.etp[i], gapCell(cur.etp[i], prev.etp[i])] }));
  return { rows, foot: [cur.totIns, prev.totIns, gapCell(cur.totIns, prev.totIns), cur.totEtp, prev.totEtp, gapCell(cur.totEtp, prev.totEtp)] };
}

// Effectif d'une nature dans un mois : contrats concernés (valeur affichée) et leur groupe en personnes reliées distinctes (jetons,
// taille passée au seuil ; une personne présente dans deux natures masquées y compte une fois) et contrats non reliés. Convention
// partagée avec KPI RH (src/lib/confidentialite/flows.ts : FlowCount).
export type NatureCount = FlowCount;

// Cellules « dont <nature> » d'un total du mois : une cellule par nature comptée, le nombre de contrats, masquée quand elle concerne
// de 1 à (seuil − 1) personnes distinctes, non vérifiable quand ses contrats non reliés laissent les personnes reliées sous le seuil
// (masquage secondaire dans le mois, dont le total est affiché). Total n.d. : la même raison ; total en borne basse : la répartition
// n'est pas publiée. Statuts : flowPartitionStatus (src/lib/confidentialite/flows.ts), la fonction que KPI RH appelle pour les entrées
// et les sorties du périmètre retenu par le filtre Nature : une même cellule a le même statut sur les deux écrans.
export function natureCells(counts: Readonly<Record<string, NatureCount>>, natures: readonly string[], total: CountIn | MovementIn | number, seuil: number): CroiseeCell[] {
  if (typeof total !== "number" && total.kind === "nd") return natures.map(() => ({ nd: total.nd.reason }));
  if (typeof total !== "number" && total.kind === "lower_bound") return natures.map(() => ({ nd: REPARTITION_BORNE }));
  const st = flowPartitionStatus(counts, natures, seuil, true);
  return natures.map((n, i) => (isHidden(st[i]) ? { nd: maskReason(st[i], seuil)! } : (counts[n]?.contracts ?? 0)));
}

// Mouvements comptés d'un mois par nature (agrégation du journal : aucune date exacte, aucun service) : contrats et leur groupe.
export function countByNature(events: readonly JournalEventIn[], month: string, kind: "entry" | "exit"): Record<string, NatureCount> {
  const list = events.filter((e): e is JournalEventIn & { nature: string } => e.month === month && e.kind === kind && e.nature !== null);
  return flowCounts(list.map((e) => ({ group: e.nature, contract: e.contract, person: e.person })));
}

// Récapitulatif des motifs de sortie (DSN) : sorties comptées par motif déclaré. Un motif qui concerne moins de personnes reliées
// distinctes que le seuil n'est pas nommé : il rejoint « Autres motifs (k motifs) », lui-même masqué s'il concerne moins de personnes
// que le seuil, ou non vérifiable (contrats non reliés) ; masquage secondaire : le total est affiché.
export function exitMotifRows(events: readonly JournalEventIn[], seuil: number): { rows: { label: string; cell: CroiseeCell }[]; total: number } {
  const exits = events.filter((e) => e.kind === "exit").map((e) => ({ code: e.endReason ?? "", contract: e.contract, person: e.person }));
  const by = new Map<string, number>();
  for (const e of exits) by.set(e.code, (by.get(e.code) ?? 0) + 1);
  const who = groupsOfContracts(exits.map((e) => ({ group: e.code, ...e })));
  const label = (code: string) => (code === "" ? "Motif non déclaré" : endReasonLabel(code));
  const big = [...by].filter(([code]) => who[code].persons.length >= seuil).map(([code, n]) => ({ label: label(code), n, group: who[code] })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const small = [...by].filter(([code]) => who[code].persons.length < seuil);
  const smallCodes = new Set(small.map(([code]) => code));
  const others = { label: `Autres motifs (${plural(small.length, "motif", "motifs")})`, n: small.reduce((s, [, n]) => s + n, 0), group: groupsOfContracts(exits.filter((e) => smallCodes.has(e.code)).map((e) => ({ group: "autres", ...e }))).autres ?? NO_GROUP };
  const groups = [...big, ...(small.length ? [others] : [])];
  // members : une personne sortie deux fois, sous deux motifs masqués, n'y compte qu'une fois.
  const st = maskGroups(
    groups.map((x) => groupInput(x.group, seuil, x.n)),
    seuil,
    true,
  );
  return { rows: groups.map((x, i) => ({ label: x.label, cell: isHidden(st[i]) ? { nd: maskReason(st[i], seuil)! } : x.n })), total: exits.length };
}

// Compte écrit hors d'un tableau (échéances « fin non datée », « sans date de début ») : le nombre de contrats, ou n.d. avec la raison
// de confidentialité quand ils concernent de 1 à (seuil − 1) personnes distinctes, ou des contrats non reliés sous le seuil (même
// règle que les cellules du tableau ; aucun total publié ne les contient, pas de masquage secondaire).
export function outsideCount(contracts: number, group: PersonsOfContracts, seuil: number): CroiseeCell {
  const [st] = maskGroups([groupInput(group, seuil, contracts)], seuil, false);
  return isHidden(st) ? { nd: maskReason(st, seuil)! } : contracts;
}

// Colonnes d'un tableau mois × nature : pour chaque mesure, le total puis « dont <nature> » (seulement s'il y a plusieurs natures).
function natureColumns(measures: { key: string; header: string; term?: string }[], natures: readonly string[]): CroiseeColumn[] {
  const split = natures.length > 1;
  return measures.flatMap((m) => [num(m.key, m.header, m.term ? { term: m.term } : {}), ...(split ? natures.map((n) => num(`${m.key}-${n}`, `dont ${contractNatureLabel(n)}`, { term: "natures" })) : [])]);
}

// --- Construction du modèle -------------------------------------------------------------------------------------------------------

const AXIS_TITLES: Record<GridAxis, string> = { service: "par service", categorie: "par catégorie de contrat", statut: "par statut de cadre dirigeant" };
const TAIL = (s: string) => (s === "Non classé" || s === "Hors salarié" || s === NON_VENTILE || s.endsWith("n.d.") ? 1 : 0);
const groupsOf = (grids: Grid[]): string[] => [...new Set(grids.flatMap((g) => (g.kind === "value" ? g.groups : [])))].sort((a, b) => TAIL(a) - TAIL(b) || a.localeCompare(b, "fr"));

export function buildEffectifs(input: EffectifsInput): EffectifsModel {
  const empty: EffectifsModel = { chapter: "effectifs", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: EFFECTIFS_TERMS, blocks: [] };
  const d = input.data;
  const p = input.period;
  if (input.nd || !d || !p || p.months.length === 0) {
    const nd = input.nd ?? { reason: "aucun mois disponible", action: { href: input.links.donnees, label: "Données" } };
    return { ...empty, nd: { reason: nd.reason, action: nd.action } };
  }
  return scrubModel(buildChapter(input, d, p), d.reasonSwaps);
}

function buildChapter(input: EffectifsInput, d: EffectifsData, p: NonNullable<EffectifsInput["period"]>): EffectifsModel {
  const { months, prevMonths } = p;
  const to = months[months.length - 1];
  const prevTo = prevMonths[prevMonths.length - 1];
  const label = p.labels.period;
  const prevLabel = p.labels.prev;
  const filtered = input.service.value !== undefined;
  const paramAction: Action = { href: input.links.parametres, label: "Paramètres" };
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: EffectifsBlock[] = [];
  const block = (b: Omit<EffectifsBlock, "nd" | "charts" | "tables" | "prevu"> & Partial<Pick<EffectifsBlock, "nd" | "charts" | "tables" | "prevu">>) => {
    const full: EffectifsBlock = { nd: [], charts: [], tables: [], prevu: [], ...b };
    blocks.push(full);
    return full;
  };
  // Bloc entièrement n.d. : la raison à l'écran, et un tableau d'une ligne pour l'export.
  const ndBlock = (id: EffectifsBlockId, title: string, tableId: string, nd: BlockNd, extra: Partial<EffectifsBlock> = {}) => {
    tables.push(ndTable(tableId, title, nd.reason));
    return block({ id, title, nd: [nd], ...extra });
  };
  // Seuil de confidentialité (module partagé) : sans réglage lisible, chaque répartition est n.d. avec la raison et le lien vers
  // Paramètres › Confidentialité.
  const confRead = confidentialiteOf(input.settings.confidentialite);
  const seuil = confRead.kind === "set" ? confRead.value : null;
  const confNd: BlockNd | null = confRead.kind === "nd" ? { reason: confRead.reason, action: { href: input.links.confidentialite, label: "Paramètres" } } : null;

  // --- Où sont les effectifs ? (calculé d'abord : la carte « ETP fin de mois » d'un service filtré lit la même grille masquée)
  const serviceGrid = d.grids.find((g) => g.axis === "service") ?? null;
  const axisModel = (g: GridsIn) => {
    const groups = groupsOf([g.inscrit.cur, g.inscrit.prev, g.etp.cur, g.etp.prev]);
    // Masquage calculé sur les groupes de la grille, comme sans filtre ; le service retenu a toujours sa ligne, même absent des
    // groupes de la grille (n.d. avec la raison de la grille, ou 0 réel), ajoutée sans changer le masquage des autres.
    const am = maskedAxis(g, groups, to, prevTo, seuil!);
    if (!filtered || g.axis !== "service" || groups.includes(input.service.label)) return am;
    return { rows: [...am.rows, ...maskedAxis(g, [input.service.label], to, prevTo, seuil!).rows], foot: am.foot };
  };
  const serviceAxis = serviceGrid && seuil !== null ? axisModel(serviceGrid) : null;

  // --- Cartes
  const lastRow = d.rows[d.rows.length - 1];
  const lastPrev = d.prevRows[d.prevRows.length - 1];
  const hcSeriesCur = headcountSeries(d.rows)[0];
  const hcSeriesPrev = headcountSeries(d.prevRows)[0];
  // Filtre de service actif : le référentiel RH ne porte pas le service (code analytique des lignes de paie), la carte est n.d.
  const notFiltered = (t: TileSpec): TileSpec => (filtered ? { id: t.id, label: t.label, term: t.term, sub: t.sub, value: ndTile(NON_FILTRABLE), note: t.id === "etp-proratise" ? t.note : undefined } : t);
  const etpServiceTile = (): TileSpec => {
    const base = { id: "etp-fin", label: "ETP fin de mois", term: TERMS.etpFin, sub: `${fin(to)} · ${input.service.label}` };
    if (confNd) return { ...base, value: ndTile(confNd.reason) };
    const row = serviceAxis?.rows.find((r) => r.group === input.service.label);
    if (!serviceGrid || !row) return { ...base, value: ndTile("ETP par service indisponible") };
    const [cur, prev] = [row.cells[3], row.cells[4]];
    const tileOf = (c: CroiseeCell): TileValue => (isNum(c) ? etpTile({ kind: "exact", etp4: c }) : ndTile(ndOf(c)?.nd ?? "ETP du service n.d."));
    const valued = (c: CroiseeCell) => (isNum(c) ? { kind: "exact" as const, etp4: c } : { kind: "nd" as const, nd: kpiNd("month-nd", ndOf(c)?.nd ?? "ETP du service n.d.") });
    return { ...base, value: tileOf(cur), variations: [prevLine(tileOf(prev)), deltaLine(delta(valued(cur), valued(prev), etpValue, "etp", fin(prevTo)))] };
  };
  const prorNotes = etpProratedNotes(d.etpProrated.current.kind === "nd" || !d.etpProrated.qualifiers?.length ? [d.etpProrated.qualifier] : d.etpProrated.qualifiers).join(" ; ");
  const tiles: TileSpec[] = [
    notFiltered({
      id: "effectif",
      label: "Effectif fin de mois",
      term: TERMS.effectif,
      sub: fin(to),
      value: headcountTile(lastRow.headcount),
      variations: [prevLine(headcountTile(lastPrev.headcount)), deltaLine(d.headcountDelta)],
      spark: { label: `Effectif fin de mois, ${label}`, values: sparkValues(hcSeriesCur.values) },
    }),
    filtered
      ? etpServiceTile()
      : {
          id: "etp-fin",
          label: "ETP fin de mois",
          term: TERMS.etpFin,
          sub: fin(to),
          value: etpTile(d.etpEnd.current),
          variations: [prevLine(etpTile(d.etpEnd.previous)), deltaLine(d.etpEnd.delta)],
        },
    // Le qualifieur obligatoire de l'ETP proratisé reste écrit, même quand la carte est n.d. (filtre de service).
    notFiltered({
      id: "etp-proratise",
      label: ETP_PRORATED_LABEL,
      term: TERMS.etpProratise,
      sub: capital(monthLongLabel(to)),
      value: averageTile(d.etpProrated.current),
      variations: [prevLine(averageTile(d.etpProrated.previous)), deltaLine(d.etpProrated.delta)],
      note: prorNotes,
    }),
    notFiltered({
      id: "etp-moyen",
      label: "ETP moyen",
      term: TERMS.etpMoyen,
      sub: capital(label),
      value: averageTile(d.etpAverage.current),
      variations: [prevLine(averageTile(d.etpAverage.previous)), deltaLine(d.etpAverage.delta)],
    }),
    notFiltered({
      id: "effectif-moyen",
      label: "Effectif moyen",
      term: TERMS.effectifMoyen,
      sub: capital(label),
      value: averageTile(d.headcountAverage.current),
      variations: [prevLine(averageTile(d.headcountAverage.previous)), deltaLine(d.headcountAverage.delta)],
    }),
    notFiltered({
      id: "entrees",
      label: "Entrées",
      term: TERMS.mouvements,
      sub: capital(label),
      value: movementTile(d.movements.current.entries),
      variations: [prevLine(movementTile(d.movements.previous.entries))],
    }),
    notFiltered({
      id: "sorties",
      label: "Sorties",
      term: TERMS.mouvements,
      sub: capital(label),
      value: movementTile(d.movements.current.exits),
      variations: [prevLine(movementTile(d.movements.previous.exits))],
      note: d.source === "payfit" ? `Motif de sortie : n.d. — ${MOTIF_PAYFIT}` : undefined,
    }),
    notFiltered({
      id: "turnover",
      label: "Turnover 12 mois glissants",
      term: TERMS.turnover,
      sub: capital(d.turnover.label),
      value: rateTile(d.turnover.current),
      variations: [prevLine(rateTile(d.turnover.previous)), deltaLine(d.turnover.delta)],
      note:
        d.turnover.current.kind === "exact"
          ? `${d.turnover.entries === null ? "entrées n.d." : plural(d.turnover.entries, "entrée", "entrées")} · ${d.turnover.exits === null ? "sorties n.d." : plural(d.turnover.exits, "sortie", "sorties")}`
          : undefined,
    }),
  ];
  block({ id: "cartes", title: "Chiffres clés", term: T.periodeFiltres });

  // --- Effectif en fin de mois, N-1 et N (graphique et tableau exact) ; libellés de période du contexte.
  const effTitle = `Effectif en fin de mois, ${label} face à ${prevLabel}`;
  if (filtered) ndBlock("effectif", effTitle, "effectif-mensuel", { reason: NON_FILTRABLE }, { term: TERMS.effectif, graph: true });
  else {
    const ax = monthAxis(months, prevMonths);
    const series: ChartSeries[] = [
      { ...hcSeriesPrev, key: "effectif-n1", name: `${prevLabel} (N-1)`, color: "var(--chart-7)" },
      { ...hcSeriesCur, key: "effectif", name: label, color: "var(--chart-1)" },
    ];
    charts.push({ id: "effectif-mensuel", title: effTitle, kind: "barres", unit: "nombre", categories: ax.categories, categoryTitles: ax.titles, series, mode: "grouped", tableId: "effectif-mensuel" });
    tables.push({
      id: "effectif-mensuel",
      title: `${effTitle} (personnes)`,
      columns: [text("mois", "Mois"), num("n1", `${capital(prevLabel)} (N-1)`, { term: TERMS.effectif }), num("n", capital(label), { term: TERMS.effectif })],
      rows: months.map((m, i) => ({ cells: [monthName(m), headcountCell(d.prevRows[i]?.headcount ?? { kind: "nd", nd: { reason: "mois N-1 non lu" } }), headcountCell(d.rows[i].headcount)] })),
      terms: [TERMS.effectif, T.nMoinsUn],
    });
    block({ id: "effectif", title: effTitle, term: TERMS.effectif, graph: true, charts: ["effectif-mensuel"], tables: ["effectif-mensuel"], prevu: [PREVU_PROJECTION] });
  }

  // --- Entrées et sorties par mois, sur les deux périodes (graphique et tableau exact) : totaux de toute l'entreprise.
  const mvTitle = `Entrées et sorties par mois, ${prevLabel} et ${label}`;
  if (filtered) ndBlock("mouvements", mvTitle, "mouvements", { reason: NON_FILTRABLE }, { term: TERMS.mouvements, graph: true });
  else {
    const allRows = [...d.prevRows, ...d.rows];
    const ax = monthAxis(allRows.map((r) => r.month));
    const [e, s] = movementSeries(allRows);
    charts.push({
      id: "mouvements",
      title: mvTitle,
      kind: "barres",
      unit: "nombre",
      categories: ax.categories,
      categoryTitles: ax.titles,
      series: [{ ...e, color: "var(--chart-1)" }, { ...s, color: "var(--chart-2)" }],
      mode: "grouped",
      tableId: "mouvements",
    });
    const monthRow = (r: RowIn): CroiseeRow => ({ cells: [capital(monthLongLabel(r.month)), countCell(r.movements.entries), countCell(r.movements.exits)] });
    tables.push({
      id: "mouvements",
      title: `${mvTitle} (contrats)`,
      columns: [text("mois", "Mois"), num("entrees", "Entrées", { term: TERMS.mouvements }), num("sorties", "Sorties", { term: TERMS.mouvements })],
      rows: [
        ...d.prevRows.map(monthRow),
        { cells: [`Total ${prevLabel}`, countCell(d.movements.previous.entries), countCell(d.movements.previous.exits)], style: "subtotal" },
        ...d.rows.map(monthRow),
        { cells: [`Total ${label}`, countCell(d.movements.current.entries), countCell(d.movements.current.exits)], style: "subtotal" },
      ],
      terms: [TERMS.mouvements, TERMS.turnover],
    });
    block({ id: "mouvements", title: mvTitle, term: TERMS.mouvements, graph: true, charts: ["mouvements"], tables: ["mouvements"] });
  }

  // --- Où sont les effectifs ? Inscrits et ETP de fin de période, par service, catégorie et statut (grille des effectifs mensuels),
  // écart N − N-1, seuil de confidentialité avec masquage secondaire ; le total de l'entreprise n'est pas masqué.
  const repTitle = "Où sont les effectifs ?";
  const rep = block({ id: "repartition", title: repTitle, term: T.repartitionEffectifs });
  const confAxes: string[] = [];
  for (const g of d.grids) {
    const axisName = splitAxisLabel(AXES.find((a) => a.key === g.axis)?.label ?? g.axis).name;
    const id = `effectifs-${g.axis}`;
    const title = `${repTitle} ${capital(AXIS_TITLES[g.axis])}, ${fin(to)}`;
    if (filtered && g.axis !== "service") {
      tables.push(ndTable(id, title, NON_FILTRABLE));
      rep.nd.push({ label: capital(AXIS_TITLES[g.axis]), reason: NON_FILTRABLE });
      continue;
    }
    if (confNd) {
      tables.push(ndTable(id, title, confNd.reason));
      confAxes.push(AXIS_TITLES[g.axis]);
      continue;
    }
    const am = g.axis === "service" && serviceAxis ? serviceAxis : axisModel(g);
    const rows = am.rows.filter((r) => !filtered || r.group === input.service.label).map((r): CroiseeRow => ({ cells: [r.group, ...r.cells] }));
    tables.push({
      id,
      title,
      columns: [
        text("groupe", axisName),
        num("inscrits", `Inscrits fin ${monthShortYear(to)}`, { term: TERMS.inscrits }),
        num("inscrits-n1", `Inscrits fin ${monthShortYear(prevTo)}`, { term: TERMS.inscrits }),
        num("inscrits-ecart", "Écart", { signed: true, term: T.nMoinsUn }),
        { key: "etp", header: `ETP fin ${monthShortYear(to)}`, kind: "etp", term: TERMS.etpFin },
        { key: "etp-n1", header: `ETP fin ${monthShortYear(prevTo)}`, kind: "etp", term: TERMS.etpFin },
        { key: "etp-ecart", header: "Écart ETP", kind: "etp", signed: true, term: T.nMoinsUn },
      ],
      rows,
      foot: filtered ? undefined : { cells: ["Total", ...am.foot] },
      notes: filtered ? [`Service retenu : ${input.service.label}.`] : [],
      terms: [T.repartitionEffectifs, TERMS.inscrits, TERMS.etpFin, T.confidentialite],
    });
    rep.tables.push(id);
  }
  if (confNd && confAxes.length) rep.nd.push({ label: capital(confAxes.join(", ")), reason: confNd.reason, action: confNd.action });
  tables.push({
    id: "axes-indisponibles",
    title: "Axes de répartition indisponibles",
    columns: [text("axe", "Axe"), text("raison", "Raison")],
    rows: UNAVAILABLE_AXES.map((a) => ({ cells: [a.label, a.reason] })),
    terms: [T.repartitionEffectifs],
  });
  rep.tables.push("axes-indisponibles");

  // --- Journal des mouvements sur douze mois, agrégé : entrées et sorties comptées par mois et par nature (aucune date exacte, aucun
  // service, aucun motif individuel) ; motifs de sortie récapitulés (DSN) ; seuil de confidentialité sur chaque nature et chaque motif.
  const j = d.journal;
  const jTitle = `Journal des mouvements, ${monthShortYear(j.from)} → ${monthShortYear(j.to)}`;
  const jLink: Action = { href: input.links.mouvements, label: "Détail nominatif : Collaborateurs › Mouvements" };
  const jPrevu = d.source === "payfit" ? [PREVU_MOTIFS_PAYFIT] : [];
  if (filtered) ndBlock("journal", jTitle, "journal-mouvements", { reason: NON_FILTRABLE }, { term: T.journalMouvements, link: jLink });
  else if (confNd) ndBlock("journal", jTitle, "journal-mouvements", confNd, { term: T.journalMouvements, link: jLink, prevu: jPrevu });
  else {
    const s = seuil!;
    const split = d.natures.length > 1;
    const dont = (counts: Record<string, NatureCount>, total: CountIn | MovementIn) => (split ? natureCells(counts, d.natures, total, s) : []);
    const blanks = split ? d.natures.map((): CroiseeCell => "") : [];
    tables.push({
      id: "journal-mouvements",
      title: `Mouvements comptés par mois et par nature de contrat, ${monthShortYear(j.from)} → ${monthShortYear(j.to)}`,
      columns: [
        text("mois", "Mois"),
        ...natureColumns(
          [
            { key: "entrees", header: "Entrées", term: TERMS.mouvements },
            { key: "sorties", header: "Sorties", term: TERMS.mouvements },
          ],
          d.natures,
        ),
      ],
      rows: j.months.map((m) => ({
        cells: [capital(monthLongLabel(m.month)), countCell(m.entries), ...dont(countByNature(j.events, m.month, "entry"), m.entries), countCell(m.exits), ...dont(countByNature(j.events, m.month, "exit"), m.exits)],
      })),
      foot: { cells: [`Total ${monthShortYear(j.from)} → ${monthShortYear(j.to)}`, countCell(j.total.entries), ...blanks, countCell(j.total.exits), ...blanks] },
      notes: [seuilNote(s)],
      terms: [T.journalMouvements, TERMS.mouvements, TERMS.turnover, "natures", T.confidentialite],
    });
    const jb = block({ id: "journal", title: jTitle, term: T.journalMouvements, tables: ["journal-mouvements"], link: jLink, prevu: jPrevu });
    if (d.source === "dsn") {
      const motifTitle = `Motifs de sortie, ${monthShortYear(j.from)} → ${monthShortYear(j.to)}`;
      const notExact = j.months.find((m) => m.exits.kind !== "exact");
      if (notExact) {
        const reason = notExact.exits.kind === "nd" ? `sorties de ${monthShortYear(notExact.month)} n.d. : motifs non récapitulés` : "sorties en borne basse : motifs non récapitulés";
        tables.push(ndTable("motifs-sortie", motifTitle, reason));
        jb.nd.push({ label: "Motifs de sortie", reason });
      } else {
        const mr = exitMotifRows(
          j.events.filter((e) => e.kind === "exit"),
          s,
        );
        tables.push({
          id: "motifs-sortie",
          title: motifTitle,
          columns: [text("motif", "Motif de sortie (DSN)"), num("sorties", "Sorties comptées", { term: TERMS.mouvements })],
          rows: mr.rows.map((r) => ({ cells: [r.label, r.cell] })),
          foot: { cells: ["Total", mr.total] },
          notes: mr.rows.length === 0 ? ["Aucune sortie comptée sur ces douze mois."] : [],
          terms: [T.journalMouvements, T.confidentialite],
        });
        jb.tables.push("motifs-sortie");
      }
    }
  }

  // --- Structure de l'effectif (valeurs à la date de lecture), seuil de confidentialité avec masquage secondaire
  const sTitle = `Qui compose l'effectif salarié ? ${capital(fin(to))}`;
  const sPrevu = prevuStructure(d.source);
  const confidentialite: Confidentialite = seuil !== null ? { kind: "set", value: seuil } : { kind: "nd", reason: confNd!.reason };
  if (filtered) ndBlock("structure", sTitle, "structure-effectif", { reason: NON_FILTRABLE }, { term: T.structureEffectif, prevu: sPrevu });
  else if (d.population.kind === "nd") ndBlock("structure", sTitle, "structure-effectif", { reason: d.population.reason }, { term: T.structureEffectif, prevu: sPrevu });
  else {
    const st = effectifStructure({ contracts: d.population.contracts, confidentialite });
    if (st.kind === "nd") ndBlock("structure", sTitle, "structure-effectif", { reason: st.reason, action: confNd ? confNd.action : undefined }, { term: T.structureEffectif, prevu: sPrevu });
    else {
      tables.push({
        id: "structure-effectif",
        title: sTitle,
        columns: [text("caracteristique", "Caractéristique"), num("contrats", "Contrats", { term: TERMS.inscrits })],
        rows: st.dimensions.flatMap((dim): CroiseeRow[] =>
          dim.nd !== null ? [{ cells: [dim.label, { nd: dim.nd }] }] : dim.groups.map((g) => ({ cells: [g.label, g.cell.kind === "value" ? g.cell.contracts : { nd: g.cell.reason }] })),
        ),
        foot: { cells: ["Total des contrats comptés", st.total] },
        notes: [
          ...(d.source === "payfit" ? [`Valeurs à la date de lecture, non historisées${d.referenceDate ? ` (lecture du ${formatDate(d.referenceDate)})` : ""}.`] : []),
          ...(d.population.lower ? ["Effectif de fin de mois en borne basse : au moins les contrats connus."] : []),
          seuilNote(st.seuil),
        ],
        terms: [T.structureEffectif, T.confidentialite, "quota-and-time"],
      });
      block({ id: "structure", title: sTitle, term: T.structureEffectif, tables: ["structure-effectif"], prevu: sPrevu });
    }
  }

  // --- Échéances de contrat dans l'horizon des Paramètres, depuis la date de lecture RH (PayFit) ; la DSN ne déclare rien d'avance.
  const hz = setting(input.settings, "horizonEcheances", input.links.parametres);
  const eTitle = "value" in hz ? `Échéances de contrat d'ici ${plural(hz.value, "jour", "jours")}` : "Échéances de contrat";
  if (filtered) ndBlock("echeances", eTitle, "echeances-contrat", { reason: NON_FILTRABLE }, { term: T.echeancesContrat });
  else if (d.source === "dsn") ndBlock("echeances", eTitle, "echeances-contrat", { reason: DSN_ECHEANCES }, { term: T.echeancesContrat });
  else if ("nd" in hz) ndBlock("echeances", eTitle, "echeances-contrat", hz.nd, { term: T.echeancesContrat });
  else if (confNd) ndBlock("echeances", eTitle, "echeances-contrat", confNd, { term: T.echeancesContrat });
  else {
    const ech = contractEcheances({ referenceDate: d.referenceDate, horizonDays: hz.value, natures: d.natures, contracts: d.contracts });
    if (ech.kind === "nd") ndBlock("echeances", eTitle, "echeances-contrat", { reason: ech.reason }, { term: T.echeancesContrat });
    else {
      const s = seuil!;
      const split = d.natures.length > 1;
      // Détail par nature : contrats affichés, groupe en personnes distinctes passé au seuil.
      const counts = (m: string, pick: "fins" | "entrees"): Record<string, NatureCount> =>
        Object.fromEntries(ech.lines.filter((l) => l.month === m).map((l) => [l.nature, { contracts: l[pick], ...(pick === "fins" ? l.finsGroup : l.entreesGroup) }]));
      const sum = (m: string, pick: "fins" | "entrees") => ech.lines.filter((l) => l.month === m).reduce((t, l) => t + l[pick], 0);
      const dont = (m: string, pick: "fins" | "entrees") => (split ? natureCells(counts(m, pick), d.natures, sum(m, pick), s) : []);
      const blanks = split ? d.natures.map((): CroiseeCell => "") : [];
      // Une fin non renseignée peut tomber dans l'horizon : le total des fins est alors une borne basse.
      const finsTotal: CroiseeCell = ech.endUndated > 0 ? `≥ ${nf.format(ech.fins)}` : ech.fins;
      // Comptes hors du tableau : sous le seuil, le nombre n'est pas écrit (n.d. avec la raison) ; l'effet sur le total reste écrit.
      const endUndated = outsideCount(ech.endUndated, ech.endUndatedGroup, s);
      const undated = outsideCount(ech.undated, ech.undatedGroup, s);
      const endUndatedNote = isNum(endUndated)
        ? `Fin non datée : ${plural(endUndated, "contrat en cours ou à venir", "contrats en cours ou à venir")} sans date de fin renseignée, hors du tableau ; total des fins en borne basse.`
        : `Fin non datée : n.d. — ${ndOf(endUndated)?.nd} ; total des fins en borne basse.`;
      const undatedNote = isNum(undated)
        ? `${plural(undated, "contrat", "contrats")} sans date de début : non positionnable${undated > 1 ? "s" : ""}, hors du tableau.`
        : `Sans date de début : n.d. — ${ndOf(undated)?.nd} ; contrats non positionnables, hors du tableau.`;
      tables.push({
        id: "echeances-contrat",
        title: eTitle,
        columns: [
          text("mois", "Mois"),
          ...natureColumns(
            [
              { key: "fins", header: "Fins de contrat" },
              { key: "entrees", header: "Entrées à venir" },
            ],
            d.natures,
          ),
        ],
        rows: ech.months.map((m) => ({ cells: [capital(monthLongLabel(m)), sum(m, "fins"), ...dont(m, "fins"), sum(m, "entrees"), ...dont(m, "entrees")] })),
        foot: { cells: ["Total", finsTotal, ...blanks, ech.entrees, ...blanks] },
        notes: [
          `Du ${formatDate(ech.from)} au ${formatDate(ech.to)}, à partir de la lecture du ${formatDate(d.referenceDate)}.`,
          ...(ech.endUndated > 0 ? [endUndatedNote] : []),
          ...(ech.undated > 0 ? [undatedNote] : []),
          seuilNote(s),
        ],
        terms: [T.echeancesContrat, "natures", T.confidentialite],
      });
      block({ id: "echeances", title: eTitle, term: T.echeancesContrat, tables: ["echeances-contrat"] });
    }
  }

  // --- Seuils d'effectif : effectif moyen de l'année N-1 et de N à date, face aux seuils des Paramètres (aucun seuil codé)
  const alerts: AlertSpec[] = [];
  const thTitle = "Effectif moyen et seuils d'effectif";
  if (filtered) ndBlock("seuils", thTitle, "effectif-moyen-annuel", { reason: NON_FILTRABLE }, { term: T.seuilsEffectif });
  else {
    const curLabel = periodLabel(d.annual.curMonths);
    const prevHead = `année ${d.annual.prevYear}`;
    tables.push({
      id: "effectif-moyen-annuel",
      title: `Effectif moyen, ${prevHead} et ${curLabel}`,
      columns: [text("indicateur", "Indicateur"), num("n1", capital(prevHead), { term: TERMS.effectifMoyen }), num("n", capital(curLabel), { term: TERMS.effectifMoyen })],
      rows: [{ cells: ["Effectif moyen", averageCell(d.annual.prev), averageCell(d.annual.cur)] }],
      terms: [TERMS.effectifMoyen, T.seuilsEffectif],
    });
    const th = block({ id: "seuils", title: thTitle, term: T.seuilsEffectif, tables: ["effectif-moyen-annuel"] });
    const seuils = setting(input.settings, "seuilsEffectif", input.links.parametres);
    if ("nd" in seuils) {
      tables.push(ndTable("seuils-effectif", "Seuils d'effectif", seuils.nd.reason));
      th.nd.push({ label: "Seuils d'effectif", ...seuils.nd });
    } else {
      tables.push({
        id: "seuils-effectif",
        title: "Écart de l'effectif moyen aux seuils d'effectif suivis",
        columns: [
          text("seuil", "Seuil suivi"),
          num("valeur", "Effectif du seuil"),
          num("ecart-n1", `Écart ${prevHead} (effectif moyen − seuil)`, { signed: true }),
          num("ecart-n", `Écart ${curLabel} (effectif moyen − seuil)`, { signed: true }),
        ],
        rows: seuils.value.map((x) => ({ cells: [`« ${x.libelle} »`, x.valeur, seuilGap(d.annual.prev, x.valeur), seuilGap(d.annual.cur, x.valeur)] })),
        terms: [T.seuilsEffectif, TERMS.effectifMoyen],
      });
      th.tables.push("seuils-effectif");
      const marge = setting(input.settings, "margeAlerte", input.links.parametres);
      if ("nd" in marge) th.nd.push({ label: "Marge d'alerte", ...marge.nd });
      else
        alerts.push(
          ...seuilAlerts(
            [
              // Mêmes libellés que le repère de la Synthèse (chapitre 01), qui appelle seuilAlerts sur les mêmes effectifs moyens.
              { id: "n1", label: `Effectif moyen ${d.annual.prevYear}`, avg: d.annual.prev },
              { id: "n", label: `Effectif moyen ${to.slice(0, 4)} (${curLabel})`, avg: d.annual.cur },
            ],
            seuils.value,
            marge.value,
          ),
        );
    }
  }

  // --- Indicateurs non disponibles
  block({ id: "non-disponibles", title: "Indicateurs non disponibles", term: T.prevu, prevu: PREVU_INDICATEURS });

  // --- Limites de la lecture (une ligne chacune ; le détail est au glossaire)
  const limits = [
    ...(d.source === "payfit" ? [`Quotités, temps de travail et statut lus à la date de lecture${d.referenceDate ? ` (${formatDate(d.referenceDate)})` : ""}, non historisés par PayFit.`] : []),
    "Effectif en personnes ; inscrits, entrées, sorties et échéances en contrats ; seuil de confidentialité compté en personnes distinctes.",
  ];

  return { chapter: "effectifs", tiles, alerts, tables, charts, limits, nd: null, terms: EFFECTIFS_TERMS, blocks };
}

// --- Lecture des sources (serveur) -------------------------------------------------------------------------------------------------

export async function loadEffectifsInput(ctx: CroiseeContext): Promise<EffectifsInput> {
  const slug = ctx.slug;
  const p = ctx.period;
  const base: Omit<EffectifsInput, "nd" | "data"> = {
    links: {
      parametres: croiseeSettingsHref(slug),
      confidentialite: confidentialiteHref(slug),
      donnees: `/e/${slug}/donnees`,
      mouvements: p ? `/e/${slug}/studio-rh/collaborateurs/mouvements?de=${rollingWindow(p.months[p.months.length - 1]).from}&a=${p.months[p.months.length - 1]}` : `/e/${slug}/studio-rh/collaborateurs/mouvements`,
      tableau: ctx.href({ affichage: "tableau" }),
    },
    period: p ? { months: p.months, prevMonths: ctx.prevMonths, labels: { period: ctx.labels.period, prev: ctx.labels.prev } } : null,
    service: { value: ctx.service.value, label: ctx.service.label },
    settings: ctx.settings,
  };
  const donnees: Action = { href: `/e/${slug}/donnees`, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  if (!p) return { ...base, nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: donnees }, data: null };

  const pay = await ctx.load.payroll();
  const kpi = pay.kpi;
  const input = kpi.input;
  const refusal = kpiRefusal({
    chosen: Boolean(kpi.collab.source.chosen),
    sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(input),
    invalid: kpi.settings.invalid.map((k) => KPI_KEYS[k]),
  });
  if (!input || refusal) {
    const action = kpi.settings.invalid.length > 0 ? { href: `/e/${slug}/parametres`, label: "Paramètres des KPI" } : donnees;
    return { ...base, nd: { reason: capital(refusal ?? "référentiel RH non construit"), action }, data: null };
  }

  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const to = months[months.length - 1];
  const prevTo = prevMonths[prevMonths.length - 1];
  const prv = windowOf(prevMonths);
  const dash = kpiDashboard(input, windowOf(months));
  const dashPrev = kpiDashboard(input, prv);
  const prevLabel = prv.label;
  const compare = <T extends { kind: string }>(current: T, previous: T, d: Delta) => ({ current, previous, delta: d });

  // Cartes : valeurs du moteur des KPI ; N-1 sur les mêmes mois un an plus tôt (jamais l'année civile entière).
  const hCur = dash.rows[dash.rows.length - 1].headcount;
  const hPrev = dashPrev.rows[dashPrev.rows.length - 1].headcount;
  const headcountDelta = delta(hCur, hPrev, (h) => ratio(h.persons, 1), "persons", `fin ${monthLongLabel(prevTo)}`);
  const etpAvgCur = dash.tiles.etpAverage.current;
  const etpAvgPrev = dashPrev.tiles.etpAverage.current;
  const hcAvgCur = dash.tiles.headcountAverage.current;
  const hcAvgPrev = dashPrev.tiles.headcountAverage.current;
  const roll = rollingWindow(to);
  const to12 = compareWindows(input, roll, turnover, (t) => t.ratio, "points");
  const prorCur = dash.tiles.etpProrated.current;

  // Effectif moyen de l'année civile N-1 et de N à date (janvier → dernier mois de la période).
  const year = Number(to.slice(0, 4));
  const curMonths = monthsBetween(`${year}-01`, to);
  const annual = { prevYear: year - 1, prev: headcountAverage(input, civilWindow(year - 1)), curMonths, cur: headcountAverage(input, windowOf(curMonths)) };

  // Jetons propres à cette lecture (rang d'apparition) : jeton de personne (null pour un contrat sans personne rattachée : non relié)
  // et jeton de contrat ; ils servent seulement à compter des personnes distinctes et des contrats non reliés ; aucune clé de la
  // source n'entre dans les mouvements ni dans les contrats du chapitre.
  const tokens = new Map<string, string>();
  const token = (c: { contractKey: string; personKey: string | null }): string | null => {
    const k = personOf(c);
    if (k === null) return null;
    let t = tokens.get(k);
    if (t === undefined) tokens.set(k, (t = `personne-${tokens.size + 1}`));
    return t;
  };
  const ctokens = new Map<string, string>();
  const ctoken = (c: { contractKey: string }): string => {
    let t = ctokens.get(c.contractKey);
    if (t === undefined) ctokens.set(c.contractKey, (t = `contrat-${ctokens.size + 1}`));
    return t;
  };
  const byKey = new Map(input.data.contracts.map((c) => [c.contractKey, c]));

  // Où sont les effectifs ? Grille des effectifs mensuels (réel), années N et N-1, inscrits et ETP, trois axes. Effectif de chaque
  // groupe pour le seuil de confidentialité, en personnes distinctes : par service, contrats qui portent l'ETP de fin de mois, rangés
  // par le service de leurs lignes de paie ; par catégorie et par statut, contrats comptés à la fin du mois (mêmes contrats que la
  // grille).
  const ws = ctx.workspace.id;
  const [{ natures: categoryNatures }, overrides] = await Promise.all([getCategoryNatures(ws), getContractCategories(ws)]);
  const etpServiceCell = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? ndCell(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const real: RealSource = { kpi: input, journal: pay.input, natures: categoryNatures, overrides, etpService: etpServiceCell };
  const grid = (measure: "inscrit" | "etp", axis: GridAxis, y: string) => monthlyGrid({ measure, axis, year: y, real, scenario: null });
  const serviceMap = pay.input && pay.service.axis ? buildContractServiceMap(pay.input.lines, pay.input.grid, pay.service.axis) : null;
  const sizesAt = (m: string, axis: GridAxis): Record<string, StockGroup> | null => {
    if (axis === "service") {
      if (!serviceMap) return null;
      const e = etpMonthEnd(input, m);
      if (e.kind !== "exact") return null;
      return serviceSizes(
        e.contributions.map((c) => ({ id: c.externalId, person: token(c) })),
        (id) => serviceMap.get(`${m}|${id}`) ?? null,
      );
    }
    // Effectif en borne basse ou n.d. : la grille l'est aussi ; l'effectif du groupe n'est pas dénombré.
    const h = headcountAt(input.data, monthEnd(m), countedOpts(input));
    if (h.kind !== "exact") return null;
    return stockGroups(
      h.contractKeys.flatMap((k) => {
        const c = byKey.get(k);
        return c ? [{ group: axisGroup(c, axis, categoryNatures, overrides), contract: ctoken(c), person: token(c) }] : [];
      }),
    );
  };
  const grids: GridsIn[] = (["service", "categorie", "statut"] as const).map((axis) => ({
    axis,
    inscrit: { cur: grid("inscrit", axis, to.slice(0, 4)), prev: grid("inscrit", axis, prevTo.slice(0, 4)) },
    etp: { cur: grid("etp", axis, to.slice(0, 4)), prev: grid("etp", axis, prevTo.slice(0, 4)) },
    sizes: { cur: sizesAt(to, axis), prev: sizesAt(prevTo, axis) },
  }));

  // Journal des mouvements sur douze mois : mouvements comptés dans le turnover, par mois et par nature (aucune date, aucun service).
  const jMonths: JournalMonthIn[] = [];
  const events: JournalEventIn[] = [];
  for (const m of roll.months) {
    const mv = monthMovements(input, m);
    jMonths.push({ month: m, entries: mv.entries, exits: mv.exits });
    for (const x of countedMovements(mv)) events.push({ month: m, kind: x.row.event.kind, nature: x.row.event.nature, endReason: x.row.event.endReason, contract: ctoken(x.row.contract), person: token(x.row.contract) });
  }
  const jTotal = windowMovements(input, roll);

  // Raisons du moteur qui citent des identifiants de contrat (contrats continus non vérifiables), sur tous les mois lus par le chapitre.
  const allMonths = [...new Set([...months, ...prevMonths, ...roll.months, ...to12.previousWindow.months])];
  const reasonSwaps = continuitySwaps(allMonths.map((m) => monthMovements(input, m)));

  // Population de la structure : contrats comptés dans l'effectif de fin de période.
  const hEnd = headcountAt(input.data, monthEnd(to), countedOpts(input));
  const population: EffectifsData["population"] =
    hEnd.kind === "nd"
      ? { kind: "nd", reason: hEnd.nd.reason }
      : {
          kind: "value",
          lower: hEnd.kind === "lower_bound",
          contracts: hEnd.contractKeys.flatMap((k) => {
            const c = byKey.get(k);
            return c ? [{ contractKey: c.contractKey, personKey: c.personKey, isFullTimeAtRead: c.isFullTimeAtRead, modalityAtRead: c.modalityAtRead, executive: c.executive, fieldsNd: c.fieldsNd }] : [];
          }),
        };

  const data: EffectifsData = {
    source: input.data.build.source,
    referenceDate: input.data.build.referenceDate,
    rows: dash.rows,
    prevRows: dashPrev.rows,
    headcountDelta,
    etpEnd: dash.tiles.etpEnd,
    etpProrated: { ...dash.tiles.etpProrated, qualifier: etpProratedQualifier(input), qualifiers: prorCur.kind === "nd" ? undefined : prorCur.qualifiers },
    etpAverage: compare(etpAvgCur, etpAvgPrev, delta(etpAvgCur, etpAvgPrev, (a) => a.ratio, "etp", prevLabel)),
    headcountAverage: compare(hcAvgCur, hcAvgPrev, delta(hcAvgCur, hcAvgPrev, (a) => a.ratio, "persons", prevLabel)),
    movements: { current: dash.movements, previous: dashPrev.movements },
    turnover: {
      label: roll.label,
      current: to12.current,
      previous: to12.previous,
      delta: to12.delta,
      entries: to12.current.kind === "exact" ? to12.current.entries : null,
      exits: to12.current.kind === "exact" ? to12.current.exits : null,
    },
    annual,
    grids,
    journal: { from: roll.from, to: roll.to, months: jMonths, total: jTotal, events },
    population,
    natures: countedOpts(input).natures,
    contracts: input.data.contracts.map((c) => ({ contract: ctoken(c), person: token(c), startDate: c.startDate, endDate: c.endDate, nature: c.nature, endUnknown: c.endDate === null && c.fieldsNd.endDate !== undefined })),
    reasonSwaps,
  };
  return { ...base, nd: null, data };
}

// Un seul calcul par affichage : le composant du chapitre et les exports appellent cette fonction (mémoïsée par contexte de requête).
export const effectifsModel = memoByContext((ctx: CroiseeContext) => loadEffectifsInput(ctx).then(buildEffectifs));
