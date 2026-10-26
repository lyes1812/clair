import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { journalReason } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ChartSeries } from "@/components/charts/shared";
import { amountGap, chargesOfWindow, type Amount, type ChargesPassage } from "@/lib/croisee/charges-personnel";
import { croiseeSettingReason, croiseeSettingsHref, settingValue } from "@/lib/croisee-settings";
import { formatMonth } from "@/lib/dates";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { MASSE_TERMS as M } from "@/lib/glossary/masse";
import { dsnBrutWindow, type DsnWindow } from "@/lib/payroll/dsn";
import { monthPayroll, servicesOf, windowPayroll, withService } from "@/lib/payroll/engine";
import { RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { comptaGap, operatingRevenue, provisionMonth, reconcile, type ProvisionMonth, type Reconciliation } from "@/lib/payroll/lot2";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { costVariation, plainVariation, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeRow, type CroiseeTable, type TileSpec } from "@/lib/viz/croisee";
import { COLORS, dsnPoint, euros, eurosSigned, monthLongLabel, monthsAxis, monthShortYear, ndGroups, ndLines, noPeriod, pluriel, provisionParts, provisionTotals, reasonText, reconMonthSeries, reconRubricChart } from "@/lib/viz/masse";
import { nd as ndTile, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 07 · Paie & comptabilité. buildPaieCompta est une fonction PURE : elle met en forme des résultats
// déjà calculés par le moteur du journal de paie (windowPayroll, monthPayroll), par les fonctions de l'onglet Paie & comptabilité de
// la Masse salariale (provisionMonth, reconcile, comptaGap, operatingRevenue), par le contrôle DSN (dsnBrutWindow) et par le passage
// vers les charges de personnel (src/lib/croisee/charges-personnel.ts). loadPaieComptaInput appelle ces MÊMES fonctions sur les mêmes
// mois et le même service que l'onglet : les chiffres sont identiques. L'écran, le CSV et l'Excel partent du même modèle. Montants en
// centimes ; un n.d. reste n.d. (raison écrite) jusqu'au tableau et au graphique, jamais un zéro. Aucun nom de personne.

// --- Entrées minimales (les types du moteur y sont assignables) -------------------------------------------------------------------

type MonthValue = { month: string; kind: "value"; open: boolean; brut: number; masse: number; byRubric: Record<RubricId, number>; unclassified: readonly { accountId: string; balanceCents: number }[] };
export type MonthIn = MonthValue | { month: string; kind: "nd"; open: boolean; nd: { reason: string } };
export type WindowIn =
  | { kind: "value"; brut: number; masse: number; byRubric: Record<RubricId, number>; months: readonly MonthIn[] }
  | { kind: "nd"; nd: { reason: string }; months: readonly MonthIn[] };
export type DsnMonthIn = { status: "complete" | "incomplete" | "blocked"; byType: Record<string, number> };
export type Action = { href: string; label: string };
// n.d. d'un bloc (ou du chapitre) : la raison et l'action qui y remédie ; tableOnly : ne concerne qu'un tableau (masqué en « Graphiques »).
export type BlockNd = { label?: string; reason: string; action?: Action; tableOnly?: boolean };

export type ProvisionServiceIn = { value: string | null; cur: ProvisionMonth; prev: ProvisionMonth; persons: number | null; personsPrev: number | null };
export type ComptaIn =
  | { kind: "nd"; reason: string; action?: Action }
  | { kind: "value"; sourceName: string; sourceReason: string; recon: Reconciliation; reconPrev: Reconciliation; masse: number; massePrev: WindowIn; produits: number; produitsPrev: Amount };
export type DsnRowIn = { month: string; open: boolean; journal: MonthIn; dsn: DsnMonthIn | undefined };
export type DsnIn =
  | { kind: "nd"; reason: string; action?: Action }
  | { kind: "value"; rows: DsnRowIn[]; journal: WindowIn; journalPrev: WindowIn; window: DsnWindow; windowPrev: DsnWindow };
export type PaieData = {
  year: number;
  months: string[];
  prevMonths: string[];
  openMonths: string[];
  links: { donnees: string; dsn: string; parametres: string };
  grid: Record<RubricId, string[]>;
  // Journal restreint au service retenu dans les filtres (comme l'onglet Paie & comptabilité) : passage et provision.
  cur: WindowIn;
  prev: WindowIn;
  provCur: ProvisionMonth[];
  provPrev: ProvisionMonth[];
  // Journal entier : provision par service (sans filtre de service), comptabilité, DSN.
  provServices: { kind: "hidden" } | { kind: "nd"; reason: string } | { kind: "value"; rows: ProvisionServiceIn[]; total: { cur: ProvisionMonth; prev: ProvisionMonth } };
  confidentialite: { kind: "set"; value: number } | { kind: "nd"; reason: string };
  compta: ComptaIn;
  dsn: DsnIn;
};
export type PaieInput = { nd: BlockNd | null; data: PaieData | null };

// --- Modèle -------------------------------------------------------------------------------------------------------------------------

// Bloc de l'écran : graphiques et tableaux (identifiants dans model.charts / model.tables), n.d. et lignes courtes (source, limites).
// graph : bloc affiché aussi en « Graphiques ».
export type PaieBlock = { id: string; title: string; term?: string; graph: boolean; nd: BlockNd[]; notes: string[]; charts: string[]; tables: string[] };
// Indicateur « Prévu » : aucun chiffre, la raison (matrice de correspondance) et l'entrée du glossaire.
export type PrevuItem = { id: string; label: string; reason: string; term: string };
export type PaieModel = ChapterModel & { chapter: "paie-compta"; blocks: PaieBlock[]; prevu: PrevuItem[]; trend: boolean };

export const PAIE_IDS = {
  charges: "paie-compta-charges",
  chargesNature: "paie-compta-charges-nature",
  reconMois: "paie-compta-recon-mois",
  reconRubriques: "paie-compta-recon-rubriques",
  ratio: "paie-compta-ratio",
  dsn: "paie-compta-dsn",
  provisionMois: "paie-compta-provision-mois",
  provisionParts: "paie-compta-provision-parts",
  provisionN1: "paie-compta-provision-n1",
  provisionServices: "paie-compta-provision-services",
} as const;

// Identifiants du glossaire cités par le chapitre (lus par le garde-fou du glossaire).
export const PAIE_CX_TERMS = {
  chargesPersonnel: "croisee-charges-personnel",
  decaissements: "croisee-decaissements",
  confidentialite: "croisee-confidentialite",
  provision: "provision",
  rapprochement: "rapprochement",
  ratio: "ratio-produits",
  controleDsn: "controle-dsn",
  brutDsn: "brut-dsn",
  masse: "masse",
  brut: "brut",
  horsMasse: "hors-masse",
  grille: "grille",
} as const;

export const SANS_DSN = "aucune DSN déposée pour ces mois";
export const TOTAL_PERIODE = "Total de la période";
export const MEME_PERIODE_N1 = "Même période N-1";
export const NON_FILTRABLE_COMPTA = "non filtrable par service : la comptabilité ne porte pas le code analytique du journal de paie";
export const NON_FILTRABLE_DSN = "non filtrable par service : la DSN ne porte pas le code analytique du journal de paie";
export const SANS_PRODUITS = "aucun produit d'exploitation (comptes 70 à 75) sur la période";
export const SEUIL_NON_VERIFIABLE = "effectif du service non dénombré : seuil de confidentialité non vérifiable";
export const sousSeuil = (seuil: number): string => `service de moins de ${pluriel(seuil, "personne")} : non affiché (seuil de confidentialité)`;

// Blocs du chapitre que Clair ne calcule pas (matrice 4.7) : « Prévu », sans valeur reconstituée.
export const PREVU_PAIE: PrevuItem[] = [
  {
    id: "paie-compta-decaissements",
    label: "Décaissements par créancier",
    reason: "le classement des comptes de tiers du journal par créancier (grille des créanciers) est un paramètre de l'espace prévu dans une prochaine version",
    term: T.decaissements,
  },
  {
    id: "paie-compta-decaissements-estimes",
    label: "Estimation des décaissements à venir",
    reason: "à saisir comme une hypothèse tracée ; aucune moyenne des derniers mois n'est calculée à sa place",
    term: T.decaissements,
  },
  {
    id: "paie-compta-provisions-rtt-primes",
    label: "Provisions de RTT et de primes",
    reason: "le journal ne provisionne que les congés payés",
    term: M.provision,
  },
];

// --- Petites mises en forme (aucun calcul métier) ---------------------------------------------------------------------------------

type MonthNd = Extract<MonthIn, { kind: "nd" }>;
const isNum = (v: unknown): v is number => typeof v === "number";
const ndOf = (a: Amount): string | null => (typeof a === "object" ? a.nd : null);
const cell = (a: Amount): CroiseeCell => (typeof a === "number" ? a : { nd: a.nd });
const signedOrNd = (a: Amount): string | null => (isNum(a) ? eurosSigned(a) : null);
const monthRow = (m: string, open: boolean) => `${formatMonth(m)}${open ? " (provisoire)" : ""}`;

// Raison d'un mois n.d., sans le mois (écrit à part) ; raison d'une fenêtre n.d. : ses mois regroupés par raison identique
// (« janv. 2026, févr. 2026 : mois hors de la lecture PayFit appliquée »).
const stripMonth = (m: MonthNd) => m.nd.reason.split(m.month).join("").replace(/\s{2,}/g, " ").trim();
export function windowReason(w: { nd: { reason: string }; months: readonly MonthIn[] }): string {
  const lines = ndLines(ndGroups(w.months.map((m) => ({ month: m.month, reason: m.kind === "nd" ? stripMonth(m) : null }))));
  return lines.join(" ; ") || noPeriod(w.nd.reason);
}
const passageOf = (w: WindowIn): ChargesPassage => chargesOfWindow(w.kind === "value" ? { kind: "value", byRubric: w.byRubric } : { kind: "nd", reason: windowReason(w) });
const windowAmount = (w: WindowIn, pick: (v: Extract<WindowIn, { kind: "value" }>) => number): Amount => (w.kind === "value" ? pick(w) : { nd: windowReason(w) });

// Provision d'une fin de mois : total, parts ; raison d'une part n.d. (même règle que les séries de l'écran : provisionParts).
type PV = Extract<ProvisionMonth, { kind: "value" }>;
const partReason = (x: PV, prefix: string) => x.missing.filter((r) => r.startsWith(prefix)).join(" ; ") || x.missing.join(" ; ") || "part n.d.";
const provTotal = (x: ProvisionMonth): Amount => (x.kind === "nd" ? { nd: x.reason } : x.total === null ? { nd: x.missing.join(" ; ") || "total n.d." } : x.total);
const provConges = (x: ProvisionMonth): Amount => (x.kind === "nd" ? { nd: x.reason } : x.conges === null ? { nd: partReason(x, "congés payés") } : x.conges);
const provCharges = (x: ProvisionMonth): Amount => (x.kind === "nd" ? { nd: x.reason } : x.charges === null ? { nd: partReason(x, "charges sociales") } : x.charges);
const provGap = (a: Amount, b: Amount): Amount => (isNum(a) && isNum(b) ? a - b : { nd: "écart non calculable : provision n.d." });

// Seuil de confidentialité appliqué à un service, à une fin de mois : moins de personnes (contrats rémunérés du mois) que le seuil ⇒
// n.d. ; effectif inconnu ⇒ n.d. (seuil non vérifiable). Un mois n.d. garde sa propre raison.
export function guardProvision(x: ProvisionMonth, persons: number | null, seuil: number): { total: Amount; conges: Amount; charges: Amount } {
  if (x.kind === "value") {
    if (persons === null) return { total: { nd: SEUIL_NON_VERIFIABLE }, conges: { nd: SEUIL_NON_VERIFIABLE }, charges: { nd: SEUIL_NON_VERIFIABLE } };
    if (persons < seuil) {
      const r = sousSeuil(seuil);
      return { total: { nd: r }, conges: { nd: r }, charges: { nd: r } };
    }
  }
  return { total: provTotal(x), conges: provConges(x), charges: provCharges(x) };
}

// Libellés courts de l'axe des natures (le libellé complet de la grille est dans l'infobulle).
const RUBRIC_SHORT: Record<RubricId, string> = {
  salaires: "Salaires",
  primes: "Primes",
  stages: "Stages",
  indemnites: "Indemnités",
  cotisations: "Cotisations",
  taxes: "Taxes",
  "provisions-cp": "Prov. CP",
  "autres-charges": "Autres",
};
const rubricLabel = (id: RubricId | "non-classe") => (id === "non-classe" ? "Comptes 63 et 64 non classés" : (RUBRICS.find((r) => r.id === id)?.label ?? id));

const series = (key: string, name: string, list: Amount[], color: string, extra: Partial<ChartSeries> = {}): ChartSeries => ({
  key,
  name,
  values: list.map((a) => (isNum(a) ? a : null)),
  reasons: list.map(ndOf),
  color,
  ...extra,
});

// --- Construction du modèle ----------------------------------------------------------------------------------------------------------

export function buildPaieCompta(input: PaieInput): PaieModel {
  const ID = PAIE_IDS;
  const terms = [T.chargesPersonnel, T.decaissements, T.confidentialite, M.provision, M.rapprochement, M.ratio, M.controleDsn, M.brutDsn, M.masse, M.brut, M.horsMasse, M.grille];
  const base = { chapter: "paie-compta" as const, alerts: [], terms, prevu: PREVU_PAIE };
  const d = input.data;
  if (input.nd || !d) return { ...base, tiles: [], tables: [], charts: [], blocks: [], limits: [], trend: false, nd: input.nd ?? { reason: "journal de paie indisponible" } };

  const nHead = String(d.year);
  const pHead = `${d.year - 1} (N-1)`;
  const last = d.months[d.months.length - 1];
  const lastPrev = d.prevMonths[d.prevMonths.length - 1];
  const open = new Set(d.openMonths);
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: PaieBlock[] = [];
  const limits: string[] = [];

  // --- Passage de la masse chargée aux charges de personnel (journal restreint au service retenu).
  const passN = passageOf(d.cur);
  const passP = passageOf(d.prev);
  const lineRows: CroiseeRow[] = [];
  let foot: CroiseeRow | undefined;
  passN.lines.forEach((l, i) => {
    const p = passP.lines[i];
    const comptes = l.kind === "rubrique" ? d.grid[l.key as RubricId].join(", ") || "aucun compte" : "";
    const row: CroiseeRow = { cells: [l.label, cell(l.amount), cell(p.amount), cell(amountGap(l.amount, p.amount)), comptes] };
    if (l.kind === "total") foot = row;
    else lineRows.push({ ...row, style: l.kind === "sous-total" ? "subtotal" : "child" });
  });
  tables.push({
    id: ID.charges,
    title: "De la masse chargée aux charges de personnel du journal",
    columns: [
      { key: "ligne", header: "Journal de paie", kind: "text" },
      { key: "n", header: nHead, kind: "eur" },
      { key: "n1", header: pHead, kind: "eur" },
      { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true },
      { key: "comptes", header: "Comptes de la grille", kind: "text", term: M.grille },
    ],
    rows: lineRows,
    foot,
    terms: [T.chargesPersonnel, M.masse, M.horsMasse, M.grille],
  });
  const rubN = passN.lines.filter((l) => l.kind === "rubrique");
  const rubP = passP.lines.filter((l) => l.kind === "rubrique");
  charts.push({
    id: ID.chargesNature,
    title: `Charges de personnel par nature, ${nHead} face à ${pHead}`,
    kind: "barres",
    unit: "eur",
    categories: rubN.map((l) => RUBRIC_SHORT[l.key as RubricId] ?? l.label),
    categoryTitles: rubN.map((l) => l.label),
    series: [series("n", nHead, rubN.map((l) => l.amount), COLORS.now), series("n1", pHead, rubP.map((l) => l.amount), COLORS.before)],
    mode: "grouped",
    tableId: ID.charges,
  });
  blocks.push({ id: "charges", title: "De la masse chargée aux charges de personnel", term: T.chargesPersonnel, graph: true, nd: [], notes: [], charts: [ID.chargesNature], tables: [ID.charges] });
  // Comptes 63 / 64 sans rubrique : hors masse et hors passage (signalés, jamais reclassés).
  const unclassified = new Map<string, number>();
  for (const m of d.cur.months) if (m.kind === "value") for (const a of m.unclassified) unclassified.set(a.accountId, (unclassified.get(a.accountId) ?? 0) + a.balanceCents);
  if (unclassified.size > 0) {
    const sum = [...unclassified.values()].reduce((s, v) => s + v, 0);
    limits.push(`Comptes 63 et 64 non classés dans la grille de comptes (${pluriel(unclassified.size, "compte")}, ${euros(sum)}) : hors du passage vers les charges de personnel.`);
  }

  // --- Journal de paie et comptabilité (journal entier) : rapprochement par mois et par rubrique, ratio sur produits.
  const c = d.compta;
  const comptaBlock: PaieBlock = { id: "comptabilite", title: "Journal de paie et comptabilité", term: M.rapprochement, graph: true, nd: [], notes: [], charts: [], tables: [] };
  if (c.kind === "nd") {
    comptaBlock.nd.push({ reason: c.reason, action: c.action });
  } else {
    comptaBlock.notes.push(`Source comptable : ${c.sourceName} · ${noPeriod(c.sourceReason)}`);
    const r = c.recon;
    if (r.kind === "nd") comptaBlock.nd.push({ label: "Rapprochement", reason: r.reason });
    else {
      const prevRow = (label: string): CroiseeRow =>
        c.reconPrev.kind === "value"
          ? { style: "subtotal", cells: [label, c.reconPrev.journal, c.reconPrev.compta, c.reconPrev.ecart] }
          : { style: "subtotal", cells: [label, { nd: c.reconPrev.reason }, { nd: c.reconPrev.reason }, { nd: c.reconPrev.reason }] };
      tables.push({
        id: ID.reconRubriques,
        title: "Rapprochement par rubrique : journal de paie et comptabilité",
        columns: [
          { key: "rubrique", header: "Rubrique", kind: "text" },
          { key: "journal", header: "Journal de paie", kind: "eur" },
          { key: "compta", header: "Comptabilité", kind: "eur" },
          { key: "ecart", header: "Écart journal − comptabilité", kind: "eur", signed: true, term: M.rapprochement },
        ],
        rows: r.rows.map((x) => ({ cells: [rubricLabel(x.rubric), x.journal, x.compta, x.ecart] })),
        foot: { cells: ["Total comptes 63 et 64", r.journal, r.compta, r.ecart] },
        terms: [M.rapprochement, M.grille],
      });
      tables.push({
        id: ID.reconMois,
        title: "Rapprochement par mois : journal de paie et comptabilité",
        columns: [
          { key: "mois", header: "Mois", kind: "text" },
          { key: "journal", header: "Journal de paie", kind: "eur" },
          { key: "compta", header: "Comptabilité", kind: "eur" },
          { key: "ecart", header: "Écart journal − comptabilité", kind: "eur", signed: true, term: M.rapprochement },
        ],
        rows: [
          ...r.months.map((m) => ({ cells: [monthRow(m.month, open.has(m.month)), m.journal, m.compta, m.journal - m.compta] })),
          { style: "subtotal", cells: [TOTAL_PERIODE, r.journal, r.compta, r.ecart] },
          prevRow(MEME_PERIODE_N1),
        ],
        terms: [M.rapprochement],
      });
      const axis = monthsAxis(r.months.map((m) => m.month), [], d.openMonths);
      charts.push({ id: ID.reconMois, title: "Journal de paie et comptabilité, par mois", kind: "barres", unit: "eur", categories: axis.categories, categoryTitles: axis.titles, series: reconMonthSeries(r.months), mode: "grouped", tableId: ID.reconMois });
      const rub = reconRubricChart(r.rows.map((x) => ({ key: x.rubric, label: rubricLabel(x.rubric), journal: x.journal, compta: x.compta })));
      charts.push({ id: ID.reconRubriques, title: "Journal de paie et comptabilité, par rubrique", kind: "barres", unit: "eur", categories: rub.categories, categoryTitles: rub.titles, series: rub.series, mode: "grouped", tableId: ID.reconRubriques });
      comptaBlock.charts.push(ID.reconMois, ID.reconRubriques);
      comptaBlock.tables.push(ID.reconRubriques, ID.reconMois);
    }
    // Masse chargée ÷ produits d'exploitation (même calcul que l'onglet Paie & comptabilité), N et N-1.
    const massePrev = windowAmount(c.massePrev, (w) => w.masse);
    tables.push({
      id: ID.ratio,
      title: "Masse salariale chargée ÷ produits d'exploitation",
      columns: [
        { key: "indicateur", header: "Indicateur", kind: "text" },
        { key: "n", header: nHead, kind: "eur" },
        { key: "n1", header: pHead, kind: "eur" },
      ],
      rows: [
        { cells: ["Masse salariale chargée", c.masse, cell(massePrev)] },
        { cells: ["Produits d'exploitation (comptes 70 à 75)", c.produits, cell(c.produitsPrev)] },
        { kind: "pourcent", cells: ["Masse salariale ÷ produits d'exploitation", ratioCell(c.masse, c.produits), ratioCell(massePrev, c.produitsPrev)] },
      ],
      terms: [M.ratio, M.masse],
    });
    comptaBlock.tables.push(ID.ratio);
  }
  blocks.push(comptaBlock);

  // --- Journal de paie et déclarations sociales (brut, type 001), journal entier.
  const s = d.dsn;
  const dsnBlock: PaieBlock = { id: "dsn", title: "Journal de paie et déclarations sociales (DSN)", term: M.controleDsn, graph: false, nd: [], notes: [], charts: [], tables: [] };
  if (s.kind === "nd") dsnBlock.nd.push({ reason: s.reason, action: s.action });
  else {
    // Brut déclaré d'un mois : même lecture que la colonne « Brut DSN (001) » de l'écran (dsnPoint : non déposée, bloquée, type absent).
    const dsnCell = (x: DsnMonthIn | undefined): Amount => {
      const pt = dsnPoint(x);
      return pt.v === null ? { nd: pt.reason ?? "DSN n.d." } : pt.v;
    };
    const etat = (x: DsnMonthIn | undefined) => (!x ? "non déposée" : x.status === "complete" ? "complète" : x.status === "incomplete" ? "incomplète" : "bloquée");
    const gapCell = (a: Amount, b: Amount): CroiseeCell => (isNum(a) && isNum(b) ? a - b : { nd: "écart non calculable : brut du journal ou de la DSN n.d." });
    const winCell = (w: DsnWindow): Amount => (w.kind === "value" ? w.brutCents : { nd: w.reason });
    const winEtat = (w: DsnWindow) => (w.kind === "value" && w.incompleteMonths.length ? `mois incomplets : ${w.incompleteMonths.map(monthShortYear).join(", ")}` : "");
    const total = (label: string, j: WindowIn, w: DsnWindow): CroiseeRow => {
      const ja = windowAmount(j, (v) => v.brut);
      const wa = winCell(w);
      return { style: "subtotal", cells: [label, cell(ja), cell(wa), gapCell(ja, wa), winEtat(w)] };
    };
    tables.push({
      id: ID.dsn,
      title: "Brut du journal de paie et brut déclaré (DSN, type 001)",
      columns: [
        { key: "mois", header: "Mois", kind: "text" },
        { key: "journal", header: "Brut du journal", kind: "eur", term: M.brut },
        { key: "dsn", header: "Brut DSN (001)", kind: "eur", term: M.brutDsn },
        { key: "ecart", header: "Écart journal − DSN", kind: "eur", signed: true, term: M.controleDsn },
        { key: "etat", header: "DSN", kind: "text" },
      ],
      rows: [
        ...s.rows.map((r) => {
          const j: Amount = r.journal.kind === "value" ? r.journal.brut : { nd: stripMonth(r.journal) };
          const x = dsnCell(r.dsn);
          return { cells: [monthRow(r.month, r.open), cell(j), cell(x), gapCell(j, x), etat(r.dsn)] };
        }),
        total(TOTAL_PERIODE, s.journal, s.window),
        total(MEME_PERIODE_N1, s.journalPrev, s.windowPrev),
      ],
      terms: [M.controleDsn, M.brutDsn],
    });
    dsnBlock.tables.push(ID.dsn);
  }
  blocks.push(dsnBlock);

  // --- Provision de congés payés (journal restreint au service retenu), puis par service (journal entier, seuil de confidentialité).
  const provBlock: PaieBlock = { id: "provision", title: "Provision de congés payés", term: M.provision, graph: true, nd: [], notes: [], charts: [ID.provisionParts, ID.provisionN1], tables: [ID.provisionMois] };
  tables.push({
    id: ID.provisionMois,
    title: "Provision de congés payés à fin de mois, N et N-1",
    columns: [
      { key: "mois", header: "Fin de mois", kind: "text" },
      { key: "total", header: "Total", kind: "eur", term: M.provision },
      { key: "total-n1", header: "Total N-1", kind: "eur" },
      { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true },
      { key: "conges", header: "dont congés payés", kind: "eur" },
      { key: "charges", header: "dont charges sociales", kind: "eur" },
    ],
    rows: d.months.map((m, i) => {
      const a = d.provCur[i];
      const b = d.provPrev[i];
      return { cells: [monthRow(m, open.has(m)), cell(provTotal(a)), cell(provTotal(b)), cell(provGap(provTotal(a), provTotal(b))), cell(provConges(a)), cell(provCharges(a))] };
    }),
    terms: [M.provision],
  });
  const axisN = monthsAxis(d.months, [], d.openMonths);
  const axisBoth = monthsAxis(d.months, d.prevMonths, d.openMonths);
  charts.push({ id: ID.provisionParts, title: `Provision fin de mois, ${nHead}`, kind: "barres", unit: "eur", categories: axisN.categories, categoryTitles: axisN.titles, series: provisionParts(d.provCur), mode: "stacked", tableId: ID.provisionMois });
  charts.push({
    id: ID.provisionN1,
    title: `Total de la provision, ${nHead} face à ${pHead}`,
    kind: "courbe",
    unit: "eur",
    categories: axisBoth.categories,
    categoryTitles: axisBoth.titles,
    series: provisionTotals(d.provCur, d.provPrev, { cur: `Provision ${nHead}`, prev: `Provision ${pHead}` }),
    tableId: ID.provisionMois,
  });
  const ps = d.provServices;
  if (ps.kind === "nd") provBlock.nd.push({ label: "Provision par service", reason: ps.reason, tableOnly: true });
  else if (ps.kind === "value") {
    if (d.confidentialite.kind === "nd") provBlock.nd.push({ label: "Provision par service", reason: d.confidentialite.reason, action: { href: d.links.parametres, label: "Paramètres" }, tableOnly: true });
    else {
      const seuil = d.confidentialite.value;
      const line = (label: string, a: { total: Amount; conges: Amount; charges: Amount }, b: { total: Amount }): CroiseeCell[] => [label, cell(a.total), cell(b.total), cell(provGap(a.total, b.total)), cell(a.conges), cell(a.charges)];
      const whole = (x: ProvisionMonth) => ({ total: provTotal(x), conges: provConges(x), charges: provCharges(x) });
      tables.push({
        id: ID.provisionServices,
        title: `Provision de congés payés par service, fin ${monthLongLabel(last)}`,
        columns: [
          { key: "service", header: `Service, fin ${monthLongLabel(last)}`, kind: "text", term: M.provision },
          { key: "total", header: "Total", kind: "eur" },
          { key: "total-n1", header: `Total fin ${monthLongLabel(lastPrev)}`, kind: "eur" },
          { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true },
          { key: "conges", header: "dont congés payés", kind: "eur" },
          { key: "charges", header: "dont charges sociales", kind: "eur" },
        ],
        rows: ps.rows.map((r) => ({ cells: line(r.value ?? "Non ventilé", guardProvision(r.cur, r.persons, seuil), guardProvision(r.prev, r.personsPrev, seuil)) })),
        foot: { cells: line("Toute l'entreprise", whole(ps.total.cur), whole(ps.total.prev)) },
        terms: [M.provision, T.confidentialite],
      });
      provBlock.tables.push(ID.provisionServices);
      limits.push("Provision par service : effectif compté en contrats rémunérés du mois dans le journal de paie ; un service sous le seuil de confidentialité est n.d., la ligne « Toute l'entreprise » reste complète.");
    }
  }
  blocks.push(provBlock);

  // --- Cartes : charges de personnel, écarts journal − comptabilité et journal − DSN, provision de fin de mois, ratio sur produits.
  const tiles: TileSpec[] = [];
  const value = (a: Amount, text: (v: number) => string): TileValue => (isNum(a) ? { text: text(a), kind: "value", reason: null } : ndTile(a.nd));
  const gapN = amountGap(passN.total, passP.total);
  tiles.push({
    id: "charges",
    label: "Charges de personnel du journal",
    term: T.chargesPersonnel,
    value: value(passN.total, euros),
    cost: true,
    main: true,
    variations: [plainVariation("N-1", isNum(passP.total) ? euros(passP.total) : null, ndOf(passP.total)), costVariation("Écart", isNum(gapN) ? gapN : null, signedOrNd(gapN), ndOf(gapN))],
  });
  const recon = c.kind === "value" ? c.recon : null;
  tiles.push({
    id: "ecart-compta",
    label: "Écart journal − comptabilité",
    term: M.rapprochement,
    sub: "Comptes 63 et 64",
    value: c.kind === "nd" ? ndTile(c.reason) : recon?.kind === "value" ? { text: eurosSigned(recon.ecart), kind: "value", reason: null } : ndTile(recon?.kind === "nd" ? recon.reason : "rapprochement n.d."),
    variations:
      c.kind === "value"
        ? [c.reconPrev.kind === "value" ? plainVariation("N-1", eurosSigned(c.reconPrev.ecart)) : plainVariation("N-1", null, c.reconPrev.reason)]
        : [],
  });
  const dsnGap = (j: WindowIn, w: DsnWindow): Amount => {
    const ja = windowAmount(j, (v) => v.brut);
    if (!isNum(ja)) return ja;
    return w.kind === "value" ? ja - w.brutCents : { nd: w.reason };
  };
  const dn = s.kind === "value" ? dsnGap(s.journal, s.window) : { nd: s.reason };
  const dp = s.kind === "value" ? dsnGap(s.journalPrev, s.windowPrev) : null;
  tiles.push({
    id: "ecart-dsn",
    label: "Écart journal − DSN",
    term: M.controleDsn,
    sub: "Brut, type 001",
    value: value(dn, eurosSigned),
    variations: dp === null ? [] : [plainVariation("N-1", signedOrNd(dp), ndOf(dp))],
    note: s.kind === "value" && s.window.kind === "value" && s.window.incompleteMonths.length ? `DSN incomplète : ${s.window.incompleteMonths.map(monthShortYear).join(", ")}` : undefined,
  });
  const provLast = d.provCur[d.provCur.length - 1];
  const provN = provTotal(provLast);
  const provP = provTotal(d.provPrev[d.provPrev.length - 1]);
  const provG = provGap(provN, provP);
  const part = (a: Amount) => (isNum(a) ? euros(a) : "n.d.");
  tiles.push({
    id: "provision",
    label: `Provision fin ${monthLongLabel(last)}`,
    term: M.provision,
    sub: provLast.kind === "value" ? `congés payés ${part(provConges(provLast))} + charges sociales ${part(provCharges(provLast))}` : undefined,
    value: value(provN, euros),
    cost: true,
    variations: [plainVariation(`Fin ${monthLongLabel(lastPrev)}`, isNum(provP) ? euros(provP) : null, ndOf(provP)), costVariation("Écart", isNum(provG) ? provG : null, signedOrNd(provG), isNum(provG) ? null : ndOf(provG))],
  });
  const ratioN = c.kind === "nd" ? ({ nd: c.reason } as const) : ratioOf(c.masse, c.produits);
  const ratioP = c.kind === "nd" ? null : ratioOf(windowAmount(c.massePrev, (w) => w.masse), c.produitsPrev);
  const ratioText = (r: Ratio | { nd: string }) => ("nd" in r ? null : fmtPercent(r));
  tiles.push({
    id: "ratio",
    label: "Masse salariale ÷ produits d'exploitation",
    term: M.ratio,
    value: "nd" in ratioN ? ndTile(ratioN.nd) : { text: fmtPercent(ratioN), kind: "value", reason: null },
    variations: ratioP === null ? [] : [plainVariation("N-1", ratioText(ratioP), "nd" in ratioP ? ratioP.nd : null)],
  });

  return { ...base, tiles, tables, charts, blocks, limits, trend: true, nd: null };
}

// Ratio masse chargée ÷ produits d'exploitation (fraction exacte) : n.d. si l'un des deux l'est, ou sans produit d'exploitation (zéro ou
// négatif). Arrondi une seule fois à l'affichage (centième de point), comme l'onglet Paie & comptabilité.
type Ratio = { num: number; den: number };
export function ratioOf(masse: Amount, produits: Amount): Ratio | { nd: string } {
  if (!isNum(masse)) return { nd: masse.nd };
  if (!isNum(produits)) return { nd: produits.nd };
  return produits <= 0 ? { nd: SANS_PRODUITS } : { num: masse, den: produits };
}
function ratioCell(masse: Amount, produits: Amount): CroiseeCell {
  const r = ratioOf(masse, produits);
  return "nd" in r ? { nd: r.nd } : { exact: r.num / r.den };
}

// --- Chargement : mêmes fonctions et mêmes entrées que l'onglet Paie & comptabilité de la Masse salariale -----------------------------

export async function loadPaieComptaInput(ctx: CroiseeContext): Promise<PaieInput> {
  const links = { donnees: `/e/${ctx.slug}/donnees`, dsn: `/e/${ctx.slug}/donnees/dsn`, parametres: croiseeSettingsHref(ctx.slug) };
  const dataAction: Action = { href: links.donnees, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction }, data: null };
  const pay = await ctx.load.payroll();
  const full = pay.input;
  if (!full) return { nd: { reason: journalReason(pay) ?? "journal de paie indisponible", action: dataAction }, data: null };
  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const last = months[months.length - 1];
  const lastPrev = prevMonths[prevMonths.length - 1];
  // Même entrée que l'onglet : le journal restreint au service retenu dans les filtres (s'il y en a un).
  const svc = ctx.service.value;
  const filtered = svc !== undefined;
  const input = filtered ? withService(full, svc) : full;
  const removeFilter: Action = { href: ctx.href({ service: null }), label: "Retirer le filtre Service" };

  // Provision par service : journal entier, fins de mois N et N-1, effectif = contrats rémunérés du mois dans le service.
  let provServices: PaieData["provServices"];
  if (filtered) provServices = { kind: "hidden" };
  else if (!ctx.service.axis || !full.serviceAxis) provServices = { kind: "nd", reason: ctx.service.reason ?? "aucun axe de service retenu (Paramètres)" };
  else {
    const services = servicesOf(full, [last, lastPrev]);
    const persons = (si: typeof full, m: string) => {
      const r = monthPayroll(si, m);
      return r.kind === "value" ? r.paidContracts.length : null;
    };
    provServices =
      services.length === 0
        ? { kind: "nd", reason: "aucune ligne de charges de personnel dans le journal pour ces fins de mois" }
        : {
            kind: "value",
            rows: services.map((s) => {
              const si = withService(full, s);
              return { value: s, cur: provisionMonth(si, last), prev: provisionMonth(si, lastPrev), persons: persons(si, last), personsPrev: persons(si, lastPrev) };
            }),
            total: { cur: provisionMonth(full, last), prev: provisionMonth(full, lastPrev) },
          };
  }
  const conf = ctx.settings.confidentialite;
  const seuil = settingValue(conf);
  const confidentialite: PaieData["confidentialite"] = seuil !== null ? { kind: "set", value: seuil } : { kind: "nd", reason: croiseeSettingReason("confidentialite", conf) ?? "seuil de confidentialité non défini (Paramètres)" };

  // Comptabilité : mêmes contrôles et mêmes raisons que l'onglet Paie & comptabilité (une seule raison, écrite une fois).
  let compta: ComptaIn;
  if (filtered) compta = { kind: "nd", reason: NON_FILTRABLE_COMPTA, action: removeFilter };
  else {
    const c = await ctx.load.compta();
    const masse = windowPayroll(full, months);
    const sourceName = c.source === "fec" ? "FEC déposés" : "API Pennylane";
    const gap = c.source ? comptaGap(c.months, c.nd, months) : null;
    if (c.error) compta = { kind: "nd", reason: "lecture de la comptabilité en erreur ; le détail est dans les journaux du serveur, rechargez la page", action: { href: links.donnees, label: "Vérifier la source comptable dans Données" } };
    else if (!c.source)
      compta = {
        kind: "nd",
        reason: /^aucune source appliquée/i.test(c.reason) ? "aucune source comptable retenue pour ce domaine" : `aucune source comptable retenue : ${reasonText(c.reason)}`,
        action: { href: links.donnees, label: "Connecter Pennylane ou déposer un FEC dans Données" },
      };
    else if (masse.kind === "nd") compta = { kind: "nd", reason: `journal de paie : ${noPeriod(masse.nd.reason)}`, action: { href: links.donnees, label: "Lire le journal de paie dans Données" } };
    else if (gap) compta = { kind: "nd", reason: `${noPeriod(gap)} (source comptable : ${sourceName})`, action: { href: links.donnees, label: "Compléter la comptabilité dans Données" } };
    else {
      const gapPrev = comptaGap(c.months, c.nd, prevMonths);
      compta = {
        kind: "value",
        sourceName,
        sourceReason: c.reason,
        recon: reconcile(full, c.lines, c.months, months, c.nd),
        reconPrev: reconcile(full, c.lines, c.months, prevMonths, c.nd),
        masse: masse.masse,
        massePrev: windowPayroll(full, prevMonths),
        produits: operatingRevenue(c.lines, months),
        produitsPrev: gapPrev ? { nd: gapPrev } : operatingRevenue(c.lines, prevMonths),
      };
    }
  }

  // DSN : contrôle du brut du journal (journal entier), comme la colonne « Brut DSN (001) » de la Synthèse de la Masse salariale.
  let dsn: DsnIn;
  if (filtered) dsn = { kind: "nd", reason: NON_FILTRABLE_DSN, action: removeFilter };
  else if (![...months, ...prevMonths].some((m) => pay.dsn.has(m))) dsn = { kind: "nd", reason: SANS_DSN, action: { href: links.dsn, label: "Données › DSN" } };
  else {
    const journal = windowPayroll(full, months);
    dsn = {
      kind: "value",
      rows: journal.months.map((m) => ({ month: m.month, open: m.open, journal: m, dsn: pay.dsn.get(m.month) })),
      journal,
      journalPrev: windowPayroll(full, prevMonths),
      window: dsnBrutWindow(pay.dsn, months),
      windowPrev: dsnBrutWindow(pay.dsn, prevMonths),
    };
  }

  return {
    nd: null,
    data: {
      year: p.year,
      months,
      prevMonths,
      openMonths: ctx.openMonths,
      links,
      grid: full.grid,
      cur: windowPayroll(input, months),
      prev: windowPayroll(input, prevMonths),
      provCur: months.map((m) => provisionMonth(input, m)),
      provPrev: prevMonths.map((m) => provisionMonth(input, m)),
      provServices,
      confidentialite,
      compta,
      dsn,
    },
  };
}
