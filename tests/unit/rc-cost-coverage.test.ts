import { describe, expect, it } from 'vitest';
import { rcCostsCoveredByPayroll } from '@/lib/payroll/rc-cost-coverage';
import { DEFAULT_PREFIXES } from '@/lib/payroll/grid';
import type { JournalInput } from '@/lib/payroll/engine';
import type { RcPayslipPeriod } from '@/lib/payroll/rc-payslips';

const input = (): JournalInput => ({ months: ['2026-02'], openMonths: [], grid: structuredClone(DEFAULT_PREFIXES), lines: [
  { key: 'fictif-brut', month: '2026-02', accountId: '6411', accountName: null, debitCents: 500000, creditCents: 0, contractId: 'fictif-a' },
  { key: 'fictif-charges', month: '2026-02', accountId: '6451', accountName: null, debitCents: 130000, creditCents: 0, contractId: 'fictif-a' },
] });
const period = (): RcPayslipPeriod => ({ status: 'value', amountCents: 200000, identifiedCount: 1, mergedCount: 1, reviewCount: 0, reason: null,
  costStatus: 'value', chargedCents: 270000, employerChargesCents: 70000, rows: [{ month: '2026-02', collaboratorId: 'fictif-personne', contractId: 'fictif-a', payslipId: 'fictif-bulletin', pdfHash: 'a'.repeat(64), parserVersion: 'fictif', status: 'identified', code: 'explicit-rc-amount', indemnityCents: 200000, components: [{ label: 'Indemnité fictive', amountCents: 200000, page: 1, line: 4 }], cost: { status: 'value', code: 'fictif', chargedCents: 270000, employerChargesCents: 70000, components: [{ label: 'Charge fictive', amountCents: 70000, page: 1, line: 5 }] } }],
});

describe('Périmètre des coûts RC dans le journal fictif', () => {
  it('exige le même contrat, le mois clos et les rubriques brut et cotisations sans modifier la source', () => {
    const source = input(), rc = period(), before = JSON.stringify([source, rc]);
    expect(rcCostsCoveredByPayroll(source, rc)).toBe(true);
    expect(JSON.stringify([source, rc])).toBe(before);
    source.lines[0].contractId = 'autre-fictif';
    expect(rcCostsCoveredByPayroll(source, rc)).toBe(false);
  });
  it('ne rattache pas des lignes globales ni des montants supérieurs au coût du contrat', () => {
    const source = input(); source.lines[1].contractId = null;
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
    source.lines[1].contractId = 'fictif-a'; source.lines[1].debitCents = 100;
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
  });
  it('refuse le service, la paie ouverte, les doublons et les comptes de paie non classés', () => {
    const source = input(); source.serviceFilter = { value: 'fictif' };
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
    delete source.serviceFilter; source.openMonths = ['2026-02'];
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
    source.openMonths = []; source.lines.push({ ...source.lines[0] });
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
    source.lines.pop(); source.lines.push({ ...source.lines[0], key: 'non-classe', accountId: '649999' });
    expect(rcCostsCoveredByPayroll(source, period())).toBe(false);
  });
  it('ne transforme pas un nominal seul ou une charge inconnue en preuve chargée', () => {
    const rc = period(); rc.costStatus = 'review';
    expect(rcCostsCoveredByPayroll(input(), rc)).toBe(false);
    rc.costStatus = 'value'; delete rc.rows[0].cost;
    expect(rcCostsCoveredByPayroll(input(), rc)).toBe(false);
  });
});
