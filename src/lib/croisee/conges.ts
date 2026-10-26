import { addMonths, monthEnd, monthStart, monthsBetween } from "@/lib/dates";
import { monthRanges } from "@/lib/rh/headcount";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { absenceSlots } from "@/lib/rh/kpi/days";
import { countedOpts } from "@/lib/rh/kpi/period";
import type { AbsenceSlice, AbsenteeismMonth, Absenteeism, Kind, KpiInput, KpiNd, SlotKey, Window } from "@/lib/rh/kpi/types";
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
// Personnes concernées : collaborateur du contrat (clé de personne), à défaut le contrat lui-même ; elles servent au seuil de
// confidentialité de l'écran. Aucun nom, aucun identifiant n'est renvoyé : des nombres. who : jetons des personnes de la cellule
// (numéro d'ordre de la personne parmi celles de l'entrée, clés triées), sans identifiant ; ils permettent au masquage de compter une
// personne une seule fois d'une cellule masquée à l'autre (un mois et le suivant, deux motifs d'un même mois).

export type CongeValue = { kind: Kind; half: number; persons: number; who?: readonly number[] };
export type CongeCell = CongeValue | { kind: "nd"; reason: string };

// Effectif d'une cellule pour le seuil de confidentialité : les personnes des demi-journées comptées. Une borne basse sans aucune
// demi-journée comptée (seulement des demi-journées incertaines : statut non renseigné, moment de début ou de fin absent, jours hors
// contrat) décrit au moins une absence sans personne dénombrée : son effectif n'est pas dénombré (null, seuil non vérifiable), jamais
// « 0 personne ». Une borne basse avec des personnes comptées garde ce nombre (borne basse de l'effectif).
export const congeSize = (c: CongeValue): number | null => (c.kind === "lower_bound" && c.persons === 0 ? null : c.persons);
export type CongeLine = { type: string; chosen: boolean; months: CongeCell[]; total: CongeCell };
export type CongesPris = { window: Window; lines: CongeLine[]; emptyReason: string | null };

const nf = new Intl.NumberFormat("fr-FR");
const personOf = (x: { personKey: string | null; contractKey: string }) => x.personKey ?? `contrat:${x.contractKey}`;
const personsOf = (slices: readonly AbsenceSlice[]): Set<string> => new Set(slices.filter((s) => s.half > 0).map(personOf));

// Jeton d'une personne : son rang parmi les personnes des contrats de l'entrée (clés triées), le même pour toutes les copies de
// l'entrée (motifInput) et pour la période comme pour N-1 ; une personne absente des contrats reçoit le rang suivant.
export function personTokens(input: KpiInput): (person: string) => number {
  const index = new Map([...new Set(input.data.contracts.map(personOf))].sort().map((k, i) => [k, i] as const));
  return (person) => {
    let n = index.get(person);
    if (n === undefined) index.set(person, (n = index.size));
    return n;
  };
}
const tokensOf = (persons: Iterable<string>, token: (person: string) => number): number[] => [...persons].map(token).sort((a, b) => a - b);

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
  const persons = personsOf(r.slices);
  return { kind: r.kind, half: r.ratio.num, persons: persons.size, who: tokensOf(persons, token) };
}

// Total de la fenêtre : celui du moteur (absenteeism : un mois sans contrat compté n'y apporte rien, tout autre mois n.d. rend la
// fenêtre n.d.) ; personnes = réunion des personnes des mois comptés.
function totalCell(copy: KpiInput, r: Absenteeism, token: (person: string) => number): CongeCell {
  if (r.kind === "nd") return { kind: "nd", reason: publicWindowReason(copy, r.nd) };
  const persons = new Set<string>();
  for (const m of r.months) if (m.kind !== "nd") for (const p of personsOf(m.slices)) persons.add(p);
  return { kind: r.kind, half: r.ratio.num, persons: persons.size, who: tokensOf(persons, token) };
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

  // Créneaux comptés et incertains, par ligne (motif × statut), mois et contrat.
  type Acc = { union: Map<string, Set<SlotKey>>; doubt: Map<string, Set<SlotKey>>; person: Map<string, string> };
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
      x.person.set(c.contractKey, personOf(c));
    }
  }

  const lines: AVenirLine[] = [...acc.keys()]
    .map((k) => ({ k, statut: k.slice(0, k.indexOf("|")) as AVenirStatut, type: k.slice(k.indexOf("|") + 1) }))
    .sort((p, q) => p.type.localeCompare(q.type) || (p.statut === q.statut ? 0 : p.statut === "pose" ? -1 : 1))
    .map(({ k, statut, type }) => {
      const x = acc.get(k)!;
      const all = new Set<string>();
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
        const persons = new Set<string>();
        for (const [key, slots] of x.union) {
          if (!key.startsWith(`${m}|`)) continue;
          half += slots.size;
          if (slots.size > 0) persons.add(x.person.get(key.slice(m.length + 1))!);
        }
        for (const [key, slots] of x.doubt) {
          if (!key.startsWith(`${m}|`)) continue;
          const u = x.union.get(key);
          for (const s of slots) if (!u?.has(s)) doubtful += 1;
        }
        sum += half;
        if (doubtful) lower = true;
        for (const p of persons) all.add(p);
        return { kind: doubtful ? "lower_bound" : "exact", half, persons: persons.size, who: tokensOf(persons, token) };
      });
      const total: CongeCell = nd !== null ? { kind: "nd", reason: nd } : { kind: lower ? "lower_bound" : "exact", half: sum, persons: all.size, who: tokensOf(all, token) };
      return { type, statut, months: cells, total };
    });
  return { kind: "value", after, months, lines, nonRattachees };
}
