import { formatDate, monthEnd, monthStart } from "@/lib/dates";
import { gateAt, natureOfMonth, payfitExactFrom } from "@/lib/rh/headcount";
import type { ContractDraft } from "@/lib/rh/referential/types";
import { countDays } from "./days";
import { contractEtp } from "./etp";
import { ratio } from "./fraction";
import { memo } from "./memo";
import { countedOpts } from "./period";
import { kpiNd, type ContractRef, type EtpMissing, type EtpProrated, type EtpProratedContribution, type KpiInput } from "./types";

// ETP contractuel proratisé : somme, sur les contrats comptés présents au moins un jour du mois, de quotité × jours sous contrat
// du mois ÷ jours du mois. Ce n'est ni un ETP payé ni un historique exact : la quotité est celle de l'ETP contractuel fin de mois
// (PayFit : quotité à la date de lecture ; DSN : quotité déclarée du mois). Le stock de fin de mois (etpMonthEnd) reste inchangé.
export const ETP_PRORATED_LABEL = "ETP contractuel proratisé — quotité actuelle";

const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);
const inEst = (scope: string[] | undefined, id: string | null) => !scope || (id !== null && scope.includes(id));
const refOf = (c: ContractDraft, nature: string | null): ContractRef => ({ contractKey: c.contractKey, externalId: c.externalId, personKey: c.personKey, establishmentId: c.establishmentId, nature });

// Qualifieur obligatoire de la valeur (affiché avec le chiffre, n.d. compris).
export function etpProratedQualifier(input: KpiInput): string {
  const tail = "proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact";
  return input.data.build.source === "payfit"
    ? `ETP contractuel proratisé : quotité à la date de lecture (${formatDate(input.data.build.referenceDate)}), ${tail}`
    : `ETP contractuel proratisé : quotité déclarée dans la DSN du mois, ${tail}`;
}

export function etpProratedMonth(input: KpiInput, month: string): EtpProrated {
  return memo(input, `etp-pr:${month}`, () => {
    const { data, scope, params } = input;
    const opts = countedOpts(input);
    const g = gateAt(data, monthEnd(month), scope.establishments);
    if (g.nd) return { month, kind: "nd", nd: kpiNd(g.nd.code, g.nd.reason), missing: [] };
    // PayFit en historique signalé : avant la limite de conservation, des contrats archivés peuvent manquer ⇒ borne basse
    // (comme l'ETP fin de mois) ; exact dès que le mois entier est postérieur à la limite.
    const exactFrom = payfitExactFrom(data);
    const lowerCoverage = g.coverage.some((c) => c.presenceStatus === "lower_bound") && !(exactFrom !== null && monthStart(month) >= exactFrom);
    const byKey = new Map(data.contracts.map((c) => [c.contractKey, c]));
    // Même règle de présence que les jours théoriques : lignes du mois par dates (PayFit) ou déclarées (DSN), présentes un jour.
    // Un contrat sans date de début qui a une ligne ce mois-là est présent sans période connue : listé, jamais compté.
    const rows = data.months
      .filter((m) => m.month === month && inEst(scope.establishments, m.establishmentId))
      .filter((m) => (data.build.source === "payfit" ? m.presenceBasis === "dates" : m.presenceBasis === "declared" && !m.flags.includes("declared_before_start") && !m.flags.includes("declared_after_end")))
      .sort((a, b) => a.contractKey.localeCompare(b.contractKey) || a.establishmentId.localeCompare(b.establishmentId));
    const seen = new Set<string>();
    const contributions: EtpProratedContribution[] = [];
    const missing: EtpMissing[] = [];
    const monthDays = countDays(monthStart(month), monthEnd(month), params.dayBasis);
    for (const m of rows) {
      const c = byKey.get(m.contractKey);
      const nature = c ? natureOfMonth(c, m) : null;
      if (!c || nature === null || !opts.natures.includes(nature)) continue;
      if (!m.presentAnyDay && c.startDate !== null) continue;
      if (seen.has(c.contractKey)) continue;
      seen.add(c.contractKey);
      if (c.startDate === null) {
        missing.push({ ...refOf(c, nature), kind: "missing", source: null, nd: kpiNd("no-start-date", "contrat sans date de début : jours sous contrat inconnus") });
        continue;
      }
      const r = contractEtp(input, c, month);
      if (r.kind === "missing") {
        missing.push(r);
        continue;
      }
      const from = max(c.startDate, monthStart(month));
      const to = min(c.endDate ?? monthEnd(month), monthEnd(month));
      const days = countDays(from, to, params.dayBasis);
      contributions.push({ ...r, from, to, days, weighted: r.etp4 * days });
    }
    if (!contributions.length && missing.length) {
      const unpositioned = missing.every((x) => x.nd.code === "no-start-date");
      const label = unpositioned ? "aucun contrat avec une date de début" : "aucune quotité lisible";
      return { month, kind: "nd", nd: kpiNd(unpositioned ? "no-start-date" : "quota-missing", `${label} : ${missing[0].nd.reason}`, { keys: missing.map((x) => x.contractKey) }), missing };
    }
    const qualifiers = [etpProratedQualifier(input)];
    const noStart = missing.filter((x) => x.nd.code === "no-start-date").length;
    const noQuota = missing.length - noStart;
    if (noQuota) qualifiers.push(`${noQuota} contrat(s) présent(s) sans quotité : total en borne basse`);
    if (noStart) qualifiers.push(`${noStart} contrat(s) présent(s) sans date de début : total en borne basse`);
    if (lowerCoverage) qualifiers.push("mois en borne basse (PayFit) : contrats archivés inconnus");
    return {
      month,
      kind: missing.length || lowerCoverage ? "lower_bound" : "exact",
      ratio: ratio(
        contributions.reduce((s, x) => s + x.weighted, 0),
        10000 * monthDays,
      ),
      dayBasis: params.dayBasis,
      monthDays,
      contributions,
      missing,
      qualifiers,
    };
  });
}
