import { addMonths, monthEnd, monthStart, monthsBetween } from "@/lib/dates";
import { absenteeism, absenteeismMonth } from "@/lib/rh/kpi/absence";
import { absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { absenceSlots } from "@/lib/rh/kpi/days";
import { countedOpts } from "@/lib/rh/kpi/period";
import type { AbsenceSlice, AbsenteeismMonth, Absenteeism, Kind, KpiInput, SlotKey, Window } from "@/lib/rh/kpi/types";
import type { AbsenceRow } from "@/lib/rh/referential/types";

// Congés et absences par motif (Masse salariale croisée, chapitre 03). Fonctions pures, sans base ni horloge.
//
// 1. congesPris : jours pris par motif et par mois, avec le nombre de personnes concernées. Même moteur et même technique que
//    l'absentéisme par motif (absenceByMotif) : pour chaque motif présent dans la lecture, le moteur de l'absentéisme est exécuté sur
//    une copie de l'entrée qui ne garde que les absences de ce motif. Statuts retenus (params.absenceStatuses), base de jours, natures
//    comptées, bornes du contrat, demi-journées incertaines (« ≥ ») et mois hors des mois lus (n.d.) sont donc ceux du moteur. Aucun
//    motif n'est classé par son nom (congé payé, RTT, repos…) : chaque motif de la source a sa ligne.
// 2. congesAVenir : congés posés (statut retenu) et demandes en attente d'approbation, datés après le dernier mois clos, en jours par
//    mois lu. Les mois postérieurs au dernier mois clos ne sont pas encore couverts par le référentiel (jours théoriques n.d.) : les
//    demi-journées se comptent ici directement sur les dates des absences (absenceSlots), bornées au mois et au contrat, une demi-journée
//    couverte par deux absences du même contrat, du même motif et du même statut comptée une fois.
//
// Personnes concernées : collaborateur du contrat (clé de personne), à défaut le contrat lui-même ; elles servent au seuil de
// confidentialité de l'écran. Aucun nom, aucun identifiant n'est renvoyé : des nombres.

export type CongeValue = { kind: Kind; half: number; persons: number };
export type CongeCell = CongeValue | { kind: "nd"; reason: string };
export type CongeLine = { type: string; chosen: boolean; months: CongeCell[]; total: CongeCell };
export type CongesPris = { window: Window; lines: CongeLine[]; emptyReason: string | null };

const personOf = (x: { personKey: string | null; contractKey: string }) => x.personKey ?? `contrat:${x.contractKey}`;
const personsOf = (slices: readonly AbsenceSlice[]): Set<string> => new Set(slices.filter((s) => s.half > 0).map(personOf));

function monthCell(r: AbsenteeismMonth): CongeCell {
  if (r.kind === "nd") return { kind: "nd", reason: r.nd.reason };
  return { kind: r.kind, half: r.ratio.num, persons: personsOf(r.slices).size };
}

// Total de la fenêtre : celui du moteur (absenteeism : un mois sans contrat compté n'y apporte rien, tout autre mois n.d. rend la
// fenêtre n.d.) ; personnes = réunion des personnes des mois comptés.
function totalCell(r: Absenteeism): CongeCell {
  if (r.kind === "nd") return { kind: "nd", reason: r.nd.reason };
  const persons = new Set<string>();
  for (const m of r.months) if (m.kind !== "nd") for (const p of personsOf(m.slices)) persons.add(p);
  return { kind: r.kind, half: r.ratio.num, persons: persons.size };
}

export function congesPris(input: KpiInput, w: Window): CongesPris {
  const motifs = absenceByMotif(input, w);
  const a = input.absences;
  if (a.status !== "read" || motifs.lines.length === 0) return { window: w, lines: [], emptyReason: motifs.emptyReason ?? "aucun motif dans la lecture" };
  const lines = motifs.lines.map((l): CongeLine => {
    const copy: KpiInput = { ...input, absences: { ...a, rows: a.rows.filter((r) => r.type === l.type) }, params: { ...input.params, absenceTypes: [l.type] } };
    const months = w.months.map((m) => monthCell(absenteeismMonth(copy, m)));
    return { type: l.type, chosen: l.chosen, months, total: totalCell(absenteeism(copy, w)) };
  });
  return { window: w, lines, emptyReason: null };
}

// --- Congés posés à venir et demandes en attente ------------------------------------------------------------------------------------

export type AVenirStatut = "pose" | "en-attente";
export type AVenirLine = { type: string; statut: AVenirStatut; months: CongeCell[]; total: CongeCell };
export type CongesAVenir =
  // nonRattachees : absences posées ou en attente dont tout ou partie des jours ne se rattache à aucun mois lu (date absente, jours
  // au-delà du dernier mois lu, contrat inconnu du référentiel) : ces jours ne sont pas comptés.
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
    if (sd === null || ed === null || sd > end) {
      nonRattachees += 1;
      continue;
    }
    const c = byExternal.get(r.contractId);
    if (!c) {
      nonRattachees += 1;
      continue;
    }
    if (c.startDate === null || c.nature === null || !opts.natures.includes(c.nature) || !inEst(c.establishmentId)) continue; // hors population comptée
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
        return { kind: doubtful ? "lower_bound" : "exact", half, persons: persons.size };
      });
      const total: CongeCell = nd !== null ? { kind: "nd", reason: nd } : { kind: lower ? "lower_bound" : "exact", half: sum, persons: all.size };
      return { type, statut, months: cells, total };
    });
  return { kind: "value", after, months, lines, nonRattachees };
}
