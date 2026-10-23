import { contractNatureLabel } from "@/lib/dsn/labels";
import { hireKey } from "@/lib/budget/engine";
import type { Loaded } from "./ecart-data";

// Identité d'un salarié pour le détail d'un écart : identifiant externe du contrat (PayFit) ou « embauche:… ». Lu dans le
// référentiel Collaborateurs courant, puis dans les bases et embauches des scénarios choisis.
export type PersonInfo = { label: string; externalId: string | null; service: string | null; contract: string | null; start: string | null; end: string | null };

export function peopleIndex(loaded: Loaded): Map<string, PersonInfo> {
  const out = new Map<string, PersonInfo>();
  for (const f of loaded.scenarios.values()) {
    for (const c of f.base.contracts) out.set(c.externalId, { label: c.label, externalId: c.externalId, service: c.service, contract: c.nature ? contractNatureLabel(c.nature) : null, start: c.startDate, end: c.endDate });
    for (const h of f.hypotheses) if (h.kind === "embauche") out.set(hireKey(h.id), { label: `${h.label} (embauche)`, externalId: null, service: h.service, contract: h.category ?? null, start: h.start, end: h.end });
  }
  const kpi = loaded.ctx.kpi.input;
  if (kpi) {
    const persons = new Map(kpi.data.persons.map((p) => [p.personKey, p]));
    for (const c of kpi.data.contracts) {
      if (out.has(c.externalId)) continue;
      const p = c.personKey ? persons.get(c.personKey) : undefined;
      const label = (p && [p.usageName ?? p.familyName, p.givenNames].filter(Boolean).join(" ").trim()) || c.externalId;
      out.set(c.externalId, { label, externalId: c.externalId, service: null, contract: c.nature ? contractNatureLabel(c.nature) : null, start: c.startDate, end: c.endDate });
    }
  }
  return out;
}
