import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ChartSeries } from "@/components/charts/shared";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { AXES, monthlyGrid, UNAVAILABLE_AXES, type Axis, type Grid, type RealSource } from "@/lib/budget/monthly";
import { nd as ndCell, val } from "@/lib/budget/versions";
import { contractEcheances, type EcheanceContract } from "@/lib/croisee/echeances";
import { effectifStructure, type Confidentialite, type StructureContract } from "@/lib/croisee/structure";
import { croiseeSettingReason, croiseeSettingsHref, settingValue, type CroiseeSetting, type CroiseeSettingKey, type CroiseeSettings, type CroiseeSettingValues, type SeuilEffectif } from "@/lib/croisee-settings";
import { formatDate, monthEnd, monthsBetween } from "@/lib/dates";
import { contractNatureLabel, endReasonLabel } from "@/lib/dsn/labels";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { buildContractServiceMap } from "@/lib/payroll/service-map";
import { headcountAt } from "@/lib/rh/headcount";
import { headcountAverage } from "@/lib/rh/kpi/average";
import { compareWindows, delta, etpValue } from "@/lib/rh/kpi/compare";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { ETP_PRORATED_LABEL, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { ratio } from "@/lib/rh/kpi/fraction";
import { civilWindow, countedOpts, rollingWindow } from "@/lib/rh/kpi/period";
import { monthMovements, turnover } from "@/lib/rh/kpi/turnover";
import { kpiNd, type Delta, type EventWhy, type Ratio } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { plainVariation, sparkValues, type AlertSpec, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeRow, type CroiseeTable, type TileSpec, type TileVariation } from "@/lib/viz/croisee";
import { etpProratedNotes, headcountSeries, monthAxis, monthLongLabel, movementSeries, splitAxisLabel, type CountIn, type EtpProratedIn, type RowIn } from "@/lib/viz/kpi";
import { capital, monthShortYear, ndGroups, ndLines } from "@/lib/viz/masse";
import { averageTile, deltaView, etpTile, headcountTile, kpiRefusal, MONTH_NAMES, nd as ndTile, periodLabel, rateTile, windowOf, type AverageIn, type EtpIn, type HeadcountIn, type RateIn, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 02 · Effectifs & mouvements. buildEffectifs est une fonction PURE : elle met en forme des
// résultats déjà calculés par le moteur des KPI RH (kpiDashboard, moyennes, turnover, mouvements), par la grille des effectifs
// mensuels (monthlyGrid) et par deux fonctions pures du chapitre (structure de l'effectif, échéances de contrat). L'écran, le CSV et
// l'Excel partent du même modèle. loadEffectifsInput lit les sources par les lecteurs du contexte et appelle ces fonctions : aucun
// nouveau moteur de calcul. Un n.d. reste n.d. (raison écrite) jusqu'au tableau et au graphique ; aucun nom de personne.

// --- Entrée ------------------------------------------------------------------------------------------------------------------------

export type Action = { href: string; label: string };
// Bloc (ou partie de bloc) non calculable : la raison, et l'action qui y remédie (Paramètres, Données).
export type BlockNd = { label?: string; reason: string; action?: Action };

type Compare<T> = { current: T; previous: T; delta: Delta };
export type MovementIn = { kind: "exact" | "lower_bound"; value: number } | { kind: "nd"; nd: { reason: string } };
export type EtpPointIn = { etp4: number | null; reason: string | null }; // ETP fin de mois d'un service (journal de paie)
export type ServiceIn = { kind: "value"; value: string | null } | { kind: "nd"; reason: string };
// Mouvement du journal, sans nom ni identifiant : date, sens, nature, motif de sortie, décompte du turnover, service du mois.
export type JournalEventIn = { date: string; kind: "entry" | "exit"; nature: string | null; endReason: string | null; endReasonNd: string | null; why: EventWhy; service: ServiceIn };
export type JournalMonthIn = { month: string; entries: CountIn; exits: CountIn };
export type GridAxis = Extract<Axis, "service" | "categorie" | "statut">;
export type GridsIn = { axis: GridAxis; inscrit: { cur: Grid; prev: Grid }; etp: { cur: Grid; prev: Grid } };

export type EffectifsData = {
  source: "payfit" | "dsn";
  referenceDate: string | null; // date de la lecture RH appliquée
  rows: RowIn[]; // lignes du tableau de bord des KPI (kpiDashboard) pour chaque mois de la période
  prevRows: RowIn[]; // mêmes mois un an plus tôt (N-1)
  headcountDelta: Delta; // effectif de fin de période face à N-1 (delta du moteur des KPI)
  etpEnd: Compare<EtpIn>;
  etpProrated: Compare<EtpProratedIn> & { qualifier: string }; // qualifieur obligatoire du moteur (etpProratedQualifier)
  etpAverage: Compare<AverageIn>;
  headcountAverage: Compare<AverageIn>;
  movements: { current: { entries: MovementIn; exits: MovementIn }; previous: { entries: MovementIn; exits: MovementIn } };
  turnover: Compare<RateIn> & { label: string; entries: number | null; exits: number | null };
  etpService: Compare<EtpPointIn> | null; // ETP fin de mois du service retenu (filtre de service actif)
  annual: { prevYear: number; prev: AverageIn; curMonths: string[]; cur: AverageIn }; // effectif moyen de l'année N-1, et de N à date
  grids: GridsIn[];
  journal: { from: string; to: string; months: JournalMonthIn[]; events: JournalEventIn[] };
  population: { kind: "value"; lower: boolean; contracts: StructureContract[] } | { kind: "nd"; reason: string }; // effectif de fin de période
  natures: string[]; // natures comptées dans l'effectif (Paramètres des KPI)
  contracts: EcheanceContract[]; // contrats du référentiel (dates et nature seulement)
};

export type EffectifsInput = {
  links: { parametres: string; donnees: string; mouvements: string; tableau: string };
  period: { months: string[]; prevMonths: string[] } | null;
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

const SEXE_REASON = UNAVAILABLE_AXES.find((a) => a.label === "Sexe")?.reason ?? "sexe absent du référentiel Collaborateurs lu";
// Caractéristiques de l'effectif que Clair ne lit pas : « Prévu », avec la raison de la matrice (aucune valeur reconstituée).
export const PREVU_STRUCTURE: PrevuItem[] = [
  { label: "Femmes et hommes", reason: SEXE_REASON },
  { label: "Âge moyen et tranches d'âge", reason: "date de naissance non lue par Clair" },
  { label: "Cadres et non-cadres", reason: "PayFit ne fournit à Clair que l'indicateur « cadre dirigeant », pas le statut cadre" },
  { label: "Ancienneté moyenne et tranches d'ancienneté", reason: "règle de continuité de présence non paramétrée" },
];
export const PREVU_INDICATEURS: PrevuItem[] = [
  { label: "Écart d'ETP au budget", reason: "le budget saisi ne porte pas d'ETP" },
  { label: "Postes ouverts non pourvus", reason: "aucun budget par poste" },
  { label: "Fins de période d'essai", reason: "date de fin de période d'essai non lue par Clair" },
];

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

const prevLine = (v: TileValue): TileVariation => plainVariation("N-1", v.kind === "nd" ? null : v.text, v.kind === "nd" ? v.reason : null);
const deltaLine = (d: Delta): TileVariation => {
  const v = deltaView(d);
  return plainVariation("Écart", v.text, v.reason);
};
const movementTile = (m: MovementIn): TileValue =>
  m.kind === "nd" ? ndTile(m.nd.reason) : m.kind === "lower_bound" ? { text: `≥ ${nf.format(m.value)}`, kind: "lower", reason: null } : { text: nf.format(m.value), kind: "value", reason: null };
const etpPointTile = (e: EtpPointIn): TileValue => (e.etp4 === null ? ndTile(e.reason ?? "ETP par service n.d.") : etpTile({ kind: "exact", etp4: e.etp4 }));

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

// --- Seuils d'effectif ---------------------------------------------------------------------------------------------------------------

// Écart exact entre un effectif moyen (fraction) et un seuil (entier) : effectif moyen − seuil, positif au-dessus du seuil.
export function seuilGap(a: AverageIn, valeur: number): CroiseeCell {
  if (a.kind === "nd") return { nd: a.nd.reason };
  if (a.kind === "lower_bound") return { nd: "effectif moyen en borne basse : écart non calculable" };
  return { exact: (a.ratio.num - valeur * a.ratio.den) / a.ratio.den };
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

// --- Construction du modèle -------------------------------------------------------------------------------------------------------

const AXIS_TITLES: Record<GridAxis, string> = { service: "par service", categorie: "par catégorie de contrat", statut: "par statut de cadre dirigeant" };
const TAIL = (s: string) => (s === "Non classé" || s === "Hors salarié" || s === "Non ventilé" || s.endsWith("n.d.") ? 1 : 0);
const groupsOf = (grids: Grid[]): string[] => [...new Set(grids.flatMap((g) => (g.kind === "value" ? g.groups : [])))].sort((a, b) => TAIL(a) - TAIL(b) || a.localeCompare(b, "fr"));

const WHY: Partial<Record<EventWhy, string>> = {
  counted: "compté",
  neutralized: "neutralisé : contrat continu",
  "excluded-nature": "exclu : nature de sortie (Paramètres)",
  "continuity-unknown": "non vérifiable : contrat continu",
};

export function buildEffectifs(input: EffectifsInput): EffectifsModel {
  const empty: EffectifsModel = { chapter: "effectifs", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: EFFECTIFS_TERMS, blocks: [] };
  const d = input.data;
  const p = input.period;
  if (input.nd || !d || !p || p.months.length === 0) {
    const nd = input.nd ?? { reason: "aucun mois disponible", action: { href: input.links.donnees, label: "Données" } };
    return { ...empty, nd: { reason: nd.reason, action: nd.action } };
  }
  const { months, prevMonths } = p;
  const to = months[months.length - 1];
  const prevTo = prevMonths[prevMonths.length - 1];
  const year = to.slice(0, 4);
  const prevYear = prevTo.slice(0, 4);
  const label = periodLabel(months);
  const prevLabel = periodLabel(prevMonths);
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

  // --- Cartes
  const lastRow = d.rows[d.rows.length - 1];
  const lastPrev = d.prevRows[d.prevRows.length - 1];
  const hcSeriesCur = headcountSeries(d.rows)[0];
  const hcSeriesPrev = headcountSeries(d.prevRows)[0];
  // Filtre de service actif : le référentiel RH ne porte pas le service (code analytique des lignes de paie), la carte est n.d.
  const notFiltered = (t: TileSpec): TileSpec => (filtered ? { id: t.id, label: t.label, term: t.term, sub: t.sub, value: ndTile(NON_FILTRABLE) } : t);
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
    filtered && d.etpService
      ? {
          id: "etp-fin",
          label: "ETP fin de mois",
          term: TERMS.etpFin,
          sub: `${fin(to)} · ${input.service.label}`,
          value: etpPointTile(d.etpService.current),
          variations: [prevLine(etpPointTile(d.etpService.previous)), deltaLine(d.etpService.delta)],
        }
      : notFiltered({
          id: "etp-fin",
          label: "ETP fin de mois",
          term: TERMS.etpFin,
          sub: fin(to),
          value: etpTile(d.etpEnd.current),
          variations: [prevLine(etpTile(d.etpEnd.previous)), deltaLine(d.etpEnd.delta)],
        }),
    notFiltered({
      id: "etp-proratise",
      label: ETP_PRORATED_LABEL,
      term: TERMS.etpProratise,
      sub: capital(monthLongLabel(to)),
      value: averageTile(d.etpProrated.current),
      variations: [prevLine(averageTile(d.etpProrated.previous)), deltaLine(d.etpProrated.delta)],
      note: etpProratedNotes([d.etpProrated.qualifier]).join(" ; "),
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
      note: d.turnover.current.kind === "exact" ? `${d.turnover.entries === null ? "entrées n.d." : plural(d.turnover.entries, "entrée", "entrées")} · ${plural(d.turnover.exits ?? 0, "sortie", "sorties")}` : undefined,
    }),
  ];
  block({ id: "cartes", title: "Chiffres clés", term: T.periodeFiltres });

  // --- Effectif en fin de mois, N-1 et N (graphique et tableau exact)
  const effTitle = `Effectif en fin de mois, ${year} face à ${prevYear}`;
  if (filtered) ndBlock("effectif", effTitle, "effectif-mensuel", { reason: NON_FILTRABLE }, { term: TERMS.effectif, graph: true });
  else {
    const ax = monthAxis(months, prevMonths);
    const series: ChartSeries[] = [
      { ...hcSeriesPrev, key: "effectif-n1", name: `${prevYear} (N-1)`, color: "var(--chart-7)" },
      { ...hcSeriesCur, key: "effectif", name: year, color: "var(--chart-1)" },
    ];
    charts.push({ id: "effectif-mensuel", title: effTitle, kind: "barres", unit: "nombre", categories: ax.categories, categoryTitles: ax.titles, series, mode: "grouped", tableId: "effectif-mensuel" });
    tables.push({
      id: "effectif-mensuel",
      title: `${effTitle} (personnes)`,
      columns: [text("mois", "Mois"), num("n1", `Fin de mois ${prevYear}`, { term: TERMS.effectif }), num("n", `Fin de mois ${year}`, { term: TERMS.effectif })],
      rows: months.map((m, i) => ({ cells: [monthName(m), headcountCell(d.prevRows[i]?.headcount ?? { kind: "nd", nd: { reason: "mois N-1 non lu" } }), headcountCell(d.rows[i].headcount)] })),
      terms: [TERMS.effectif, T.nMoinsUn],
    });
    block({ id: "effectif", title: effTitle, term: TERMS.effectif, graph: true, charts: ["effectif-mensuel"], tables: ["effectif-mensuel"] });
  }

  // --- Entrées et sorties par mois, sur les deux périodes (graphique et tableau exact)
  const mvTitle = `Entrées et sorties par mois, ${prevYear} et ${year}`;
  if (filtered) ndBlock("mouvements", mvTitle, "mouvements", { reason: NON_FILTRABLE }, { term: TERMS.mouvements, graph: true });
  else {
    const allRows = [...d.prevRows, ...d.rows];
    const allMonths = allRows.map((r) => r.month);
    const ax = monthAxis(allMonths);
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

  // --- Où sont les effectifs ? Inscrits et ETP de fin de période, par service, catégorie et statut (grille des effectifs mensuels)
  const repTitle = "Où sont les effectifs ?";
  const rep = block({ id: "repartition", title: repTitle, term: "effectifs-ventilation" });
  for (const g of d.grids) {
    const axisName = splitAxisLabel(AXES.find((a) => a.key === g.axis)?.label ?? g.axis).name;
    const id = `effectifs-${g.axis}`;
    const title = `${repTitle} ${capital(AXIS_TITLES[g.axis])}, ${fin(to)}`;
    if (filtered && g.axis !== "service") {
      tables.push(ndTable(id, title, NON_FILTRABLE));
      rep.nd.push({ label: capital(AXIS_TITLES[g.axis]), reason: NON_FILTRABLE });
      continue;
    }
    const all = [g.inscrit.cur, g.inscrit.prev, g.etp.cur, g.etp.prev];
    const groups = groupsOf(all).filter((x) => !filtered || x === input.service.label);
    const row = (grp: string | null, lbl: string): CroiseeRow => ({ cells: [lbl, gridCell(g.inscrit.cur, grp, to), gridCell(g.inscrit.prev, grp, prevTo), gridCell(g.etp.cur, grp, to), gridCell(g.etp.prev, grp, prevTo)] });
    tables.push({
      id,
      title,
      columns: [
        text("groupe", axisName),
        num("inscrits", `Inscrits fin ${monthShortYear(to)}`, { term: TERMS.inscrits }),
        num("inscrits-n1", `Inscrits fin ${monthShortYear(prevTo)}`, { term: TERMS.inscrits }),
        { key: "etp", header: `ETP fin ${monthShortYear(to)}`, kind: "etp", term: TERMS.etpFin },
        { key: "etp-n1", header: `ETP fin ${monthShortYear(prevTo)}`, kind: "etp", term: TERMS.etpFin },
      ],
      rows: groups.map((grp) => row(grp, grp)),
      foot: filtered ? undefined : row(null, "Total"),
      notes: filtered ? [`Service retenu : ${input.service.label}.`] : [],
      terms: ["effectifs-ventilation", TERMS.inscrits, TERMS.etpFin],
    });
    rep.tables.push(id);
  }
  tables.push({
    id: "axes-indisponibles",
    title: "Axes de répartition indisponibles",
    columns: [text("axe", "Axe"), text("raison", "Raison")],
    rows: UNAVAILABLE_AXES.map((a) => ({ cells: [a.label, a.reason] })),
    terms: ["effectifs-ventilation"],
  });
  rep.tables.push("axes-indisponibles");

  // --- Journal des mouvements sur douze mois, sans nom
  const jTitle = `Journal des mouvements, ${monthShortYear(d.journal.from)} → ${monthShortYear(d.journal.to)}`;
  const listed = d.journal.events.filter((e) => WHY[e.why] !== undefined);
  const serviceKnown = (e: JournalEventIn) => e.service.kind === "value";
  const shown = filtered ? listed.filter((e) => e.service.kind === "value" && e.service.value === (input.service.value ?? null)) : listed;
  const hiddenUnknown = filtered ? listed.filter((e) => !serviceKnown(e)).length : 0;
  const motif = (e: JournalEventIn): CroiseeCell => {
    if (e.kind === "entry") return "";
    if (d.source === "payfit") return { nd: MOTIF_PAYFIT };
    return e.endReason ? endReasonLabel(e.endReason) : { nd: e.endReasonNd ?? "motif de rupture absent de la DSN" };
  };
  const monthNotes = (pick: (m: JournalMonthIn) => CountIn, what: string): string[] => {
    const nds = ndLines(ndGroups(d.journal.months.map((m) => ({ month: m.month, reason: ((c) => (c.kind === "nd" ? `${what} n.d. — ${c.nd.reason}` : null))(pick(m)) }))));
    const lows = ndLines(ndGroups(d.journal.months.map((m) => ({ month: m.month, reason: pick(m).kind === "lower_bound" ? `${what} : au moins celles connues (source incomplète)` : null }))));
    return [...nds, ...lows];
  };
  tables.push({
    id: "journal-mouvements",
    title: jTitle,
    columns: [
      { key: "date", header: "Date", kind: "date" },
      text("mouvement", "Mouvement"),
      text("nature", "Nature du contrat", { term: "natures" }),
      text("service", "Service"),
      text("motif", "Motif de sortie"),
      text("decompte", "Décompte du turnover", { term: TERMS.turnover }),
    ],
    rows: [...shown]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "entry" ? -1 : 1))
      .map((e) => ({
        cells: [
          e.date,
          e.kind === "entry" ? "Entrée" : "Sortie",
          e.nature === null ? { nd: "nature de contrat absente de la source" } : contractNatureLabel(e.nature),
          e.service.kind === "nd" ? { nd: e.service.reason } : (e.service.value ?? "Non ventilé"),
          motif(e),
          WHY[e.why]!,
        ],
      })),
    notes: [
      ...(shown.length === 0 ? ["Aucun mouvement sur ces douze mois."] : []),
      ...(hiddenUnknown > 0 ? [`${plural(hiddenUnknown, "mouvement", "mouvements")} au service inconnu, non affiché${hiddenUnknown > 1 ? "s" : ""} avec le filtre de service.`] : []),
      ...monthNotes((m) => m.entries, "entrées"),
      ...monthNotes((m) => m.exits, "sorties"),
    ],
    terms: [T.journalMouvements, TERMS.mouvements, TERMS.turnover],
  });
  block({ id: "journal", title: jTitle, term: T.journalMouvements, tables: ["journal-mouvements"], link: { href: input.links.mouvements, label: "Détail nominatif : Collaborateurs › Mouvements" } });

  // --- Structure de l'effectif (valeurs à la date de lecture), seuil de confidentialité
  const sTitle = `Qui compose l'effectif salarié ? ${capital(fin(to))}`;
  const conf = setting(input.settings, "confidentialite", input.links.parametres);
  const confidentialite: Confidentialite = "value" in conf ? { kind: "set", value: conf.value } : { kind: "nd", reason: conf.nd.reason };
  if (filtered) ndBlock("structure", sTitle, "structure-effectif", { reason: NON_FILTRABLE }, { term: T.structureEffectif, prevu: PREVU_STRUCTURE });
  else if (d.population.kind === "nd") ndBlock("structure", sTitle, "structure-effectif", { reason: d.population.reason }, { term: T.structureEffectif, prevu: PREVU_STRUCTURE });
  else {
    const st = effectifStructure({ contracts: d.population.contracts, confidentialite });
    if (st.kind === "nd") ndBlock("structure", sTitle, "structure-effectif", { reason: st.reason, action: "nd" in conf ? paramAction : undefined }, { term: T.structureEffectif, prevu: PREVU_STRUCTURE });
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
          `Valeurs à la date de lecture, non historisées${d.referenceDate ? ` (lecture du ${formatDate(d.referenceDate)})` : ""}.`,
          ...(d.population.lower ? ["Effectif de fin de mois en borne basse : au moins les contrats connus."] : []),
          `Seuil de confidentialité : ${plural(st.seuil, "personne", "personnes")}.`,
        ],
        terms: [T.structureEffectif, T.confidentialite, "quota-and-time"],
      });
      block({ id: "structure", title: sTitle, term: T.structureEffectif, tables: ["structure-effectif"], prevu: PREVU_STRUCTURE });
    }
  }

  // --- Échéances de contrat dans l'horizon des Paramètres, depuis la date de lecture RH
  const hz = setting(input.settings, "horizonEcheances", input.links.parametres);
  const eTitle = "value" in hz ? `Échéances de contrat d'ici ${plural(hz.value, "jour", "jours")}` : "Échéances de contrat";
  if (filtered) ndBlock("echeances", eTitle, "echeances-contrat", { reason: NON_FILTRABLE }, { term: T.echeancesContrat });
  else if ("nd" in hz) ndBlock("echeances", eTitle, "echeances-contrat", hz.nd, { term: T.echeancesContrat });
  else {
    const ech = contractEcheances({ referenceDate: d.referenceDate, horizonDays: hz.value, natures: d.natures, contracts: d.contracts });
    if (ech.kind === "nd") ndBlock("echeances", eTitle, "echeances-contrat", { reason: ech.reason }, { term: T.echeancesContrat });
    else {
      tables.push({
        id: "echeances-contrat",
        title: eTitle,
        columns: [text("mois", "Mois"), text("nature", "Nature du contrat", { term: "natures" }), num("fins", "Fins de contrat"), num("entrees", "Entrées à venir")],
        rows: ech.lines.map((l) => ({ cells: [capital(monthLongLabel(l.month)), contractNatureLabel(l.nature), l.fins, l.entrees] })),
        foot: { cells: ["Total", "", ech.fins, ech.entrees] },
        notes: [
          `Du ${formatDate(ech.from)} au ${formatDate(ech.to)}, à partir de la lecture du ${formatDate(d.referenceDate)}.`,
          ...(ech.lines.length === 0 ? ["Aucune échéance dans l'horizon."] : []),
          ...(ech.undated > 0 ? [`${plural(ech.undated, "contrat", "contrats")} sans date de début : non daté${ech.undated > 1 ? "s" : ""}, hors du tableau.`] : []),
        ],
        terms: [T.echeancesContrat, "natures"],
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
    const prevHead = `${d.annual.prevYear} (année civile)`;
    const curHead = `${year} (${curLabel})`;
    tables.push({
      id: "effectif-moyen-annuel",
      title: `Effectif moyen annuel, ${d.annual.prevYear} et ${year} à date`,
      columns: [text("indicateur", "Indicateur"), num("n1", prevHead, { term: TERMS.effectifMoyen }), num("n", curHead, { term: TERMS.effectifMoyen })],
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
        columns: [text("seuil", "Seuil suivi"), num("valeur", "Effectif du seuil"), num("ecart-n1", `Écart ${d.annual.prevYear} (effectif moyen − seuil)`, { signed: true }), num("ecart-n", `Écart ${year} (effectif moyen − seuil)`, { signed: true })],
        rows: seuils.value.map((s) => ({ cells: [`« ${s.libelle} »`, s.valeur, seuilGap(d.annual.prev, s.valeur), seuilGap(d.annual.cur, s.valeur)] })),
        terms: [T.seuilsEffectif, TERMS.effectifMoyen],
      });
      th.tables.push("seuils-effectif");
      const marge = setting(input.settings, "margeAlerte", input.links.parametres);
      if ("nd" in marge) th.nd.push({ label: "Marge d'alerte", ...marge.nd });
      else
        alerts.push(
          ...seuilAlerts(
            [
              { id: "n1", label: `Effectif moyen ${d.annual.prevYear}`, avg: d.annual.prev },
              { id: "n", label: `Effectif moyen ${year} (${curLabel})`, avg: d.annual.cur },
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
    "Effectif en personnes ; inscrits, entrées, sorties et échéances en contrats.",
  ];

  return { chapter: "effectifs", tiles, alerts, tables, charts, limits, nd: null, terms: EFFECTIFS_TERMS, blocks };
}

// --- Lecture des sources (serveur) -------------------------------------------------------------------------------------------------

const serviceReasonOf = (ctx: CroiseeContext): string => ctx.service.reason ?? "service non disponible";

export async function loadEffectifsInput(ctx: CroiseeContext): Promise<EffectifsInput> {
  const slug = ctx.slug;
  const p = ctx.period;
  const base: Omit<EffectifsInput, "nd" | "data"> = {
    links: {
      parametres: croiseeSettingsHref(slug),
      donnees: `/e/${slug}/donnees`,
      mouvements: p ? `/e/${slug}/studio-rh/collaborateurs/mouvements?de=${rollingWindow(p.months[p.months.length - 1]).from}&a=${p.months[p.months.length - 1]}` : `/e/${slug}/studio-rh/collaborateurs/mouvements`,
      tableau: ctx.href({ affichage: "tableau" }),
    },
    period: p ? { months: p.months, prevMonths: ctx.prevMonths } : null,
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

  // ETP fin de mois du service retenu (journal de paie) : seul indicateur des cartes filtrable par service.
  let etpService: EffectifsData["etpService"] = null;
  if (ctx.service.value !== undefined) {
    const f = { value: ctx.service.value };
    const [e] = pay.etp([to], f);
    const [ep] = pay.etp([prevTo], f);
    const valued = (x: { etp4: number | null; reason: string | null }) => (x.etp4 === null ? { kind: "nd" as const, nd: kpiNd("month-nd", x.reason ?? "ETP par service n.d.") } : { kind: "exact" as const, etp4: x.etp4 });
    etpService = { current: e, previous: ep, delta: delta(valued(e), valued(ep), etpValue, "etp", `fin ${monthLongLabel(prevTo)}`) };
  }

  // Effectif moyen de l'année civile N-1 et de N à date (janvier → dernier mois de la période).
  const year = Number(to.slice(0, 4));
  const curMonths = monthsBetween(`${year}-01`, to);
  const annual = { prevYear: year - 1, prev: headcountAverage(input, civilWindow(year - 1)), curMonths, cur: headcountAverage(input, windowOf(curMonths)) };

  // Où sont les effectifs ? Grille des effectifs mensuels (réel), années N et N-1, inscrits et ETP, trois axes.
  const ws = ctx.workspace.id;
  const [{ natures: categoryNatures }, overrides] = await Promise.all([getCategoryNatures(ws), getContractCategories(ws)]);
  const etpServiceCell = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? ndCell(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const real: RealSource = { kpi: input, journal: pay.input, natures: categoryNatures, overrides, etpService: etpServiceCell };
  const grid = (measure: "inscrit" | "etp", axis: GridAxis, y: string) => monthlyGrid({ measure, axis, year: y, real, scenario: null });
  const grids: GridsIn[] = (["service", "categorie", "statut"] as const).map((axis) => ({
    axis,
    inscrit: { cur: grid("inscrit", axis, to.slice(0, 4)), prev: grid("inscrit", axis, prevTo.slice(0, 4)) },
    etp: { cur: grid("etp", axis, to.slice(0, 4)), prev: grid("etp", axis, prevTo.slice(0, 4)) },
  }));

  // Journal des mouvements sur douze mois : mouvements du turnover, service du contrat le mois du mouvement (journal de paie).
  const serviceMap = pay.input && pay.service.axis ? buildContractServiceMap(pay.input.lines, pay.input.grid, pay.service.axis) : null;
  const noService = ctx.service.axis ? null : serviceReasonOf(ctx);
  const jMonths: JournalMonthIn[] = [];
  const events: JournalEventIn[] = [];
  for (const m of roll.months) {
    const mv = monthMovements(input, m);
    jMonths.push({ month: m, entries: mv.entries, exits: mv.exits });
    for (const x of mv.events) {
      const ev = x.row.event;
      const key = `${ev.month}|${x.row.contract.externalId}`;
      const service: ServiceIn = !serviceMap
        ? { kind: "nd", reason: noService ?? "service non disponible" }
        : serviceMap.has(key)
          ? { kind: "value", value: serviceMap.get(key) ?? null }
          : { kind: "nd", reason: "aucune ligne de paie du contrat ce mois-là" };
      events.push({ date: ev.date, kind: ev.kind, nature: ev.nature, endReason: ev.endReason, endReasonNd: ev.fieldsNd.endReason?.reason ?? null, why: x.why, service });
    }
  }

  // Population de la structure : contrats comptés dans l'effectif de fin de période.
  const hEnd = headcountAt(input.data, monthEnd(to), countedOpts(input));
  const byKey = new Map(input.data.contracts.map((c) => [c.contractKey, c]));
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
    etpProrated: { ...dash.tiles.etpProrated, qualifier: etpProratedQualifier(input) },
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
    etpService,
    annual,
    grids,
    journal: { from: roll.from, to: roll.to, months: jMonths, events },
    population,
    natures: countedOpts(input).natures,
    contracts: input.data.contracts.map((c) => ({ startDate: c.startDate, endDate: c.endDate, nature: c.nature })),
  };
  return { ...base, nd: null, data };
}
