import { classify, gridRubrics } from './grid';
import { monthPayroll, type JournalInput } from './engine';
import type { RcPayslipPeriod } from './rc-payslips';

/** Vérifie l’attribution et les bornes dans le périmètre du journal ; ne reconstitue aucune cotisation. */
export function rcCostsCoveredByPayroll(input: JournalInput | null, period: RcPayslipPeriod): boolean {
  if (!input || input.serviceFilter || period.status !== 'value' || period.costStatus !== 'value' || !period.rows.length) return false;
  const rubrics = gridRubrics(input.grid);
  const seen = new Set<string>();
  for (const record of period.rows) {
    const key = JSON.stringify([record.month, record.contractId]);
    if (seen.has(key) || record.status !== 'identified' || record.cost?.status !== 'value' || record.indemnityCents === null
      || record.cost.employerChargesCents === null || record.cost.chargedCents === null || input.openMonths.includes(record.month)
      || monthPayroll(input, record.month).kind !== 'value') return false;
    seen.add(key);
    let gross = 0n, charges = 0n, grossLines = 0, chargeLines = 0;
    const lineKeys = new Set<string>();
    for (const line of input.lines.filter((line) => line.month === record.month)) {
      if (lineKeys.has(line.key)) return false;
      lineKeys.add(line.key);
      const classification = classify(line.accountId, rubrics);
      if (!classification.rubric && classification.payroll && (!line.contractId || line.contractId === record.contractId)) return false;
      const role = classification.rubric?.role;
      if (role !== 'brut' && role !== 'cotisations') continue;
      if (!line.contractId) return false;
      if (line.contractId !== record.contractId) continue;
      if (line.debitCents === null && line.creditCents === null
        || line.debitCents !== null && !Number.isSafeInteger(line.debitCents)
        || line.creditCents !== null && !Number.isSafeInteger(line.creditCents)) return false;
      const value = BigInt(line.debitCents ?? 0) - BigInt(line.creditCents ?? 0);
      if (role === 'brut') { gross += value; grossLines++; } else { charges += value; chargeLines++; }
    }
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (!grossLines || !chargeLines || gross < BigInt(record.indemnityCents) || charges < BigInt(record.cost.employerChargesCents)
      || gross + charges < BigInt(record.cost.chargedCents) || gross > max || charges > max || gross + charges > max) return false;
  }
  return true;
}
