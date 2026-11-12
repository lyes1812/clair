import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/e/[slug]/parametres/actions',()=>({saveKpiSettings:async()=>undefined}));
import { KpiForm, type KpiFormProps } from '@/app/e/[slug]/parametres/KpiForm';
import { KpiHeader, KpiTile } from '@/app/e/[slug]/studio-rh/kpi/components';
import { KPI_DEFAULTS } from '@/lib/rh-kpi-settings';
import type { KpiContext } from '@/lib/rh/kpi-context';
import { payfitFixtureBuild } from './helpers/rh';

const built=await payfitFixtureBuild();
const ctx={collab:{slug:'fictif',source:{domain:'rh',chosen:'payfit',mode:'api',appliedAt:new Date('2026-10-21T08:00:00Z'),reason:'ANCIEN_NARRATIF_ADMINISTRATEUR',apiApplied:true,filesApplied:false,modeSetAt:null},data:{...built,build:{...built.build,builtAt:new Date('2026-10-21T08:00:00Z'),inputsHash:'f'.repeat(64)}},state:null,switchedAt:new Date('2026-10-20T08:00:00Z'),payfitHistory:{mode:'raw',origin:'default',limit:null}},input:null} as unknown as KpiContext;
describe('KPI : lecture compacte et population explicite',()=>{
 it('un seul accès Vigilance fermé conserve les limites et la provenance sans narratif administrateur visible',()=>{
  const html=renderToStaticMarkup(h(KpiHeader,{ctx,closedMonth:'2026-09'}));
  expect(html).toContain('Septembre 2026');
  const tag=html.match(/<details[^>]*data-testid="kpi-vigilance"[^>]*>/)?.[0]??'';
  expect(tag).toBeTruthy();expect(tag).not.toContain(' open');
  expect(html.indexOf('data-testid="kpi-read-details"')).toBeGreaterThan(html.indexOf('data-testid="kpi-vigilance"'));
  expect(html).toContain('data-testid="kpi-read-limits"');
  expect(html).toContain('data-testid="rh-build-info"');
  expect(html).not.toContain('ANCIEN_NARRATIF_ADMINISTRATEUR');
 });
 it('n.d. reste un état avec des raisons accessibles et repliées, jamais une valeur nulle',()=>{
  const html=renderToStaticMarkup(h(KpiTile,{id:'absenteeism',slug:'fictif',label:'Absentéisme',shown:{text:'n.d. — motif non disponible',kind:'nd'},n1:'n.d. — source précédente incomplète',delta:'n.d.',term:'absenteisme',detail:'?detail=absenteeism',detailN1:'?detail=absenteeism&n1=1'}));
  expect(html).toContain('>n.d.</dd>');
  expect(html).toContain('Pourquoi n.d. ?');
  expect(html).toContain('n.d. — motif non disponible');
  expect(html).toContain('N-1 : n.d. — source précédente incomplète');
  expect(html.match(/<details[^>]*data-testid="kpi-tile-absenteeism-nd-help"[^>]*>/)?.[0]).not.toContain(' open');
 });
 it('l’administrateur retrouve le choix CDI enregistré sans changer les champs des effectifs',()=>{
  const props:KpiFormProps={slug:'fictif',values:{...KPI_DEFAULTS,turnoverNatures:['01','07']},origins:{},kinds:{},notes:{etp:null,turnover:null,absence:null},natures:[{code:'01',label:'CDI'},{code:'02',label:'CDD'},{code:'03',label:'Contrat de mission (intérim)'},{code:'07',label:'CDI intermittent'},{code:'29',label:'Convention de stage'}],headcountNatures:['01','02','29'],types:[],readLabel:null,statuses:[{code:'approved',label:'Approuvée'}],disabled:false};
  const html=renderToStaticMarkup(h(KpiForm,props));
  expect(html).toMatch(/name="turnoverPopulation"[^>]*value="custom"[^>]*checked=""|name="turnoverPopulation"[^>]*checked=""[^>]*value="custom"/);
  const controls=[...html.matchAll(/<input[^>]+>/g)].map(match=>match[0]).filter(tag=>tag.includes('name="turnoverNatures"'));
  for(const code of ['01','07'])expect(controls.find(tag=>tag.includes(`value="${code}"`))).toContain('checked=""');
  for(const code of ['02','03','29'])expect(controls.find(tag=>tag.includes(`value="${code}"`))).not.toContain('checked=""');
  expect(controls).toHaveLength(5);
  expect(html).toContain('Convention de stage');
  expect(html).toContain('Contrat de mission (intérim)');
  expect(html).toContain('CDI uniquement');
  expect(html).not.toContain('name="natures"');
  expect(html).toContain('name="fullTimeIsOne"');
 });
 it('sans réglage de turnover, suit les effectifs sans bloquer le passage à une sélection libre',()=>{
  const props:KpiFormProps={slug:'fictif',values:KPI_DEFAULTS,origins:{},kinds:{},notes:{etp:null,turnover:null,absence:null},natures:[{code:'01',label:'CDI'},{code:'02',label:'CDD'},{code:'29',label:'Convention de stage'}],headcountNatures:['01','02','29'],types:[],readLabel:null,statuses:[{code:'approved',label:'Approuvée'}],disabled:false};
  const html=renderToStaticMarkup(h(KpiForm,props));
  expect(html).toContain('Suivre la population des effectifs');
  expect(html).toContain('Personnaliser les contrats inclus');
  const controls=[...html.matchAll(/<input[^>]+>/g)].map(match=>match[0]).filter(tag=>tag.includes('name="turnoverNatures"'));
  expect(controls).toHaveLength(3);for(const control of controls){expect(control).toContain('checked=""');expect(control).toContain('disabled=""');}
 });
});
