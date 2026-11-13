import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),get:vi.fn(),save:vi.fn(),active:vi.fn(),absenceTypes:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/workspace',()=>({requireWorkspace:mocks.auth}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
vi.mock('@/lib/rh-kpi-settings',async original=>({...await original<typeof import('@/lib/rh-kpi-settings')>(),getKpiSettings:mocks.get,setKpiSettings:mocks.save}));
vi.mock('@/lib/rh/referential/store',async original=>({...await original<typeof import('@/lib/rh/referential/store')>(),activePayFitSync:mocks.active,loadAbsenceTypes:mocks.absenceTypes}));
import {saveKpiSettings} from '@/app/e/[slug]/parametres/actions';
import {KPI_DEFAULTS} from '@/lib/rh-kpi-settings';
const form=(population?:string)=>{const f=new FormData();Object.entries({fullTimeIsOne:'on',capAtOne:'on',forfaitJoursIsOne:'on',etpDecimals:'4',turnoverFormula:'half_sum',neutralizeContinuity:'on',absenceTypes:'fr_maladie_ordinaire',absenceStatuses:'approved',dayBasis:'calendar'}).forEach(([k,v])=>f.set(k,v));if(population!==undefined)f.set('turnoverPopulation',population);return f};
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({workspace:{id:'espace-fictif'},session:{user:{id:'admin-fictif'}}});mocks.get.mockResolvedValue({values:{...KPI_DEFAULTS,turnoverNatures:['01','07']}});mocks.active.mockResolvedValue(null);mocks.save.mockResolvedValue([])});
describe('Population du turnover : commande administrateur',()=>{
 it('le choix CDI enregistre sa cohorte sans modifier les natures de l’effectif',async()=>{expect((await saveKpiSettings('fictif',undefined,form('cdi')))?.ok).toBeTruthy();expect(mocks.auth).toHaveBeenCalledWith('fictif','admin');expect(mocks.save).toHaveBeenCalledExactlyOnceWith('espace-fictif',expect.objectContaining({turnoverNatures:['01','07']}),'admin-fictif');expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('natures');});
 it('un ancien formulaire sans ce champ conserve la cohorte déjà définie',async()=>{await saveKpiSettings('fictif',undefined,form());expect(mocks.save.mock.calls[0][1].turnoverNatures).toEqual(['01','07']);});
 it('le choix effectifs retrouve l’héritage explicite de la population générale',async()=>{await saveKpiSettings('fictif',undefined,form('headcount'));expect(mocks.save.mock.calls[0][1].turnoverNatures).toEqual([]);});
 it('CDD, stages et intérim sont librement inclus ou retirés sans modifier les effectifs',async()=>{
  const chosen=form('custom');for(const nature of ['29','01','02','03'])chosen.append('turnoverNatures',nature);
  expect((await saveKpiSettings('fictif',undefined,chosen))?.ok).toBeTruthy();
  expect(mocks.save.mock.calls[0][1].turnoverNatures).toEqual(['01','02','03','29']);expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('natures');
  const withoutStage=form('custom');for(const nature of ['01','02','03'])withoutStage.append('turnoverNatures',nature);
  await saveKpiSettings('fictif',undefined,withoutStage);expect(mocks.save.mock.calls[1][1].turnoverNatures).toEqual(['01','02','03']);
 });
 it('une cohorte personnalisée exige une sélection valide',async()=>{expect((await saveKpiSettings('fictif',undefined,form('custom')))?.error).toContain('au moins');const f=form('custom');f.append('turnoverNatures','1');expect((await saveKpiSettings('fictif',undefined,f))?.error).toContain('Population du turnover');expect(mocks.save).not.toHaveBeenCalled();});
 it('un lecteur est refusé avant tout accès aux paramètres',async()=>{mocks.auth.mockRejectedValue(new Error('404'));await expect(saveKpiSettings('fictif',undefined,form('cdi'))).rejects.toThrow('404');expect(mocks.get).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();});
});
