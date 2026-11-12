import { ProviderError } from '@/lib/connectors/http';
import { isMonth } from '@/lib/connectors/months';
import type { PayFitClient } from '@/lib/connectors/payfit/client';
import { listPayFitPayslips, fetchPayFitPayslip } from '@/lib/connectors/payfit/payslips';
import { sha256 } from '@/lib/crypto';
import { extractRcPayslip } from './rc-payslip-parser';
import type { RcPayslipRecord } from './rc-payslips';

export type RcReadDependencies = {
  list: typeof listPayFitPayslips;
  fetch: typeof fetchPayFitPayslip;
  extract: typeof extractRcPayslip;
};
const defaults: RcReadDependencies = { list: listPayFitPayslips, fetch: fetchPayFitPayslip, extract: extractRcPayslip };

/** Une personne, exclusivement les mois explicitement clôturés. Aucun PDF ou texte libre n’est conservé. */
export async function readRcCollaborator(client: PayFitClient, companyId: string, collaboratorId: string, closedMonths: string[], deps: RcReadDependencies = defaults, heartbeat: () => Promise<void> = async () => {}) {
  if (closedMonths.some(month => !isMonth(month)) || new Set(closedMonths).size !== closedMonths.length) throw new ProviderError('invalid_response', 'période de bulletins');
  const wanted = new Set(closedMonths);
  const list = (await deps.list(client, companyId, collaboratorId)).filter(p => wanted.has(p.month));
  const groups = new Map<string, typeof list>();
  for (const item of list) {
    const key = `${item.month}:${item.contractId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const records: RcPayslipRecord[] = [];
  let checkedPayslips = 0;
  for (const group of groups.values()) {
    await heartbeat();
    // L’API ne documente aucun ordre de priorité des bulletins rectificatifs.
    if (group.length > 1) {
      for (const p of group) records.push({ ...p, collaboratorId, pdfHash: null, parserVersion: 'rc-v1', status: 'review', code: 'multiple-payslips', indemnityCents: null, components: [] });
      continue;
    }
    const p = group[0];
    try {
      const bytes = await deps.fetch(client, companyId, collaboratorId, p.contractId, p.payslipId);
      const pdfHash = sha256(Buffer.from(bytes));
      const extraction = await deps.extract(bytes);
      checkedPayslips++;
      records.push({ ...p, collaboratorId, pdfHash, ...extraction });
    } catch (error) {
      if (error instanceof ProviderError && ['key_rejected', 'scope_denied', 'rate_limited'].includes(error.code)) throw error;
      records.push({ ...p, collaboratorId, pdfHash: null, parserVersion: 'rc-v1', status: 'review', code: error instanceof ProviderError ? `pdf-${error.code}` : 'pdf-unavailable', indemnityCents: null, components: [] });
    }
  }
  return { records, checkedPayslips };
}
