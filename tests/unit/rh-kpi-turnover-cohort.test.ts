import { describe, expect, it } from 'vitest';
import { monthWindow } from '@/lib/rh/kpi/period';
import { turnover, turnoverCohort, turnoverPopulationLabel, windowMovements } from '@/lib/rh/kpi/turnover';
import { headcountAt } from '@/lib/rh/headcount';
import { headcountAverage } from '@/lib/rh/kpi/average';
import { KPI_PARSERS } from '@/lib/rh-kpi-settings';
import { same } from '@/lib/rh/kpi/fraction';
import { kpiInput, DSN_ABSENCES } from './helpers/kpi';
import { payfitBuild } from './helpers/rh';
import { payfitEdgeFetch, type PayFitEdgeCase } from './helpers/edge-cases';

const edge: PayFitEdgeCase = {
  collaborators: ['A','B','C','D','E'].map(id=>({id:`P-${id}`})),
  contracts: [
    {contractId:'C-A',collaboratorId:'P-A',startDate:'2025-06-01',endDate:null,natureContratDsn:'01'},
    {contractId:'C-B',collaboratorId:'P-B',startDate:'2026-02-01',endDate:null,natureContratDsn:'01'},
    {contractId:'C-C',collaboratorId:'P-C',startDate:'2025-06-01',endDate:'2026-02-14',natureContratDsn:'01'},
    {contractId:'C-D',collaboratorId:'P-D',startDate:'2026-02-01',endDate:'2026-02-14',natureContratDsn:'02'},
    {contractId:'C-E',collaboratorId:'P-E',startDate:'2026-02-01',endDate:null,natureContratDsn:'29'},
  ],
};
const data = await payfitBuild('cle-fictive-cohorte',payfitEdgeFetch('cle-fictive-cohorte',edge),['2026-01','2026-02'],new Date('2026-03-01T08:00:00Z'));
const w=monthWindow('2026-02');
const input=()=>kpiInput(data,DSN_ABSENCES,{natures:['01','02','29'],neutralizeContinuity:false});

describe('Turnover : cohorte indépendante sur données fictives',()=>{
  it('CDI : E=1, S=1, effectif fin de mois=2 => 50 %, sans modifier les autres indicateurs',()=>{
    const base=input(), scoped={...base,params:{...base.params,turnoverNatures:['01','07']}};
    expect(turnover(base,w)).toMatchObject({kind:'exact',entries:3,exits:2,ratio:{num:5,den:6}});
    const rate=turnover(scoped,w);
    expect(rate).toMatchObject({kind:'exact',entries:1,exits:1});
    expect(rate.kind==='exact'&&same(rate.ratio,{num:1,den:2})).toBe(true);
    expect(headcountAt(scoped.data,'2026-02-28',{natures:scoped.params.natures})).toMatchObject({kind:'exact',persons:3});
    expect(headcountAverage(scoped,w)).toEqual(headcountAverage(base,w));
    expect(windowMovements(scoped,w)).toEqual(windowMovements(base,w));
    expect(scoped.params.natures).toEqual(['01','02','29']);
  });
  it('la variante sorties/effectif au premier jour utilise aussi la cohorte CDI : 1/3',()=>{
    const base=input();
    expect(turnover({...base,params:{...base.params,turnoverFormula:'exits_over_start',turnoverNatures:['01','07']}},w)).toMatchObject({kind:'exact',entries:1,exits:1,ratio:{num:1,den:3},base:{kind:'start',persons:3}});
  });
  it('inclure les CDD ou les stages applique la même sélection aux mouvements et au dénominateur',()=>{
    const base=input();
    const withCdd=turnover({...base,params:{...base.params,turnoverNatures:['01','02','07']}},w);
    expect(withCdd).toMatchObject({kind:'exact',entries:2,exits:2});expect(withCdd.kind==='exact'&&same(withCdd.ratio,{num:1,den:1})).toBe(true);
    const withStage=turnover({...base,params:{...base.params,turnoverNatures:['01','07','29']}},w);
    expect(withStage).toMatchObject({kind:'exact',entries:2,exits:1});expect(withStage.kind==='exact'&&same(withStage.ratio,{num:1,den:2})).toBe(true);
    const all=turnover({...base,params:{...base.params,turnoverNatures:['01','02','07','29']}},w);
    expect(all).toMatchObject({kind:'exact',entries:3,exits:2});expect(all.kind==='exact'&&same(all.ratio,{num:5,den:6})).toBe(true);
    expect(base.params.natures).toEqual(['01','02','29']);
  });
  it('sans paramètre ou avec une liste vide, conserve exactement le calcul historique',()=>{
    const base=input();
    expect(turnoverCohort(base)).toBe(base);
    expect(turnover({...base,params:{...base.params,turnoverNatures:[]}},w)).toEqual(turnover(base,w));
  });
  it('un filtre CDD ne remplace jamais la cohorte CDI',()=>{
    const base=input();
    const scoped={...base,params:{...base.params,turnoverNatures:['01','07']},scope:{nature:'02'}};
    expect(turnoverCohort(scoped).params.natures).toEqual([]);
    expect(turnoverCohort(turnoverCohort(scoped)).params.natures).toEqual([]);
    expect(turnover(scoped,w)).toMatchObject({kind:'nd',nd:{code:'denominator-zero'}});
  });
  it('le libellé explique la population sans codes techniques et sans sélection globale modifiée',()=>{
    const base=input();
    expect(turnoverPopulationLabel({...base,params:{...base.params,turnoverNatures:['01','07']}})).toBe('CDI, CDI intermittent');
    expect(KPI_PARSERS.turnoverNatures(['07','01','01'])).toEqual(['01','07']);
    expect(KPI_PARSERS.turnoverNatures(['1'])).toBeNull();
    expect(KPI_PARSERS.turnoverNatures(undefined)).toEqual([]);
  });
});
