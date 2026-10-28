import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ChartSeries } from "@/components/charts/shared";
import { amountGap, chargesOfWindow, type Amount, type ChargesPassage } from "@/lib/croisee/charges-personnel";
import { journalReason } from "@/lib/croisee/format";
import { memoPublicModel as memoByContext } from "@/lib/croisee/public";
import { confidentialiteHref, confidentialiteReason, isHidden, maskGroups, maskReason as sharedMaskReason, personsOfContracts, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE as GROUPE_NON_DENOMBRE, type ConfidentialiteSetting, type MaskInput, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { confidentialiteOf as seuilOf, groupInput, serviceGuardOnWindows, type Confidentialite, type ServiceGuard } from "@/lib/croisee/confidentialite";
import { formatMonth } from "@/lib/dates";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { MASSE_TERMS as M } from "@/lib/glossary/masse";
import { dsnBrutWindow, type DsnWindow } from "@/lib/payroll/dsn";
import { monthPayroll, serviceOf, servicesOf, windowPayroll, withService, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { classify, gridRubrics, RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { comptaGap, maskProvisionServices, maskProvisionStatus, operatingRevenue, provisionContracts, provisionGuard, provisionMonth, provisionServiceKey, reconcile, type ProvisionMonth, type Reconciliation } from "@/lib/payroll/lot2";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { costVariation, plainVariation, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeRow, type CroiseeTable, type TileSpec } from "@/lib/viz/croisee";
import { capital, COLORS, dsnPoint, euros, eurosSigned, monthLongLabel, monthsAxis, monthShortYear, ndGroups, ndLines, noPeriod, pluriel, provisionParts, provisionTotals, reasonText, reconMonthSeries, reconRubricChart } from "@/lib/viz/masse";
import { nd as ndTile, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 07 · Paie & comptabilité. buildPaieCompta est une fonction PURE : elle met en forme des résultats
// déjà calculés par le moteur du journal de paie (windowPayroll, monthPayroll), par les fonctions de l'onglet Paie & comptabilité de
// la Masse salariale (provisionMonth, reconcile, comptaGap, operatingRevenue), par le contrôle DSN (dsnBrutWindow) et par le passage
// vers les charges de personnel (src/lib/croisee/charges-personnel.ts). loadPaieComptaInput appelle ces MÊMES fonctions sur les mêmes
// mois et le même service que l'onglet, puis applique le seuil de confidentialité (module partagé src/lib/confidentialite : groupes
// comptés en personnes distinctes, masquage maskGroups) aux chiffres d'un service. L'écran, le CSV et l'Excel partent du même modèle
// (paieComptaModel, calculé une fois par requête). Montants en centimes ; un n.d. reste n.d. (raison écrite) jusqu'au tableau et au
// graphique, jamais un zéro. Aucun nom de personne ni identifiant de contrat.

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

// Provision d'un service à la dernière fin de mois N et N-1, seuil de confidentialité DÉJÀ appliqué (maskedProvision).
export type ProvisionServiceIn = { value: string | null; cur: ProvisionMonth; prev: ProvisionMonth };
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
  labels: { period: string; prev: string }; // libellés de la période et de N-1 (« janvier → mars 2026 »), jamais l'année seule
  openMonths: string[]; // mois non clos du JOURNAL DE PAIE (période et N-1) : mention « (provisoire) »
  links: { donnees: string; dsn: string; parametres: string; retirerFiltre: string };
  grid: Record<RubricId, string[]>;
  // Service retenu dans les filtres (null : toute l'entreprise). Ses chiffres suivent le seuil de confidentialité : guard, la garde
  // unique du filtre Service (seuil absent ou illisible, service masqué dans les lignes par service, masquage secondaire compris) rend
  // passage et provision du service n.d. ; provision, la garde de la provision (provisionGuard : une fin de mois du service masquée
  // dans la provision par service) rend la provision du service n.d. Lien vers Paramètres (paramètre) ou retrait du filtre (seuil).
  service: { label: string; guard: ServiceGuard | null; provision: ServiceGuard | null } | null;
  // Journal restreint au service retenu (comme l'onglet Paie & comptabilité), seuil déjà appliqué : passage et provision.
  cur: WindowIn;
  prev: WindowIn;
  provCur: ProvisionMonth[];
  provPrev: ProvisionMonth[];
  // Journal entier : provision par service (sans filtre de service, seuil déjà appliqué), comptabilité, DSN.
  provServices: { kind: "hidden" } | { kind: "nd"; reason: string; action?: Action } | { kind: "value"; rows: ProvisionServiceIn[]; total: { cur: ProvisionMonth; prev: ProvisionMonth } };
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

// Entrées du glossaire citées par le chapitre : elles forment model.terms (feuille « Définitions » de l'export).
export const PAIE_CX_TERMS = {
  chargesPersonnel: T.chargesPersonnel,
  decaissements: T.decaissements,
  confidentialite: T.confidentialite,
  provision: M.provision,
  rapprochement: M.rapprochement,
  ratio: M.ratio,
  controleDsn: M.controleDsn,
  brutDsn: M.brutDsn,
  masse: M.masse,
  brut: M.brut,
  horsMasse: M.horsMasse,
  grille: M.grille,
} as const;

export const SANS_DSN = "aucune DSN déposée pour ces mois";
export const TOTAL_PERIODE = "Total de la période";
export const MEME_PERIODE_N1 = "Même période N-1";
export const NON_FILTRABLE_COMPTA = "non filtrable par service : la comptabilité ne porte pas le code analytique du journal de paie";
export const NON_FILTRABLE_DSN = "non filtrable par service : la DSN ne porte pas le code analytique du journal de paie";
export const SANS_PRODUITS = "aucun produit d'exploitation (comptes 70 à 75) sur la période";
// Raisons du module partagé : groupe non dénombré, seuil non défini.
export const SEUIL_NON_VERIFIABLE = GROUPE_NON_DENOMBRE;
export const SEUIL_ABSENT = SEUIL_NON_DEFINI;
// Limites de la lecture : comment le seuil compte un service (tableau par service, puis service retenu dans les filtres).
export const PROVISION_SERVICES_LIMITE =
  "Provision par service : seuil de confidentialité compté à chaque fin de mois en personnes distinctes dont un contrat porte une ligne de dotation de la provision ; une provision non nulle sans contrat rattaché, ou dont les contrats ne sont pas reliés à une personne, n'est pas vérifiable ; masquage secondaire compris ; la ligne « Toute l'entreprise » reste complète.";
export const SERVICE_RETENU_LIMITE =
  "Service retenu : n.d. dès que sa ligne par service est masquée dans la Masse salariale (période, N-1 ou un de leurs mois, masquage secondaire compris) ; sa provision est n.d. dès qu'une de ses fins de mois l'est dans la provision par service ; le passage, compté chaque mois en personnes distinctes dont un contrat porte une ligne de charges de personnel, est masqué quand la provision l'est ; une valeur non nulle sans contrat rattaché n'est pas vérifiable.";
// Raison d'une valeur masquée, la MÊME dans toute l'application pour le masquage principal et le masquage secondaire (module partagé).
export const sousSeuil = (seuil: number): string => confidentialiteReason(seuil);

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

// --- Seuil de confidentialité par service (module partagé) -------------------------------------------------------------------------

// Un groupe = un service à une fin de mois, pour UNE valeur affichée : la provision de congés payés, ou le passage vers les charges de
// personnel. group = personnes distinctes dont un contrat porte au moins une ligne de cette valeur dans le journal de paie
// (provisionContracts, passageContracts, reliés par le référentiel), et contrats non reliés ; null : effectif non dénombré (mois n.d.,
// aucune valeur affichée). value = la valeur affichée, qui ordonne le masquage secondaire (le plus petit montant d'abord) ; null :
// valeur n.d. (le groupe n'est alors ni masqué ni protecteur : il n'affiche rien). nonZero = la valeur affichée n'est pas nulle ;
// absent, il se lit sur value. Statuts du module partagé : shown (affiché), masked (1 à seuil − 1 personnes), secondary (masqué pour
// protéger un autre service), unverifiable (effectif non dénombré : mois n.d., contrats non reliés sous le seuil, valeur non nulle
// sans contrat rattaché), nd (valeur déjà n.d.).
export type MaskStatus = "shown" | "masked" | "secondary" | "unverifiable" | "nd";
export type MaskGroup = { group: PersonsOfContracts | null; value: number | null; nonZero?: boolean };

// Règle (maskGroups, le total de toute l'entreprise étant affiché) : un service de 1 à (seuil − 1) personnes est masqué ; un service
// non dénombré (valeur non nulle sans contrat rattaché, ou contrats non reliés sous le seuil) n'est pas vérifiable ; un service sans
// contrat et de valeur nulle ne décrit personne. Les services masqués doivent compter AU MOINS « seuil » personnes distinctes (une
// personne présente dans deux services masqués compte une fois) : sinon le service affiché de plus petit montant est masqué aussi, et
// ainsi de suite ; un service sans personne comptée ne suffit jamais à en protéger un autre.
export function maskServices(groups: readonly MaskGroup[], seuil: number): MaskStatus[] {
  const inputs = groups.map((g): MaskInput => (g.group === null ? { size: null, value: g.value } : groupInput(g.group, seuil, g.value, g.nonZero ?? (g.value !== null && g.value !== 0))));
  return maskGroups(inputs, seuil, true);
}

// Contrats d'un service (input.serviceFilter ; toute l'entreprise sans filtre) qui portent, dans le mois, une ligne de la valeur
// affichée. Provision : lignes de dotation « Mois courant » de la rubrique Provisions de congés payés, celles que provisionMonth
// additionne (provisionContracts de lot2.ts, la fonction de l'onglet Paie & comptabilité, ré-exportée). Passage : toute ligne de
// charges de personnel (rubrique de la grille ou compte 63/64 non classé), celles que monthPayroll additionne. Une ligne sans contrat
// ne compte pas : un service qui n'a que de telles lignes est « sans contrat rattaché ».
export { provisionContracts };
export function passageContracts(input: JournalInput, month: string): string[] {
  const rubrics = gridRubrics(input.grid);
  const f = input.serviceFilter;
  const ids = new Set<string>();
  for (const l of input.lines) {
    if (l.month !== month || !l.contractId) continue;
    const c = classify(l.accountId, rubrics);
    if (!(c.rubric !== null || c.payroll)) continue;
    if (f && serviceOf(l, input.serviceAxis) !== f.value) continue;
    ids.add(l.contractId);
  }
  return [...ids].sort();
}

// Statut du passage d'un service retenu dans les filtres : le passage contient la rubrique Provisions de congés payés (dotations et
// reprises du mois) ; il est donc masqué aussi quand la provision du service est masquée (principal ou secondaire), sinon sa ligne
// « Provisions de congés payés » redonnerait ce que le bloc Provision masque. Pour chaque valeur, les services masqués contiennent
// ceux de son propre masquage, qui comptent au moins « seuil » contrats : rien ne se retrouve par différence. Une provision n.d.
// (« non vérifiable ») ne masque pas le passage : le bloc Provision n'affiche alors rien.
export const passageStatus = (passage: MaskStatus, provision: MaskStatus): MaskStatus =>
  passage === "shown" && (provision === "masked" || provision === "secondary") ? provision : passage;

// Groupe du seuil pour le passage d'un service et d'un mois (journal restreint au service). link : lien contrat → personne du
// référentiel (absent : aucun contrat relié, le service n'est pas dénombré dès qu'il porte une valeur non nulle). La provision suit
// provisionCell / maskProvisionStatus de lot2.ts (règle de valeur « total, à défaut la part connue »), jamais un groupe local.
export function passageGroup(input: JournalInput, month: string, link: PersonLink = new Map()): MaskGroup {
  const r = monthPayroll(input, month);
  if (r.kind === "nd") return { group: null, value: null };
  const rubrics = Object.values(r.byRubric);
  const amounts = [...rubrics, ...r.unclassified.map((a) => a.balanceCents)];
  return { group: personsOfContracts(passageContracts(input, month), link), value: rubrics.reduce((s, v) => s + v, 0), nonZero: amounts.some((v) => v !== 0) };
}

// Raison d'un statut masqué (module partagé) ; un statut « nd » n'a pas de raison propre ici (la valeur garde la sienne).
const maskReason = (s: MaskStatus, seuil: number): string => sharedMaskReason(s, seuil) ?? SEUIL_NON_VERIFIABLE;

// Provision d'un service selon son statut : affichée telle quelle, ou n.d. avec la raison du seuil (un mois déjà n.d. garde sa raison).
export function maskedProvision(x: ProvisionMonth, status: MaskStatus, seuil: number): ProvisionMonth {
  if (!isHidden(status) || x.kind === "nd") return x;
  return { month: x.month, kind: "nd", reason: maskReason(status, seuil) };
}

// Fenêtre du journal d'un service : n.d. dès qu'un de ses mois est masqué (sinon le mois se retrouverait par différence avec une
// autre période), ce mois portant la raison du seuil ; un mois déjà n.d. garde sa raison.
export function maskedWindow(w: WindowIn, statusAt: (month: string) => MaskStatus, seuil: number): WindowIn {
  let masked = false;
  const list: readonly MonthIn[] = w.months;
  const months = list.map((r): MonthIn => {
    const s = statusAt(r.month);
    if (!isHidden(s) || r.kind === "nd") return r;
    masked = true;
    return { month: r.month, kind: "nd", open: r.open, nd: { reason: maskReason(s, seuil) } };
  });
  return masked ? { kind: "nd", nd: { reason: sousSeuil(seuil) }, months } : w;
}

// Seuil de l'espace (module partagé) : la valeur, sinon n.d. avec la raison du paramètre (jamais de valeur par défaut).
export function confidentialiteOf(s: ConfidentialiteSetting): Confidentialite {
  return seuilOf(s);
}

// --- Petites mises en forme (aucun calcul métier) ---------------------------------------------------------------------------------

type MonthNd = Extract<MonthIn, { kind: "nd" }>;
const isNum = (v: unknown): v is number => typeof v === "number";
const ndOf = (a: Amount): string | null => (typeof a === "object" ? a.nd : null);
const cell = (a: Amount): CroiseeCell => (typeof a === "number" ? a : { nd: a.nd });
const signedOrNd = (a: Amount): string | null => (isNum(a) ? eurosSigned(a) : null);
const monthRow = (m: string, open: boolean) => `${formatMonth(m)}${open ? " (provisoire)" : ""}`;
// Valeur d'un point de série : le nombre, ou n.d. avec la raison de la série (jamais 0).
const pointOf = (s: ChartSeries, i: number): Amount => {
  const v = s.values[i];
  return typeof v === "number" ? v : { nd: s.reasons?.[i] ?? "valeur n.d." };
};
// Libellé d'une rubrique du rapprochement : celui de l'onglet Paie & comptabilité.
const rubricLabel = (id: RubricId | "non-classe") => (id === "non-classe" ? "Comptes 63/64 non classés" : (RUBRICS.find((r) => r.id === id)?.label ?? id));

// Raison d'un mois n.d., sans le mois (écrit à part) ; raison d'une fenêtre n.d. : ses mois regroupés par raison identique
// (« janv. 2026, févr. 2026 : mois hors de la lecture PayFit appliquée »).
const stripMonth = (m: MonthNd) => m.nd.reason.split(m.month).join("").replace(/\s{2,}/g, " ").trim();
export function windowReason(w: { nd: { reason: string }; months: readonly MonthIn[] }): string {
  const lines = ndLines(ndGroups(w.months.map((m) => ({ month: m.month, reason: m.kind === "nd" ? stripMonth(m) : null }))));
  return lines.join(" ; ") || noPeriod(w.nd.reason);
}
const passageOf = (w: WindowIn): ChargesPassage => chargesOfWindow(w.kind === "value" ? { kind: "value", byRubric: w.byRubric } : { kind: "nd", reason: windowReason(w) });
const windowAmount = (w: WindowIn, pick: (v: Extract<WindowIn, { kind: "value" }>) => number): Amount => (w.kind === "value" ? pick(w) : { nd: windowReason(w) });

// Provision d'une fin de mois (total, congés payés, charges sociales) et de la même fin de mois N-1 : lus dans les séries mêmes du
// graphique (provisionParts, provisionTotals de l'onglet), donc avec les mêmes valeurs et les mêmes raisons n.d.
function provisionAmounts(cur: ProvisionMonth, prev: ProvisionMonth): { total: Amount; totalPrev: Amount; conges: Amount; charges: Amount } {
  const [c, s] = provisionParts([cur]);
  const [t, tp] = provisionTotals([cur], [prev], { cur: "", prev: "" });
  return { total: pointOf(t, 0), totalPrev: pointOf(tp, 0), conges: pointOf(c, 0), charges: pointOf(s, 0) };
}
const provGap = (a: Amount, b: Amount): Amount => (isNum(a) && isNum(b) ? a - b : { nd: "écart non calculable : provision n.d." });

// Libellés courts de l'axe des rubriques : ceux du graphique de rapprochement de l'onglet (reconRubricChart) ; seuls les libellés
// de l'axe en sont repris, les séries sont celles du passage.
const rubricAxis = (rows: { key: string; label: string }[]) => {
  const a = reconRubricChart(rows.map((r) => ({ key: r.key, label: r.label, journal: 0, compta: 0 })));
  return { categories: a.categories, titles: a.titles };
};

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
  const base = { chapter: "paie-compta" as const, alerts: [], terms: Object.values(PAIE_CX_TERMS), prevu: PREVU_PAIE };
  const d = input.data;
  if (input.nd || !d) return { ...base, tiles: [], tables: [], charts: [], blocks: [], limits: [], trend: false, nd: input.nd ?? { reason: "journal de paie indisponible" } };

  // En-têtes de période (D4) : jamais l'année seule pour une période partielle.
  const nHead = capital(d.labels.period);
  const pHead = `N-1 (${d.labels.prev})`;
  const last = d.months[d.months.length - 1];
  const lastPrev = d.prevMonths[d.prevMonths.length - 1];
  const open = new Set(d.openMonths);
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: PaieBlock[] = [];
  const limits: string[] = [];
  // Service retenu gardé (seuil non défini, ou service masqué dans les lignes par service : garde unique du filtre Service) : passage
  // et provision du service sont n.d., avec le lien vers Paramètres (paramètre) ou le retrait du filtre (seuil). Provision gardée seule
  // (une fin de mois du service masquée dans la provision par service) : la provision du service est n.d.
  const toParams: Action = { href: d.links.parametres, label: "Paramètres" };
  const guardAction = (g: ServiceGuard): Action => (g.cause === "parametre" ? toParams : { href: d.links.retirerFiltre, label: "Retirer le filtre Service" });
  const serviceGuard = d.service?.guard ?? null;
  const serviceNd = serviceGuard?.reason ?? null;
  const provGuard = serviceGuard ?? d.service?.provision ?? null;
  const provisionNd = provGuard?.reason ?? null;

  // --- Passage de la masse chargée aux charges de personnel (journal restreint au service retenu).
  const passN = passageOf(d.cur);
  const passP = passageOf(d.prev);
  const chargesBlock: PaieBlock = { id: "charges", title: "De la masse chargée aux charges de personnel", term: T.chargesPersonnel, graph: true, nd: [], notes: [], charts: [], tables: [] };
  if (serviceGuard) chargesBlock.nd.push({ reason: serviceGuard.reason, action: guardAction(serviceGuard) });
  else {
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
    const axis = rubricAxis(rubN.map((l) => ({ key: l.key, label: l.label })));
    charts.push({
      id: ID.chargesNature,
      title: `Charges de personnel par nature, ${d.labels.period} face à N-1 (${d.labels.prev})`,
      kind: "barres",
      unit: "eur",
      categories: axis.categories,
      categoryTitles: axis.titles,
      series: [series("n", nHead, rubN.map((l) => l.amount), COLORS.now), series("n1", pHead, rubP.map((l) => l.amount), COLORS.before)],
      mode: "grouped",
      tableId: ID.charges,
    });
    chargesBlock.charts.push(ID.chargesNature);
    chargesBlock.tables.push(ID.charges);
    // Comptes 63 / 64 sans rubrique : hors masse et hors passage (signalés, jamais reclassés). Fenêtre n.d. : ni nombre ni montant
    // partiels (seuls les mois connus seraient comptés).
    const unclassified = new Map<string, number>();
    for (const m of d.cur.months) if (m.kind === "value") for (const a of m.unclassified) unclassified.set(a.accountId, (unclassified.get(a.accountId) ?? 0) + a.balanceCents);
    if (d.cur.kind === "value" && unclassified.size > 0) {
      const sum = [...unclassified.values()].reduce((s, v) => s + v, 0);
      limits.push(`Comptes 63 et 64 non classés dans la grille de comptes (${pluriel(unclassified.size, "compte")}, ${euros(sum)}) : hors du passage vers les charges de personnel.`);
    } else if (d.cur.kind === "nd" && unclassified.size > 0) {
      limits.push(`Comptes 63 et 64 non classés dans la grille de comptes : nombre et montant n.d. (${windowReason(d.cur)}) ; hors du passage vers les charges de personnel.`);
    }
  }
  blocks.push(chargesBlock);

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
        title: `Rapprochement par rubrique : journal de paie et comptabilité, ${d.labels.period}`,
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
          { style: "subtotal", cells: [`${TOTAL_PERIODE} (${d.labels.period})`, r.journal, r.compta, r.ecart] },
          prevRow(`${MEME_PERIODE_N1} (${d.labels.prev})`),
        ],
        terms: [M.rapprochement],
      });
      const axis = monthsAxis(r.months.map((m) => m.month), [], d.openMonths);
      charts.push({ id: ID.reconMois, title: `Journal de paie et comptabilité par mois, ${d.labels.period}`, kind: "barres", unit: "eur", categories: axis.categories, categoryTitles: axis.titles, series: reconMonthSeries(r.months), mode: "grouped", tableId: ID.reconMois });
      const rub = reconRubricChart(r.rows.map((x) => ({ key: x.rubric, label: rubricLabel(x.rubric), journal: x.journal, compta: x.compta })));
      charts.push({ id: ID.reconRubriques, title: `Journal de paie et comptabilité par rubrique, ${d.labels.period}`, kind: "barres", unit: "eur", categories: rub.categories, categoryTitles: rub.titles, series: rub.series, mode: "grouped", tableId: ID.reconRubriques });
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
        total(`${TOTAL_PERIODE} (${d.labels.period})`, s.journal, s.window),
        total(`${MEME_PERIODE_N1} (${d.labels.prev})`, s.journalPrev, s.windowPrev),
      ],
      terms: [M.controleDsn, M.brutDsn],
    });
    dsnBlock.tables.push(ID.dsn);
  }
  blocks.push(dsnBlock);

  // --- Provision de congés payés (journal restreint au service retenu), puis par service (journal entier, seuil de confidentialité).
  // Les cellules des tableaux sont lues dans les séries des graphiques : tableau et graphique ont les mêmes valeurs et raisons.
  const provBlock: PaieBlock = { id: "provision", title: "Provision de congés payés", term: M.provision, graph: true, nd: [], notes: [], charts: [], tables: [] };
  const parts = provisionParts(d.provCur);
  const totals = provisionTotals(d.provCur, d.provPrev, { cur: `Provision ${d.labels.period}`, prev: `Provision N-1 (${d.labels.prev})` });
  if (provGuard) provBlock.nd.push({ reason: provGuard.reason, action: guardAction(provGuard) });
  else {
    tables.push({
      id: ID.provisionMois,
      title: `Provision de congés payés à fin de mois, ${d.labels.period} et N-1`,
      columns: [
        { key: "mois", header: "Fin de mois", kind: "text" },
        { key: "total", header: "Total", kind: "eur", term: M.provision },
        { key: "total-n1", header: "Total, même mois N-1", kind: "eur" },
        { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true },
        { key: "conges", header: "dont congés payés", kind: "eur" },
        { key: "charges", header: "dont charges sociales", kind: "eur" },
      ],
      rows: d.months.map((m, i) => {
        const t = pointOf(totals[0], i);
        const tp = pointOf(totals[1], i);
        return { cells: [monthRow(m, open.has(m)), cell(t), cell(tp), cell(provGap(t, tp)), cell(pointOf(parts[0], i)), cell(pointOf(parts[1], i))] };
      }),
      terms: [M.provision, ...(d.service ? [T.confidentialite] : [])],
    });
    const axisN = monthsAxis(d.months, [], d.openMonths);
    const axisBoth = monthsAxis(d.months, d.prevMonths, d.openMonths);
    charts.push({ id: ID.provisionParts, title: `Provision fin de mois, ${d.labels.period}`, kind: "barres", unit: "eur", categories: axisN.categories, categoryTitles: axisN.titles, series: parts, mode: "stacked", tableId: ID.provisionMois });
    charts.push({
      id: ID.provisionN1,
      title: `Total de la provision, ${d.labels.period} face à N-1 (${d.labels.prev})`,
      kind: "courbe",
      unit: "eur",
      categories: axisBoth.categories,
      categoryTitles: axisBoth.titles,
      series: totals,
      tableId: ID.provisionMois,
    });
    provBlock.charts.push(ID.provisionParts, ID.provisionN1);
    provBlock.tables.push(ID.provisionMois);
  }
  const ps = d.provServices;
  if (ps.kind === "nd") provBlock.nd.push({ label: "Provision par service", reason: ps.reason, action: ps.action, tableOnly: true });
  else if (ps.kind === "value") {
    const line = (label: string, cur: ProvisionMonth, prev: ProvisionMonth): CroiseeCell[] => {
      const a = provisionAmounts(cur, prev);
      return [label, cell(a.total), cell(a.totalPrev), cell(provGap(a.total, a.totalPrev)), cell(a.conges), cell(a.charges)];
    };
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
      rows: ps.rows.map((r) => ({ cells: line(r.value ?? "Non ventilé", r.cur, r.prev) })),
      foot: { cells: line("Toute l'entreprise", ps.total.cur, ps.total.prev) },
      terms: [M.provision, T.confidentialite],
    });
    provBlock.tables.push(ID.provisionServices);
    limits.push(PROVISION_SERVICES_LIMITE);
  }
  if (d.service && !serviceNd) limits.push(SERVICE_RETENU_LIMITE);
  blocks.push(provBlock);

  // --- Cartes : charges de personnel, écarts journal − comptabilité et journal − DSN, provision de fin de mois, ratio sur produits.
  const tiles: TileSpec[] = [];
  const value = (a: Amount, text: (v: number) => string): TileValue => (isNum(a) ? { text: text(a), kind: "value", reason: null } : ndTile(a.nd));
  const gapN = amountGap(passN.total, passP.total);
  tiles.push({
    id: "charges",
    label: "Charges de personnel du journal",
    term: T.chargesPersonnel,
    sub: d.labels.period,
    value: serviceNd ? ndTile(serviceNd) : value(passN.total, euros),
    cost: true,
    main: true,
    variations: serviceNd ? [] : [plainVariation("N-1", isNum(passP.total) ? euros(passP.total) : null, ndOf(passP.total)), costVariation("Écart", isNum(gapN) ? gapN : null, signedOrNd(gapN), ndOf(gapN))],
  });
  const recon = c.kind === "value" ? c.recon : null;
  tiles.push({
    id: "ecart-compta",
    label: "Écart journal − comptabilité",
    term: M.rapprochement,
    sub: `Comptes 63 et 64 · ${d.labels.period}`,
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
    sub: `Brut, type 001 · ${d.labels.period}`,
    value: value(dn, eurosSigned),
    variations: dp === null ? [] : [plainVariation("N-1", signedOrNd(dp), ndOf(dp))],
    note: s.kind === "value" && s.window.kind === "value" && s.window.incompleteMonths.length ? `DSN incomplète : ${s.window.incompleteMonths.map(monthShortYear).join(", ")}` : undefined,
  });
  const i = d.months.length - 1;
  const provN = pointOf(totals[0], i);
  const provP = pointOf(totals[1], i);
  const provG = provGap(provN, provP);
  const conges = pointOf(parts[0], i);
  const charges = pointOf(parts[1], i);
  const part = (a: Amount) => (isNum(a) ? euros(a) : "n.d.");
  tiles.push({
    id: "provision",
    label: `Provision fin ${monthLongLabel(last)}`,
    term: M.provision,
    sub: !provisionNd && (isNum(conges) || isNum(charges)) ? `congés payés ${part(conges)} + charges sociales ${part(charges)}` : undefined,
    value: provisionNd ? ndTile(provisionNd) : value(provN, euros),
    cost: true,
    variations: provisionNd ? [] : [plainVariation(`Fin ${monthLongLabel(lastPrev)}`, isNum(provP) ? euros(provP) : null, ndOf(provP)), costVariation("Écart", isNum(provG) ? provG : null, signedOrNd(provG), isNum(provG) ? null : ndOf(provG))],
  });
  const ratioN = c.kind === "nd" ? ({ nd: c.reason } as const) : ratioOf(c.masse, c.produits);
  const ratioP = c.kind === "nd" ? null : ratioOf(windowAmount(c.massePrev, (w) => w.masse), c.produitsPrev);
  const ratioText = (r: Ratio | { nd: string }) => ("nd" in r ? null : fmtPercent(r));
  tiles.push({
    id: "ratio",
    label: "Masse salariale ÷ produits d'exploitation",
    term: M.ratio,
    sub: d.labels.period,
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
  const links = { donnees: `/e/${ctx.slug}/donnees`, dsn: `/e/${ctx.slug}/donnees/dsn`, parametres: confidentialiteHref(ctx.slug), retirerFiltre: ctx.href({ service: null }) };
  const dataAction: Action = { href: links.donnees, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  const p = ctx.period;
  if (!p) return { nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: dataAction }, data: null };
  const pay = await ctx.load.payroll();
  const full = pay.input;
  if (!full) return { nd: { reason: journalReason(pay) ?? "journal de paie indisponible", action: dataAction }, data: null };
  const months = p.months;
  const prevMonths = ctx.prevMonths;
  const scope = [...months, ...prevMonths];
  const last = months[months.length - 1];
  const lastPrev = prevMonths[prevMonths.length - 1];
  // Mois non clos : ceux du journal de paie (ce chapitre ne lit que lui), pour les lignes comme pour les axes des graphiques.
  const openMonths = full.openMonths.filter((m) => scope.includes(m)).sort();
  const svc = ctx.service.value;
  const filtered = svc !== undefined;
  const removeFilter: Action = { href: links.retirerFiltre, label: "Retirer le filtre Service" };
  const setting = ctx.settings.confidentialite;
  const conf = confidentialiteOf(setting);
  // Lien contrat → personne (référentiel Collaborateurs) : les groupes du seuil sont comptés en personnes distinctes.
  const link = conf.kind === "set" ? await ctx.load.persons() : new Map<string, string>();

  // Services du journal entier sur la période et N-1 (plus le service retenu s'il n'y figure pas) : une entrée filtrée par service,
  // créée une fois (le moteur mémoïse ses mois par entrée). Statuts du seuil par mois, calculés une fois par mois et pour chaque valeur
  // affichée : la provision (contrats portant une ligne de dotation), partagée par le tableau par service et par la vue filtrée (un
  // service masqué dans l'un l'est dans l'autre), et le passage vers les charges de personnel (contrats portant une ligne de charges
  // de personnel), calculé sur tous les services puisque chacun se lit sous son filtre et que le total de l'entreprise est affiché.
  const groups = (() => {
    if (!filtered && !(ctx.service.axis && full.serviceAxis)) return [];
    const list = servicesOf(full, scope);
    if (filtered && !list.includes(svc)) list.push(svc);
    return list.map((value) => ({ value, input: withService(full, value) }));
  })();
  // Statuts de la provision par service et par fin de mois (maskProvisionStatus de lot2.ts : la passe de l'onglet Paie & comptabilité,
  // règle de valeur « total, à défaut la part connue », contrats portant une ligne de dotation, masquage secondaire par mois), sur la
  // période et N-1, calculés une fois : lus par le tableau par service et par la vue filtrée (un service masqué dans l'un l'est dans
  // l'autre). Mois absent : la provision est déjà n.d.
  const seuil = conf.kind === "set" ? conf.value : null;
  const provStatus = seuil === null ? {} : maskProvisionStatus({ inputs: groups, months: scope, link, seuil });
  const provisionAt = (value: string | null, m: string): MaskStatus => provStatus[provisionServiceKey(value)]?.[m] ?? "nd";
  // Passage vers les charges de personnel par service et par mois (contrats portant une ligne de charges de personnel), lu sous le
  // filtre seulement, mois par mois, sur le journal réduit aux lignes du mois (mêmes résultats, sans relire toute l'année).
  const passageMasks = new Map<string, MaskStatus[]>();
  const passageAt = (m: string, s: number): MaskStatus[] => {
    let x = passageMasks.get(m);
    if (!x) {
      const month: JournalInput = { ...full, lines: full.lines.filter((l) => l.month === m) };
      x = maskServices(groups.map((g) => passageGroup(withService(month, g.value), m, link)), s);
      passageMasks.set(m, x);
    }
    return x;
  };

  // Passage et provision : journal entier (toute l'entreprise, non soumis au seuil), ou journal du service retenu sous ses gardes.
  let service: PaieData["service"] = null;
  let cur: WindowIn;
  let prev: WindowIn;
  let provCur: ProvisionMonth[];
  let provPrev: ProvisionMonth[];
  if (!filtered) {
    cur = windowPayroll(full, months);
    prev = windowPayroll(full, prevMonths);
    provCur = months.map((m) => provisionMonth(full, m));
    provPrev = prevMonths.map((m) => provisionMonth(full, m));
  } else {
    const gi = groups.findIndex((g) => g.value === svc);
    const input = groups[gi].input;
    const ndWindow = (ms: string[], reason: string): WindowIn => ({ kind: "nd", nd: { reason }, months: ms.map((m): MonthIn => ({ month: m, kind: "nd", open: openMonths.includes(m), nd: { reason } })) });
    const ndProvision = (m: string, reason: string): ProvisionMonth => ({ month: m, kind: "nd", reason });
    // Garde unique du filtre Service (la même que la Masse salariale, l'Écart budgétaire, l'Analyse des écarts et les autres chapitres) :
    // seuil non défini, ou service masqué dans ses lignes par service sur la période ou N-1 (masquage secondaire compris) → passage et
    // provision du service n.d. avec la raison nue du moteur.
    const guard = serviceGuardOnWindows(full, [months, prevMonths], svc, link, setting);
    if (guard || seuil === null) {
      const g: ServiceGuard = guard ?? { cause: "parametre", reason: conf.kind === "nd" ? conf.reason : SEUIL_NON_VERIFIABLE };
      service = { label: ctx.service.label, guard: g, provision: null };
      cur = ndWindow(months, g.reason);
      prev = ndWindow(prevMonths, g.reason);
      provCur = months.map((m) => ndProvision(m, g.reason));
      provPrev = prevMonths.map((m) => ndProvision(m, g.reason));
    } else {
      // Provision du service : la garde de la provision de l'onglet Paie & comptabilité (provisionGuard sur maskProvisionServices de
      // lot2.ts : une fin de mois du service masquée dans la provision par service, période ou N-1) rend toute sa provision n.d. ;
      // sinon chaque fin de mois garde son statut. Le passage, qui contient les provisions, est masqué quand la provision l'est.
      const pg = provisionGuard(maskProvisionServices({ inputs: groups, months: scope, link, conf: setting }), svc, scope, setting);
      service = { label: ctx.service.label, guard: null, provision: pg };
      const passageStatusAt = (m: string) => passageStatus(passageAt(m, seuil)[gi], provisionAt(svc, m));
      cur = maskedWindow(windowPayroll(input, months), passageStatusAt, seuil);
      prev = maskedWindow(windowPayroll(input, prevMonths), passageStatusAt, seuil);
      const prov = (m: string) => (pg ? ndProvision(m, pg.reason) : maskedProvision(provisionMonth(input, m), provisionAt(svc, m), seuil));
      provCur = months.map(prov);
      provPrev = prevMonths.map(prov);
    }
  }

  // Provision par service (sans filtre de service) : services présents aux deux fins de mois, seuil et masquage secondaire appliqués
  // (statuts de maskProvisionStatus : les mêmes cellules n.d. que l'onglet Paie & comptabilité et son export).
  let provServices: PaieData["provServices"];
  if (filtered) provServices = { kind: "hidden" };
  else if (!ctx.service.axis || !full.serviceAxis) provServices = { kind: "nd", reason: ctx.service.reason ?? "aucun axe de service retenu (Paramètres)" };
  else if (seuil === null) provServices = { kind: "nd", reason: conf.kind === "nd" ? conf.reason : SEUIL_NON_VERIFIABLE, action: { href: links.parametres, label: "Paramètres" } };
  else {
    const s = seuil;
    const shown = servicesOf(full, [last, lastPrev]);
    provServices =
      shown.length === 0
        ? { kind: "nd", reason: "aucune ligne de charges de personnel dans le journal pour ces fins de mois" }
        : {
            kind: "value",
            rows: shown.map((value) => {
              const si = groups[groups.findIndex((g) => g.value === value)].input;
              return { value, cur: maskedProvision(provisionMonth(si, last), provisionAt(value, last), s), prev: maskedProvision(provisionMonth(si, lastPrev), provisionAt(value, lastPrev), s) };
            }),
            total: { cur: provisionMonth(full, last), prev: provisionMonth(full, lastPrev) },
          };
  }

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
  else if (!scope.some((m) => pay.dsn.has(m))) dsn = { kind: "nd", reason: SANS_DSN, action: { href: links.dsn, label: "Données › DSN" } };
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
      labels: { period: ctx.labels.period, prev: ctx.labels.prev },
      openMonths,
      links,
      grid: full.grid,
      service,
      cur,
      prev,
      provCur,
      provPrev,
      provServices,
      compta,
      dsn,
    },
  };
}

// Modèle du chapitre, calculé une fois par requête (D5) : le composant du chapitre et les exports appellent cette même fonction.
export const paieComptaModel = memoByContext((ctx: CroiseeContext) => loadPaieComptaInput(ctx).then(buildPaieCompta));
