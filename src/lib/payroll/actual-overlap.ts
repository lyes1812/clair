import { z } from "zod";
import { isIsoDate, isMonth } from "@/lib/connectors/months";
import { roundDiv } from "@/lib/budget/engine";
import { monthPayroll, type JournalInput } from "./engine";
import { classify, gridRubrics } from "./grid";

const key = z.string().min(1).max(300).refine((value) => value === value.trim());
const contract = z.object({
  contractKey: key, syncId: z.string().uuid(),
  startDate: z.string().refine(isIsoDate).nullable(), endDate: z.string().refine(isIsoDate).nullable(),
}).strict();
const payroll = z.object({
  syncId: z.string().uuid(), month: z.string().refine(isMonth), contractKey: key,
  chargedCents: z.number().int().safe().nonnegative().nullable(), lineKeys: z.array(key).min(1),
}).strict();
const inputSchema = z.object({
  month: z.string().refine(isMonth), syncId: z.string().uuid(), incoming: contract, outgoing: contract, payroll,
}).strict();

export type ActualOverlapContract = z.infer<typeof contract>;
export type ActualOverlapPayroll = z.infer<typeof payroll>;
export type ActualOverlapInput = z.infer<typeof inputSchema>;
export const actualOverlapCalculationSchema = z.object({
  basis: z.literal("calendar-estimate"), method: z.enum(["whole-month", "calendar-prorata", "no-overlap"]),
  incoming: contract, outgoing: contract, source: payroll,
  days: z.object({ incomingPresence: z.number().int().min(1).max(31), overlap: z.number().int().min(0).max(31) }).strict(),
  interval: z.object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) }).strict().nullable(),
}).strict();
export type ActualOverlapCalculation = z.infer<typeof actualOverlapCalculationSchema>;
export type ActualOverlapSourceContract = ActualOverlapContract & { externalId: string };
export type ActualOverlapCode = "invalid-input" | "same-contract" | "sync-mismatch" | "payroll-month-mismatch"
  | "payroll-contract-mismatch" | "duplicate-lines" | "incoming-start-missing" | "outgoing-start-missing"
  | "outgoing-end-missing" | "invalid-contract-dates" | "amount-missing" | "incoming-not-present" | "unsafe-result"
  | "journal-unavailable" | "month-not-read" | "month-open" | "no-journal" | "service-filter" | "contract-unavailable"
  | "unassigned-lines" | "unclassified-lines" | "gross-missing" | "contributions-missing" | "negative-cost";
type Details = {
  basis: "calendar-estimate";
  source: ActualOverlapPayroll | null;
  days: { incomingPresence: number; overlap: number } | null;
  interval: { from: string; to: string } | null;
  warnings: string[];
};
export type ActualOverlapResult = Details & (
  | { kind: "value"; amountCents: number; method: "whole-month" | "calendar-prorata" | "no-overlap"; calculation: ActualOverlapCalculation; code: null; reason: null }
  | { kind: "nd"; amountCents: null; method: null; code: ActualOverlapCode; reason: string }
);

const qualification = "Attribution calendaire calculée à partir du coût mensuel observé ; primes et régularisations non ventilées par jour. Ce calcul ne prouve pas une période de rémunération exacte.";
const equalSync = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
const monthLast = (month: string) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
};

/** Coût de l'entrant seul, déjà payé : aucune somme du binôme, aucune modification du journal ni création d'événement. */
export function estimateActualOverlap(input: ActualOverlapInput): ActualOverlapResult {
  let source: ActualOverlapPayroll | null = null;
  let days: Details["days"] = null;
  let interval: Details["interval"] = null;
  const unavailable = (code: ActualOverlapCode, reason: string): ActualOverlapResult => ({
    kind: "nd", amountCents: null, method: null, code, reason, basis: "calendar-estimate", source, days, interval, warnings: [],
  });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid-input", "Mois, identifiants, dates ISO, lignes sources ou coût chargé en centimes entiers invalides.");
  const { month, syncId, incoming, outgoing, payroll: pay } = parsed.data;
  source = { ...pay, lineKeys: [...pay.lineKeys] };
  if (incoming.contractKey === outgoing.contractKey) return unavailable("same-contract", "L’entrant et le sortant doivent être deux contrats distincts, explicitement choisis.");
  if (![incoming.syncId, outgoing.syncId, pay.syncId].every((id) => equalSync(id, syncId))) return unavailable("sync-mismatch", "Contrats et coût chargé doivent provenir de la même lecture de paie.");
  if (pay.month !== month) return unavailable("payroll-month-mismatch", "Le coût chargé mensuel ne correspond pas au mois du tuilage.");
  if (pay.contractKey !== incoming.contractKey) return unavailable("payroll-contract-mismatch", "Le coût chargé mensuel doit porter uniquement sur le contrat entrant.");
  if (new Set(pay.lineKeys).size !== pay.lineKeys.length) return unavailable("duplicate-lines", "Les références des lignes de paie sont en double ; coût mensuel à rapprocher avant calcul.");
  if (incoming.startDate === null) return unavailable("incoming-start-missing", "Date de début du contrat entrant absente.");
  if (outgoing.startDate === null) return unavailable("outgoing-start-missing", "Date de début du contrat sortant absente.");
  if (outgoing.endDate === null) return unavailable("outgoing-end-missing", "Date de fin du contrat sortant absente ; le chevauchement n’est pas établi.");
  if (incoming.endDate !== null && incoming.startDate > incoming.endDate || outgoing.startDate > outgoing.endDate) return unavailable("invalid-contract-dates", "Date de fin antérieure à la date de début d’un contrat.");
  if (pay.chargedCents === null) return unavailable("amount-missing", "Coût chargé mensuel du contrat entrant absent ; aucun montant reconstitué.");
  const first = `${month}-01`, last = monthLast(month);
  const presenceFrom = [first, incoming.startDate].sort().at(-1)!;
  const presenceTo = [last, incoming.endDate ?? last].sort()[0];
  if (presenceFrom > presenceTo) return unavailable("incoming-not-present", "Le contrat entrant n’a aucun jour de présence dans le mois du coût chargé ; période de paie à vérifier.");
  const from = [presenceFrom, outgoing.startDate].sort().at(-1)!;
  const to = [presenceTo, outgoing.endDate].sort()[0];
  const overlap = from > to ? 0 : daysBetween(from, to);
  days = { incomingPresence: daysBetween(presenceFrom, presenceTo), overlap };
  interval = overlap ? { from, to } : null;
  // La paie observée est déjà proratisée à l'entrée : division par les jours de présence, pas une seconde fois par tout le mois.
  const amountCents = roundDiv(BigInt(pay.chargedCents) * BigInt(overlap), BigInt(days.incomingPresence));
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return unavailable("unsafe-result", "Résultat hors des centimes entiers sûrs.");
  const method = overlap === 0 ? "no-overlap" : overlap === days.incomingPresence ? "whole-month" : "calendar-prorata";
  return {
    kind: "value", amountCents: amountCents === 0 ? 0 : amountCents,
    method, calculation: { basis: "calendar-estimate", method, incoming: { ...incoming }, outgoing: { ...outgoing }, source, days: { ...days }, interval: interval ? { ...interval } : null },
    code: null, reason: null, basis: "calendar-estimate", source, days, interval, warnings: [qualification],
  };
}

/** Adaptation des lignes réellement lues : aucune base récurrente, taux reconstitué ni coût du sortant n'entre dans le montant. */
export function actualOverlapFromJournal(p: {
  input: JournalInput | null; syncId: string; month: string;
  incoming: ActualOverlapSourceContract | null; outgoing: ActualOverlapSourceContract | null;
}): ActualOverlapResult {
  const nd = (code: ActualOverlapCode, reason: string): ActualOverlapResult => ({ kind: "nd", amountCents: null, method: null, code, reason, basis: "calendar-estimate", source: null, days: null, interval: null, warnings: [] });
  if (!isMonth(p.month)) return nd("invalid-input", "Mois du tuilage invalide.");
  if (!p.input) return nd("journal-unavailable", "Journal comptable de paie PayFit indisponible.");
  if (p.input.serviceFilter) return nd("service-filter", "Retirer le filtre de service : le coût du contrat doit être lu sur toutes ses lignes.");
  if (!p.input.months.includes(p.month)) return nd("month-not-read", "Mois du tuilage absent de la lecture de paie appliquée.");
  if (p.input.openMonths.includes(p.month)) return nd("month-open", "La paie du mois doit être clôturée avant de calculer le tuilage passé.");
  if (!p.incoming || !p.outgoing || !p.incoming.externalId || !p.outgoing.externalId || p.incoming.externalId === p.outgoing.externalId) return nd("contract-unavailable", "Deux contrats distincts avec leurs identifiants PayFit sont nécessaires.");
  const lines = p.input.lines.filter((line) => line.month === p.month);
  if (!lines.length) return nd("no-journal", "Aucune ligne de journal de paie renvoyée pour ce mois.");
  if (new Set(lines.map((line) => line.key)).size !== lines.length) return nd("duplicate-lines", "Références de lignes de paie en double ; aucun calcul partiel.");
  const rubrics = gridRubrics(p.input.grid);
  let cents = 0n, grossLines = 0, contributionLines = 0;
  const lineKeys: string[] = [];
  for (const line of lines) {
    const c = classify(line.accountId, rubrics);
    if (!c.rubric && c.payroll && (!line.contractId || line.contractId === p.incoming.externalId)) return nd("unclassified-lines", "Des comptes de paie non classés empêchent d’établir le coût complet de l’entrant.");
    const role = c.rubric?.role;
    if (role !== "brut" && role !== "cotisations") continue;
    if (!line.contractId) return nd("unassigned-lines", "Des lignes de brut ou de cotisations ne sont rattachées à aucun contrat ; coût complet de l’entrant non établi.");
    if (line.debitCents === null && line.creditCents === null) return nd("amount-missing", "Une ligne de brut ou de cotisations du mois est sans débit ni crédit ; aucun coût partiel.");
    if (line.debitCents !== null && !Number.isSafeInteger(line.debitCents) || line.creditCents !== null && !Number.isSafeInteger(line.creditCents)) return nd("unsafe-result", "Une ligne de paie n’est pas exprimée en centimes entiers sûrs.");
    if (line.contractId !== p.incoming.externalId) continue;
    cents += BigInt(line.debitCents ?? 0) - BigInt(line.creditCents ?? 0);
    lineKeys.push(line.key);
    if (role === "brut") grossLines++; else contributionLines++;
  }
  if (!grossLines) return nd("gross-missing", "Aucune ligne de brut rattachée au contrat entrant pour ce mois.");
  if (!contributionLines) return nd("contributions-missing", "Aucune ligne de cotisations rattachée au contrat entrant pour ce mois ; zéro charge non confirmé.");
  if (cents < 0n) return nd("negative-cost", "Le coût chargé mensuel de l’entrant est négatif ; régularisation à identifier avant attribution.");
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return nd("unsafe-result", "Coût chargé mensuel hors des centimes entiers sûrs.");
  if (monthPayroll(p.input, p.month).kind !== "value") return nd("amount-missing", "Le journal de paie du mois est incomplet ; aucun coût partiel.");
  const { externalId: _in, ...incoming } = p.incoming, { externalId: _out, ...outgoing } = p.outgoing;
  return estimateActualOverlap({ month: p.month, syncId: p.syncId, incoming, outgoing, payroll: { syncId: p.syncId, month: p.month, contractKey: incoming.contractKey, chargedCents: Number(cents), lineKeys: lineKeys.sort() } });
}
