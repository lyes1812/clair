import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsencesView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChAbsences";
import { BlocksChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChBudget";
import { EffectifsView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffectifs";
import { FixeVariableChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChFixeVariable";
import { PaieComptaChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChPaieCompta";
import { ServicesChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChServices";
import { SyntheseView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChSynthese";
import { ChartNd, chartTitle, sameTitle } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/atomes";
import { AFFICHAGES, type Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import type { ChartSeries, UnitName } from "@/components/charts";
import type { CroiseeChart, CroiseeTable } from "@/lib/viz/croisee";
import type { AbsencesModel } from "@/lib/viz/croisee-absences";
import type { BlocksModel } from "@/lib/viz/croisee-budget";
import type { EffectifsModel } from "@/lib/viz/croisee-effectifs";
import type { FixeVariableModel, MasseChart, ServicesModel } from "@/lib/viz/croisee-masse";
import type { PaieModel } from "@/lib/viz/croisee-paie";
import { SYNTHESE_TABLE_IDS as ID, type SyntheseModel } from "@/lib/viz/croisee-synthese";

// Mission H3 (lot 12) : « le titre doublé ». Un bloc d'un chapitre porte UN titre visible (son h3, avec le « ? » du glossaire) ; le
// graphique qu'il contient ne le répète pas en texte visible (il garde son libellé accessible), un bloc à plusieurs graphiques garde
// des sous-titres distincts, un tableau seul n'a qu'une légende réservée aux lecteurs d'écran. Modèles fictifs écrits à la main,
// aucune donnée réelle.

// --- Règle de comparaison et garde n.d. (cas écrits à la main) -------------------------------------------------------------------
describe("sameTitle / chartTitle", () => {
  it("même titre : identique, ou à la casse, aux espaces (insécables compris) et à la ponctuation finale près", () => {
    expect(sameTitle("Absentéisme par mois", "Absentéisme par mois")).toBe(true);
    expect(sameTitle("Absentéisme par mois", "  absentéisme   PAR mois ")).toBe(true);
    expect(sameTitle("D'où vient l'écart de coût ?", "D'où vient l'écart de coût")).toBe(true);
    expect(sameTitle("Effectif : fin de mois", "Effectif : fin de mois")).toBe(true);
    expect(sameTitle("Brut par nature et par mois.", "Brut par nature et par mois")).toBe(true);
  });

  it("titre différent : un mot de plus ou de moins le distingue (jamais de rapprochement approximatif)", () => {
    expect(sameTitle("Répartition du coût", "Répartition du coût de la période")).toBe(false);
    expect(sameTitle("Cascade d'ETP", "Cascade des ETP moyens")).toBe(false);
    expect(sameTitle("Primes", "Primes par mois, N face à N-1")).toBe(false);
    expect(sameTitle("", "Primes")).toBe(false);
  });

  it("chartTitle : rien quand le bloc porte déjà ce titre, le titre du graphique sinon, et sans bloc le titre tel quel", () => {
    expect(chartTitle("Brut par nature et par mois", "Brut par nature et par mois")).toBeUndefined();
    expect(chartTitle("Composition du brut", "Répartition du brut de la période")).toBe("Répartition du brut de la période");
    expect(chartTitle(undefined, "Primes par mois, N face à N-1")).toBe("Primes par mois, N face à N-1");
  });
});

const sp = (s: string) => s.replace(/[  ]/g, " ");
const serie = (key: string, name: string, values: (number | null)[], reasons?: (string | null)[]): ChartSeries => ({ key, name, values, ...(reasons ? { reasons } : {}) });

describe("ChartNd", () => {
  const vide = [serie("a", "Série A", [null, null], ["journal du mois absent", "journal du mois absent"]), serie("b", "Série B", [null, null], ["mois non lu", null])];

  it("avec une valeur connue : rend l'enfant tel quel", () => {
    const out = renderToStaticMarkup(h(ChartNd, { testid: "cx-chart-x", heading: "Titre", series: [serie("a", "A", [null, 3])], children: h("i", { "data-testid": "enfant" }) }));
    expect(out).toBe('<i data-testid="enfant"></i>');
  });

  it("sans aucune valeur : état n.d. avec les raisons distinctes, sans titre quand le bloc le porte déjà, avec le sous-titre sinon", () => {
    const sans = renderToStaticMarkup(h(ChartNd, { testid: "cx-chart-x", series: vide, children: "jamais rendu" }));
    expect(sans).toContain('data-testid="cx-chart-x-vide"');
    expect(sans).toContain("Aucune valeur connue sur la période : graphique non tracé.");
    expect(sans).toContain("<li>journal du mois absent</li><li>mois non lu</li>");
    expect(sans).not.toContain("ms-sub");
    expect(sans).not.toContain("jamais rendu");
    const avec = renderToStaticMarkup(h(ChartNd, { testid: "cx-chart-x", heading: "Sous-titre du graphique", series: vide, children: null }));
    expect(avec).toContain('<h3 class="ms-sub">Sous-titre du graphique</h3>');
  });

  it("au-delà de trois raisons, le nombre des autres est dit", () => {
    const quatre = [serie("a", "A", [null, null, null, null], ["r1", "r2", "r3", "r4"])];
    const out = renderToStaticMarkup(h(ChartNd, { testid: "cx-chart-x", series: quatre, children: null }));
    expect(out).toContain("<li>r1</li><li>r2</li><li>r3</li>");
    expect(out).not.toContain("<li>r4</li>");
    expect(out).toContain("… et 1 autre raison.");
  });
});

// --- Modèles fictifs (valeurs écrites à la main) ---------------------------------------------------------------------------------
const MONTHS = ["janv.", "févr.", "mars"];
const MONTH_TITLES = ["janvier 2026", "février 2026", "mars 2026"];
const bars = (id: string, title: string, series: ChartSeries[], unit: UnitName = "nombre", mode: "grouped" | "stacked" = "grouped", tableId = id): CroiseeChart => ({ id, title, kind: "barres", unit, categories: MONTHS, categoryTitles: MONTH_TITLES, series, mode, tableId });
const courbe = (id: string, title: string, series: ChartSeries[], tableId = id): CroiseeChart => ({ id, title, kind: "courbe", unit: "eur", categories: MONTHS, categoryTitles: MONTH_TITLES, series, tableId });
const anneau = (id: string, title: string, parts: [string, number][], tableId = id): MasseChart => ({ id, title, kind: "anneau", unit: "eur", categories: parts.map((p) => p[0]), series: parts.map(([name, v]) => serie(name.toLowerCase(), name, [v])), tableId });
const cascade = (id: string, title: string, categories: string[], values: number[], unit: UnitName = "eur", tableId = id, trend?: "cost"): CroiseeChart => ({ id, title, kind: "cascade", unit, categories, series: [{ key: "cascade", name: title, values }], tableId, ...(trend ? { trend } : {}) });
const table = (id: string, title: string): CroiseeTable => ({
  id,
  title,
  columns: [
    { key: "mois", header: "Mois", kind: "text" },
    { key: "valeur", header: "Valeur", kind: "nombre" },
  ],
  rows: [{ cells: ["Janvier 2026", 12] }, { cells: ["Février 2026", 13] }],
  foot: { cells: ["Total", 25] },
});
const ND3 = ["journal du mois absent", "journal du mois absent", "journal du mois absent"];
const base = { tiles: [], alerts: [], limits: [], nd: null, terms: [] };

// 02 · Effectifs & mouvements : deux blocs à un graphique dont le titre est celui du bloc (le second sans aucune valeur connue), un
// bloc à deux tableaux (sous-titres h4 distincts).
const EFF = "Effectif en fin de mois, janvier → mars 2026 face à janvier → mars 2025";
const MV = "Entrées et sorties par mois, 2025 et 2026";
const REP = "Où sont les effectifs ?";
const effectifs: EffectifsModel = {
  ...base,
  chapter: "effectifs",
  charts: [bars("effectif-mensuel", EFF, [serie("n", "Fin de mois 2026", [10, 11, 12]), serie("n1", "Fin de mois 2025", [9, 9, null], [null, null, "mois hors de la lecture"])]), bars("mouvements", MV, [serie("entrees", "Entrées", [null, null, null], ND3), serie("sorties", "Sorties", [null, null, null], ND3)])],
  tables: [table("effectif-mensuel", `${EFF} (personnes)`), table("mouvements", `${MV} (contrats)`), table("effectifs-service", `${REP} Par service, fin mars 2026`), table("effectifs-categorie", `${REP} Par catégorie, fin mars 2026`)],
  blocks: [
    { id: "effectif", title: EFF, graph: true, nd: [], charts: ["effectif-mensuel"], tables: ["effectif-mensuel"], prevu: [] },
    { id: "mouvements", title: MV, graph: true, nd: [], charts: ["mouvements"], tables: ["mouvements"], prevu: [] },
    { id: "repartition", title: REP, nd: [], charts: [], tables: ["effectifs-service", "effectifs-categorie"], prevu: [] },
  ],
};

// 03 · Absences & congés : deux blocs à un graphique (barres groupées, puis empilées avec la bascule), titres égaux à ceux des blocs.
const ABS = "Absentéisme par mois";
const CONGES = "Demi-journées prises par motif et par mois";
const absences: AbsencesModel = {
  ...base,
  chapter: "absences",
  charts: [bars("absences-mensuel", ABS, [serie("taux", "Taux d'absentéisme", [120, 150, 90])], "bps"), bars("absences-conges", CONGES, [serie("cp", "Congés payés", [4, 6, 2]), serie("rtt", "RTT", [1, 0, 3])], "nombre", "stacked")],
  tables: [table("absences-mensuel", ABS), table("absences-conges", CONGES)],
  blocks: [
    { id: "mensuel", title: ABS, graph: true, nd: [], charts: ["absences-mensuel"], tables: [], prevu: [] },
    { id: "conges", title: CONGES, graph: true, nd: [], charts: ["absences-conges"], tables: [], prevu: [] },
  ],
};

// 04 · Fixe & variable : un bloc à deux graphiques (anneau et barres, sous-titres distincts du bloc), un bloc à un graphique au titre du bloc.
const MOIS = "Brut par nature et par mois";
const fixeVariable: FixeVariableModel = {
  ...base,
  chapter: "fixe-variable",
  trend: false,
  tileNd: [],
  prevu: [],
  charts: [anneau("fv-repartition", "Répartition du brut de la période", [["Fixe", 800000], ["Variable", 200000]], "fv-parts"), bars("fv-structure", "Structure du brut, N-1 et N", [serie("n1", "N-1", [700000, 700000, 700000]), serie("n", "N", [800000, 800000, 800000])], "eur", "grouped", "fv-composantes"), bars("fv-mois", MOIS, [serie("fixe", "Fixe", [260000, 270000, 270000]), serie("variable", "Variable", [60000, 70000, 70000])], "eur", "stacked")],
  tables: [table("fv-composantes", "Composantes du brut et de la masse chargée"), table("fv-parts", "Parts du brut"), table("fv-mois", MOIS)],
  blocks: [
    { id: "composition", title: "Composition du brut", graph: true, nd: [], charts: ["fv-repartition", "fv-structure"], tables: ["fv-composantes", "fv-parts"], notes: [] },
    { id: "mois", title: MOIS, graph: true, nd: [], charts: ["fv-mois"], tables: ["fv-mois"], notes: [] },
  ],
};

// 05 · Services : tableau seul, puis deux demi-blocs à un graphique ; le second a un titre de graphique différent de celui du bloc.
const CONTRIB = "Contribution des services à l'écart";
const services: ServicesModel = {
  ...base,
  chapter: "services",
  trend: false,
  count: 2,
  selected: null,
  charts: [
    { id: "services-contribution", title: CONTRIB, kind: "barres", unit: "eur", categories: ["Atelier", "Bureau"], series: [serie("ecart", "Écart N − N-1", [5000, -2000])], mode: "grouped", tableId: "services-table" },
    anneau("services-repartition", "Répartition du coût de la période", [["Atelier", 600000], ["Bureau", 400000]], "services-table"),
  ],
  tables: [table("services-table", "Coût par service")],
  blocks: [
    { id: "tableau", title: "Coût par service", graph: false, badge: "2 services", nd: [], charts: [], tables: ["services-table"], notes: [] },
    { id: "contribution", title: CONTRIB, graph: true, half: true, nd: [], charts: ["services-contribution"], tables: [], notes: [] },
    { id: "repartition", title: "Répartition du coût", graph: true, half: true, nd: [], charts: ["services-repartition"], tables: [], notes: [] },
  ],
};

// 07 · Paie & comptabilité : un graphique au titre différent, un graphique sans valeur au titre du bloc, un bloc à deux graphiques.
const RECON = "Journal de paie et comptabilité";
const paie: PaieModel = {
  ...base,
  chapter: "paie-compta",
  trend: false,
  prevu: [],
  charts: [
    bars("paie-charges-nature", "Charges de personnel par nature, janvier → mars 2026 face à N-1", [serie("n", "2026", [100000, 101000, 102000]), serie("n1", "2025", [90000, 91000, 92000])], "eur", "grouped", "paie-charges"),
    bars("paie-recon-mois", RECON, [serie("journal", "Journal de paie", [null, null, null], ND3), serie("compta", "Comptabilité", [null, null, null], ND3)], "eur"),
    bars("paie-provision-parts", "Provision fin de mois, janvier → mars 2026", [serie("conges", "Congés payés", [40000, 42000, 43000]), serie("charges", "Charges sociales", [16000, 16800, 17200])], "eur", "stacked", "paie-provision-mois"),
    courbe("paie-provision-n1", "Total de la provision, janvier → mars 2026 face à N-1", [serie("n", "Provision 2026", [56000, 58800, 60200]), serie("n1", "Provision N-1", [50000, 52000, 53000])], "paie-provision-mois"),
  ],
  tables: [table("paie-charges", "De la masse chargée aux charges de personnel du journal"), table("paie-recon-mois", "Rapprochement par mois : journal de paie et comptabilité"), table("paie-provision-mois", "Provision de congés payés à fin de mois, janvier → mars 2026 et N-1")],
  blocks: [
    { id: "charges", title: "De la masse chargée aux charges de personnel", graph: true, nd: [], notes: [], charts: ["paie-charges-nature"], tables: ["paie-charges"] },
    { id: "comptabilite", title: RECON, graph: true, nd: [], notes: [], charts: ["paie-recon-mois"], tables: ["paie-recon-mois"] },
    { id: "provision", title: "Provision de congés payés", graph: true, nd: [], notes: [], charts: ["paie-provision-parts", "paie-provision-n1"], tables: ["paie-provision-mois"] },
  ],
};

// 06 · Budget & prévisions : un graphique au titre du bloc, une courbe au titre différent, deux cascades (sous-titres distincts).
const ECART = "Écart au budget";
const budget: BlocksModel = {
  ...base,
  chapter: "budget",
  prevu: [],
  tileNd: [],
  trend: false,
  charts: [
    bars("budget-mensuel-chart", ECART, [serie("ecart", "Réalisé − budget", [2000, -1000, 0])], "eur", "grouped", "budget-mensuel"),
    courbe("budget-douze-mois", "Coût employeur par mois, 2026 : scénario, réalisé et budget", [serie("scenario", "Scénario « Base »", [100000, 100000, 110000]), serie("reel", "Réalisé", [100000, 101000, null], [null, null, "mois non clos"]), serie("budget", "Budget saisi", [98000, 98000, 98000])]),
    cascade("budget-atterrissage-cascade", "Atterrissage 2026 : réel puis projection", ["Réel janvier → mars", "Projection avril → décembre", "Atterrissage 2026"], [300000, 900000, 1200000], "eur", "budget-atterrissage"),
    cascade("budget-retraite-cascade", "De l'atterrissage 2026 à l'atterrissage retraité", ["Atterrissage 2026", "Éléments non récurrents", "Atterrissage retraité 2026"], [1200000, -50000, 1150000], "eur", "budget-atterrissage"),
  ],
  tables: [table("budget-mensuel", "Réalisé et budget saisi par mois, janvier → mars 2026"), table("budget-douze-mois", "Coût employeur par mois, 2026 : scénario « Base », réalisé et budget"), table("budget-atterrissage", "Atterrissage 2026 et atterrissage retraité, scénario « Base »")],
  blocks: [
    { id: "ecart", title: ECART, charts: ["budget-mensuel-chart"], tables: ["budget-mensuel"], nd: [], notes: [], links: [], trend: false },
    { id: "prevision", title: "Réalisé, projection et budget, 2026", charts: ["budget-douze-mois"], tables: ["budget-douze-mois"], nd: [], notes: [], links: [{ href: "/e/demo/studio-rh/hypotheses", label: "Comparaison dans Hypothèses budgétaires" }], trend: false },
    { id: "atterrissage", title: "Atterrissage 2026", charts: ["budget-atterrissage-cascade", "budget-retraite-cascade"], tables: ["budget-atterrissage"], nd: [], notes: [], links: [], trend: false },
  ],
};

// 08 · Effets d'évolution : une cascade de coût au titre différent, une cascade d'ETP au titre du bloc.
const ETP = "Cascade d'ETP";
const effets: BlocksModel = {
  ...base,
  chapter: "effets",
  prevu: [],
  tileNd: [],
  trend: false,
  charts: [
    cascade("effets-pont-cascade", "Masse salariale chargée, de N-1 à N : effet volume et effet coût moyen", ["N-1 (2025)", "Effet volume", "Effet coût moyen", "N (2026)"], [1000000, 60000, 40000, 1100000], "eur", "effets-pont", "cost"),
    cascade("effets-etp-cascade", ETP, ["ETP moyen 2025", "Entrées", "Sorties", "ETP moyen 2026"], [120000, 10000, -5000, 125000], "etp", "effets-etp"),
  ],
  tables: [table("effets-pont", "Pont de la masse salariale chargée, de N-1 (2025) à N (2026)"), table("effets-etp", "Cascade des ETP moyens, de N-1 (2025) à N (2026)")],
  blocks: [
    { id: "decomposition", title: "Décomposer la variation du coût", charts: ["effets-pont-cascade"], tables: ["effets-pont"], nd: [], notes: [], links: [], trend: false },
    { id: "etp", title: ETP, charts: ["effets-etp-cascade"], tables: ["effets-etp"], nd: [], notes: [], links: [], trend: false },
  ],
};

// 01 · Synthèse : graphique principal et composition sous un h3 (sans titre de graphique), cascade dans un bloc repliable.
const MAIN = "Masse salariale chargée par mois, 2026 : réel, projection, budget saisi et N-1";
const COMP = "Composition de la masse chargée, janvier → mars 2026";
const CASC = "D'où vient l'écart de coût ?";
const CASC_CHART = "Masse salariale chargée, de N-1 (2025) à N (2026) : contribution de chaque rubrique";
const synthese: SyntheseModel = {
  ...base,
  chapter: "synthese",
  prevu: [],
  tileNd: [],
  mentions: [],
  links: [],
  tableHref: "/t",
  tableHrefs: { composition: "/c", cascade: "/k" },
  trend: false,
  print: { max: 5, folded: 0 },
  servicesNote: null,
  charts: [bars(ID.mensuel, MAIN, [serie("reel", "Réel", [100000, 101000, null], [null, null, "mois non clos"]), serie("budget", "Budget saisi", [98000, 98000, 98000])], "eur"), anneau(ID.composition, COMP, [["Brut", 800000], ["Charges", 300000]]), cascade(ID.cascade, CASC_CHART, ["N-1 (2025)", "Brut", "Charges", "N (2026)"], [1000000, 80000, 20000, 1100000], "eur", ID.cascade, "cost")],
  tables: [table(ID.mensuel, MAIN), table(ID.composition, COMP), table(ID.cascade, "De la masse chargée N-1 (2025) à N (2026), par rubrique"), table(ID.services, "Coût par service, janvier → mars 2026"), table(ID.montants, "Chiffres clés de la période : montants")],
  blocks: [
    { id: "cartes", title: "Cartes de synthèse", tables: [], charts: [], nd: [], notes: [] },
    { id: "graphique", title: MAIN, tables: [ID.mensuel], charts: [ID.mensuel], nd: [], notes: [] },
    { id: "composition", title: COMP, tables: [ID.composition], charts: [ID.composition], nd: [], notes: [] },
    { id: "cascade", title: CASC, tables: [ID.cascade], charts: [ID.cascade], nd: [], notes: [] },
    { id: "services", title: "Tableau de synthèse par service", tables: [ID.services], charts: [], nd: [], notes: [] },
    { id: "chiffres", title: "Chiffres clés en tableau", tables: [ID.montants], charts: [], nd: [], notes: [] },
  ],
};

// --- Rendu des huit chapitres vivants -------------------------------------------------------------------------------------------
const TABLEAU = "/e/demo/studio-rh/masse-salariale/croisee?affichage=tableau";
const VIEWS: Record<string, (affichage: Affichage) => string> = {
  synthese: (affichage) => renderToStaticMarkup(h(SyntheseView, { model: synthese, slug: "demo", affichage })),
  effectifs: (affichage) => renderToStaticMarkup(h(EffectifsView, { model: effectifs, slug: "demo", affichage, tableauHref: TABLEAU })),
  absences: (affichage) => renderToStaticMarkup(h(AbsencesView, { model: absences, slug: "demo", affichage, tableauHref: TABLEAU })),
  "fixe-variable": (affichage) => renderToStaticMarkup(h(FixeVariableChapter, { model: fixeVariable, slug: "demo", affichage, tableauHref: TABLEAU })),
  services: (affichage) => renderToStaticMarkup(h(ServicesChapter, { model: services, slug: "demo", affichage, tableauHref: TABLEAU })),
  budget: (affichage) => renderToStaticMarkup(h(BlocksChapter, { model: budget, slug: "demo", affichage, tableauHref: TABLEAU })),
  "paie-compta": (affichage) => renderToStaticMarkup(h(PaieComptaChapter, { model: paie, slug: "demo", affichage, tableauHref: TABLEAU })),
  effets: (affichage) => renderToStaticMarkup(h(BlocksChapter, { model: effets, slug: "demo", affichage, tableauHref: TABLEAU })),
};

// Texte visible d'un fragment : sans la légende des tableaux réservée aux lecteurs d'écran, sans les « ? » du glossaire, sans balise
// (les attributs aria-label et title disparaissent avec elles), entités HTML de React rétablies (apostrophe, esperluette…).
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const visible = (html: string) =>
  unescape(
    sp(html)
      .replace(/<caption class="ms-sr">[\s\S]*?<\/caption>/g, "")
      .replace(/<a class="gloss-link"[^>]*>\?<\/a>/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const text = (inner: string) => visible(inner);
// Titres visibles d'un fragment : h3 et h4 (titres de bloc, sous-titres de tableau, état n.d.), summary (bloc repliable) et titres
// de graphique (.chart-title).
const titlesOf = (html: string): string[] => [
  ...[...html.matchAll(/<(h3|h4|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])),
  ...[...html.matchAll(/<span class="chart-title">([\s\S]*?)<\/span>/g)].map((m) => text(m[1])),
];
const chartTitles = (html: string): string[] => [...html.matchAll(/<span class="chart-title">([\s\S]*?)<\/span>/g)].map((m) => text(m[1]));
// Blocs d'un chapitre : sections « panel » et blocs repliables (details), chacun jusqu'à sa balise fermante (profondeur suivie).
function blocksOf(html: string): { head: string; html: string }[] {
  const out: { head: string; html: string }[] = [];
  const open = /<(section|details)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    if (!/class="(?:panel\b|cx-fold\b)/.test(m[0])) continue;
    const tok = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, "g");
    tok.lastIndex = m.index;
    let depth = 0;
    let end = -1;
    let t: RegExpExecArray | null;
    while ((t = tok.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    expect(end, m[0]).toBeGreaterThan(m.index);
    out.push({ head: m[0], html: html.slice(m.index, end) });
  }
  return out;
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("titres des blocs : aucun titre visible répété dans un bloc, pour chaque chapitre et chaque affichage", () => {
  for (const [chapter, render] of Object.entries(VIEWS)) {
    for (const affichage of AFFICHAGES) {
      it(`${chapter} · ${affichage}`, () => {
        const html = render(affichage);
        const blocks = blocksOf(html);
        expect(blocks.length, "au moins un bloc rendu").toBeGreaterThan(0);
        for (const b of blocks) {
          const titles = titlesOf(b.html).filter((t) => t !== "");
          const seen = new Set<string>();
          for (const t of titles) {
            expect(seen.has(t.toLowerCase()), `${chapter} · ${affichage} · ${b.head} : titre répété « ${t} »`).toBe(false);
            seen.add(t.toLowerCase());
          }
        }
      });
    }
  }
});

describe("02 · Effectifs & mouvements : le défaut relevé (titre du bloc répété en titre de graphique)", () => {
  it("affichage « tout » : le titre du bloc est écrit une fois en texte visible, le graphique n'a pas de titre visible, son libellé accessible le garde", () => {
    const html = VIEWS.effectifs("tout");
    expect(html).toContain(`<h3 id="cx-effectifs-effectif-titre" class="cx-eff-title">${EFF}`);
    expect(chartTitles(html)).toEqual([]);
    expect(count(visible(html), EFF)).toBe(1);
    expect(html).toContain(`aria-label="${EFF}, en nombre"`);
    expect(html).toContain('data-testid="cx-chart-effectif-mensuel"');
  });

  it("graphique sans aucune valeur connue : l'état n.d. ne répète pas le titre du bloc", () => {
    const html = VIEWS.effectifs("graphique");
    expect(html).toContain('data-testid="cx-chart-mouvements-vide"');
    expect(html).not.toContain("ms-sub");
    expect(count(visible(html), MV)).toBe(1);
  });

  it("bloc à plusieurs tableaux : sous-titres h4 distincts, différents du titre du bloc", () => {
    const html = VIEWS.effectifs("tableau");
    const rep = blocksOf(html).find((b) => b.head.includes('data-testid="cx-effectifs-repartition"'))!;
    expect(titlesOf(rep.html)).toEqual([REP, `${REP} Par service, fin mars 2026`, `${REP} Par catégorie, fin mars 2026`]);
  });

  it("chapitre entier n.d. : le titre du chapitre (déjà en tête de page) n'est pas répété", () => {
    const nd: EffectifsModel = { ...effectifs, nd: { reason: "aucune source RH retenue", action: { href: "/e/demo/donnees", label: "Données" } }, blocks: [], charts: [], tables: [] };
    const html = renderToStaticMarkup(h(EffectifsView, { model: nd, slug: "demo", affichage: "tout", tableauHref: TABLEAU }));
    expect(html).toContain('data-testid="cx-effectifs-nd"');
    expect(html).not.toContain("Effectifs &amp; mouvements");
    expect(html).not.toContain("ms-sub");
  });
});

describe("autres chapitres : titre masqué seulement quand il est celui du bloc, sous-titres conservés sinon", () => {
  it("03 · Absences : aucun titre de graphique visible, libellés accessibles conservés", () => {
    const html = VIEWS.absences("tout");
    expect(chartTitles(html)).toEqual([]);
    expect(count(visible(html), ABS)).toBe(1);
    expect(count(visible(html), CONGES)).toBe(1);
    expect(html).toContain(`aria-label="${ABS}, en pourcentage"`);
    expect(html).toContain(`aria-label="${CONGES}, en demi-journées"`);
  });

  it("04 · Fixe & variable : deux sous-titres distincts dans le bloc à deux graphiques, aucun dans le bloc au titre du graphique", () => {
    const html = VIEWS["fixe-variable"]("tout");
    const blocks = blocksOf(html);
    const composition = blocks.find((b) => b.head.includes('data-testid="cx-fixe-variable-composition"'))!;
    const mois = blocks.find((b) => b.head.includes('data-testid="cx-fixe-variable-mois"'))!;
    expect(chartTitles(composition.html)).toEqual(["Répartition du brut de la période", "Structure du brut, N-1 et N"]);
    expect(chartTitles(mois.html)).toEqual([]);
    expect(count(visible(mois.html), MOIS)).toBe(1);
  });

  it("05 · Services : contribution sans titre visible (titre du bloc), répartition avec son titre (différent du bloc)", () => {
    const html = VIEWS.services("tout");
    const blocks = blocksOf(html);
    const contribution = blocks.find((b) => b.head.includes('data-testid="cx-services-contribution"'))!;
    const repartition = blocks.find((b) => b.head.includes('data-testid="cx-services-repartition"'))!;
    expect(chartTitles(contribution.html)).toEqual([]);
    expect(count(visible(contribution.html), CONTRIB)).toBe(1);
    expect(chartTitles(repartition.html)).toEqual(["Répartition du coût de la période"]);
  });

  it("07 · Paie & comptabilité : titre différent affiché, titre du bloc masqué (y compris dans l'état n.d.), deux sous-titres distincts", () => {
    const html = VIEWS["paie-compta"]("tout");
    const blocks = blocksOf(html);
    const charges = blocks.find((b) => b.head.includes('data-testid="cx-paie-compta-charges"'))!;
    const compta = blocks.find((b) => b.head.includes('data-testid="cx-paie-compta-comptabilite"'))!;
    const provision = blocks.find((b) => b.head.includes('data-testid="cx-paie-compta-provision"'))!;
    expect(chartTitles(charges.html)).toEqual(["Charges de personnel par nature, janvier → mars 2026 face à N-1"]);
    expect(compta.html).toContain('data-testid="cx-chart-paie-recon-mois-vide"');
    expect(compta.html).not.toContain("ms-sub");
    expect(count(visible(compta.html), RECON)).toBe(1);
    expect(chartTitles(provision.html)).toEqual(["Provision fin de mois, janvier → mars 2026", "Total de la provision, janvier → mars 2026 face à N-1"]);
  });

  it("06 · Budget & prévisions : barres au titre du bloc sans titre visible, courbe titrée, deux cascades aux sous-titres distincts", () => {
    const html = VIEWS.budget("tout");
    const blocks = blocksOf(html);
    const ecart = blocks.find((b) => b.head.includes('data-testid="cx-budget-ecart"'))!;
    const prevision = blocks.find((b) => b.head.includes('data-testid="cx-budget-prevision"'))!;
    const att = blocks.find((b) => b.head.includes('data-testid="cx-budget-atterrissage"'))!;
    expect(chartTitles(ecart.html)).toEqual([]);
    expect(count(visible(ecart.html), ECART)).toBe(1);
    expect(chartTitles(prevision.html)).toEqual(["Coût employeur par mois, 2026 : scénario, réalisé et budget"]);
    expect(chartTitles(att.html)).toEqual(["Atterrissage 2026 : réel puis projection", "De l'atterrissage 2026 à l'atterrissage retraité"]);
  });

  it("08 · Effets d'évolution : cascade de coût titrée, cascade d'ETP sans titre visible (titre du bloc)", () => {
    const html = VIEWS.effets("tout");
    const blocks = blocksOf(html);
    const dec = blocks.find((b) => b.head.includes('data-testid="cx-effets-decomposition"'))!;
    const etp = blocks.find((b) => b.head.includes('data-testid="cx-effets-etp"'))!;
    expect(chartTitles(dec.html)).toEqual(["Masse salariale chargée, de N-1 à N : effet volume et effet coût moyen"]);
    expect(chartTitles(etp.html)).toEqual([]);
    expect(count(visible(etp.html), ETP)).toBe(1);
    expect(unescape(etp.html)).toContain(`aria-label="${ETP}, en équivalents temps plein"`);
  });

  it("01 · Synthèse : graphique principal et composition sous leur h3 seulement ; la cascade garde son titre quand il diffère du bloc repliable, le perd sinon", () => {
    const html = VIEWS.synthese("tout");
    expect(chartTitles(html)).toEqual([CASC_CHART]);
    expect(count(visible(html), MAIN)).toBe(1);
    expect(count(visible(html), COMP)).toBe(1);
    expect(count(visible(html), CASC)).toBe(1);
    expect(titlesOf(html)).toContain(CASC);
    const same: SyntheseModel = { ...synthese, charts: synthese.charts.map((c) => (c.id === ID.cascade ? { ...c, title: CASC } : c)) };
    const out = renderToStaticMarkup(h(SyntheseView, { model: same, slug: "demo", affichage: "tout" }));
    expect(chartTitles(out)).toEqual([]);
    expect(count(visible(out), CASC)).toBe(1);
    expect(unescape(out)).toContain(`aria-label="${CASC}, montants monétaires"`);
  });
});
