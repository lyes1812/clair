import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({auth:vi.fn(),start:vi.fn(),resume:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/workspace',()=>({requireWorkspace:mock.auth}));
vi.mock('@/lib/payroll/rc-payslips-store',()=>({startRcPayslipScan:mock.start,resumeRcPayslipScan:mock.resume,RcPayslipError:class extends Error{}}));
vi.mock('next/cache',()=>({revalidatePath:mock.refresh}));
import { launchRcPayslips, resumeRcPayslips } from '@/app/e/[slug]/donnees/rc-actions';
const form=()=>{let f=new FormData();f.set('from','2025-01');f.set('to','2026-11');return f};
beforeEach(()=>{vi.resetAllMocks();mock.auth.mockResolvedValue({workspace:{id:'espace-fictif'},session:{user:{id:'editeur-fictif'}}});});
describe('Autorité et confidentialité de la lecture RC',()=>{
  it('un lecteur est refusé avant toute requête fournisseur',async()=>{
    mock.auth.mockRejectedValue(new Error('404'));
    await expect(launchRcPayslips('fictif',undefined,form())).rejects.toThrow('404');
    expect(mock.auth).toHaveBeenCalledWith('fictif','editor');expect(mock.start).not.toHaveBeenCalled();
  });
  it('utilise seulement l’espace et l’acteur authentifiés et rafraîchit les écrans',async()=>{
    expect((await launchRcPayslips('fictif',undefined,form()))?.ok).toBeTruthy();
    expect(mock.start).toHaveBeenCalledExactlyOnceWith('espace-fictif','editeur-fictif','2025-01','2026-11');
    expect(mock.refresh).toHaveBeenCalledWith('/e/fictif/studio-rh','layout');
  });
  it('ne renvoie aucun message PDF brut au navigateur',async()=>{
    mock.start.mockRejectedValue(new Error('CONFIDENTIEL_PDF_SOURCE'));
    const result=await launchRcPayslips('fictif',undefined,form());
    expect(result?.error).toContain('indisponible');expect(JSON.stringify(result)).not.toContain('CONFIDENTIEL');
  });
  it('la reprise requiert le rôle éditeur et reste dans le même espace',async()=>{
    await resumeRcPayslips('fictif',undefined);
    expect(mock.auth).toHaveBeenCalledWith('fictif','editor');expect(mock.resume).toHaveBeenCalledExactlyOnceWith('espace-fictif');
  });
});
