import { maskSize, personsOfContracts, type PersonsOfContracts } from "@/lib/confidentialite/persons";
import { canonicalCompare, windowStatus } from "@/lib/confidentialite/columns";
import { maskRelations, type MaskCell, type MaskRelation, type MaskStatus } from "@/lib/croisee/structure";
import { addMonths, monthEnd, monthStart, monthsBetween } from "@/lib/dates";
import { monthRanges } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { absenceSlots } from "@/lib/rh/kpi/days";
import { countedOpts } from "@/lib/rh/kpi/period";
import type { AbsenteeismMonth, Absenteeism, Kind, KpiInput, KpiNd, SlotKey, Window } from "@/lib/rh/kpi/types";
import type { AbsenceRow } from "@/lib/rh/referential/types";

// Congés et absences par motif (Masse salariale croisée, chapitre 03). Fonctions pures, sans base ni horloge.
//
// 1. congesPris : demi-journées prises par motif et par mois, avec le nombre de personnes concernées. Même moteur et même technique
//    que l'absentéisme par motif (absenceByMotif) : pour chaque motif présent dans la lecture, le moteur de l'absentéisme est exécuté
//    sur une copie de l'entrée qui ne garde que les absences de ce motif (motifInput). Statuts retenus (params.absenceStatuses), base
//    de jours, natures comptées, bornes du contrat, demi-journées incertaines (« ≥ ») et mois hors des mois lus (n.d.) sont donc ceux
//    du moteur. Aucun motif n'est classé par son nom (congé payé, RTT, repos…) : chaque motif de la source a sa ligne.
// 2. congesAVenir : absences posées (statut retenu) et demandes en attente d'approbation, datées après le dernier mois clos, en
//    demi-journées par mois lu. Les mois postérieurs au dernier mois clos ne sont pas encore couverts par le référentiel (jours
//    théoriques n.d.) : les demi-journées se comptent ici directement sur les dates des absences (absenceSlots), bornées au mois et au
//    contrat, une demi-journée couverte par deux absences du même contrat, du même motif et du même statut comptée une fois.
// 3. Raisons publiques : le moteur nomme l'absence et le contrat en cause quand un mois est n.d. pour un contrat inconnu ou une date
//    absente. La page croisée n'affiche aucun identifiant : ces raisons sont remplacées par une raison qui garde le mois et le nombre
//    d'absences en cause (le détail reste dans KPI RH).
//
// Personnes concernées : collaborateur du contrat (clé de personne) ; un contrat sans personne rattachée est non relié ; elles servent au seuil de
// confidentialité de l'écran. Aucun nom, aucun identifiant n'est renvoyé : des nombres. who : jetons des personnes de la cellule
// (numéro d'ordre de la personne parmi celles de l'entrée, clés triées), sans identifiant ; ils permettent au masquage de compter une
// personne une seule fois d'une cellule masquée à l'autre (un mois et le suivant, deux motifs d'un même mois).

// persons : personnes reliées distinctes des contrats des demi-journées comptées ; unlinked : contrats distincts sans personne rattachée
// qui en portent (NON RELIÉS : jamais comptés comme une personne, ils ne protègent pas) ; who : jetons des personnes reliées.
export type CongeValue = { kind: Kind; half: number; persons: number; unlinked: number; who: readonly number[] };
export type CongeCell = CongeValue | { kind: "nd"; reason: string };

// Effectif d'une cellule pour le seuil de confidentialité : les personnes des demi-journées comptées, par la règle du module partagé
// (maskSize : null, non dénombré, quand des contrats non reliés existent et que les personnes reliées sont sous le seuil). Une borne
// basse sans aucune demi-journée comptée (seulement des demi-journées incertaines : statut non renseigné, moment de début ou de fin
// absent, jours hors contrat) décrit au moins une absence sans personne dénombrée : son effectif n'est pas dénombré (null, seuil non
// vérifiable), jamais « 0 personne ». Une borne basse avec des personnes comptées garde ce nombre (borne basse de l'effectif).
export const congeSize = (c: CongeValue, seuil: number): number | null => (c.kind === "lower_bound" && c.persons === 0 ? null : maskSize({ persons: c.who.map(String), unlinked: c.unlinked }, seuil));
export type CongeLine = { type: string; chosen: boolean; months: CongeCell[]; total: CongeCell };
export type CongesPris = { window: Window; lines: CongeLine[]; emptyReason: string | null };

const nf = new Intl.NumberFormat("fr-FR");
// Personnes et contrats non reliés des demi-journées comptées (personsOfContracts du module partagé : chaque contrat relié à sa
// personne par la tranche elle-même, un contrat sans personne est non relié).
const groupOf = (slices: readonly { contractKey: string; personKey: string | null; half: number }[]): PersonsOfContracts =>
  personsOfContracts(
    slices.filter((s) => s.half > 0).map((s) => s.contractKey),
    new Map(slices.flatMap((s) => (s.personKey === null ? [] : [[s.contractKey, s.personKey] as const]))),
  );

// Jeton d'une personne : son rang parmi les personnes des contrats de l'entrée (clés triées), le même pour toutes les copies de
// l'entrée (motifInput) et pour la période comme pour N-1 ; une personne absente des contrats reçoit le rang suivant. Un contrat sans
// personne n'a pas de jeton.
export function personTokens(input: KpiInput): (person: string) => number {
  const index = new Map([...new Set(input.data.contracts.flatMap((c) => (c.personKey === null ? [] : [c.personKey])))].sort().map((k, i) => [k, i] as const));
  return (person) => {
    let n = index.get(person);
    if (n === undefined) index.set(person, (n = index.size));
    return n;
  };
}
const tokensOf = (persons: Iterable<string>, token: (person: string) => number): number[] => [...persons].map(token).sort((a, b) => a - b);
// Cellule d'un groupe : nombre de personnes reliées, contrats non reliés, jetons des personnes.
const cellOf = (kind: Kind, half: number, g: PersonsOfContracts, token: (person: string) => number): CongeValue => ({ kind, half, persons: g.persons.length, unlinked: g.unlinked, who: tokensOf(g.persons, token) });

// --- Copies de l'entrée (les mêmes que celles de absenceByMotif) ------------------------------------------------------------------

// Un motif : ses seules absences, retenu seul.
export function motifInput(input: KpiInput, type: string): KpiInput {
  const a = input.absences;
  return { ...input, absences: a.status === "read" ? { ...a, rows: a.rows.filter((r) => r.type === type) } : a, params: { ...input.params, absenceTypes: [type] } };
}
// Taux tous motifs : toutes les absences, tous les motifs présents dans la lecture retenus.
export function allMotifsInput(input: KpiInput): KpiInput {
  const rows = input.absences.status === "read" ? input.absences.rows : [];
  return { ...input, params: { ...input.params, absenceTypes: [...new Set(rows.map((r) => r.type))].sort() } };
}

// --- Raisons publiques (aucun identifiant d'absence ni de contrat) ----------------------------------------------------------------

export const ABSENCE_ISSUES = ["absence-unknown-contract", "absence-date-nd"] as const;
export type AbsenceIssue = (typeof ABSENCE_ISSUES)[number];
const isIssue = (code: string): code is AbsenceIssue => (ABSENCE_ISSUES as readonly string[]).includes(code);

// L'absence que nomme une raison du moteur (rapprochement exact sur son texte ; aucune autre lecture du texte).
const named = (reason: string, code: AbsenceIssue, rows: readonly AbsenceRow[]): AbsenceRow | undefined =>
  code === "absence-unknown-contract" ? rows.find((x) => reason === `absence ${x.id} rattachée au contrat ${x.contractId} inconnu du référentiel`) : rows.find((x) => reason.startsWith(`absence ${x.id} : date de `));

// Nombre d'absences en cause dans un mois que le moteur rend n.d. pour un contrat inconnu ou une date absente. Le moteur s'arrête à
// la première : elle est retirée d'une copie de l'entrée et le mois est recalculé, tant que la raison garde le même code. count null :
// une absence n'a pas pu être rapprochée de la raison (le nombre n'est alors pas écrit). null : le mois n'est pas dans ce cas.
export function absencesEnCause(input: KpiInput, month: string): { code: AbsenceIssue; count: number | null } | null {
  let r: AbsenteeismMonth = absenteeismMonth(input, month);
  if (r.kind !== "nd" || !isIssue(r.nd.code)) return null;
  const code = r.nd.code;
  let cur = input;
  let count = 0;
  while (r.kind === "nd" && r.nd.code === code) {
    const a = cur.absences;
    if (a.status !== "read") return { code, count: null };
    const hit = named(r.nd.reason, code, a.rows);
    if (!hit) return { code, count: null };
    count += 1;
    cur = { ...cur, absences: { ...a, rows: a.rows.filter((x) => x !== hit) } };
    r = absenteeismMonth(cur, month);
  }
  return { code, count };
}

// Raison publique d'un mois : le mois et le nombre d'absences en cause, sans identifiant.
export function issueReason(code: AbsenceIssue, count: number | null, month: string): string {
  const many = count !== null && count > 1;
  const who = count === null ? "au moins une absence" : `${nf.format(count)} absence${many ? "s" : ""}`;
  return code === "absence-unknown-contract"
    ? `${who} rattachée${many ? "s" : ""} à un contrat inconnu du référentiel en ${month} (détail dans KPI RH)`
    : `${who} sans date de début ou de fin dans PayFit en ${month} (détail dans KPI RH)`;
}

// Raison d'un mois n.d. du moteur, sans identifiant ; les autres raisons passent telles quelles. input : l'entrée (ou la copie) qui a
// produit ce résultat.
export function publicMonthReason(input: KpiInput, month: string, nd: KpiNd): string {
  if (!isIssue(nd.code)) return nd.reason;
  const c = absencesEnCause(input, month);
  return issueReason(nd.code, c && c.code === nd.code ? c.count : null, month);
}

// Raison d'une période n.d. du moteur, sans identifiant : mois en cause, puis la raison publique du premier (même forme que la raison
// de période du moteur, le mois étant écrit dans la raison du mois).
export function publicWindowReason(input: KpiInput, nd: KpiNd): string {
  const list = nd.months;
  if ((nd.code !== "month-nd" && nd.code !== "month-lower-bound") || !list?.length) return nd.reason;
  const first = absenteeismMonth(input, list[0]);
  if (first.kind !== "nd" || !isIssue(first.nd.code)) return nd.reason;
  const text = publicMonthReason(input, list[0], first.nd);
  return list.length === 1 ? text : `${list.length} mois n.d. (${monthRanges(list)}) ; ${text}`;
}

// Résultats du moteur dont la raison n.d. est rendue publique (les valeurs ne changent pas).
export function publicMonth<T extends { month: string; kind: string; nd?: KpiNd }>(input: KpiInput, r: T): T {
  return r.kind === "nd" && r.nd ? ({ ...r, nd: { ...r.nd, reason: publicMonthReason(input, r.month, r.nd) } } as T) : r;
}
export function publicWindow<T extends { kind: string; nd?: KpiNd | null }>(input: KpiInput, r: T): T {
  return r.kind === "nd" && r.nd ? ({ ...r, nd: { ...r.nd, reason: publicWindowReason(input, r.nd) } } as T) : r;
}

// --- Pris par motif et par mois -------------------------------------------------------------------------------------------------

function monthCell(copy: KpiInput, r: AbsenteeismMonth, token: (person: string) => number): CongeCell {
  if (r.kind === "nd") return { kind: "nd", reason: publicMonthReason(copy, r.month, r.nd) };
  return cellOf(r.kind, r.ratio.num, groupOf(r.slices), token);
}

// Total de la fenêtre : celui du moteur (absenteeism : un mois sans contrat compté n'y apporte rien, tout autre mois n.d. rend la
// fenêtre n.d.) ; personnes = réunion des personnes des mois comptés (un contrat présent plusieurs mois compte une fois).
function totalCell(copy: KpiInput, r: Absenteeism, token: (person: string) => number): CongeCell {
  if (r.kind === "nd") return { kind: "nd", reason: publicWindowReason(copy, r.nd) };
  return cellOf(r.kind, r.ratio.num, groupOf(r.months.flatMap((m) => (m.kind === "nd" ? [] : m.slices))), token);
}

export function congesPris(input: KpiInput, w: Window): CongesPris {
  const motifs = absenceByMotif(input, w);
  if (input.absences.status !== "read" || motifs.lines.length === 0) return { window: w, lines: [], emptyReason: motifs.emptyReason ?? "aucun motif dans la lecture" };
  const token = personTokens(input);
  const lines = motifs.lines.map((l): CongeLine => {
    const copy = motifInput(input, l.type);
    const months = w.months.map((m) => monthCell(copy, absenteeismMonth(copy, m), token));
    return { type: l.type, chosen: l.chosen, months, total: totalCell(copy, absenteeism(copy, w), token) };
  });
  return { window: w, lines, emptyReason: null };
}

// --- Seuil de confidentialité : demi-journées par motif (UNE seule fonction pour toute l'application) ---------------------------------
// La même cellule (demi-journées d'un motif sur un mois ou sur une fenêtre) est publiée par KPI RH (détail de l'absentéisme, « Par
// motif », période et N-1) et par la croisée 03 (tableau par motif, demi-journées prises, période et N-1, et leurs exports). Son statut
// ne dépend ni de l'écran ni de la fenêtre choisie (règle canonique de src/lib/confidentialite/columns.ts) : une cellule masquée pour
// une période et affichée pour une autre se reconstituerait par différence.
//   1. Mois d'un motif : statut calculé sur la SEULE colonne de son mois (motifMonthMask), formée dans l'ordre canonique des motifs
//      (canonicalCompare), avec les seules relations du mois dont la somme est publiée : motifs retenus du mois → absentéisme du mois
//      (tableau mensuel), quand il n'est pas n.d. ; autres motifs du mois → taux tous motifs du mois − absentéisme du mois, le taux tous
//      motifs du mois étant une cellule onlyAsTotal (publiée par toute fenêtre d'un mois, masquée seulement quand rien d'autre ne protège
//      un motif masqué) ; sans absentéisme publié, tous les motifs → taux tous motifs du mois ; sans taux tous motifs, rien de plus.
//   2. Fenêtre (période, N-1, colonne « Par motif » du détail de KPI RH) : total d'un motif et taux tous motifs déduits de leurs mois
//      (windowStatus), sans relation propre : n.d. dès qu'un de leurs mois est masqué, quelle que soit la fenêtre.
// Exception : le seul motif retenu présent dans la lecture (sa ligne égale la tuile Absentéisme, déjà publiée) est exempt, mois et total.
// Taille d'une cellule : congeSize (personnes reliées ; non dénombrée quand des contrats non reliés laissent les personnes reliées sous
// le seuil, ou pour une borne basse sans demi-journée comptée) ; cellule absente (motif sans ligne) : non dénombrée. Un motif vide du
// mois (0, aucune personne) ne protège personne ; il reste dans la colonne, car les deux écrans listent tous les motifs de la lecture :
// quand les motifs retenus d'un mois ne peuvent pas se protéger entre eux, toute la répartition du mois est n.d., zéros compris (sinon
// absentéisme du mois − 0 redonnerait le motif masqué).
// type : le motif tel que la source le nomme (ordre canonique de la colonne d'un mois).
export type MotifWindowLine = { type: string; chosen: boolean; months: readonly (CongeCell | undefined)[]; total: CongeCell | undefined };
// Ce que l'application publie d'une fenêtre, mois par mois : months, l'absentéisme de chaque mois (tableau mensuel de KPI RH et de la
// croisée) ; allMonths, le taux tous motifs de chaque mois (publié par toute fenêtre d'un seul mois) ; all, le taux tous motifs de la
// fenêtre. Les drapeaux d'un mois ne dépendent que du mois (motifPublished) : le même mois a la même colonne dans toutes les fenêtres.
export type MotifPublished = { months: readonly boolean[]; allMonths: readonly boolean[]; all: boolean };
export type MotifWindow = { lines: readonly MotifWindowLine[]; published: MotifPublished };
// months[r][j], total[r] : statut du mois j et du total de la ligne r ; all : statut du taux tous motifs ; exempt : ligne exempte.
export type MotifWindowMask = { months: MaskStatus[][]; total: MaskStatus[]; all: MaskStatus; exempt: number | null };

// Cellule de masquage d'une cellule de congés : taille congeSize (des demi-journées sans aucune personne ni contrat compté ne sont
// pas dénombrées : non vérifiables, règle de groupInput), valeur = demi-journées (ordre du masquage secondaire), jetons des personnes
// (non transmis pour une cellule non dénombrée : elle n'apporte aucune personne comptée) ; n.d. du moteur : déjà n.d.
export function congeMaskCell(c: CongeCell | undefined, seuil: number, exempt = false): MaskCell {
  if (!c) return { size: null, value: 0 };
  if (c.kind === "nd") return { size: null, value: null };
  const s = congeSize(c, seuil);
  const size = s === 0 && c.half > 0 ? null : s;
  return { size, value: c.half, exempt, members: size === null ? [] : c.who };
}

// Ligne exempte : le seul motif retenu présent dans la lecture (les lignes sont les motifs de toute la lecture, pas de la fenêtre).
const exemptOf = (lines: readonly { chosen: boolean }[]): number | null => {
  const retained = lines.flatMap((l, r) => (l.chosen ? [r] : []));
  return retained.length === 1 ? retained[0] : null;
};

// Colonne d'un mois : la cellule de chaque motif de la lecture ce mois-là, et ce que l'application publie de ce mois (absentéisme,
// taux tous motifs). Statuts dans l'ordre des lignes reçues ; all : statut du taux tous motifs du mois.
export type MotifMonth = { lines: readonly { type: string; chosen: boolean; cell: CongeCell | undefined }[]; published: { absenteeism: boolean; all: boolean } };
export type MotifMonthMask = { lines: MaskStatus[]; all: MaskStatus; exempt: number | null };
export function motifMonthMask(col: MotifMonth, seuil: number): MotifMonthMask {
  const exempt = exemptOf(col.lines);
  // Ordre canonique des motifs (libellé, ordre des points de code) : le départage des égalités ne dépend pas de l'ordre de l'écran.
  const order = col.lines.map((_, r) => r).sort((a, b) => canonicalCompare(col.lines[a].type, col.lines[b].type));
  const cells: MaskCell[] = order.map((r) => congeMaskCell(col.lines[r].cell, seuil, r === exempt));
  const allAt = cells.length;
  cells.push({ size: null, value: col.published.all ? 0 : null, onlyAsTotal: true });
  const pos = order.map((_, p) => p);
  const retained = pos.filter((p) => col.lines[order[p]].chosen);
  const others = pos.filter((p) => !col.lines[order[p]].chosen);
  const { absenteeism: abs, all } = col.published;
  const rel: MaskRelation[] = abs && all ? [{ cells: retained }, { cells: others, total: allAt }] : all ? [{ cells: pos, total: allAt }] : abs ? [{ cells: retained }] : [];
  const st = maskRelations(cells, rel, seuil);
  const lines: MaskStatus[] = new Array(col.lines.length);
  order.forEach((r, p) => (lines[r] = st[p]));
  return { lines, all: st[allAt], exempt };
}

export function motifWindowMask(g: MotifWindow, seuil: number): MotifWindowMask {
  const k = g.published.months.length;
  const cols = Array.from({ length: k }, (_, j) =>
    motifMonthMask({ lines: g.lines.map((l) => ({ type: l.type, chosen: l.chosen, cell: l.months[j] })), published: { absenteeism: g.published.months[j], all: g.published.allMonths[j] } }, seuil),
  );
  const months = g.lines.map((_, r) => cols.map((c) => c.lines[r]));
  // Total d'un motif : déduit de ses mois ; n.d. du moteur : sa raison ; motif sans ligne (cellule absente) : non dénombré.
  const total = g.lines.map((l, r) => (l.total === undefined ? "unverifiable" : windowStatus(months[r], l.total.kind === "nd")));
  return { months, total, all: windowStatus(cols.map((c) => c.all), !g.published.all), exempt: exemptOf(g.lines) };
}

// Cellules d'une fenêtre à partir des demi-journées prises par motif (congesPris) et de ce que l'application publie de la même fenêtre.
export const motifWindowOf = (c: CongesPris, published: MotifPublished): MotifWindow => ({ lines: c.lines.map((l) => ({ type: l.type, chosen: l.chosen, months: l.months, total: l.total })), published });

// Ce que l'application publie d'une fenêtre, lu dans le moteur : absentéisme de chaque mois (absenteeismMonth, celui du tableau
// mensuel), taux tous motifs de chaque mois (tous les motifs de la lecture retenus, allMotifsInput : la valeur d'une fenêtre d'un mois),
// taux tous motifs de la fenêtre (absenceByMotif). KPI RH et la croisée l'appellent sur les mêmes fenêtres (période et N-1).
export function motifPublished(input: KpiInput, w: Window): MotifPublished {
  const allIn = allMotifsInput(input);
  return {
    months: w.months.map((m) => absenteeismMonth(input, m).kind !== "nd"),
    allMonths: w.months.map((m) => absenteeismMonth(allIn, m).kind !== "nd"),
    all: absenceByMotif(input, w).all.kind !== "nd",
  };
}

// Cellules d'une fenêtre lues dans le moteur : demi-journées prises par motif et par mois (congesPris) et ce que l'application publie de
// la fenêtre (motifPublished). KPI RH l'appelle sur la fenêtre de son détail (période ou N-1) ; la croisée lit les mêmes résultats du
// moteur (loadAbsencesInput) pour sa période et pour N-1.
export function motifWindow(input: KpiInput, w: Window): MotifWindow {
  return motifWindowOf(congesPris(input, w), motifPublished(input, w));
}

// --- Absences posées à venir et demandes en attente ----------------------------------------------------------------------------------

export type AVenirStatut = "pose" | "en-attente";
export type AVenirLine = { type: string; statut: AVenirStatut; months: CongeCell[]; total: CongeCell };
export type CongesAVenir =
  // nonRattachees : absences posées ou en attente, sur un contrat de la population comptée ou inconnu du référentiel, dont tout ou
  // partie des jours ne se rattache à aucun mois lu (date absente, jours au-delà du dernier mois lu, contrat inconnu) : ces jours ne
  // sont pas comptés.
  { kind: "value"; after: string; months: string[]; lines: AVenirLine[]; nonRattachees: number } | { kind: "nd"; reason: string };

const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);
const notRead = (month: string, read: readonly string[]) => `absences non lues pour ${month} (mois lus : ${read.length ? `${read[0]} → ${read[read.length - 1]}` : "aucun"})`;

// Statut d'une absence à venir : en attente d'approbation, posée (statut retenu dans les Définitions des KPI), ou ni l'un ni l'autre.
export function aVenirStatut(status: AbsenceRow["status"], retained: readonly string[]): AVenirStatut | null {
  if (status === "pending_approval") return "en-attente";
  return status !== null && retained.includes(status) ? "pose" : null;
}

// after : dernier mois clos (AAAA-MM). Mois affichés : du mois qui suit jusqu'au dernier mois lu ; un mois non lu entre les deux est n.d.
export function congesAVenir(input: KpiInput, after: string): CongesAVenir {
  const a = input.absences;
  if (a.status === "not-extracted") return { kind: "nd", reason: a.nd.reason };
  if (a.status === "unavailable") return { kind: "nd", reason: `absences non lues : ${a.nd.reason}` };
  const read = [...a.months].sort();
  const last = read[read.length - 1];
  if (!last || last <= after) return { kind: "nd", reason: `aucun mois lu après ${after} (mois lus : ${read.length ? `${read[0]} → ${last}` : "aucun"})` };
  const months = monthsBetween(addMonths(after, 1), last);
  const readSet = new Set(read);
  const first = monthStart(months[0]);
  const end = monthEnd(last);
  const opts = countedOpts(input);
  const token = personTokens(input);
  const inEst = (id: string | null) => !opts.establishments || (id !== null && opts.establishments.includes(id));
  const byExternal = new Map(input.data.contracts.map((c) => [c.externalId, c]));

  // Créneaux comptés et incertains, par ligne (motif × statut), mois et contrat ; person : la personne de chaque contrat (null : non relié).
  type Acc = { union: Map<string, Set<SlotKey>>; doubt: Map<string, Set<SlotKey>>; person: Map<string, string | null> };
  const acc = new Map<string, Acc>();
  const lineKey = (type: string, statut: AVenirStatut) => `${statut}|${type}`;
  const get = (k: string): Acc => {
    let x = acc.get(k);
    if (!x) acc.set(k, (x = { union: new Map(), doubt: new Map(), person: new Map() }));
    return x;
  };
  const add = (m: Map<string, Set<SlotKey>>, k: string, slots: SlotKey[]) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    for (const x of slots) s.add(x);
  };
  let nonRattachees = 0;
  for (const r of a.rows) {
    const statut = aVenirStatut(r.status, input.params.absenceStatuses);
    if (!statut) continue;
    const sd = r.start.date;
    const ed = r.end.date;
    if (ed !== null && ed < first) continue; // entièrement avant les mois à venir
    if (ed === null && sd !== null && sd < first) continue; // commencée avant les mois à venir, fin inconnue : pas une absence à venir
    const c = byExternal.get(r.contractId);
    if (!c) {
      nonRattachees += 1; // contrat inconnu du référentiel : population non vérifiable, jours non rattachés
      continue;
    }
    if (c.startDate === null || c.nature === null || !opts.natures.includes(c.nature) || !inEst(c.establishmentId)) continue; // hors population comptée
    if (sd === null || ed === null || sd > end) {
      nonRattachees += 1; // date absente, ou absence entièrement après le dernier mois lu
      continue;
    }
    if (ed > end) nonRattachees += 1; // jours au-delà du dernier mois lu : non comptés
    const x = get(lineKey(r.type, statut));
    for (const m of months) {
      if (!readSet.has(m) || sd > monthEnd(m) || ed < monthStart(m)) continue;
      const clip = { from: max(monthStart(m), c.startDate), to: min(monthEnd(m), c.endDate ?? monthEnd(m)) };
      if (clip.from > clip.to) continue;
      const s = absenceSlots({ start: { date: sd, moment: r.start.moment }, end: { date: ed, moment: r.end.moment } }, clip, input.params.dayBasis);
      const k = `${m}|${c.contractKey}`;
      add(x.union, k, s.slots);
      add(x.doubt, k, s.uncertain);
      x.person.set(c.contractKey, c.personKey);
    }
  }

  const lines: AVenirLine[] = [...acc.keys()]
    .map((k) => ({ k, statut: k.slice(0, k.indexOf("|")) as AVenirStatut, type: k.slice(k.indexOf("|") + 1) }))
    .sort((p, q) => p.type.localeCompare(q.type) || (p.statut === q.statut ? 0 : p.statut === "pose" ? -1 : 1))
    .map(({ k, statut, type }) => {
      const x = acc.get(k)!;
      // Contrats des demi-journées comptées de la ligne (tous mois), vus par leur personne (groupOf : un contrat sans personne est non relié).
      const all: { contractKey: string; personKey: string | null; half: number }[] = [];
      let lower = false;
      let sum = 0;
      let nd: string | null = null;
      const cells = months.map((m): CongeCell => {
        if (!readSet.has(m)) {
          nd ??= notRead(m, read);
          return { kind: "nd", reason: notRead(m, read) };
        }
        let half = 0;
        let doubtful = 0;
        const counted: typeof all = [];
        for (const [key, slots] of x.union) {
          if (!key.startsWith(`${m}|`)) continue;
          half += slots.size;
          const contractKey = key.slice(m.length + 1);
          counted.push({ contractKey, personKey: x.person.get(contractKey) ?? null, half: slots.size });
        }
        for (const [key, slots] of x.doubt) {
          if (!key.startsWith(`${m}|`)) continue;
          const u = x.union.get(key);
          for (const s of slots) if (!u?.has(s)) doubtful += 1;
        }
        sum += half;
        if (doubtful) lower = true;
        all.push(...counted);
        return cellOf(doubtful ? "lower_bound" : "exact", half, groupOf(counted), token);
      });
      const total: CongeCell = nd !== null ? { kind: "nd", reason: nd } : cellOf(lower ? "lower_bound" : "exact", sum, groupOf(all), token);
      return { type, statut, months: cells, total };
    });
  return { kind: "value", after, months, lines, nonRattachees };
}
