import { z } from "zod";
import { isMonth, monthRange } from "@/lib/connectors/months";
import type { ActualEvent } from './non-recurring';

export type RcPayslipComponent = { label: string; amountCents: number; page: number; line: number };
export type RcPayslipCost = {
  status: 'value' | 'review'; code: string;
  employerChargesCents: number | null; chargedCents: number | null;
  components: RcPayslipComponent[];
};
export type RcPayslipRecord = {
  month: string; collaboratorId: string; contractId: string; payslipId: string;
  pdfHash: string | null; parserVersion: string;
  status: 'identified' | 'none' | 'review'; code: string;
  indemnityCents: number | null; components: RcPayslipComponent[];
  cost?: RcPayslipCost;
};
export type RcPayslipScan = {
  version: 1; id: string; payrollSyncId: string; companyId: string;
  from: string; to: string; status: 'running' | 'complete' | 'partial' | 'failed';
  startedAt: string; finishedAt: string | null;
  closedMonths: string[]; unavailableMonths: string[];
  totalCollaborators: number; completedCollaborators: number; checkedPayslips: number;
  records: RcPayslipRecord[]; issues: { code: string; count: number }[];
};
export type RcPayslipPeriod = {
  status: 'not-read' | 'running' | 'value' | 'none' | 'review';
  amountCents: number | null; identifiedCount: number; mergedCount: number; reviewCount: number;
  reason: string | null; rows: RcPayslipRecord[];
  chargedCents?: number | null; employerChargesCents?: number | null;
  costReason?: string | null; costStatus?: 'not-read' | 'value' | 'review' | 'none';
};

const boundedId = z.string().min(1).max(128);
const month = z.string().refine(isMonth);
const count = z.number().int().safe().min(0);
const cents = z.number().int().safe();
const component = z.object({ label: z.string().min(1).max(160), amountCents: cents, page: count.min(1).max(20), line: count.max(20_000) }).strict();
const cost = z.object({
  status: z.enum(['value', 'review']), code: z.string().min(1).max(100),
  employerChargesCents: cents.nullable(), chargedCents: cents.nullable(), components: z.array(component).max(100),
}).strict();
const invalidCost = (): RcPayslipCost => ({ status: 'review', code: 'invalid-cost', employerChargesCents: null, chargedCents: null, components: [] });
const record = z.object({
  month, collaboratorId: boundedId, contractId: boundedId, payslipId: boundedId,
  pdfHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), parserVersion: z.string().min(1).max(64),
  status: z.enum(['identified', 'none', 'review']), code: z.string().min(1).max(100),
  indemnityCents: cents.nullable(), components: z.array(component).max(100),
  cost: z.unknown().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status !== 'identified') {
    if (value.indemnityCents !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Montant non confirmé.' });
    return;
  }
  if (value.pdfHash === null || value.indemnityCents === null || value.indemnityCents < 0 || !value.components.length
    || value.components.some((part) => part.amountCents < 0)
    || value.components.reduce((sum, part) => sum + BigInt(part.amountCents), 0n) !== BigInt(value.indemnityCents ?? 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Montant du bulletin incohérent.' });
  }
}).transform((value) => {
  if (value.cost === undefined) return { ...value, cost: undefined };
  const parsed = cost.safeParse(value.cost);
  if (!parsed.success) return { ...value, cost: invalidCost() };
  const charge = parsed.data;
  const valid = charge.status === 'review' ? charge.chargedCents === null && charge.employerChargesCents === null
    : value.status === 'identified' && value.pdfHash !== null && value.indemnityCents !== null
      && charge.employerChargesCents !== null && charge.chargedCents !== null
      && charge.employerChargesCents >= 0 && charge.chargedCents >= 0 && charge.components.length > 0
      && charge.components.every((part) => part.amountCents >= 0)
      && charge.components.reduce((sum, part) => sum + BigInt(part.amountCents), 0n) === BigInt(charge.employerChargesCents)
      && BigInt(value.indemnityCents) + BigInt(charge.employerChargesCents) === BigInt(charge.chargedCents);
  return { ...value, cost: valid ? charge : invalidCost() };
});
const scanSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), payrollSyncId: z.string().uuid(), companyId: boundedId,
  from: month, to: month, status: z.enum(['running', 'complete', 'partial', 'failed']),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  closedMonths: z.array(month).max(24), unavailableMonths: z.array(month).max(24),
  totalCollaborators: count.max(1000), completedCollaborators: count.max(1000), checkedPayslips: count.max(2000),
  records: z.array(record).max(2000), issues: z.array(z.object({ code: z.string().min(1).max(100), count: count.max(2000) }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  const validRange = value.from <= value.to && monthRange(value.from, value.to).length <= 24;
  if (!validRange || value.completedCollaborators > value.totalCollaborators
    || value.status === 'complete' && (value.completedCollaborators !== value.totalCollaborators || value.finishedAt === null)
    || new Set(value.closedMonths).size !== value.closedMonths.length || new Set(value.unavailableMonths).size !== value.unavailableMonths.length
    || [...value.closedMonths, ...value.unavailableMonths].some((key) => key < value.from || key > value.to)
    || value.unavailableMonths.some((key) => value.closedMonths.includes(key))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Périmètre de lecture incohérent.' });
});

export function parseRcPayslipScan(value: unknown): RcPayslipScan | null {
  const parsed = scanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const sameNominalRecord = (a: RcPayslipRecord, b: RcPayslipRecord) => a.pdfHash !== null && a.pdfHash === b.pdfHash
  && a.month === b.month && a.contractId === b.contractId && a.collaboratorId === b.collaboratorId
  && a.parserVersion === b.parserVersion && a.status === b.status && a.code === b.code
  && a.indemnityCents === b.indemnityCents && JSON.stringify(a.components) === JSON.stringify(b.components);
const conflictingCost = (): RcPayslipCost => ({ status: 'review', code: 'conflicting-cost-versions', employerChargesCents: null, chargedCents: null, components: [] });

/** Les indemnités observées restent séparées des coûts chargés et des retraitements. */
export function buildRcPayslipPeriod(scan: RcPayslipScan | null, months: string[], syncId: string | null, events: ActualEvent[] = [], serviceFiltered = false): RcPayslipPeriod {
  const manual = events.filter((event) => event.kind === 'rupture-conventionnelle' && months.includes(event.month));
  const empty = (status: RcPayslipPeriod['status'], reason: string | null, patch: Partial<RcPayslipPeriod> = {}): RcPayslipPeriod => ({
    status, amountCents: null, identifiedCount: 0, mergedCount: manual.length, reviewCount: 0, reason, rows: [],
    chargedCents: null, employerChargesCents: null,
    costStatus: status === 'not-read' ? 'not-read' : status === 'none' ? 'none' : 'review', costReason: reason,
    ...patch,
  });
  if (!months.length || months.some((key) => !isMonth(key)) || new Set(months).size !== months.length) return empty('review', 'Choisir une période valide pour les bulletins de RC.');
  if (!scan) return empty('not-read', 'Les bulletins PayFit n’ont pas encore été lus pour les indemnités de RC.');
  const parsed = parseRcPayslipScan(scan);
  if (!parsed) return empty('review', 'La lecture des bulletins est illisible ; relancer la synchronisation.');
  if (!syncId || parsed.payrollSyncId.toLowerCase() !== syncId.toLowerCase()) return empty('review', 'Les bulletins dépendent d’une autre lecture de paie ; relancer leur synchronisation.');
  if (serviceFiltered) return empty('review', 'Les indemnités des bulletins ne sont pas ventilées par service ; ouvrir la vue globale.');
  if (parsed.status === 'running') return empty('running', `Lecture des bulletins en cours : ${parsed.completedCollaborators}/${parsed.totalCollaborators} collaborateurs parcourus.`);
  if (parsed.status === 'failed') return empty('review', 'La lecture des bulletins a échoué ; relancer la synchronisation.');
  const selected = parsed.records.filter((entry) => months.includes(entry.month));
  // L’empreinte permet de reconnaître un document strictement identique, jamais de choisir une version rectifiée.
  const byDocument = new Map<string, RcPayslipRecord>();
  let conflict = false;
  for (const entry of selected) {
    const identity = JSON.stringify([entry.collaboratorId, entry.contractId, entry.month, entry.payslipId]);
    const before = byDocument.get(identity);
    if (before && JSON.stringify(before) !== JSON.stringify(entry)) {
      if (sameNominalRecord(before, entry)) byDocument.set(identity, { ...before, cost: conflictingCost() });
      else conflict = true;
    }
    else if (!before) byDocument.set(identity, entry);
  }
  const grouped = new Map<string, RcPayslipRecord[]>();
  for (const entry of byDocument.values()) {
    const identity = JSON.stringify([entry.contractId, entry.month]);
    grouped.set(identity, [...(grouped.get(identity) ?? []), entry]);
  }
  const rows: RcPayslipRecord[] = [];
  for (const entries of grouped.values()) {
    const first = entries[0];
    const identical = entries.every((entry) => sameNominalRecord(first, entry));
    if (entries.length > 1 && !identical) {
      conflict = true;
      rows.push({ ...entries[0], status: 'review', code: 'multiple-payslip-versions', indemnityCents: null, components: [], cost: entries[0].cost ? { status: 'review', code: 'multiple-payslip-versions', chargedCents: null, employerChargesCents: null, components: [] } : undefined });
    } else if (entries.some((entry) => JSON.stringify(entry.cost) !== JSON.stringify(first.cost))) rows.push({ ...first, cost: conflictingCost() });
    else rows.push(first);
  }
  const relevant = rows.filter((entry) => entry.status !== 'none');
  const identified = relevant.filter((entry) => entry.status === 'identified');
  const sourceIdentities = new Set(identified.map((entry) => JSON.stringify([entry.contractId, entry.month])));
  const merged = new Set(sourceIdentities);
  let ambiguousManual = false;
  for (const event of manual) {
    if (event.contractKeys.length === 1 && event.contractKeys[0].startsWith('payfit:')) merged.add(JSON.stringify([event.contractKeys[0].slice(7), event.month]));
    else {
      if (identified.some((entry) => entry.month === event.month)) ambiguousManual = true;
      else merged.add(`manual:${event.id}`);
    }
  }
  const badClosure = selected.some((entry) => !parsed.closedMonths.includes(entry.month));
  const uncovered = months.some((key) => key < parsed.from || key > parsed.to || !parsed.closedMonths.includes(key));
  const reviewCount = relevant.filter((entry) => entry.status === 'review').length;
  const patch = { rows: relevant, identifiedCount: identified.length, mergedCount: merged.size, reviewCount };
  if (badClosure || uncovered) return empty('review', 'La période n’est pas entièrement couverte par des paies clôturées ; aucun cumul partiel.', patch);
  if (conflict) return empty('review', 'Plusieurs versions d’un bulletin demandent une vérification ; aucune version n’est choisie automatiquement.', patch);
  if (ambiguousManual) return empty('review', 'Une RC déclarée sans contrat doit être rapprochée du bulletin avant cumul.', { ...patch, reviewCount: reviewCount + 1 });
  if (parsed.status === 'partial' || reviewCount > 0) return empty('review', 'Certains bulletins n’ont pas pu être vérifiés ; aucun cumul partiel des indemnités.', patch);
  if (!identified.length) return empty('none', 'Aucune indemnité de RC repérée dans les bulletins lus ; la couverture des anciens collaborateurs reste à vérifier.', patch);
  const total = identified.reduce((sum, entry) => sum + BigInt(entry.indemnityCents!), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return empty('review', 'Total des indemnités hors des centimes entiers sûrs.', patch);
  const nominal = { ...empty('value', 'Indemnité du bulletin uniquement ; les cotisations propres à la RC ne sont pas isolées.', patch), amountCents: Number(total) };
  if (identified.some((entry) => !entry.cost)) return { ...nominal, costReason: 'Relire les bulletins pour identifier les cotisations propres à la RC ; aucun taux n’est reconstitué.' };
  if (identified.some((entry) => entry.cost!.status !== 'value')) return { ...nominal, costReason: 'Les cotisations propres à chaque RC ne sont pas toutes isolées ; aucun coût chargé partiel.' };
  const charges = identified.reduce((sum, entry) => sum + BigInt(entry.cost!.employerChargesCents!), 0n);
  const charged = identified.reduce((sum, entry) => sum + BigInt(entry.cost!.chargedCents!), 0n);
  if (charges > BigInt(Number.MAX_SAFE_INTEGER) || charged > BigInt(Number.MAX_SAFE_INTEGER)) return { ...nominal, costReason: 'Total chargé des RC hors des centimes entiers sûrs.' };
  return {
    ...nominal, reason: 'Indemnités et cotisations propres aux RC explicitement identifiées dans les bulletins.',
    employerChargesCents: Number(charges), chargedCents: Number(charged), costStatus: 'value',
    costReason: 'Indemnités et cotisations patronales explicitement rattachées aux RC ; aucun taux reconstitué.',
  };
}
