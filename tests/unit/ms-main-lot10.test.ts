import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DsnView } from "@/app/e/[slug]/studio-rh/masse-salariale/DsnView";
import { glossaryEntry } from "@/lib/glossary";
import type { DsnMonth } from "@/lib/payroll/dsn";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import type { RcPayslipScan } from "@/lib/payroll/rc-payslips";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

// Écrans de la Masse salariale rendus de bout en bout (lot 10) sur un journal fictif écrit à la main : tendances rouge / vert d'un coût,
// aucun narratif, « ? » vers le glossaire, légende unique. Le contexte (base de données) est remplacé par un contexte fictif.
const state = vi.hoisted(() => ({ ctx: null as unknown, actualEvents: [] as ActualEvent[], rcScan: null as RcPayslipScan | null, budgets: [] as unknown[], scenarios: [] as unknown[], frozen: null as unknown }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => state.ctx }));
vi.mock("@/lib/payroll/non-recurring-store", () => ({ listActualEvents: async () => state.actualEvents, actualEventVersion: () => "fictif" }));
vi.mock("@/lib/payroll/rc-payslips-store", () => ({ getRcPayslipScan: async () => state.rcScan }));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/actual-actions", () => ({ saveActualEventAction: async () => ({ ok: "fictif" }) }));
vi.mock('@/lib/budget/store',()=>({listBudgets:async()=>state.budgets,listScenarios:async()=>state.scenarios,getScenario:async()=>state.frozen}));
vi.mock('@/lib/croisee-settings',async(orig)=>({...await orig<typeof import('@/lib/croisee-settings')>(),getCroiseeSettings:async()=>({confidentialite:{kind:'set',value:1,updatedAt:null,updatedBy:null},seuilsEffectif:{kind:'absent'},margeAlerte:{kind:'absent'},horizonEcheances:{kind:'absent'}})}));
beforeEach(() => { state.actualEvents = []; state.rcScan = null; state.budgets=[];state.scenarios=[];state.frozen=null; });

// Journal : janvier 2026 (service A : brut 2 200,00 €, cotisations 1 200,00 € ; service B : brut 1 000,00 €, cotisations 500,00 €),
// février 2026 identique mais non clôturé, janvier 2025 à 90 % de janvier 2026 ; février 2025 absent du journal (n.d.).
let n = 0;
const an = (code: string) => [{ type: "Service", code, value: code }];
const line = (month: string, accountId: string, name: string, debit: number, contractId: string | null, svc: string | null): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`,
  month,
  accountId,
  accountName: name,
  debitCents: debit,
  creditCents: null,
  contractId,
  analytic: svc ? an(svc) : [],
});
const lines: LedgerLine[] = [];
const add = (m: string, v: { salA: number; priA: number; cotA: number; salB: number; cotB: number; conges: number; charges: number }) => {
  lines.push(line(m, "641100", "Salaires", v.salA, "C1", "A"), line(m, "641300", "Primes sur objectif", v.priA, "C1", "A"), line(m, "645100", "Cotisations", v.cotA, "C1", "A"));
  lines.push(line(m, "641100", "Salaires", v.salB, "C2", "B"), line(m, "645100", "Cotisations", v.cotB, "C2", "B"));
  lines.push(line(m, "641200", "Provisions pour conges payes - Mois courant", v.conges, null, null), line(m, "648500", "Provisions pour charges sociales - Mois courant", v.charges, null, null));
};
const v26 = { salA: 200000, priA: 20000, cotA: 120000, salB: 100000, cotB: 50000, conges: 100000, charges: 40000 };
add("2026-01", v26);
add("2026-02", v26);
add("2025-01", { salA: 180000, priA: 18000, cotA: 108000, salB: 90000, cotB: 45000, conges: 90000, charges: 36000 });
const input: JournalInput = { lines, months: ["2025-01", "2025-02", "2026-01", "2026-02", "2026-03"], openMonths: ["2026-02"], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
// Comptabilité (FEC fictif de janvier 2026) : salaires 3 050,00 € (journal 3 000,00 €), primes 150,00 € (journal 200,00 €), cotisations 1 700,00 € (= journal).
const compta = {
  source: "fec" as const,
  reason: "FEC fictif",
  lines: [
    { month: "2026-01", accountId: "641100", debitCents: 305000, creditCents: null },
    { month: "2026-01", accountId: "641300", debitCents: 15000, creditCents: null },
    { month: "2026-01", accountId: "645100", debitCents: 170000, creditCents: null },
    { month: "2026-01", accountId: "707000", debitCents: null, creditCents: 1000000 },
  ],
  months: ["2026-01"],
  nd: {},
  error: false,
};
state.ctx = {
  kpi: { collab: { workspace: { id: "w1", role: "reader" }, data: null } },
  source: "payfit",
  grid: { grid: DEFAULT_PREFIXES, origin: "default", updatedAt: null },
  read: { syncId: "s1", startedAt: new Date("2026-03-03T10:00:00Z"), months: input.months },
  unavailable: null,
  input,
  etp: (months: string[]) => months.map((m) => ({ month: m, etp4: 30000, reason: null })),
  axes: ["Service"],
  service: { axis: "Service", origin: "single-axis", updatedAt: null },
  dsn: new Map(),
  etpQualifiers: [],
  compta: async () => compta,
  axisMissing: false,
};

const page = async (sp: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/e/[slug]/studio-rh/masse-salariale/page");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(sp) }));
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
// Retire seulement la balise de présentation monétaire pour vérifier le texte et la couleur de son parent.
const shownHtml = (html: string) => html.replace(/<span class="money-display"[^>]*>([^<]*)<\/span>/g, "$1");
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
// Panneaux de synthèse autonomes : vérifier leurs montants, sans confondre les mêmes valeurs dans les tableaux détaillés.
const summaryPanel = (html: string, testid: string) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  expect(at, testid).toBeGreaterThanOrEqual(0);
  const from = html.lastIndexOf("<section", at);
  const to = html.indexOf("</section>", at);
  expect(from, testid).toBeGreaterThanOrEqual(0);
  expect(to, testid).toBeGreaterThan(at);
  return html.slice(from, to + "</section>".length);
};
const NARRATIF = /Un graphique est une lecture|Sens de « n\.d\. »|Montants tels que (renvoyés|déclarés)|\(N − N-1\) ÷ N-1 =|brut \+ cotisations patronales<|Définitions et règles de calcul|ms-definitions|Coût = masse chargée \(brut|chaque chiffre renvoie à sa définition|une colonne hachurée est un mois n\.d\./i;

// Vérifie la visibilité initiale du résumé, indépendamment de ses détails de vigilance fermés.
const expectOutsideDetails = (html: string, testid: string) => {
  const index = html.indexOf(`data-testid="${testid}"`);
  expect(index).toBeGreaterThanOrEqual(0);
  const stack: string[] = [];
  for (const match of html.slice(0, index).matchAll(/<details\b[^>]*>|<\/details>/g)) {
    if (match[0] === "</details>") stack.pop(); else stack.push(match[0]);
  }
  expect(stack).toEqual([]);
};

describe("Masse salariale, Synthèse : tendances, « ? », aucun narratif (lot 10)", () => {
  it('charge le dernier budget sur la période exacte et transmet les mêmes mois et la même référence au détail croisé',async()=>{
    const old={id:'11111111-1111-4111-8111-111111111111',name:'Ancien budget fictif',year:'2026',amounts:{'2026-01':300000},updatedAt:new Date('2026-01-01'),createdAt:new Date('2026-01-01')};
    const recent={...old,id:'22222222-2222-4222-8222-222222222222',name:'Dernier budget fictif',amounts:{'2026-01':400000,'2026-02':99000000},updatedAt:new Date('2026-10-01')};
    state.budgets=[old,recent];
    const html=await page({annee:'2026',de:'01',a:'01'});
    const card=html.match(/<div[^>]*data-testid="ms-tile-budget"[\s\S]*?<\/div>/)?.[0]??'';
    expect(card).toContain('data-money-cents="90000"');
    expect(card).toContain('class="trend-bad"');
    expect(card).toContain('/croisee?chapitre=budget&amp;annee=2026&amp;de=01&amp;a=01&amp;budget=22222222-2222-4222-8222-222222222222');
    expect(card).toContain('affichage=tableau#cx-budget-ecart');
    const references=html.match(/data-testid="ms-synthese-budget-references"[\s\S]*?<\/div>/)?.[0]??'';
    expect(references).toContain('Dernier budget fictif');
    expect(references).toContain('Janvier 2026');
    expect(html).not.toContain('Non chargé sur cette vue');
    const main=html.match(/<div[^>]*data-testid="ms-tile-masse"[\s\S]*?<\/div>/)?.[0]??'';
    expect(main).toContain('Janvier 2026');
  });
  it('le détail suit la carte de mars–avril sans reprendre janvier–février dans son écart',async()=>{
    const original=state.ctx as Record<string,unknown>;
    const months=['2026-01','2026-02','2026-03','2026-04'];
    const source:JournalInput={grid:DEFAULT_PREFIXES,months,openMonths:[],lines:months.map((month,index)=>({key:`fictif-${month}`,month,accountId:'6411',accountName:'Salaire fictif',debitCents:[90000000,80000000,12000,24000][index],creditCents:0,contractId:'contrat-fictif'}))};
    const budget={id:'66666666-6666-4666-8666-666666666666',name:'Budget fictif quatre mois',year:'2026',amounts:{'2026-01':100000,'2026-02':100000,'2026-03':10000,'2026-04':15000},updatedAt:new Date('2026-10-01'),createdAt:new Date('2026-01-01')};
    state.budgets=[budget];
    const existing=original.kpi as {collab:Record<string,unknown>};
    state.ctx={...original,input:source,read:{syncId:'lecture-fictive',months,startedAt:new Date('2026-05-01T10:00:00Z')},axes:[],service:{axis:null,origin:'setting',updatedAt:null},kpi:{...existing,input:null,settings:{invalid:[]},collab:{...existing.collab,source:{chosen:'payfit',reason:null},state:null}}};
    try{
      const html=await page({annee:'2026',de:'03',a:'04'});
      const card=html.match(/<div[^>]*data-testid="ms-tile-budget"[\s\S]*?<\/div>/)?.[0]??'';
      expect(card).toContain('data-money-cents="11000"');
      const link=/<a class="ms-synthese-value-link" href="([^"]+)"/.exec(card)?.[1];expect(link).toBeTruthy();
      const url=new URL(link!.replaceAll('&amp;','&'),'https://clair.invalid');
      const {loadCroiseeContext}=await import('@/app/e/[slug]/studio-rh/masse-salariale/croisee/context');
      const {loadBudgetInput,buildBudget}=await import('@/lib/viz/croisee-budget');
      const context=await loadCroiseeContext('demo',{id:'w1',name:'Espace fictif',slug:'demo',role:'reader'},Object.fromEntries(url.searchParams));
      expect(context.period?.months).toEqual(['2026-03','2026-04']);
      expect(context.budget.selected?.id).toBe(budget.id);
      const detail=buildBudget(await loadBudgetInput(context));
      expect(detail.tiles.find(t=>t.id==='ecart')?.value.text.replaceAll('\u202f',' ').replaceAll('\u00a0',' ')).toBe('+110,00 €');
      expect(url.hash).toBe('#cx-budget-ecart');
    }finally{state.ctx=original;}
  });
  it('lit le dernier scénario figé et distingue son année complète du réel courant',async()=>{
    const scenario={id:'33333333-3333-4333-8333-333333333333',name:'Scénario fictif figé',status:'fige',kind:'budget',firstMonth:'2026-10',lastMonth:'2026-12',conventions:{prorata:'calendaire'},createdAt:new Date('2026-01-01'),frozenAt:new Date('2026-10-04')};
    state.scenarios=[{scenario:{...scenario,id:'44444444-4444-4444-8444-444444444444',name:'Brouillon fictif récent',status:'brouillon',createdAt:new Date('2026-11-01'),frozenAt:null}},{scenario}];
    state.frozen={scenario,base:{currency:'EUR',refMonth:'2026-09',syncId:'ancienne-lecture-fictive',readAt:'2026-10-02',contracts:[],actuals:Array.from({length:9},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,kind:'value',brut:10000,cotisations:0,masse:10000,headcount:0,etp4:0,etpNd:null})),refMasse:10000,refBaseCost:0,etpNote:null},baseHash:'fictif',hypotheses:[]};
    const html=await page({annee:'2026',de:'01',a:'01'});
    const card=html.match(/<div[^>]*data-testid="ms-tile-landing"[\s\S]*?<\/div>/)?.[0]??'';
    expect(card).toContain('data-money-cents="90000"');
    expect(card).toContain('Année 2026 · scénario figé');
    expect(card).toContain('scenario=33333333-3333-4333-8333-333333333333');
    const references=html.match(/data-testid="ms-synthese-budget-references"[\s\S]*?<\/div>/)?.[0]??'';
    expect(references).toContain('Scénario fictif figé');
    expect(references).toContain('base de septembre 2026');
    expect(references).toContain('02/10/2026');
    expect(references).toContain('réel de la base figée');
    expect(references).not.toContain('Brouillon fictif récent');
  });
  it("référence écrite à la main : janvier 2026 = 4 900,00 € contre 4 410,00 € en janvier 2025, soit +490,00 € et +11,11\u00a0% (coût en hausse : rouge)", async () => {
    const html = await page();
    expect(html).toContain('data-testid="ms-tile-masse"');
    expect(html).toContain('data-money-cents="490000"');
    expect(html).toContain('data-money-cents="163333"');
    expect(shownHtml(html)).toContain("4\u202f900\u00a0€");
    expect(html).toContain(`<dd class="trend-bad">+11,11\u00a0%</dd>`);
    expect(shownHtml(html)).toContain(`<span class="ms-delta trend-bad">+490 €</span>`);
    // Services : A +340,00 € et B +150,00 € ; total +490,00 € ; une ligne par service, écarts de montant colorés.
    expect(shownHtml(html)).toContain(`<td class="num trend-bad" data-col="ecart">+340 €</td>`);
    expect(shownHtml(html)).toContain(`<td class="num trend-bad" data-col="ecart">+150 €</td>`);
    expect(html).toContain(`<td class="num trend-bad" data-col="ecart-pct">+11,11\u00a0%</td>`);
    // Tableau mois par mois : écart du mois et de la période.
    expect(shownHtml(html)).toContain(`<td class="num trend-bad" data-col="ecart">+490 €</td>`);
  });
  it("une seule légende de tendance ; aucun bloc de définitions en bas ; aucune explication sous les tuiles, les graphiques et les tableaux", async () => {
    const html = await page();
    expect(count(html, /class="trend-legend"/g)).toBe(1);
    expect(html).not.toMatch(NARRATIF);
    expect(html).not.toContain("ms-services-note");
    expect(html).not.toMatch(/href="#def-|id="def-|id="definitions"/);
    // Les mois provisoires sont dans la ligne de période, une seule fois (jamais répétés sous chaque graphique).
    expect(count(html, /Mois provisoires/g)).toBe(0);
  });
  it("chaque « ? » mène à une entrée du glossaire ; une par tuile (cinq) et au moins un par panneau de chiffres", async () => {
    const html = await page();
    const ids = [...html.matchAll(/\/e\/demo\/glossaire#def-([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const id of ids) expect(glossaryEntry(id), id).toBeDefined();
    for (const t of ["masse", "evolution", "cout-etp", "brut", "cotisations"]) expect(html).toMatch(new RegExp(`data-testid="ms-tile-[a-z-]+"[^>]*><dt>[^<]*<a class="gloss-link" href="/e/demo/glossaire#def-${t}"`));
  });
  it("données conservées : grille de comptes en vigueur, postes hors masse, source, période et services avec leur contexte d'une ligne", async () => {
    const html = await page();
    expect(html).toMatch(/data-testid="ms-grid"><li>Salaires et appointements \(brut\) : 641<\/li><li>Primes \(brut\) : 6413<\/li>/);
    expect(shownHtml(html)).toContain(`Provisions de congés payés (hors masse chargée) : <b>1 400 €</b>`);
    expect(html).toContain("journal comptable de paie PayFit");
    expect(html).toContain("<strong>Janvier 2026</strong> · N-1 : Janvier 2025 · tous les services · €");
    expect(html).toContain("Code analytique « Service » du journal PayFit (seul axe présent)");
    expect(html).toContain("Contrôle DSN : aucune DSN déposée pour ces mois.");
    expect(html).toContain("Grille de comptes : valeur par défaut validée le 22/10/2026");
  });
  it("aucune couleur de série hors de la charte : toutes les teintes sont des var(--chart-N)", async () => {
    const html = await page();
    const teintes = [...html.matchAll(/var\(--chart-(\d+)\)/g)].map((m) => Number(m[1]));
    expect(teintes.length).toBeGreaterThan(0);
    for (const t of teintes) expect(t).toBeGreaterThanOrEqual(1), expect(t).toBeLessThanOrEqual(8);
    // Dans le balisage (y compris les graphiques partagés) : aucune couleur hexadécimale qui ne soit blanche, grise ou bleue, ni rgb() / hsl().
    for (const m of html.matchAll(/(?:style|fill|stroke)="[^"]*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
      const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
      const d = max - min;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1));
      const hue = d === 0 ? 0 : (((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60) + 360) % 360;
      expect(sat < 0.35 || (hue >= 200 && hue <= 250), `#${m[1]}`).toBe(true);
    }
    expect(html).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
  it("période avec un mois n.d. (février 2025) : l'évolution est n.d. et n'est jamais colorée ; une seule clé de lecture « n.d. » sous les graphiques", async () => {
    const html = await page({ annee: "2026", de: "01", a: "02" });
    expect(html).toContain('<dd class="nd">n.d.</dd>');
    expect(html).not.toContain('<dd class="trend-bad">');
    expect(count(html, /data-testid="ms-nd-key"/g)).toBe(1);
    expect(html).toContain("mois provisoires (paie non clôturée) : févr. 2026");
    expect(html).toMatch(/févr\. 2025 : journal de paie 2025-02 non renvoyé par PayFit/);
    expect(count(html, /class="trend-legend"/g)).toBe(1);
  });
  it("affichage « Graphique » : le seul pied conservé est l'accès au tableau exact ; affichage « Tableau » : ni graphiques, ni clé n.d.", async () => {
    const g = await page({ annee: "2026", de: "01", a: "02", affichage: "graphique" });
    expect(count(g, /data-testid="ms-graph-foot"/g)).toBe(1);
    expect(g).toContain("Afficher le tableau exact");
    expect(g).not.toContain('data-testid="ms-monthly-table"');
    const t = await page({ annee: "2026", de: "01", a: "02", affichage: "tableau" });
    expect(t).not.toContain('data-testid="ms-graphs"');
    expect(t).not.toContain('data-testid="ms-nd-key"');
    expect(t).not.toContain('data-testid="ms-graph-foot"');
    expect(t).toContain('data-testid="ms-monthly-table"');
  });
  it("service filtré : la masse du service A (3 400,00 €) est dite dans la ligne de période, les graphiques par service gardent leur limite en une ligne", async () => {
    const html = await page({ service: "A" });
    expect(html).toContain("service A");
    expect(html).toContain("Le filtre Service ne s&#x27;applique pas ici : tous les services sont montrés.");
  });
  it("le panneau Brut et cotisations suit la période et le service du journal, comme les montants détaillés", async () => {
    const cases: { sp: Record<string, string>; brut: number; cotisations: number }[] = [
      { sp: { annee: "2026", de: "01", a: "01" }, brut: 320000, cotisations: 170000 },
      { sp: { annee: "2026", de: "01", a: "02" }, brut: 640000, cotisations: 340000 },
      { sp: { annee: "2026", de: "01", a: "01", service: "A" }, brut: 220000, cotisations: 120000 },
    ];
    for (const { sp, brut, cotisations } of cases) {
      const panel = summaryPanel(await page(sp), "ms-synthese-summary-brut");
      expect(panel).toContain(`data-money-cents="${brut}"`);
      expect(panel).toContain(`data-money-cents="${cotisations}"`);
    }
    const missing = summaryPanel(await page({ annee: "2025", de: "01", a: "02" }), "ms-synthese-summary-brut");
    expect(missing).toContain("n.d.");
    expect(missing).not.toContain("data-money-cents=");
  });
  it("la répartition agrégée conserve tous les services et dit que le filtre Service ne s'y applique pas", async () => {
    const panel = summaryPanel(await page({ annee: "2026", de: "01", a: "01", service: "A" }), "ms-synthese-summary-services");
    expect(panel).toContain('data-money-cents="340000"');
    expect(panel).toContain('data-money-cents="150000"');
    expect(panel).toContain("Le filtre Service ne s&#x27;applique pas ici : tous les services sont montrés.");
  });
  it("la vue mensualisée reprend chaque mois source et conserve les filtres et les raisons n.d.", async () => {
    const html = await page({ annee: "2026", de: "01", a: "02", service: "A", repartition: "mensuelle" });
    const brut = summaryPanel(html, "ms-synthese-summary-brut");
    const services = summaryPanel(html, "ms-synthese-summary-services");
    expect(brut).toContain('data-testid="ms-summary-brut-monthly-chart"');
    expect(brut).toContain("Brut 2 200 €, Cotisations patronales 1 200 €");
    expect(services).toContain('data-testid="ms-summary-services-monthly-chart"');
    expect(services).toContain("A 3 400 €, B 1 500 €");
    expect(services).toContain("Le filtre Service ne s&#x27;applique pas ici : tous les services sont montrés.");
    expect(html).toContain('name="repartition" value="mensuelle"');
    expect(html).toContain("service=A&amp;repartition=mensuelle&amp;mois=2026-01#ms-detail");
    expect(html).toContain("service=A&amp;affichage=tableau&amp;repartition=mensuelle");
    const missing = summaryPanel(await page({ annee: "2025", de: "01", a: "02", repartition: "mensuelle" }), "ms-synthese-summary-brut");
    expect(missing).toContain("journal de paie 2025-02 non renvoyé par PayFit");
  });
  it("le mode Tableau reste sans graphique et un filtre de répartition invalide revient au cumul avec avis", async () => {
    const table = await page({ repartition: "mensuelle", affichage: "tableau" });
    expect(table).not.toContain('data-testid="ms-summary-brut-monthly-chart"');
    expect(table).not.toContain('data-testid="ms-summary-services-monthly-chart"');
    expect(table).toContain("Tableau mensuel — brut et cotisations");
    expect(table).toContain('id="ms-tables"');
    const invalid = await page({ repartition: "inconnue" });
    expect(invalid).toContain("paramètre ignoré : repartition=inconnue");
    expect(invalid).toContain('data-testid="ms-composition"');
  });
  it("le second niveau conserve les neuf indicateurs une seule fois et les graphiques, tableaux et éléments non récurrents", async () => {
    const html = await page();
    for (const tile of ["masse", "evolution", "cost-etp", "brut", "cotisations", "variable", "non-recurring", "budget", "landing"]) {
      expect(count(html, new RegExp(`data-testid="ms-tile-${tile}"`, "g")), tile).toBe(1);
    }
    for (const testid of ["ms-trend", "ms-chart-services", "ms-chart-services-months", "ms-chart-brut-cotisations", "ms-chart-cout-etp", "ms-monthly-table", "ms-services-table", "ms-services-months", "actual-non-recurring", "actual-non-recurring-categories"]) {
      expect(html, testid).toContain(`data-testid="${testid}"`);
    }
    expect(html).toContain('id="actual-non-recurring"');
    expect(html).toContain('id="ms-sources"');
    const table = await page({ affichage: "tableau" });
    expect(table).toMatch(/<details(?=[^>]*data-testid="ms-synthese-tables-details")(?=[^>]*\bopen="")/);
    const detail = await page({ mois: "2026-01" });
    expect(detail).toMatch(/<details(?=[^>]*data-testid="ms-synthese-tables-details")(?=[^>]*\bopen="")/);
    expect(detail).toContain('data-testid="ms-detail-accounts"');
  });
  it("les quatre natures non récurrentes restent visibles sans identification et hors des détails fermés", async () => {
    const html = await page({ annee: "2026", de: "01", a: "02" });
    expectOutsideDetails(html, "ms-non-recurring-summary");
    const summary = summaryPanel(html, "ms-non-recurring-summary");
    for (const label of ["Licenciements", "Ruptures conventionnelles", "Tuilages passés", "Autres éléments non récurrents"]) expect(summary).toContain(label);
    expect(count(summary, />Aucun élément identifié</g)).toBe(4);
    expect(summary).not.toContain('data-money-cents="0"');
    expect(summary).toContain('href="/e/demo/studio-rh/masse-salariale?annee=2026&amp;de=01&amp;a=02#actual-non-recurring"');
  });
  it("reprend l’indemnité du bulletin dans la carte RC sans la convertir en coût chargé", async () => {
    const previous = state.ctx;
    const syncId = "11111111-1111-4111-8111-111111111111";
    try {
      state.ctx = { ...(previous as object), read: { syncId, startedAt: new Date("2026-03-03T10:00:00Z"), months: input.months } };
      state.actualEvents = [{ id: "33333333-3333-4333-8333-333333333333", syncId, month: "2026-01", kind: "rupture-conventionnelle", chargedCents: null, contractKeys: ["payfit:CONTRAT_RC_PRIVE_FICTIF"], note: "JUSTIFICATIF_RC_PRIVE_FICTIF" }];
      state.rcScan = { version: 1, id: "22222222-2222-4222-8222-222222222222", payrollSyncId: syncId, companyId: "SOCIETE_FICTIVE", from: "2026-01", to: "2026-01", status: "complete", startedAt: "2026-02-01T08:00:00.000Z", finishedAt: "2026-02-01T08:01:00.000Z", closedMonths: ["2026-01"], unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 1, issues: [], records: [{ month: "2026-01", collaboratorId: "COLLAB_RC_PRIVE_FICTIF", contractId: "CONTRAT_RC_PRIVE_FICTIF", payslipId: "PDF_RC_PRIVE_FICTIF", pdfHash: "a".repeat(64), parserVersion: "rc-fictif-v1", status: "identified", code: "identified", indemnityCents: 98765, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 98765, page: 1, line: 8 }] }] };
      const html = await page({ annee: "2026", de: "01", a: "01" });
      const summary = summaryPanel(html, "ms-non-recurring-summary");
      expect(summary).toContain('data-money-cents="98765"'); expect(summary).toContain("Indemnité RC · bulletin");
      expect(summary).toContain("Coût chargé RC"); expect(summary).toContain("Coût chargé à vérifier"); expect(summary).toContain("1 élément identifié");
      expect(html.match(/data-testid="ms-tile-non-recurring"[\s\S]*?<\/div>/)?.[0]).toContain("n.d.");
      expect(html).not.toMatch(/COLLAB_RC_PRIVE|CONTRAT_RC_PRIVE|PDF_RC_PRIVE|JUSTIFICATIF_RC_PRIVE/);
    } finally { state.ctx = previous; }
  });
  it('alimente la vignette principale avec le coût RC du bulletin rapproché au contrat, sans doublon manuel', async () => {
    const previous = state.ctx, syncId = '11111111-1111-4111-8111-111111111111';
    try {
      state.ctx = { ...(previous as object), read: { syncId, startedAt: new Date('2026-02-01T08:00:00Z'), months: input.months } };
      state.actualEvents = [{ id: '33333333-3333-4333-8333-333333333333', syncId, month: '2026-01', kind: 'rupture-conventionnelle', chargedCents: null, contractKeys: ['payfit:C1'], note: 'JUSTIFICATIF_RC_PRIVE_FICTIF' }];
      state.rcScan = { version: 1, id: '22222222-2222-4222-8222-222222222222', payrollSyncId: syncId, companyId: 'SOCIETE_FICTIVE', from: '2026-01', to: '2026-01', status: 'complete', startedAt: '2026-02-01T08:00:00.000Z', finishedAt: '2026-02-01T08:01:00.000Z', closedMonths: ['2026-01'], unavailableMonths: [], totalCollaborators: 1, completedCollaborators: 1, checkedPayslips: 1, issues: [], records: [{ month: '2026-01', collaboratorId: 'COLLAB_RC_PRIVE_FICTIF', contractId: 'C1', payslipId: 'PDF_RC_PRIVE_FICTIF', pdfHash: 'a'.repeat(64), parserVersion: 'fictif-v4', status: 'identified', code: 'identified', indemnityCents: 10000, components: [{ label: 'RC fictive non soumise', amountCents: 10000, page: 1, line: 8 }], cost: { status: 'value', code: 'fictif', employerChargesCents: 3500, chargedCents: 13500, components: [{ label: 'Contribution RC fictive', amountCents: 3500, page: 1, line: 6 }] } }] };
      const html = await page({ annee: '2026', de: '01', a: '01' });
      const tile = html.match(/data-testid="ms-tile-non-recurring"[\s\S]*?<\/div>/)![0];
      expect(tile).toContain('135'); expect(tile).not.toContain('n.d.');
      const summary = summaryPanel(html, 'ms-non-recurring-summary');
      expect(summary).toContain('data-money-cents="13500"'); expect(summary).toContain('1 élément identifié');
      expect(state.actualEvents[0].chargedCents).toBeNull();
      expect(html).not.toMatch(/COLLAB_RC_PRIVE|PDF_RC_PRIVE|JUSTIFICATIF_RC_PRIVE/);
      state.actualEvents = [];
      const sourceOnly = await page({ annee: '2026', de: '01', a: '01' });
      expect(sourceOnly.match(/data-testid="ms-tile-non-recurring"[\s\S]*?<\/div>/)![0]).not.toContain('n.d.');
      expect(sourceOnly).not.toContain('Aucun élément non récurrent identifié sur la période');
    } finally { state.ctx = previous; }
  });
  it("une RC sans montant et un tuilage chiffré sont visibles dès la synthèse, sans leurs sources individuelles", async () => {
    const previous = state.ctx;
    const syncId = "11111111-1111-4111-8111-111111111111";
    try {
      state.ctx = { ...(previous as object), read: { syncId, startedAt: new Date("2026-03-03T10:00:00Z"), months: input.months } };
      state.actualEvents = [
        { id: "22222222-2222-4222-8222-222222222222", syncId, month: "2026-01", kind: "tuilage", chargedCents: 12345, contractKeys: ["PRIVE_ENTRANT_FICTIF", "PRIVE_SORTANT_FICTIF"], note: "SOURCE_TUILAGE_PRIVEE_FICTIVE" },
        { id: "33333333-3333-4333-8333-333333333333", syncId, month: "2026-02", kind: "rupture-conventionnelle", chargedCents: null, contractKeys: [], note: "SOURCE_RC_PRIVEE_FICTIVE" },
      ];
      const html = await page({ annee: "2026", de: "01", a: "02", repartition: "mensuelle" });
      expectOutsideDetails(html, "ms-non-recurring-summary");
      const summary = summaryPanel(html, "ms-non-recurring-summary");
      expect(summary).toContain('data-money-cents="12345"');
      expect(summary).toContain("Montant à renseigner");
      expect(summary).toContain('data-testid="ms-non-recurring-summary-rupture-conventionnelle"');
      expect(summary).toContain('data-testid="ms-non-recurring-summary-tuilage"');
      expect(summary).toContain('href="/e/demo/studio-rh/masse-salariale?annee=2026&amp;de=01&amp;a=02&amp;repartition=mensuelle#actual-non-recurring"');
      for (const secret of ["PRIVE_ENTRANT_FICTIF", "PRIVE_SORTANT_FICTIF", "SOURCE_TUILAGE_PRIVEE_FICTIVE", "SOURCE_RC_PRIVEE_FICTIVE"]) expect(html).not.toContain(secret);
    } finally { state.ctx = previous; }
  });
  it("un tuilage d’une ancienne lecture expose son statut sans reprendre son montant dans la synthèse", async () => {
    const previous = state.ctx;
    try {
      state.ctx = { ...(previous as object), read: { syncId: "11111111-1111-4111-8111-111111111111", startedAt: new Date("2026-03-03T10:00:00Z"), months: input.months } };
      state.actualEvents = [{ id: "22222222-2222-4222-8222-222222222222", syncId: "44444444-4444-4444-8444-444444444444", month: "2026-01", kind: "tuilage", chargedCents: 98765, contractKeys: ["entrant-fictif", "sortant-fictif"], note: "Justificatif privé fictif" }];
      const summary = summaryPanel(await page(), "ms-non-recurring-summary");
      expect(summary).toContain("Lecture à vérifier");
      expect(summary).toContain("n.d.");
      expect(summary).not.toContain('data-money-cents="98765"');
    } finally { state.ctx = previous; }
  });
});

describe("Masse salariale, Fixe & variable et Paie & comptabilité (lot 10)", () => {
  it("Fixe & variable : fixe 3 000,00 € contre 2 700,00 € (+300,00 €, +11,11\u00a0%), primes 200,00 € contre 180,00 € (+20,00 €) : coûts en hausse, en rouge", async () => {
    const html = await page({ vue: "fixe-variable" });
    expect(shownHtml(html)).toContain(`N-1 : 2 700 € · écart <span class="ms-delta trend-bad">+300 €</span> · <span class="trend-bad">+11,11\u00a0%</span>`);
    expect(shownHtml(html)).toContain(`N-1 : 180 € · écart <span class="ms-delta trend-bad">+20 €</span> · <span class="trend-bad">+11,11\u00a0%</span>`);
    // Tableau par libellé : écart et écart (%) colorés ; total du brut +320,00 €.
    expect(shownHtml(html)).toContain(`<td class="num trend-bad">+320 €</td><td class="num trend-bad">+11,11\u00a0%</td>`);
    expect(html).toContain("<th scope=\"col\" class=\"num\">Écart</th><th scope=\"col\" class=\"num\">Écart (%)</th>");
    expect(count(html, /class="trend-legend"/g)).toBe(1);
    expect(html).not.toMatch(NARRATIF);
    expect(html).not.toMatch(/rubriques? « (Salaires et appointements|Primes) »[^<]*<\/span>|part du variable|rubrique à part, comptée dans le brut/);
    // Une rubrique sans ligne : la tuile le dit (jamais un zéro présenté comme lu) ; la limite des éléments non récurrents est conservée.
    expect(html).toContain("aucune ligne dans le journal sur la période");
    expect(html).toContain("Les indemnités restent dans la paie source. Leur identification et celle des tuilages passés se renseignent dans « Éléments non récurrents du réel », sans les ajouter une seconde fois.");
  });
  it("Paie & comptabilité : provision +140,00 € (1 400,00 € contre 1 260,00 €) en rouge ; rapprochement : −50,00 € en vert, +50,00 € en rouge, 0,00 € neutre", async () => {
    const html = await page({ vue: "paie-compta", annee: "2026", de: "01", a: "01" });
    expect(shownHtml(html)).toContain(`<span class="ms-delta trend-bad">+140 €</span>`);
    expect(shownHtml(html)).toContain(`<td class="num trend-good" data-col="ecart">−50 €</td>`);
    expect(shownHtml(html)).toContain(`<td class="num trend-bad" data-col="ecart">+50 €</td>`);
    expect(shownHtml(html)).toContain(`<td class="num" data-col="ecart">0 €</td>`);
    expect(count(html, /class="trend-legend"/g)).toBe(1);
    expect(html).not.toMatch(NARRATIF);
    expect(html).not.toMatch(/Écart = journal de paie − comptabilité|Écart par rubrique|Congés payés \+ charges sociales = provision/);
    expect(html).toContain('href="/e/demo/glossaire#def-ratio-produits"');
  });
});

describe("Masse salariale, source DSN (lot 10)", () => {
  const month = (m: string, status: DsnMonth["status"], byType: Record<string, number>): [string, DsnMonth] => [m, { month: m, status, sirets: ["000"], byType, messages: [] }];
  const dsn = new Map<string, DsnMonth>([month("2026-01", "complete", { "001": 1483000, "002": 5000 }), month("2026-02", "incomplete", { "001": 1000000 }), month("2025-01", "complete", { "001": 1300000 })]);
  const view = (sp: Record<string, string>) => {
    const html = renderToStaticMarkup(h(DsnView, { slug: "demo", dsn, sp: { annee: "", de: "", a: "", affichage: "", ...sp } }));
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
    return html;
  };
  it("brut déclaré janvier 2026 = 14 830,00 € contre 13 000,00 € : +1 830,00 € et +14,08\u00a0% (hausse : rouge) ; masse chargée n.d. avec sa raison", () => {
    const html = view({ annee: "2026", de: "01", a: "01" });
    expect(html).toContain(`<dd class="trend-bad">+14,08\u00a0%</dd>`);
    expect(shownHtml(html)).toContain(`<span class="ms-delta trend-bad">+1 830 €</span>`);
    expect(shownHtml(html)).toContain(`<td class="num trend-bad" data-col="ecart">+1 830 €</td>`);
    expect(html).toContain("n.d. — cotisations patronales non portées salarié par salarié par la DSN");
    expect(count(html, /class="trend-legend"/g)).toBe(1);
    expect(html).not.toMatch(NARRATIF);
    expect(html).not.toContain("ms-raw-notice");
    expect(html).not.toContain('id="def-');
    for (const id of [...html.matchAll(/\/e\/demo\/glossaire#def-([a-z0-9-]+)/g)].map((m) => m[1])) expect(glossaryEntry(id), id).toBeDefined();
  });
  it("mois à DSN incomplète : une ligne courte sous le graphique ; février 2025 non déposé : n.d., clé de lecture unique, jamais zéro", () => {
    const html = view({ annee: "2026", de: "01", a: "02" });
    expect(html).toContain("Mois à DSN incomplète (⚠ dans le tableau) : févr. 2026.");
    expect(count(html, /data-testid="ms-nd-key"/g)).toBe(1);
    expect(html).toContain('<dd class="nd">n.d.</dd>');
    expect(html).not.toContain('<dd class="trend-bad">');
    // La raison du mois n.d. est écrite sous le tableau (une seule fois), pas seulement au survol.
    expect(count(html, /févr\. 2025 : aucune DSN retenue/g)).toBe(1);
  });
});
