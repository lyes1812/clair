import { personsOfContracts, type PersonsOfContracts } from "@/lib/confidentialite/persons";
import { monthRange } from "@/lib/connectors/months";
import { addDays, isIsoDate, monthOf } from "@/lib/dates";

// Échéances de contrat (Masse salariale croisée, chapitre 02) : fins de contrat et entrées déjà enregistrées dans la source RH qui
// tombent dans l'horizon défini dans les Paramètres, compté en jours à partir de la date de la lecture RH appliquée. Fonction pure,
// sans base ni horloge : la date de départ est celle de la lecture, jamais « aujourd'hui ». Aucun nom ni identifiant : un nombre de
// contrats par mois et par nature, et, pour le seuil de confidentialité, les personnes distinctes qu'ils concernent.
//
// Fenêtre : du lendemain de la date de lecture au jour « lecture + horizon » inclus. Un mouvement daté du jour de la lecture est
// déjà connu de la lecture (même règle que les mouvements « à venir » : date postérieure à la date de référence). Seuls les contrats
// d'une nature comptée dans l'effectif (Paramètres des KPI) sont retenus.
//
// Un contrat sans date de début n'est pas positionnable : compté à part (« sans date de début »), jamais dans le tableau, même si sa
// fin est datée. Un contrat en cours ou qui entre dans l'horizon, dont la source signale la fin comme non renseignée (endUnknown :
// par exemple un CDD sans date de fin), est compté à part (« fin non datée ») : sa fin peut tomber dans l'horizon, le total des fins
// est alors une borne basse. Un contrat sans fin par nature (CDI) n'a pas de fin inconnue.
//
// contract : jeton du contrat, propre à la lecture (jamais une clé de la source) ; person : jeton de la personne du contrat, null
// quand le contrat n'est relié à aucune personne du référentiel (il est NON RELIÉ : jamais compté comme une personne distincte, il ne
// protège pas). Les groupes sont formés par personsOfContracts du module partagé (src/lib/confidentialite/persons.ts).

export type EcheanceContract = { contract: string; person: string | null; startDate: string | null; endDate: string | null; nature: string | null; endUnknown?: boolean };
// fins, entrees : contrats ; finsGroup, entreesGroup : personnes distinctes (jetons triés) et contrats non reliés de ces contrats, la
// taille et les membres passés au seuil de confidentialité (une personne qui a plusieurs contrats de natures différentes dans le
// même mois y compte une fois).
export type EcheanceLine = { month: string; nature: string; fins: number; entrees: number; finsGroup: PersonsOfContracts; entreesGroup: PersonsOfContracts };
export type Echeances =
  | {
      kind: "value";
      from: string;
      to: string;
      horizon: number;
      months: string[]; // mois de la fenêtre, du premier au dernier (lignes du tableau, même vides)
      lines: EcheanceLine[];
      fins: number; // fins datées dans l'horizon
      entrees: number;
      undated: number; // contrats sans date de début
      undatedGroup: PersonsOfContracts; // personnes distinctes et contrats non reliés de ces contrats
      endUndated: number; // contrats en cours ou à venir dont la fin n'est pas renseignée
      endUndatedGroup: PersonsOfContracts;
    }
  | { kind: "nd"; reason: string };

export function contractEcheances(p: { referenceDate: string | null; horizonDays: number; natures: readonly string[]; contracts: readonly EcheanceContract[] }): Echeances {
  const ref = p.referenceDate;
  if (!ref || !isIsoDate(ref)) return { kind: "nd", reason: "date de lecture de la source RH absente" };
  if (!Number.isSafeInteger(p.horizonDays) || p.horizonDays < 1) return { kind: "nd", reason: "horizon des échéances illisible : à ré-enregistrer (Paramètres)" };
  const from = addDays(ref, 1);
  const to = addDays(ref, p.horizonDays);
  const inWindow = (d: string | null): d is string => d !== null && isIsoDate(d) && d > ref && d <= to;
  // Lien contrat → personne des contrats lus (un contrat sans personne n'y figure pas), pour former chaque groupe.
  const link = new Map<string, string>();
  for (const c of p.contracts) if (c.person !== null) link.set(c.contract, c.person);
  const group = (ids: Iterable<string>): PersonsOfContracts => personsOfContracts(ids, link);
  type Acc = { month: string; nature: string; fins: string[]; entrees: string[] };
  const byKey = new Map<string, Acc>();
  const line = (date: string, nature: string) => {
    const k = `${monthOf(date)}|${nature}`;
    let l = byKey.get(k);
    if (!l) byKey.set(k, (l = { month: monthOf(date), nature, fins: [], entrees: [] }));
    return l;
  };
  const undated: string[] = [];
  const endUndated: string[] = [];
  for (const c of p.contracts) {
    if (c.nature === null || !p.natures.includes(c.nature)) continue;
    if (c.startDate === null || !isIsoDate(c.startDate)) {
      undated.push(c.contract);
      continue;
    }
    if (inWindow(c.startDate)) line(c.startDate, c.nature).entrees.push(c.contract);
    if (inWindow(c.endDate)) line(c.endDate, c.nature).fins.push(c.contract);
    // Fin non renseignée d'un contrat en cours à la lecture ou qui entre dans l'horizon.
    if (c.endDate === null && c.endUnknown === true && c.startDate <= to) endUndated.push(c.contract);
  }
  const lines: EcheanceLine[] = [...byKey.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.nature.localeCompare(b.nature))
    .map((l) => ({ month: l.month, nature: l.nature, fins: l.fins.length, entrees: l.entrees.length, finsGroup: group(l.fins), entreesGroup: group(l.entrees) }));
  return {
    kind: "value",
    from,
    to,
    horizon: p.horizonDays,
    months: monthRange(monthOf(from), monthOf(to)),
    lines,
    fins: lines.reduce((s, l) => s + l.fins, 0),
    entrees: lines.reduce((s, l) => s + l.entrees, 0),
    undated: undated.length,
    undatedGroup: group(undated),
    endUndated: endUndated.length,
    endUndatedGroup: group(endUndated),
  };
}
