import { describe, expect, it, vi } from 'vitest';
import { readRcCollaborator, type RcReadDependencies } from '@/lib/payroll/rc-payslips-reader';
import { ProviderError } from '@/lib/connectors/http';
import type { PayFitClient } from '@/lib/connectors/payfit/client';

const client = {} as PayFitClient;
const slip = (month = '2026-02', payslipId = 'pdf-fictif') => ({ month, payslipId, contractId: 'contrat-fictif' });
const deps = (patch: Partial<RcReadDependencies> = {}): RcReadDependencies => ({
  list: vi.fn().mockResolvedValue([slip()]),
  fetch: vi.fn().mockResolvedValue(new Uint8Array([37,80,68,70,45,49])),
  extract: vi.fn().mockResolvedValue({ status: 'identified', code: 'identified', parserVersion: 'rc-v1', indemnityCents: 125000, components: [{ label: 'Indemnité de rupture conventionnelle', amountCents: 125000, page: 1, line: 8 }] }),
  ...patch,
});

describe('Lecture RC par collaborateur — données fictives', () => {
  it('ne télécharge que les mois explicitement clôturés', async () => {
    const d = deps({ list: vi.fn().mockResolvedValue([slip('2025-01','ancien'),slip(),slip('2026-03','ouvert')]) });
    const result = await readRcCollaborator(client, 'societe-fictive', 'personne-fictive', ['2026-02'], d);
    expect(d.fetch).toHaveBeenCalledExactlyOnceWith(client, 'societe-fictive', 'personne-fictive', 'contrat-fictif', 'pdf-fictif');
    expect(result.checkedPayslips).toBe(1);
    expect(result.records[0]).toMatchObject({ month: '2026-02', indemnityCents: 125000, status: 'identified', pdfHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.records[0]).not.toHaveProperty('chargedCents');
  });
  it('ne choisit ni ne somme deux bulletins distincts du même contrat et mois', async () => {
    const d = deps({ list: vi.fn().mockResolvedValue([slip(),slip('2026-02','rectificatif')]) });
    const result = await readRcCollaborator(client,'societe','personne',['2026-02'],d);
    expect(result.records).toHaveLength(2);
    expect(result.records.every(r=>r.status==='review' && r.indemnityCents===null && r.code==='multiple-payslips')).toBe(true);
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('la relance est déterministe sans texte de bulletin ou coût reconstitué', async () => {
    const d=deps();
    const first=await readRcCollaborator(client,'societe','personne',['2026-02'],d);
    const second=await readRcCollaborator(client,'societe','personne',['2026-02'],d);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toMatch(/chargedCents|pdfBytes|fullText|employeeName/);
  });
  it('un échec PDF générique devient une vigilance sans transmettre le message sensible', async () => {
    const d=deps({fetch:vi.fn().mockRejectedValue(new Error('NOM_SECRET_DANS_PDF'))});
    const result=await readRcCollaborator(client,'societe','personne',['2026-02'],d);
    expect(result.records[0]).toMatchObject({status:'review',code:'pdf-unavailable',indemnityCents:null});
    expect(JSON.stringify(result)).not.toContain('NOM_SECRET');
  });
  it.each(['scope_denied','key_rejected','rate_limited'] as const)('arrête une lecture refusée (%s)', async code=>{
    await expect(readRcCollaborator(client,'societe','personne',['2026-02'],deps({fetch:vi.fn().mockRejectedValue(new ProviderError(code))}))).rejects.toMatchObject({code});
  });
  it('maintient le bail avant chaque bulletin sans payload client', async()=>{
    const heartbeat=vi.fn().mockResolvedValue(undefined);
    await readRcCollaborator(client,'societe','personne',['2026-02'],deps(),heartbeat);
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith();
  });
});
