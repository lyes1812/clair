import { linkFromReferential, personsOfContracts, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import { monthEnd, monthOf, monthStart } from "@/lib/dates";
import type { AbsenceRow } from "@/lib/rh/referential/types";
import { absenteeism } from "./absence";
import { memo } from "./memo";
import { kpiNd, type AbsenceMotifLine, type AbsenceMotifs, type Absenteeism, type KpiInput, type Window } from "./types";

// Absentéisme par motif, sur une fenêtre. Aucun motif n'est reconnu par son nom : la tuile principale reste celle de
// params.absenceTypes (liste choisie par l'administrateur) ; ici, tous les types présents dans la lecture sont détaillés.
export const ABSENCE_ALL_MOTIFS_LABEL = "Taux d'absence, tous motifs";

// Personnes distinctes d'un résultat du moteur : celles des contrats qui portent au moins une demi-journée comptée (tranche de
// demi-journées ajoutées, half > 0) ; un contrat sans personne rattachée compte parmi les non reliés (il ne protège jamais).
function personsOf(r: Absenteeism): Pick<AbsenceMotifLine, "persons" | "unlinked"> {
  const persons = new Set<string>();
  const unlinked = new Set<string>();
  if (r.kind !== "nd") for (const m of r.months) if (m.kind !== "nd") for (const s of m.slices) if (s.half > 0) (s.personKey === null ? unlinked : persons).add(s.personKey ?? s.contractKey);
  return { persons: [...persons].sort(), unlinked: unlinked.size };
}

// Une absence touche les mois from → to quand ses dates les chevauchent ; sans date de début, quand elle se termine au plus tôt le mois
// from ; sans date de fin, quand elle commence au plus tard le mois to ; sans aucune date, toujours.
function touches(r: AbsenceRow, from: string, to: string): boolean {
  const sd = r.start.date;
  const ed = r.end.date;
  if (sd === null && ed === null) return true;
  if (sd === null) return monthOf(ed!) >= from;
  if (ed === null) return monthOf(sd) <= to;
  return sd <= monthEnd(to) && ed >= monthStart(from);
}

// Nombre d'absences d'un ensemble et personnes distinctes qu'il décrit : contrats de ses absences reliés à leur personne par le
// référentiel (personsOfContracts : un contrat inconnu du référentiel ou sans collaborateur est non relié, il ne protège jamais).
export type AbsenceCountGroup = PersonsOfContracts & { count: number };
const countGroup = (contracts: readonly string[], link: PersonLink): AbsenceCountGroup => ({ ...personsOfContracts(contracts, link), count: contracts.length });

// « Absences de la période » du détail par motif (inWindow) : pour chaque motif de la lecture, les absences qui touchent la fenêtre,
// celles qui touchent chacun de ses mois (months, dans l'ordre de window.months) et celles de la lecture qui ne touchent pas la fenêtre
// (rest : « Absences de la lecture » − « Absences de la période »), chacune avec ses propres personnes, jamais celles des demi-journées
// comptées (une ligne à 0 demi-journée peut porter des absences en attente). offMonths : absences dont la fenêtre et ses mois ne disent
// pas la même chose (la fenêtre touchée sans aucun de ses mois, ou l'inverse) ; 0 pour une fenêtre de mois consécutifs.
export type AbsencePeriodLine = { window: AbsenceCountGroup; months: AbsenceCountGroup[]; rest: AbsenceCountGroup; offMonths: number };
export type AbsencePeriodGroups = { months: string[]; types: Record<string, AbsencePeriodLine> };
// Résultat d'absenceByMotif : les lignes du moteur et, pour le seuil de confidentialité, les personnes des absences de la période.
export type AbsenceMotifsRead = AbsenceMotifs & { period: AbsencePeriodGroups };

function periodGroups(rows: readonly AbsenceRow[], types: readonly string[], window: Window, link: PersonLink): AbsencePeriodGroups {
  const acc = new Map(types.map((t) => [t, { window: [] as string[], months: window.months.map(() => [] as string[]), rest: [] as string[], off: 0 }]));
  for (const r of rows) {
    const a = acc.get(r.type);
    if (!a) continue;
    const inWindow = touches(r, window.from, window.to);
    let inMonth = false;
    window.months.forEach((m, j) => {
      if (!touches(r, m, m)) return;
      a.months[j].push(r.contractId);
      inMonth = true;
    });
    (inWindow ? a.window : a.rest).push(r.contractId);
    if (inWindow !== inMonth) a.off += 1;
  }
  const lineOf = (a: { window: string[]; months: string[][]; rest: string[]; off: number }): AbsencePeriodLine => ({
    window: countGroup(a.window, link),
    months: a.months.map((ids) => countGroup(ids, link)),
    rest: countGroup(a.rest, link),
    offMonths: a.off,
  });
  return { months: [...window.months], types: Object.fromEntries([...acc].map(([t, a]) => [t, lineOf(a)])) };
}

export function absenceByMotif(input: KpiInput, window: Window): AbsenceMotifsRead {
  return memo(input, `motifs:${window.from}:${window.to}`, () => {
    const a = input.absences;
    const rows = a.status === "read" ? a.rows : [];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    const types = [...counts.keys()].sort();
    // Le moteur de l'absentéisme est exécuté sur une copie de l'entrée (le mémo est indexé par l'objet d'entrée) ; pour un seul
    // motif, la copie ne garde que ses absences : les autres types seraient exclus, sans effet sur le résultat.
    const copy = (absenceTypes: string[], only?: string): KpiInput => ({
      ...input,
      absences: a.status === "read" && only !== undefined ? { ...a, rows: a.rows.filter((r) => r.type === only) } : a,
      params: { ...input.params, absenceTypes },
    });
    // Absences de la période : celles qui touchent la fenêtre (un seul calcul pour le nombre affiché et pour ses personnes).
    const period = periodGroups(rows, types, window, linkFromReferential(input.data));
    const lines: AbsenceMotifLine[] = types.map((type) => {
      const r = absenteeism(copy([type], type), window);
      const base = { type, count: counts.get(type) ?? 0, inWindow: period.types[type].window.count, chosen: input.params.absenceTypes.includes(type) };
      return r.kind === "nd" ? { ...base, kind: "nd", half: null, ratio: null, nd: r.nd } : { ...base, ...personsOf(r), kind: r.kind, half: r.ratio.num, ratio: r.ratio, qualifiers: r.qualifiers };
    });
    // Aucun motif dans la lecture : jamais un zéro. Lecture absente (DSN, collection non lue) : la raison du moteur.
    const all: Absenteeism = types.length
      ? absenteeism(copy(types), window)
      : a.status === "read"
        ? { kind: "nd", nd: kpiNd("no-absence-motif", "aucune absence dans la lecture : aucun motif à détailler"), months: [] }
        : absenteeism(copy([]), window);
    return { window, label: ABSENCE_ALL_MOTIFS_LABEL, lines, all, emptyReason: lines.length ? null : all.kind === "nd" ? all.nd.reason : "aucun motif dans la lecture", period };
  });
}

// Nombre d'absences et personnes distinctes de chaque motif dans un ensemble d'absences (toute une lecture) : contrats des absences du
// motif reliés à leur personne par le référentiel ; un contrat inconnu du référentiel ou sans collaborateur est non relié. Chaque
// absence compte, quel que soit son motif (une absence sans motif lu porte le motif « n.d. » d'absenceRowOf) : la somme des nombres est
// celle que publie Données › lecture (nombre d'éléments de la collection absences). Fonction pure : KPI RH et Paramètres la partagent.
export function absenceTypeGroups(rows: readonly Pick<AbsenceRow, "type" | "contractId">[], link: PersonLink): Record<string, AbsenceCountGroup> {
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    let ids = byType.get(r.type);
    if (!ids) byType.set(r.type, (ids = []));
    ids.push(r.contractId);
  }
  return Object.fromEntries([...byType].sort(([a], [b]) => a.localeCompare(b)).map(([type, ids]) => [type, countGroup(ids, link)]));
}

// Nombres d'absences par motif dans TOUTE la lecture (tuile Absentéisme, « Motifs de la lecture » ; « Absences de la lecture » du détail
// par motif) et leurs personnes distinctes. Lecture absente : aucun motif.
export function absenceTypePersons(input: KpiInput): Record<string, AbsenceCountGroup> {
  return input.absences.status === "read" ? absenceTypeGroups(input.absences.rows, linkFromReferential(input.data)) : {};
}
