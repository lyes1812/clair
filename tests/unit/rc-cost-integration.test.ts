import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFIXES } from '@/lib/payroll/grid';
import type { JournalInput } from '@/lib/payroll/engine';
import { buildActualNonRecurring, type ActualEvent } from '@/lib/payroll/non-recurring';
import { buildRcPayslipPeriod, type RcPayslipScan } from '@/lib/payroll/rc-payslips';
import { resolveLiveNonRecurring } from '@/lib/payroll/live-non-recurring';
import { rcCostsCoveredByPayroll } from '@/lib/payroll/rc-cost-coverage';
import { buildActualNonRecurringChart } from '@/lib/viz/actual-non-recurring';
import { actualNonRecurringSheet } from '@/lib/payroll/non-recurring-export';
import { ActualNonRecurring } from '@/app/e/[slug]/studio-rh/masse-salariale/ActualNonRecurring';
import { ActualNonRecurringSummary } from '@/components/ActualNonRecurringSummary';

const SYNC = '11111111-1111-4111-8111-111111111111';
const months = ['2026-02'];
const journal = (): JournalInput => ({ months, openMonths: [], grid: structuredClone(DEFAULT_PREFIXES), lines: [
  { key: 'ligne-fictive-brut', month: months[0], accountId: '6411', accountName: null, debitCents: 500000, creditCents: 0, contractId: 'contrat-prive-fictif' },
  { key: 'ligne-fictive-charges', month: months[0], accountId: '6451', accountName: null, debitCents: 130000, creditCents: 0, contractId: 'contrat-prive-fictif' },
] });
const events = (): ActualEvent[] => [
  { id: '22222222-2222-4222-8222-222222222222', syncId: SYNC, month: months[0], kind: 'rupture-conventionnelle', chargedCents: null, contractKeys: ['payfit:contrat-prive-fictif'], note: 'justificatif-prive-fictif' },
  { id: '33333333-3333-4333-8333-333333333333', syncId: SYNC, month: months[0], kind: 'autre', chargedCents: 10000, contractKeys: [], note: 'autre-justificatif-prive-fictif' },
];
const scan = (): RcPayslipScan => ({ version: 1, id: '44444444-4444-4444-8444-444444444444', payrollSyncId: SYNC, companyId: 'societe-fictive', from: months[0], to: months[0], status: 'complete', startedAt: '2026-03-01T09:00:00.000Z', finishedAt: '2026-03-01T09:01:00.000Z', closedMonths: months, unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 1, issues: [], records: [{ month: months[0], collaboratorId: 'personne-privee-fictive', contractId: 'contrat-prive-fictif', payslipId: 'bulletin-prive-fictif', pdfHash: 'a'.repeat(64), parserVersion: 'fictif-v4', status: 'identified', code: 'explicit-rc-amount', indemnityCents: 200000, components: [{ label: 'Indemnité RC fictive', amountCents: 200000, page: 1, line: 8 }], cost: { status: 'value', code: 'explicit-employer-rc-cost', employerChargesCents: 70000, chargedCents: 270000, components: [{ label: 'Contribution RC fictive', amountCents: 70000, page: 1, line: 6 }] } }] });

describe('Coût RC fictif : un seul montant entre synthèse, détail, graphique et Excel', () => {
  it('résout une saisie vide sans doublon et conserve le journal et les déclarations', () => {
    const input = journal(), declared = events(), reading = scan(), before = JSON.stringify([input, declared, reading]);
    const period = buildRcPayslipPeriod(reading, months, SYNC, declared);
    const live = resolveLiveNonRecurring({ declared: buildActualNonRecurring(input, declared, months, SYNC), rcPeriod: period, months, syncId: SYNC, sourceIncluded: rcCostsCoveredByPayroll(input, period) });
    expect(live).toMatchObject({ count: 2, nonRecurring: 280000, adjusted: 350000 });
    expect(live.rows[0].event.chargedCents).toBeNull();
    const chart = buildActualNonRecurringChart(input, declared, months, SYNC, reading);
    expect(chart).toMatchObject({ total: 280000, count: 2, points: [{ month: months[0], amount: 280000, count: 2, reason: null }] });
    expect(chart.rows.find(row => row.kind === 'rupture-conventionnelle')).toMatchObject({ amount: 270000, count: 1 });
    const sheet = actualNonRecurringSheet(input, declared, months, SYNC, reading);
    expect(sheet.rows[1]).toEqual(['Ruptures conventionnelles', 1, 270000, 270000, expect.any(String)]);
    const card = renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: live.rows, live, rc: period, href: '/fictif' }));
    expect(card).toContain('data-money-cents="270000"');
    expect(card).toContain('data-money-cents="200000"');
    const detail = renderToStaticMarkup(createElement(ActualNonRecurring, { slug: 'fictif', input, events: declared, months, syncId: SYNC, rcPeriod: period, contracts: [], editable: false }));
    expect(detail).toContain('data-money-cents="280000"');
    expect(detail).toContain('data-money-cents="350000"');
    expect(JSON.stringify([chart, sheet, card])).not.toMatch(/personne-privee|contrat-prive|bulletin-prive|justificatif-prive/);
    expect(JSON.stringify([input, declared, reading])).toBe(before);
  });
  it('garde le nominal visible mais bloque le total chargé si la lecture ne contient pas les charges', () => {
    const input = journal(), declared = events(), reading = scan(); delete reading.records[0].cost;
    const period = buildRcPayslipPeriod(reading, months, SYNC, declared);
    const live = resolveLiveNonRecurring({ declared: buildActualNonRecurring(input, declared, months, SYNC), rcPeriod: period, months, syncId: SYNC, sourceIncluded: rcCostsCoveredByPayroll(input, period) });
    expect(live.nonRecurring).toBeNull();
    expect(buildActualNonRecurringChart(input, declared, months, SYNC, reading).total).toBeNull();
    const card = renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: live.rows, live, rc: period, href: '/fictif' }));
    expect(card).toContain('data-money-cents="200000"');
    expect(card).not.toContain('data-money-cents="270000"');
  });
  it('n’emprunte pas le coût du journal d’un autre contrat pour compléter la vignette', () => {
    const input = journal(); input.lines.forEach(line => { line.contractId = 'autre-contrat-fictif'; });
    expect(buildActualNonRecurringChart(input, events(), months, SYNC, scan()).total).toBeNull();
    const sheet = actualNonRecurringSheet(input, events(), months, SYNC, scan());
    expect(sheet.rows[1][3]).toMatchObject({ nd: expect.any(String) });
  });
});
