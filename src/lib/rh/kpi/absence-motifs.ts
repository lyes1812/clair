import { linkFromReferential, personsOfContracts, type PersonsOfContracts } from "@/lib/confidentialite";
import { monthEnd, monthOf, monthStart } from "@/lib/dates";
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

export function absenceByMotif(input: KpiInput, window: Window): AbsenceMotifs {
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
    const from = monthStart(window.from);
    const to = monthEnd(window.to);
    const touches = (r: (typeof rows)[number]): boolean => {
      const sd = r.start.date;
      const ed = r.end.date;
      if (sd === null && ed === null) return true;
      if (sd === null) return monthOf(ed!) >= window.from;
      if (ed === null) return monthOf(sd) <= window.to;
      return sd <= to && ed >= from;
    };
    const lines: AbsenceMotifLine[] = types.map((type) => {
      const r = absenteeism(copy([type], type), window);
      const base = { type, count: counts.get(type) ?? 0, inWindow: rows.filter((x) => x.type === type && touches(x)).length, chosen: input.params.absenceTypes.includes(type) };
      return r.kind === "nd" ? { ...base, kind: "nd", half: null, ratio: null, nd: r.nd } : { ...base, ...personsOf(r), kind: r.kind, half: r.ratio.num, ratio: r.ratio, qualifiers: r.qualifiers };
    });
    // Aucun motif dans la lecture : jamais un zéro. Lecture absente (DSN, collection non lue) : la raison du moteur.
    const all: Absenteeism = types.length
      ? absenteeism(copy(types), window)
      : a.status === "read"
        ? { kind: "nd", nd: kpiNd("no-absence-motif", "aucune absence dans la lecture : aucun motif à détailler"), months: [] }
        : absenteeism(copy([]), window);
    return { window, label: ABSENCE_ALL_MOTIFS_LABEL, lines, all, emptyReason: lines.length ? null : all.kind === "nd" ? all.nd.reason : "aucun motif dans la lecture" };
  });
}

// Personnes distinctes concernées par chaque motif dans TOUTE la lecture (nombre d'absences par motif de la tuile Absentéisme,
// « Motifs de la lecture ») : contrats distincts des absences du motif, reliés à leur personne par le référentiel ; un contrat
// inconnu du référentiel ou sans collaborateur est non relié. Lecture absente : aucun motif.
export function absenceTypePersons(input: KpiInput): Record<string, PersonsOfContracts> {
  if (input.absences.status !== "read") return {};
  const link = linkFromReferential(input.data);
  const contracts = new Map<string, Set<string>>();
  for (const r of input.absences.rows) {
    let s = contracts.get(r.type);
    if (!s) contracts.set(r.type, (s = new Set()));
    s.add(r.contractId);
  }
  return Object.fromEntries([...contracts].sort(([a], [b]) => a.localeCompare(b)).map(([type, ids]) => [type, personsOfContracts(ids, link)]));
}
