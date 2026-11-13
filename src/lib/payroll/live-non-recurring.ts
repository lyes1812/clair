import { isMonth } from '@/lib/connectors/months';
import { parseActualEvent, type ActualEvent, type ActualNonRecurring } from './non-recurring';
import type { RcPayslipPeriod, RcPayslipRecord } from './rc-payslips';

type DeclaredRow = ActualNonRecurring['rows'][number];
export type LiveNonRecurringRow = DeclaredRow & {
  resolvedFrom?: { kind: 'payfit-payslip'; payslipId: string };
};
export type LiveNonRecurringSourceRow = Readonly<{
  month: string;
  kind: 'rupture-conventionnelle';
  amount: number | null;
  reason: string | null;
  contractKey: string;
  payslipId: string;
}>;
export type LiveNonRecurringEntry = Readonly<{
  month: string;
  kind: ActualEvent['kind'];
  amount: number | null;
  reason: string | null;
  estimated: boolean;
}>;
export type LiveNonRecurring = Omit<ActualNonRecurring, 'rows'> & {
  rows: LiveNonRecurringRow[];
  sourceRows: readonly LiveNonRecurringSourceRow[];
  entries: readonly LiveNonRecurringEntry[];
  count: number;
};

// Contrat avec buildActualNonRecurring : seul ce motif exact permet de compléter une saisie vide.
// Une raison enrichie, une autre lecture, un doublon ou un filtre ne sont jamais assimilés à ce cas.
const MISSING_AMOUNT = 'Montant chargé non saisi ; saisir un montant ou un zéro explicite.';
const UNSAFE = 'Montant ou total hors des centimes entiers sûrs.';
const SOURCE_COST = 'Coût chargé de RC non confirmé par les bulletins ; aucun montant nominal utilisé comme coût chargé.';
const SOURCE_SCOPE = 'Le coût chargé des RC ne peut pas être rapproché du périmètre du journal réel ; aucun retraitement source.';
const CONFLICT = 'Coût chargé de RC différent entre la déclaration et le bulletin ; rapprocher les sources avant cumul.';
const AMBIGUOUS = 'Une RC déclarée sans contrat PayFit précis doit être rapprochée du bulletin avant cumul.';
const OVERLAP = 'Le coût de RC peut être déjà compris dans le tuilage calendaire de l’entrant ; rapprocher les composants avant cumul.';
const SERVICE = 'Les événements réalisés ne sont pas ventilés par service ; retirer le filtre de service pour lire le retraitement.';
const PERIOD = 'Périmètre des coûts de RC incohérent avec les mois affichés.';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const safe = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const integer = (value: bigint): number | null => value > MAX || value < -MAX ? null : Number(value) === 0 ? 0 : Number(value);
const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))];
const identity = (month: string, contractKey: string) => JSON.stringify([month, contractKey]);

function validChargedRecord(record: RcPayslipRecord): boolean {
  const cost = record.cost;
  return record.status === 'identified' && typeof record.pdfHash === 'string' && /^[a-f0-9]{64}$/.test(record.pdfHash)
    && safe(record.indemnityCents) && record.components.length > 0
    && record.components.every(part => safe(part.amountCents))
    && record.components.reduce((sum, part) => sum + BigInt(part.amountCents), 0n) === BigInt(record.indemnityCents)
    && cost?.status === 'value' && safe(cost.chargedCents) && safe(cost.employerChargesCents)
    && cost.components.length > 0 && cost.components.every(part => safe(part.amountCents))
    && cost.components.reduce((sum, part) => sum + BigInt(part.amountCents), 0n) === BigInt(cost.employerChargesCents)
    && BigInt(record.indemnityCents) + BigInt(cost.employerChargesCents) === BigInt(cost.chargedCents);
}

/** Résolution du réel courant uniquement. Les événements et les bases figées restent inchangés. */
export function resolveLiveNonRecurring({ declared, rcPeriod, months, syncId, serviceFiltered = false, sourceIncluded }: {
  declared: ActualNonRecurring;
  rcPeriod: RcPayslipPeriod;
  months: string[];
  syncId: string | null;
  serviceFiltered?: boolean;
  /** false si l'appelant ne peut pas rapprocher ces coûts du journal/grille ; true ne contourne aucun autre contrôle. */
  sourceIncluded?: boolean;
}): LiveNonRecurring {
  const rows: LiveNonRecurringRow[] = declared.rows.map(row => ({ ...row }));
  const sourceRows: LiveNonRecurringSourceRow[] = [];
  const extraReasons: string[] = [];
  let blocked = false;
  const validPeriod = months.length > 0 && months.every(isMonth) && new Set(months).size === months.length;
  if (!validPeriod) { blocked = true; extraReasons.push(PERIOD); }
  if (serviceFiltered) {
    blocked = true;
    extraReasons.push(SERVICE);
    for (const row of rows) { row.amount = null; row.reason = SERVICE; }
  }

  // buildRcPayslipPeriod a déjà vérifié lecture active, clôture et couverture complète.
  // Les périodes anciennes, partielles ou en cours ne complètent jamais les déclarations.
  if (validPeriod && syncId && !serviceFiltered && rcPeriod.status === 'value') {
    const records = rcPeriod.rows.filter(record => record.status === 'identified');
    const inPeriod = records.length > 0 && records.every(record => months.includes(record.month));
    if (!inPeriod) { blocked = true; extraReasons.push(PERIOD); }
    else {
      const byIdentity = new Map<string, RcPayslipRecord>();
      let duplicate = false;
      for (const record of records) {
        const key = identity(record.month, `payfit:${record.contractId}`);
        if (byIdentity.has(key)) duplicate = true;
        else byIdentity.set(key, record);
      }
      const chargedProof = !duplicate && rcPeriod.costStatus === 'value'
        && safe(rcPeriod.amountCents) && safe(rcPeriod.chargedCents) && safe(rcPeriod.employerChargesCents)
        && records.every(validChargedRecord)
        && records.reduce((sum, record) => sum + BigInt(record.indemnityCents!), 0n) === BigInt(rcPeriod.amountCents)
        && records.reduce((sum, record) => sum + BigInt(record.cost!.chargedCents!), 0n) === BigInt(rcPeriod.chargedCents)
        && records.reduce((sum, record) => sum + BigInt(record.cost!.employerChargesCents!), 0n) === BigInt(rcPeriod.employerChargesCents);
      const included = chargedProof && sourceIncluded !== false && safe(declared.raw) && rcPeriod.chargedCents! <= declared.raw;
      const unavailableReason = chargedProof && !included ? SOURCE_SCOPE : SOURCE_COST;
      if (!chargedProof) extraReasons.push(SOURCE_COST);
      if (chargedProof && !included) extraReasons.push(SOURCE_SCOPE);

      for (const record of byIdentity.values()) {
        const contractKey = `payfit:${record.contractId}`;
        const sameMonthRc = rows.filter(row => row.event.kind === 'rupture-conventionnelle' && row.event.month === record.month);
        const ambiguous = sameMonthRc.filter(row => row.event.contractKeys.length !== 1 || !row.event.contractKeys[0].startsWith('payfit:'));
        if (ambiguous.length) {
          for (const row of ambiguous) { row.amount = null; row.reason = AMBIGUOUS; }
          extraReasons.push(AMBIGUOUS);
          continue;
        }
        const matching = sameMonthRc.filter(row => row.event.contractKeys[0] === contractKey);
        const overlaps = rows.filter(row => row.event.kind === 'tuilage' && row.event.month === record.month
          && row.event.calculation?.incoming.contractKey === contractKey);
        if (overlaps.length) {
          for (const row of [...matching, ...overlaps]) { row.amount = null; row.reason = OVERLAP; }
          extraReasons.push(OVERLAP);
          if (!matching.length) sourceRows.push({ month: record.month, kind: 'rupture-conventionnelle', amount: null, reason: OVERLAP, contractKey, payslipId: record.payslipId });
          continue;
        }
        if (matching.length) {
          // Un doublon déclaré ou une référence périmée conserve son blocage historique.
          if (matching.length !== 1) continue;
          const row = matching[0];
          const event = parseActualEvent(row.event);
          if (!event || event.syncId.toLowerCase() !== syncId.toLowerCase()) continue;
          if (event.chargedCents !== null) {
            if (included && row.reason === null && row.amount !== record.cost!.chargedCents) {
              row.amount = null; row.reason = CONFLICT; extraReasons.push(CONFLICT);
            }
            continue;
          }
          if (included && row.reason === MISSING_AMOUNT) {
            row.amount = record.cost!.chargedCents;
            row.reason = null;
            row.resolvedFrom = { kind: 'payfit-payslip', payslipId: record.payslipId };
          }
          continue;
        }
        sourceRows.push({ month: record.month, kind: 'rupture-conventionnelle', amount: included ? record.cost!.chargedCents : null,
          reason: included ? null : unavailableReason, contractKey, payslipId: record.payslipId });
      }
    }
  }

  const entries: LiveNonRecurringEntry[] = [
    ...rows.map(row => ({ month: row.event.month, kind: row.event.kind, amount: row.amount, reason: row.reason, estimated: !!row.event.calculation })),
    ...sourceRows.map(row => ({ month: row.month, kind: row.kind, amount: row.amount, reason: row.reason, estimated: false })),
  ];
  const unsafeEntry = entries.some(entry => entry.amount !== null && !safe(entry.amount));
  const nonRecurring = blocked || unsafeEntry || entries.some(entry => entry.amount === null || entry.reason !== null) ? null
    : integer(entries.reduce((sum, entry) => sum + BigInt(entry.amount!), 0n));
  const raw = declared.raw !== null && !Number.isSafeInteger(declared.raw) ? null : declared.raw;
  const adjusted = raw === null || nonRecurring === null ? null : integer(BigInt(raw) - BigInt(nonRecurring));
  const inherited = declared.reasons.filter(reason => !declared.rows.some(row => row.reason === reason));
  const reasons = unique([...inherited, ...entries.map(entry => entry.reason), ...extraReasons,
    unsafeEntry || raw !== declared.raw || !blocked && entries.every(entry => entry.amount !== null && entry.reason === null) && nonRecurring === null
      || raw !== null && nonRecurring !== null && adjusted === null ? UNSAFE : null]);
  // Jamais de somme sur les champs chargés originaux : une résolution est une lecture, pas une modification de saisie.
  return { ...declared, rows, sourceRows, entries, count: entries.length, raw, nonRecurring, adjusted, reasons };
}
