import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DsnView } from "@/app/e/[slug]/studio-rh/masse-salariale/DsnView";
import { glossaryEntry } from "@/lib/glossary";
import type { DsnMonth } from "@/lib/payroll/dsn";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { linkOnlyKpi } from "./helpers/link-only-kpi";

// Écrans de la Masse salariale rendus de bout en bout (lot 10) sur un journal fictif écrit à la main : tendances rouge / vert d'un coût,
// aucun narratif, « ? » vers le glossaire, légende unique. Le contexte (base de données) est remplacé par un contexte fictif ; le seuil
// de confidentialité de l'espace vaut 1 (aucun groupe dénombré masqué ; voir ms-confidentialite.test.ts pour le masquage).
const state = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => state.ctx }));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => ({ kind: "set", value: 1, updatedAt: null, updatedBy: null }) }));
vi.mock("@/lib/payroll/non-recurring-store", () => ({ listActualEvents: async () => [], actualEventVersion: () => "fictif" }));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/actual-actions", () => ({ saveActualEventAction: async () => ({ ok: "fictif" }) }));

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
// Référentiel fictif : C1 et C2 sont les contrats de deux personnes distinctes (seuil compté en personnes) ; lien seul (linkOnlyKpi),
// aucun ETP de fin de mois dénombré.
state.ctx = {
  kpi: { collab: { workspace: { id: "w1", role: "reader" }, data: null }, input: linkOnlyKpi({ contracts: [{ contractKey: "payfit:C1", externalId: "C1", personKey: "P1" }, { contractKey: "payfit:C2", externalId: "C2", personKey: "P2" }] }) },
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
const NARRATIF = /Un graphique est une lecture|Sens de « n\.d\. »|Montants tels que (renvoyés|déclarés)|\(N − N-1\) ÷ N-1 =|brut \+ cotisations patronales<|Définitions et règles de calcul|ms-definitions|Coût = masse chargée \(brut|chaque chiffre renvoie à sa définition|une colonne hachurée est un mois n\.d\./i;

describe("Masse salariale, Synthèse : tendances, « ? », aucun narratif (lot 10)", () => {
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
    // Seuil 1 : le service (une personne) est affiché, sans garde de confidentialité.
    expect(html).toContain('data-money-cents="340000"');
    expect(html).not.toContain('data-testid="ms-service-guard"');
    // Ligne « Confidentialité » au-dessus des tableaux par service (seuil de l'espace, jamais une valeur par défaut).
    expect(html).toContain("Confidentialité : seuil de 1 personne");
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
