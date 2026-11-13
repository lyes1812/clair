import { describe, expect, it } from 'vitest';
import { buildActualNonRecurring, type ActualEvent } from '@/lib/payroll/non-recurring';
import { resolveLiveNonRecurring } from '@/lib/payroll/live-non-recurring';
import { buildRcPayslipPeriod, type RcPayslipCost, type RcPayslipRecord, type RcPayslipScan } from '@/lib/payroll/rc-payslips';
import { estimateActualOverlap } from '@/lib/payroll/actual-overlap';
import type { JournalInput } from '@/lib/payroll/engine';
import { DEFAULT_PREFIXES } from '@/lib/payroll/grid';

const SYNC = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const MONTHS = ['2026-02'];
const id = (value: number) => `33333333-3333-4333-8333-${String(value).padStart(12, '0')}`;
const journal = (): JournalInput => ({ grid: DEFAULT_PREFIXES, months: MONTHS, openMonths: [], lines: [
  { key: 'salaire-fictif', month: MONTHS[0], accountId: '6411', accountName: 'Salaire fictif', debitCents: 700_000, creditCents: 0, contractId: 'RC_FICTIVE' },
  { key: 'charges-fictives', month: MONTHS[0], accountId: '6451', accountName: 'Charges fictives', debitCents: 300_000, creditCents: 0, contractId: 'RC_FICTIVE' },
] });
const event = (patch: Partial<ActualEvent> = {}): ActualEvent => ({ id: id(1), syncId: SYNC, month: MONTHS[0], kind: 'rupture-conventionnelle', chargedCents: null, contractKeys: ['payfit:RC_FICTIVE'], note: 'JUSTIFICATIF_PRIVE_FICTIF', ...patch });
const charge = (patch: Partial<RcPayslipCost> = {}): RcPayslipCost => ({ status: 'value', code: 'explicit-rc-cost', chargedCents: 130_000, employerChargesCents: 30_000,
  components: [{ label: 'Contribution patronale propre à la RC fictive', amountCents: 30_000, page: 1, line: 8 }], ...patch });
const record = (patch: Partial<RcPayslipRecord> = {}): RcPayslipRecord => ({ month: MONTHS[0], collaboratorId: 'PERSONNE_FICTIVE', contractId: 'RC_FICTIVE', payslipId: 'PDF_FICTIF', pdfHash: 'a'.repeat(64), parserVersion: 'fictif-v1', status: 'identified', code: 'explicit-rc-amount', indemnityCents: 100_000,
  components: [{ label: 'Indemnité de rupture conventionnelle fictive', amountCents: 100_000, page: 1, line: 6 }], cost: charge(), ...patch });
const scan = (patch: Partial<RcPayslipScan> = {}): RcPayslipScan => ({ version: 1, id: '44444444-4444-4444-8444-444444444444', payrollSyncId: SYNC, companyId: 'SOCIETE_FICTIVE', from: MONTHS[0], to: MONTHS[0], status: 'complete', startedAt: '2026-03-01T08:00:00.000Z', finishedAt: '2026-03-01T08:02:00.000Z', closedMonths: MONTHS, unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 1, records: [record()], issues: [], ...patch });
const period = (records = [record()], events: ActualEvent[] = []) => buildRcPayslipPeriod(scan({ records }), MONTHS, SYNC, events);
const declared = (events: ActualEvent[] = [], input: JournalInput | null = journal()) => buildActualNonRecurring(input, events, MONTHS, SYNC);
const resolve = (events: ActualEvent[] = []) => resolveLiveNonRecurring({ declared: declared(events), rcPeriod: period(undefined, events), months: MONTHS, syncId: SYNC });

describe('Non récurrents du réel courant : rapprochement des coûts RC sourcés', () => {
  it('complète seulement le montant lu, sans réécrire la déclaration ni lui ajouter une seconde RC', () => {
    const events = [event(), event({ id: id(2), kind: 'autre', chargedCents: 5_000, contractKeys: [] })];
    const original = declared(events), rc = period(undefined, events);
    const before = JSON.stringify({ original, rc });
    const model = resolveLiveNonRecurring({ declared: original, rcPeriod: rc, months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ count: 2, raw: 1_000_000, nonRecurring: 135_000, adjusted: 865_000, sourceRows: [], reasons: [] });
    expect(model.rows[0]).toMatchObject({ event: { chargedCents: null }, amount: 130_000, reason: null, resolvedFrom: { kind: 'payfit-payslip', payslipId: 'PDF_FICTIF' } });
    expect(JSON.stringify({ original, rc })).toBe(before);
    expect(JSON.stringify(model.entries)).not.toMatch(/JUSTIFICATIF|PERSONNE|PDF_FICTIF|payfit:|33333333/);
  });

  it('expose une source seule en lecture seule, sans inventer un événement ou un identifiant de saisie', () => {
    const events = [event({ kind: 'autre', chargedCents: 5_000, contractKeys: [] })];
    const model = resolve(events);
    expect(model).toMatchObject({ count: 2, nonRecurring: 135_000, adjusted: 865_000 });
    expect(model.rows).toHaveLength(1);
    expect(model.sourceRows).toEqual([{ month: '2026-02', kind: 'rupture-conventionnelle', amount: 130_000, reason: null, contractKey: 'payfit:RC_FICTIVE', payslipId: 'PDF_FICTIF' }]);
    expect(model.sourceRows[0]).not.toHaveProperty('event');
    expect(model.sourceRows[0]).not.toHaveProperty('id');
  });

  it('un montant manuel concordant reste saisi une seule fois', () => {
    const value = event({ chargedCents: 130_000 });
    const model = resolve([value]);
    expect(model).toMatchObject({ count: 1, nonRecurring: 130_000, adjusted: 870_000, sourceRows: [] });
    expect(model.rows[0].event).toBe(value);
    expect(model.rows[0]).not.toHaveProperty('resolvedFrom');
  });

  it.each([120_000, 0])('un coût manuel divergent (%s) est conservé dans la saisie et bloque le cumul', (chargedCents) => {
    const value = event({ chargedCents });
    const model = resolve([value]);
    expect(model).toMatchObject({ count: 1, nonRecurring: null, adjusted: null, sourceRows: [] });
    expect(model.rows[0]).toMatchObject({ event: { chargedCents }, amount: null, reason: expect.stringContaining('différent') });
    expect(value.chargedCents).toBe(chargedCents);
  });

  it('zéro explicite concordant reste zéro, sans montant ou taux reconstruit', () => {
    const zero = record({ indemnityCents: 0, components: [{ label: 'RC fictive nulle', amountCents: 0, page: 1, line: 6 }], cost: charge({ chargedCents: 0, employerChargesCents: 0, components: [{ label: 'Contribution RC fictive nulle', amountCents: 0, page: 1, line: 8 }] }) });
    const value = event({ chargedCents: 0 });
    const model = resolveLiveNonRecurring({ declared: declared([value]), rcPeriod: period([zero], [value]), months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ nonRecurring: 0, adjusted: 1_000_000, count: 1, sourceRows: [] });
    expect(model.rows[0].event.chargedCents).toBe(0);
  });

  it('un nominal seul ne devient jamais un coût chargé, avec ou sans déclaration', () => {
    const rc = period([record({ cost: undefined })]);
    expect(rc).toMatchObject({ status: 'value', amountCents: 100_000, chargedCents: null });
    const matching = resolveLiveNonRecurring({ declared: declared([event()]), rcPeriod: rc, months: MONTHS, syncId: SYNC });
    expect(matching).toMatchObject({ nonRecurring: null, adjusted: null, sourceRows: [] });
    expect(matching.rows[0]).not.toHaveProperty('resolvedFrom');
    const sourceOnly = resolveLiveNonRecurring({ declared: declared(), rcPeriod: rc, months: MONTHS, syncId: SYNC });
    expect(sourceOnly).toMatchObject({ nonRecurring: null, adjusted: null, count: 1, sourceRows: [{ amount: null, reason: expect.stringContaining('nominal') }] });
  });

  it('un coût source corrompu reste à vérifier sans effacer le nominal connu', () => {
    const rc = period([record({ cost: charge({ chargedCents: 1 }) })]);
    expect(rc).toMatchObject({ status: 'value', amountCents: 100_000, costStatus: 'review' });
    const model = resolveLiveNonRecurring({ declared: declared([event()]), rcPeriod: rc, months: MONTHS, syncId: SYNC });
    expect(model.nonRecurring).toBeNull();
    expect(model.rows[0].amount).toBeNull();
    expect(rc.amountCents).toBe(100_000);
  });

  it('une paie incomplète, une source non rapprochée ou un coût supérieur au réel ne sont pas isolés', () => {
    for (const original of [declared([], null), { ...declared(), raw: 100_000, adjusted: 100_000 }]) {
      const model = resolveLiveNonRecurring({ declared: original, rcPeriod: period(), months: MONTHS, syncId: SYNC });
      expect(model).toMatchObject({ nonRecurring: null, adjusted: null, sourceRows: [{ amount: null, reason: expect.stringContaining('périmètre du journal') }] });
    }
    const included = resolveLiveNonRecurring({ declared: declared([event()]), rcPeriod: period(), months: MONTHS, syncId: SYNC, sourceIncluded: false });
    expect(included.nonRecurring).toBeNull();
    expect(included.rows[0]).not.toHaveProperty('resolvedFrom');
  });

  it('aucun report sur une déclaration ancienne, une source ancienne, partielle ou en cours', () => {
    const oldEvent = event({ syncId: OLD });
    expect(resolve([oldEvent]).rows[0]).toMatchObject({ amount: null, reason: expect.stringContaining('autre lecture') });
    for (const patch of [{ payrollSyncId: OLD }, { status: 'partial' as const }, { status: 'running' as const, finishedAt: null }]) {
      const rc = buildRcPayslipPeriod(scan(patch), MONTHS, SYNC);
      const model = resolveLiveNonRecurring({ declared: declared([event()]), rcPeriod: rc, months: MONTHS, syncId: SYNC });
      expect(model).toMatchObject({ nonRecurring: null, sourceRows: [] });
      expect(model.rows[0]).not.toHaveProperty('resolvedFrom');
    }
  });

  it('la portée Service reste bloquante même si un modèle global est fourni', () => {
    const model = resolveLiveNonRecurring({ declared: declared([event({ chargedCents: 130_000 })]), rcPeriod: period(), months: MONTHS, syncId: SYNC, serviceFiltered: true });
    expect(model).toMatchObject({ nonRecurring: null, adjusted: null, sourceRows: [], rows: [{ amount: null, reason: expect.stringContaining('service') }] });
  });

  it('ne résout ni doublon déclaré ni déclaration sans contrat précis', () => {
    const duplicated = resolve([event(), event({ id: id(2) })]);
    expect(duplicated).toMatchObject({ nonRecurring: null, sourceRows: [], count: 2 });
    expect(duplicated.rows.every(row => row.reason?.includes('doublon'))).toBe(true);
    const unknown = event({ contractKeys: [] });
    const model = resolveLiveNonRecurring({ declared: declared([unknown]), rcPeriod: period(), months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ nonRecurring: null, sourceRows: [], count: 1, rows: [{ amount: null, reason: expect.stringContaining('sans contrat') }] });
  });

  it('un doublon de source ne produit ni deuxième ligne ni somme chargée', () => {
    const valid = period();
    const rc = { ...valid, rows: [...valid.rows, ...valid.rows] };
    const model = resolveLiveNonRecurring({ declared: declared(), rcPeriod: rc, months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ nonRecurring: null, adjusted: null, count: 1, sourceRows: [{ amount: null }] });
  });

  it('seul le motif exact de montant absent autorise la résolution', () => {
    const original = declared([event()]);
    expect(original.rows[0].reason).toBe('Montant chargé non saisi ; saisir un montant ou un zéro explicite.');
    const reason = `${original.rows[0].reason} Autre contrôle non résolu.`;
    const model = resolveLiveNonRecurring({ declared: { ...original, rows: [{ ...original.rows[0], reason }], reasons: [reason] }, rcPeriod: period(), months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ nonRecurring: null, rows: [{ amount: null, reason }] });
    expect(model.rows[0]).not.toHaveProperty('resolvedFrom');
  });

  it('un tuilage calendaire du même entrant/mois ne cumule pas une RC déjà comprise dans son coût', () => {
    const estimate = estimateActualOverlap({ month: MONTHS[0], syncId: SYNC,
      incoming: { contractKey: 'payfit:RC_FICTIVE', syncId: SYNC, startDate: '2026-02-01', endDate: null },
      outgoing: { contractKey: 'payfit:SORTANT_FICTIF', syncId: SYNC, startDate: '2025-01-01', endDate: '2026-02-14' },
      payroll: { contractKey: 'payfit:RC_FICTIVE', syncId: SYNC, month: MONTHS[0], chargedCents: 200_000, lineKeys: ['paie-fictive-entrant'] } });
    if (estimate.kind !== 'value') throw new Error('Fixture de tuilage invalide');
    const overlap = event({ id: id(2), kind: 'tuilage', chargedCents: estimate.amountCents, contractKeys: ['payfit:RC_FICTIVE', 'payfit:SORTANT_FICTIF'], calculation: estimate.calculation });
    const model = resolve([event(), overlap]);
    expect(model).toMatchObject({ count: 2, nonRecurring: null, adjusted: null, sourceRows: [] });
    expect(model.rows.every(row => row.amount === null && row.reason?.includes('tuilage'))).toBe(true);
    expect(overlap.chargedCents).toBe(100_000);
    const withoutManualRc = resolve([overlap]);
    expect(withoutManualRc).toMatchObject({ nonRecurring: null, count: 2, sourceRows: [{ amount: null, reason: expect.stringContaining('tuilage') }] });
  });

  it('la RC du sortant peut être isolée avec le coût calendaire de l’entrant distinct', () => {
    const estimate = estimateActualOverlap({ month: MONTHS[0], syncId: SYNC,
      incoming: { contractKey: 'payfit:ENTRANT_FICTIF', syncId: SYNC, startDate: '2026-02-01', endDate: null },
      outgoing: { contractKey: 'payfit:RC_FICTIVE', syncId: SYNC, startDate: '2025-01-01', endDate: '2026-02-14' },
      payroll: { contractKey: 'payfit:ENTRANT_FICTIF', syncId: SYNC, month: MONTHS[0], chargedCents: 200_000, lineKeys: ['paie-autre-entrant-fictif'] } });
    if (estimate.kind !== 'value') throw new Error('Fixture de tuilage invalide');
    const overlap = event({ kind: 'tuilage', chargedCents: estimate.amountCents, contractKeys: ['payfit:ENTRANT_FICTIF', 'payfit:RC_FICTIVE'], calculation: estimate.calculation });
    expect(resolve([overlap])).toMatchObject({ count: 2, nonRecurring: 230_000, adjusted: 770_000, sourceRows: [{ amount: 130_000, reason: null }] });
  });

  it('sans source, conserve le modèle historique et ses contrôles de sommes entières', () => {
    const events = Array.from({ length: 100 }, (_, index) => event({ id: id(index + 1), kind: 'autre', chargedCents: 100_000_000_000_000, contractKeys: [`fictif-${index}`] }));
    const original = declared(events);
    expect(original.nonRecurring).toBeNull();
    const model = resolveLiveNonRecurring({ declared: original, rcPeriod: buildRcPayslipPeriod(null, MONTHS, SYNC), months: MONTHS, syncId: SYNC });
    expect(model).toMatchObject({ raw: original.raw, nonRecurring: null, adjusted: null, count: 100, sourceRows: [] });
    expect(model.reasons).toContain('Montant ou total hors des centimes entiers sûrs.');
  });

  it('rejette une période vide ou une preuve d’un autre mois avant toute somme source', () => {
    const bad = resolveLiveNonRecurring({ declared: declared(), rcPeriod: period(), months: [], syncId: SYNC });
    expect(bad).toMatchObject({ nonRecurring: null, adjusted: null, sourceRows: [] });
    const other = resolveLiveNonRecurring({ declared: declared(), rcPeriod: period(), months: ['2026-01'], syncId: SYNC });
    expect(other).toMatchObject({ nonRecurring: null, adjusted: null, sourceRows: [] });
  });
});
