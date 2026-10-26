import { contractNatureLabel } from "@/lib/dsn/labels";
import { hireKey } from "@/lib/budget/engine";
import type { Loaded } from "./ecart-data";

// Identité d'un salarié pour le détail d'un écart : identifiant externe du contrat (PayFit) ou « embauche:… ». Lu dans le
// référentiel Collaborateurs courant, puis dans les bases et embauches des scénarios choisis.
export type PersonInfo = { label: string; externalId: string | null; service: string | null; contract: string | null; start: string | null; end: string | null; absent?: PersonAbsent };

// Ce que vaut un champ null, pour l'export Excel (l'écran et le CSV le laissent vide) : une valeur écrite telle quelle, ou
// { nd: raison } quand la donnée manque. Date de sortie null d'un salarié connu : contrat en cours, sans objet (pas de raison).
export type Absent = string | { nd: string };
export type PersonAbsent = { service: Absent; contract: Absent; start: Absent; end?: Absent };

const REFERENTIEL = "non renseigné dans le référentiel Collaborateurs";
const START_ND = "date de début absente du référentiel Collaborateurs";
const HIRE_ND = "non saisi dans l'hypothèse d'embauche";

export function peopleIndex(loaded: Loaded): Map<string, PersonInfo> {
  const out = new Map<string, PersonInfo>();
  for (const f of loaded.scenarios.values()) {
    for (const c of f.base.contracts) {
      out.set(c.externalId, {
        label: c.label,
        externalId: c.externalId,
        service: c.service,
        contract: c.nature ? contractNatureLabel(c.nature) : null,
        start: c.startDate,
        end: c.endDate,
        absent: {
          // Service null de la base : « Non ventilé », comme à l'écran Masse salariale, sauf raison propre (plusieurs services, entrée après le mois de référence).
          service: c.serviceNd ? { nd: c.serviceNd } : "Non ventilé",
          contract: { nd: c.nature === undefined ? "nature absente de la base figée du scénario (créé avant sa conservation)" : REFERENTIEL },
          start: { nd: START_ND },
        },
      });
    }
    for (const h of f.hypotheses) if (h.kind === "embauche") out.set(hireKey(h.id), { label: `${h.label} (embauche)`, externalId: null, service: h.service, contract: h.category ?? null, start: h.start, end: h.end, absent: { service: { nd: HIRE_ND }, contract: { nd: HIRE_ND }, start: { nd: HIRE_ND } } });
  }
  const kpi = loaded.ctx.kpi.input;
  if (kpi) {
    const persons = new Map(kpi.data.persons.map((p) => [p.personKey, p]));
    for (const c of kpi.data.contracts) {
      if (out.has(c.externalId)) continue;
      const p = c.personKey ? persons.get(c.personKey) : undefined;
      const label = (p && [p.usageName ?? p.familyName, p.givenNames].filter(Boolean).join(" ").trim()) || c.externalId;
      // Le référentiel n'a pas de service : il se lit dans la base d'un scénario, que ce contrat n'a pas.
      out.set(c.externalId, { label, externalId: c.externalId, service: null, contract: c.nature ? contractNatureLabel(c.nature) : null, start: c.startDate, end: c.endDate, absent: { service: { nd: "service non lu (contrat hors base de scénario)" }, contract: { nd: REFERENTIEL }, start: { nd: START_ND } } });
    }
  }
  return out;
}
