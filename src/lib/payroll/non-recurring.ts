import { z } from "zod";
import { isMonth } from "@/lib/connectors/months";
import { serviceOf, windowPayroll, type JournalInput } from "./engine";
import { classify, gridRubrics } from "./grid";
import { actualOverlapCalculationSchema, estimateActualOverlap, type ActualOverlapCalculation } from "./actual-overlap";

export type ActualEvent = {
  id: string; syncId: string; month: string;
  kind: "licenciement" | "rupture-conventionnelle" | "tuilage" | "autre";
  chargedCents: number | null; contractKeys: string[]; note: string;
  calculation?: ActualOverlapCalculation;
};
const actualEvent = z.object({
  id: z.string().uuid(), syncId: z.string().uuid(), month: z.string().refine(isMonth),
  kind: z.enum(["licenciement", "rupture-conventionnelle", "tuilage", "autre"]),
  chargedCents: z.number().int().safe().min(0).max(100_000_000_000_000).nullable(),
  contractKeys: z.array(z.string().min(1).max(300).refine((key) => key === key.trim() && key.trim().length > 0)).max(2),
  note: z.string().max(300),
  calculation: actualOverlapCalculationSchema.optional(),
}).strict().superRefine((event, ctx) => {
  if (event.kind === "tuilage" ? event.contractKeys.length !== 2 || new Set(event.contractKeys).size !== 2 : event.contractKeys.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Un tuilage exige deux contrats distincts ; les autres événements acceptent zéro ou un contrat." });
  }
  if (event.calculation) {
    const c = event.calculation;
    const result = estimateActualOverlap({ month: event.month, syncId: event.syncId, incoming: c.incoming, outgoing: c.outgoing, payroll: c.source });
    if (event.kind !== "tuilage" || event.contractKeys[0] !== c.incoming.contractKey || event.contractKeys[1] !== c.outgoing.contractKey
      || result.kind !== "value" || result.amountCents !== event.chargedCents || result.method !== c.method
      || result.days?.incomingPresence !== c.days.incomingPresence || result.days?.overlap !== c.days.overlap
      || result.interval?.from !== c.interval?.from || result.interval?.to !== c.interval?.to) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Estimation calendaire incohérente avec ses contrats, sa paie source ou son montant." });
  }
});

export function parseActualEvent(value: unknown): ActualEvent | null {
  const result = actualEvent.safeParse(value);
  return result.success ? result.data : null;
}

export type ActualNonRecurring = {
  rows: { event: ActualEvent; amount: number | null; reason: string | null }[];
  raw: number | null; nonRecurring: number | null; adjusted: number | null; reasons: string[];
};
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const safeNumber = (value: bigint): number | null => value > MAX || value < -MAX ? null : Number(value) === 0 ? 0 : Number(value);
const amountIssue = "Montant ou total hors des centimes entiers sûrs.";

// Réemploi du moteur pour la couverture et le périmètre ; contrôle entier de ses sommes avant d’exposer le réel.
function readRaw(input: JournalInput | null, months: string[]): { value: number | null; reason: string | null } {
  if (!input) return { value: null, reason: "Journal de paie réel indisponible." };
  const source = windowPayroll(input, months);
  if (source.kind === "nd") return { value: null, reason: `Réel source n.d. : ${source.nd.reason}` };
  const wanted = new Set(months), rubrics = gridRubrics(input.grid);
  const perMonth = new Map(months.map((month) => [month, 0n]));
  for (const line of input.lines) {
    if (!wanted.has(line.month) || input.serviceFilter && serviceOf(line, input.serviceAxis) !== input.serviceFilter.value) continue;
    const role = classify(line.accountId, rubrics).rubric?.role;
    if (role !== "brut" && role !== "cotisations") continue;
    if (line.debitCents !== null && !Number.isSafeInteger(line.debitCents) || line.creditCents !== null && !Number.isSafeInteger(line.creditCents)) return { value: null, reason: amountIssue };
    const balance = BigInt(line.debitCents ?? 0) - BigInt(line.creditCents ?? 0);
    if (safeNumber(balance) === null) return { value: null, reason: amountIssue };
    perMonth.set(line.month, perMonth.get(line.month)! + balance);
  }
  for (const month of source.months) {
    if (month.kind !== "value" || !Number.isSafeInteger(month.masse) || safeNumber(perMonth.get(month.month)!) === null) return { value: null, reason: amountIssue };
    if (BigInt(month.masse) !== perMonth.get(month.month)) return { value: null, reason: "Somme du réel source incohérente avec ses lignes entières." };
  }
  const exact = [...perMonth.values()].reduce((sum, value) => sum + value, 0n);
  const value = safeNumber(exact);
  if (value === null || !Number.isSafeInteger(source.masse)) return { value: null, reason: amountIssue };
  return BigInt(source.masse) === exact ? { value, reason: null } : { value: null, reason: "Somme du réel source incohérente avec ses lignes entières." };
}

/** Montants déclarés déjà inclus dans le réel : aucune indemnité, paire, date ni quote-part n’est déduite automatiquement. */
export function buildActualNonRecurring(input: JournalInput | null, events: ActualEvent[], months: string[], syncId: string | null): ActualNonRecurring {
  if (!months.length || months.some((month) => !isMonth(month)) || new Set(months).size !== months.length) {
    return { rows: [], raw: null, nonRecurring: null, adjusted: null, reasons: ["Choisir une période valide, sans mois en double."] };
  }
  const wanted = new Set(months);
  const selected = events.filter((event) => wanted.has(event.month)).map((event) => ({ event, parsed: parseActualEvent(event) }));
  const ids = new Set<string>(), fingerprints = new Set<string>();
  let duplicate = false;
  for (const { parsed } of selected) if (parsed) {
    const id = parsed.id.toLowerCase(), fingerprint = JSON.stringify([parsed.kind, parsed.month, [...parsed.contractKeys].sort()]);
    if (ids.has(id) || fingerprints.has(fingerprint)) duplicate = true;
    ids.add(id); fingerprints.add(fingerprint);
  }
  const serviceReason = input?.serviceFilter ? "Les événements réalisés ne sont pas ventilés par service ; retirer le filtre de service pour lire le retraitement." : null;
  const duplicateReason = duplicate ? "Événements en doublon : même identifiant ou même catégorie, mois et contrats. Corriger les saisies avant tout retraitement." : null;
  const rows = selected.map(({ event, parsed }) => {
    const reason = serviceReason ?? duplicateReason ?? (!parsed ? "Événement réalisé invalide." : !syncId || parsed.syncId.toLowerCase() !== syncId.toLowerCase()
      ? "Événement rattaché à une autre lecture de paie ; vérifier son rattachement avant de le reprendre."
      : parsed.chargedCents === null ? "Montant chargé non saisi ; saisir un montant ou un zéro explicite." : null);
    return { event, amount: reason ? null : parsed!.chargedCents === 0 ? 0 : parsed!.chargedCents, reason };
  });
  const reasons: string[] = [serviceReason, duplicateReason].filter((reason): reason is string => reason !== null);
  const source = readRaw(input, months);
  if (source.reason) reasons.push(source.reason);
  for (const row of rows) if (row.reason) reasons.push(row.reason);
  const nonRecurring: number | null = serviceReason || duplicateReason || rows.some((row) => row.amount === null) ? null
    : safeNumber(rows.reduce((sum, row) => sum + BigInt(row.amount!), 0n));
  if (nonRecurring === null && !serviceReason && !duplicateReason && rows.every((row) => row.amount !== null)) reasons.push(amountIssue);
  const adjusted = source.value === null || nonRecurring === null ? null : safeNumber(BigInt(source.value) - BigInt(nonRecurring));
  if (source.value !== null && nonRecurring !== null && adjusted === null) reasons.push(amountIssue);
  // Nulle part ces saisies ne sont ajoutées au journal : seul ce calcul séparé les retire du total source.
  return { rows, raw: source.value, nonRecurring, adjusted, reasons: [...new Set(reasons)] };
}
