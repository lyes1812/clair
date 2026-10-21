import type { SourceRecordInput } from "@/lib/connectors/types";
import { addDays, formatDate } from "@/lib/dates";
import { FINDING_LABELS } from "../findings";
import type { ContractDraft, EventDraft, FindingDraft, FindingSeverity, Provenance, RhBuildResult, RhBuildSummary } from "./types";

// Règles communes aux deux constructeurs (§ 4.3) : constats, tri déterministe, contrats simultanés, réembauche, continuité.

export function finding(
  code: string,
  p: { persons?: string[]; contracts?: string[]; month?: string | null; message: string; detail?: Record<string, unknown>; provenance?: Record<string, Provenance>; severity?: FindingSeverity },
): FindingDraft {
  const known = FINDING_LABELS[code];
  if (!known) throw new Error(`constat inconnu : ${code}`);
  return {
    code,
    severity: p.severity ?? known.severity,
    personKeys: [...new Set(p.persons ?? [])].sort(),
    contractKeys: [...new Set(p.contracts ?? [])].sort(),
    month: p.month ?? null,
    message: p.message,
    detail: p.detail ?? {},
    provenance: p.provenance ?? {},
  };
}

const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);

// Les enregistrements sont traités dans un ordre fixe : deux lectures identiques donnent le même référentiel.
export function sortRecords<T extends SourceRecordInput & { syncId?: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => cmp(a.collection, b.collection) || cmp(a.period, b.period) || cmp(a.key, b.key) || cmp(a.syncId ?? null, b.syncId ?? null));
}

export function sortOutputs(r: RhBuildResult): void {
  r.persons.sort((a, b) => cmp(a.personKey, b.personKey));
  r.contracts.sort((a, b) => cmp(a.contractKey, b.contractKey));
  r.months.sort((a, b) => cmp(a.contractKey, b.contractKey) || cmp(a.month, b.month) || cmp(a.establishmentId, b.establishmentId));
  r.events.sort((a, b) => cmp(a.date, b.date) || cmp(a.kind, b.kind) || cmp(a.contractKey, b.contractKey));
  r.coverage.sort((a, b) => cmp(a.establishmentId, b.establishmentId) || cmp(a.month, b.month));
  r.findings.sort((a, b) => cmp(a.code, b.code) || cmp(a.month, b.month) || cmp(a.contractKeys.join(","), b.contractKeys.join(",")) || cmp(a.personKeys.join(","), b.personKeys.join(",")));
}

export function summarize(r: Omit<RhBuildResult, "build">): RhBuildSummary {
  return { persons: r.persons.length, contracts: r.contracts.length, months: r.months.length, events: r.events.length, findings: r.findings.length };
}

const INF = "9999-12-31";

// A1 contrats simultanés, A2 réembauche, A3 continuité : même clé de personne uniquement, jamais par le nom.
export function applyCommonRules(contracts: ContractDraft[], events: EventDraft[], findings: FindingDraft[]): void {
  const eventOf = new Map(events.map((e) => [`${e.contractKey}|${e.kind}`, e]));
  const byPerson = new Map<string, ContractDraft[]>();
  for (const c of contracts) {
    if (!c.personKey || !c.startDate) continue;
    const list = byPerson.get(c.personKey) ?? [];
    list.push(c);
    byPerson.set(c.personKey, list);
  }
  for (const [personKey, list] of byPerson) {
    const sorted = [...list].sort((a, b) => cmp(a.startDate, b.startDate) || cmp(a.contractKey, b.contractKey));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (a.startDate! <= (b.endDate ?? INF) && b.startDate! <= (a.endDate ?? INF)) {
          findings.push(finding("simultaneous-contracts", { persons: [personKey], contracts: [a.contractKey, b.contractKey], message: `deux contrats se recouvrent pour la même personne : ${a.externalId} et ${b.externalId}` }));
        }
      }
    }
    for (const b of sorted) {
      // Dernier contrat terminé avant le début de B : continuité (J / J+1) ou réembauche.
      const prior = sorted.filter((a) => a !== b && a.endDate !== null && a.endDate < b.startDate!).sort((x, y) => cmp(y.endDate, x.endDate))[0];
      if (!prior) continue;
      const entry = eventOf.get(`${b.contractKey}|entry`);
      if (addDays(prior.endDate!, 1) === b.startDate) {
        const exit = eventOf.get(`${prior.contractKey}|exit`);
        if (exit && !exit.flags.includes("continuity_same_person")) exit.flags.push("continuity_same_person");
        if (entry && !entry.flags.includes("continuity_same_person")) entry.flags.push("continuity_same_person");
        findings.push(finding("continuity-same-person", { persons: [personKey], contracts: [prior.contractKey, b.contractKey], month: b.startDate!.slice(0, 7), message: `contrat continu : ${prior.externalId} se termine le ${formatDate(prior.endDate)}, ${b.externalId} commence le ${formatDate(b.startDate)}` }));
      } else {
        if (entry && !entry.flags.includes("rehire")) entry.flags.push("rehire");
        findings.push(finding("rehire", { persons: [personKey], contracts: [prior.contractKey, b.contractKey], month: b.startDate!.slice(0, 7), message: `réembauche : ${b.externalId} commence le ${formatDate(b.startDate)} après la fin de ${prior.externalId} le ${formatDate(prior.endDate)}` }));
      }
    }
  }
}
