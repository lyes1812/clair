import { describe, expect, it } from 'vitest';
import { latestFrozenScenario, latestSyntheseBudget, syntheseBudget } from '@/lib/payroll/synthese-budget';
import type { BudgetRow, ScenarioFull } from '@/lib/budget/store';
import type { BaseSnapshot } from '@/lib/budget/types';
import { DEFAULT_PREFIXES } from '@/lib/payroll/grid';
import type { JournalInput } from '@/lib/payroll/engine';
import { monthRange } from '@/lib/connectors/months';

const journal: JournalInput = { grid: DEFAULT_PREFIXES, months: ['2026-01','2026-02','2026-03'], openMonths: [], lines: ['2026-01','2026-02','2026-03'].flatMap((month,index)=>[
  { key: `gross-${month}`, month, accountId:'6411', accountName:'Salaire fictif', debitCents:index ? 10000 : 900000, creditCents:0,contractId:'fictif' },
  { key: `charges-${month}`, month, accountId:'6451', accountName:'Cotisations fictives', debitCents:2000, creditCents:0,contractId:'fictif' },
]) };
const budget=(id:string, updatedAt:string, values:Record<string,number|null>={}):BudgetRow=>({id,name:`Budget fictif ${id}`,year:'2026',amounts:{'2026-01':900000,'2026-02':8000,'2026-03':9000,...values},updatedAt:new Date(updatedAt),createdAt:new Date('2026-01-01'),currency:'EUR',workspaceId:'espace-fictif',createdBy:null,updatedBy:null});
const base: BaseSnapshot={currency:'EUR',refMonth:'2026-09',syncId:'lecture-figee',readAt:'2026-10-05',refMasse:12000,refBaseCost:12000,etpNote:null,
  contracts:[{contractKey:'contrat-fictif',externalId:'contrat-fictif',label:'LIBELLE_PERSONNEL_FICTIF',service:null,serviceNd:null,startDate:'2024-01-01',endDate:null,counted:true,etp4:10000,etpNd:null,base:{salaryCents:10000,refBrutCents:10000,refCotisationsCents:2000},baseNd:null}],
  actuals:monthRange('2026-01','2026-09').map(month=>({month,kind:'value',brut:10000,cotisations:2000,masse:12000,headcount:1,etp4:10000,etpNd:null})),
};
const frozen=(patch:Partial<ScenarioFull['scenario']>={}):ScenarioFull=>({scenario:{id:'11111111-1111-4111-8111-111111111111',name:'Scénario fictif figé',status:'fige',kind:'budget',firstMonth:'2026-10',lastMonth:'2026-12',conventions:{prorata:'calendaire'},createdAt:new Date('2026-09-01'),frozenAt:new Date('2026-10-10'),...patch} as ScenarioFull['scenario'],base,baseHash:'fictif',hypotheses:[]});
const args=()=>({year:'2026',months:['2026-02','2026-03'],journal,budgets:[budget('recent','2026-10-05')],frozen:frozen(),currentSyncId:'lecture-courante'});

describe('Références de la synthèse — données fictives',()=>{
  it('choisit le budget de l’année le plus récemment modifié, avec tri déterministe',()=>{
    const old=budget('ancien','2026-01-02'), recent=budget('recent','2026-10-05');
    expect(latestSyntheseBudget([old,{...recent,year:'2025'},recent],'2026')?.id).toBe('recent');
    expect(latestSyntheseBudget([old,recent],'2024')).toBeNull();
    expect(latestSyntheseBudget([{...recent,id:'a'},{...recent,id:'b'}],'2026')?.id).toBe('b');
  });
  it('retient la dernière date de figement et ignore un brouillon créé plus récemment',()=>{
    const older=frozen({id:'ancien',createdAt:new Date('2026-10-01'),frozenAt:new Date('2026-10-02')});
    const newer=frozen({id:'dernier',createdAt:new Date('2026-01-01'),frozenAt:new Date('2026-10-10')});
    const draft=frozen({id:'brouillon',status:'brouillon',createdAt:new Date('2026-11-01'),frozenAt:null});
    expect(latestFrozenScenario([{scenario:older.scenario},{scenario:draft.scenario},{scenario:newer.scenario}])?.scenario.id).toBe('dernier');
    expect(latestFrozenScenario([{scenario:draft.scenario}])).toBeNull();
  });
  it('compare les seuls mois affichés, sans ajouter janvier ni annualiser le budget',()=>{
    const result=syntheseBudget(args());
    expect(result.budgetTotal).toEqual({kind:'value',cost:17000});
    expect(result.gap).toMatchObject({kind:'value',a:24000,b:17000,delta:7000});
    expect(result.landing).toMatchObject({kind:'value',year:'2026',actual:108000,projected:36000,total:144000});
    expect(result.baseDiffersFromCurrent).toBe(true);
    expect([result.baseRefMonth,result.baseReadAt]).toEqual(['2026-09','2026-10-05']);
  });
  it('ne ventile jamais le budget ni l’atterrissage global sous un filtre de service',()=>{
    const result=syntheseBudget({...args(),serviceFiltered:true});
    expect(result.gap).toMatchObject({kind:'nd',reason:expect.stringContaining('global')});
    expect(result.landing).toMatchObject({kind:'nd',reason:expect.stringContaining('global')});
    expect(result.annualGap).toBeNull();
  });
  it('un budget absent, un mois non saisi ou une paie ouverte restent n.d.',()=>{
    expect(syntheseBudget({...args(),budgets:[]}).gap).toMatchObject({kind:'nd',reason:'Aucun budget saisi pour 2026.'});
    expect(syntheseBudget({...args(),budgets:[budget('incomplet','2026-10-01',{'2026-03':null})]}).gap.kind).toBe('nd');
    expect(syntheseBudget({...args(),journal:{...journal,openMonths:['2026-03']}}).gap).toMatchObject({kind:'nd',reason:expect.stringContaining('paie non clôturée')});
  });
  it('ne change pas l’année affichée quand le dernier scénario ne la couvre pas',()=>{
    const result=syntheseBudget({...args(),year:'2025',months:['2025-01']});
    expect(result.landing).toMatchObject({kind:'nd',year:'2025'});
    expect(result.scenario?.id).toBe(frozen().scenario.id);
  });
  it('un brouillon chargé à la place du scénario figé n’est pas présenté comme référence',()=>{
    const result=syntheseBudget({...args(),frozen:frozen({status:'brouillon'})});
    expect(result.landing.kind).toBe('nd');expect(result.scenario).toBeNull();
  });
  it('n’expose pas les libellés des contrats dans les raisons de projection',()=>{
    const missing={...frozen(),base:{...base,contracts:base.contracts.map(c=>({...c,base:null,baseNd:'Information manquante'}))}};
    const result=syntheseBudget({...args(),frozen:missing});
    expect(result.landing.kind).toBe('nd');
    expect(JSON.stringify(result.landing)).not.toContain('LIBELLE_PERSONNEL_FICTIF');
  });
});
