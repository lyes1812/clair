import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Espace, sources et budgets simulés (valeurs fictives écrites à la main) ------------------------------------------------------
const state = vi.hoisted(() => ({
  pay: null as unknown,
  payCalls: 0,
  budgets: [] as unknown[],
  scenarios: [] as unknown[],
  getScenario: null as null | ((id: string) => Promise<unknown>),
  getScenarioCalls: 0,
}));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace démo", slug, role: "reader" } }),
}));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => {
    state.payCalls++;
    return state.pay;
  },
}));
vi.mock("@/lib/budget/store", () => {
  class BudgetError extends Error {}
  return {
    BudgetError,
    KIND_LABELS: { budget: "Budget", revise: "Révisé", simulation: "Simulation" },
    listBudgets: async () => state.budgets,
    listScenarios: async () => state.scenarios,
    getScenario: async (_ws: string, id: string) => {
      state.getScenarioCalls++;
      return state.getScenario ? state.getScenario(id) : null;
    },
  };
});
vi.mock("@/lib/croisee-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/croisee-settings")>()),
  getCroiseeSettings: async () => ({ confidentialite: { kind: "absent" }, seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } }),
}));
// Journal de paie : chaque mois lu a une valeur ; trois services dont « non ventilé ».
vi.mock("@/lib/payroll/engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/payroll/engine")>()),
  monthPayroll: (_i: unknown, month: string) => ({ kind: "value", month }),
  servicesOf: () => ["Atelier", "Bureau", null],
}));

import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS, GLOSSARY_CROISEE } from "@/lib/glossary/croisee";
import {
  ALERT_LEVEL_LABELS,
  CHAPTER_IDS,
  cellView,
  croiseeHref,
  parseQuery,
  sortAlerts,
  sortHref,
  sortRows,
  sortState,
  sparkDrawable,
  sparkValues,
  tableNdReasons,
  variationTone,
  costVariation,
  plainVariation,
  type AlertSpec,
  type CroiseeColumn,
  type CroiseeTable,
  type TileSpec,
} from "@/lib/viz/croisee";
import { BudgetError } from "@/lib/budget/store";
import CroiseePage from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/page";
import { CHAPTER_TOTAL, CHAPTERS, chapterDef, chapterLinks, EN_CONSTRUCTION, neighbours } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import { loadCroiseeContext, once, type CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { AlertList, ChapterPrevu, ModelTable, NdNote, Pliant, Spark, Tuile, Tuiles } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/atomes";
import ChAbsences from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChAbsences";
import ChBudget from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChBudget";
import ChEffectifs from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffectifs";
import ChEffets from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffets";
import ChFixeVariable from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChFixeVariable";
import ChJuridique from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChJuridique";
import ChPaieCompta from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChPaieCompta";
import ChRestructuration from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChRestructuration";
import ChServices from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChServices";
import ChSynthese from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChSynthese";

const sp = (s: string) => s.replace(/[  ]/g, " "); // espaces insécables → espace
const WS = { id: "w1", name: "Espace démo", slug: "demo", role: "reader" as const };

// --- Chapitres -----------------------------------------------------------------------------------------------------------------
describe("chapitres", () => {
  it("dix identifiants uniques, dans l'ordre du contrat d'adresse, numérotés 01 à 10", () => {
    expect(CHAPTERS).toHaveLength(10);
    expect(CHAPTER_TOTAL).toBe("10");
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(10);
    expect(CHAPTERS.map((c) => c.id)).toEqual([...CHAPTER_IDS]);
    expect(CHAPTER_IDS).toEqual(["synthese", "effectifs", "absences", "fixe-variable", "services", "budget", "paie-compta", "effets", "restructuration", "juridique"]);
    expect(CHAPTERS.map((c) => c.num)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  });

  it("titre, question et description d'une ligne ; seuls Restructuration et Bibliothèque juridique sont « Prévu », sans filtres", () => {
    for (const c of CHAPTERS) {
      for (const t of [c.title, c.question, c.description]) {
        expect(t.trim()).not.toBe("");
        expect(t).not.toMatch(/\n/);
      }
      expect(c.question.length, c.id).toBeLessThanOrEqual(90);
      expect(c.question.endsWith("?"), c.id).toBe(true);
      expect(c.description.length, c.id).toBeLessThanOrEqual(60);
      for (const w of ["outil observé", "cahier", "webinaire", "capture", " tu ", " toi "]) expect(`${c.title} ${c.question} ${c.description}`.toLowerCase()).not.toContain(w);
    }
    expect(CHAPTERS.filter((c) => c.statut === "prevu").map((c) => c.id)).toEqual(["restructuration", "juridique"]);
    expect(CHAPTERS.filter((c) => !c.filtres).map((c) => c.id)).toEqual(["restructuration", "juridique"]);
  });

  it("précédent / suivant aux extrémités ; liens « Ce qui existe déjà » dans l'espace", () => {
    expect(neighbours("synthese")).toEqual({ prev: null, next: chapterDef("effectifs") });
    expect(neighbours("juridique")).toEqual({ prev: chapterDef("restructuration"), next: null });
    expect(neighbours("services").prev?.id).toBe("fixe-variable");
    expect(chapterLinks("demo", chapterDef("fixe-variable"))).toEqual([{ href: "/e/demo/studio-rh/masse-salariale?vue=fixe-variable", title: "Masse salariale › Fixe & variable", text: "Fixe, variable, primes par libellé." }]);
  });
});

// --- Glossaire -----------------------------------------------------------------------------------------------------------------
describe("glossaire de la Masse salariale croisée", () => {
  it("chaque identifiant de CROISEE_TERMS et de chaque chapitre existe au glossaire", () => {
    for (const id of Object.values(CROISEE_TERMS)) expect(glossaryEntry(id), id).toBeDefined();
    for (const c of CHAPTERS) for (const id of c.terms) expect(glossaryEntry(id), `${c.id} → ${id}`).toBeDefined();
  });

  it("vingt-trois entrées neuves, famille Masse salariale, sans « croisee-etp-proratise » (l'entrée etp-prorated est réutilisée)", () => {
    expect(GLOSSARY_CROISEE).toHaveLength(23);
    expect(GLOSSARY_CROISEE.map((e) => e.id)).toEqual(Object.values(CROISEE_TERMS).filter((id) => id.startsWith("croisee-")));
    for (const e of GLOSSARY_CROISEE) {
      expect(e.id).toMatch(/^croisee-/);
      expect(e.family).toBe("Masse salariale");
      expect(GLOSSARY.filter((g) => g.id === e.id)).toHaveLength(1);
      if (e.formula) expect(e.formula).not.toMatch(/\n/);
      expect(e.definition).not.toMatch(/\btu\b|\btoi\b|\bton\b|\btes\b/i);
    }
    expect(glossaryEntry("croisee-etp-proratise")).toBeUndefined();
    expect(CROISEE_TERMS.etpProratise).toBe("etp-prorated");
  });
});

// --- Adresse ---------------------------------------------------------------------------------------------------------------------
describe("paramètres d'adresse", () => {
  it("chapitre absent : Synthèse sans avis ; inconnu : Synthèse avec un avis court", () => {
    expect(parseQuery({}).chapitre).toBe("synthese");
    expect(parseQuery({}).notices).toEqual([]);
    const q = parseQuery({ chapitre: "inconnu" });
    expect(q.chapitre).toBe("synthese");
    expect(q.notices).toEqual(["paramètre ignoré : chapitre=inconnu (chapitre inconnu : Synthèse affichée)"]);
    expect(parseQuery({ chapitre: ["paie-compta", "services"] }).chapitre).toBe("paie-compta");
    expect(parseQuery({ chapitre: "x".repeat(60) }).notices[0]).toContain(`chapitre=${"x".repeat(40)}…`);
  });

  it("affichage, tri et sens validés ; année, mois, service, budget et scénario transmis tels quels au contexte", () => {
    const q = parseQuery({ chapitre: "services", affichage: "graphique", tri: "services.cout-n", sens: "asc", annee: " 2026 ", de: "01", a: "03", service: "Atelier", budget: "b1", scenario: "s1" });
    expect(q).toMatchObject({ chapitre: "services", affichage: "graphique", tri: "services.cout-n", sens: "asc", annee: "2026", de: "01", a: "03", service: "Atelier", budget: "b1", scenario: "s1", notices: [] });
    const bad = parseQuery({ affichage: "camembert", tri: "Coût N", sens: "haut" });
    expect(bad).toMatchObject({ affichage: "tout", tri: null, sens: null });
    expect(bad.notices).toEqual([
      "paramètre ignoré : affichage=camembert (valeurs : tout, graphique, tableau)",
      "paramètre ignoré : tri=Coût N (colonne inconnue)",
      "paramètre ignoré : sens=haut (valeurs : asc, desc)",
    ]);
  });

  it("croiseeHref : ordre fixe, valeurs vides et affichage « tout » omis, ancre", () => {
    const base = "/e/demo/studio-rh/masse-salariale/croisee";
    expect(croiseeHref(base, {})).toBe(base);
    expect(croiseeHref(base, { sens: "asc", chapitre: "services", annee: "2026", affichage: "tout", service: "__nv__", budget: null, tri: "services.cout-n" }, "cx-chapitre")).toBe(
      `${base}?chapitre=services&annee=2026&service=__nv__&tri=services.cout-n&sens=asc#cx-chapitre`,
    );
    expect(croiseeHref(base, { chapitre: "budget", affichage: "tableau", service: "R&D" })).toBe(`${base}?chapitre=budget&service=R%26D&affichage=tableau`);
  });
});

// --- Cellules : un n.d. n'est jamais 0 ----------------------------------------------------------------------------------------------
const col = (kind: CroiseeColumn["kind"], extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key: "k", header: "K", kind, ...extra });
describe("mise en forme des cellules par nature (cas écrits à la main)", () => {
  it("n.d. reste « n.d. » avec sa raison, dans toutes les natures ; cellule vide = sans objet", () => {
    for (const kind of ["text", "eur", "etp", "nombre", "pourcent", "date"] as const) {
      const v = cellView({ nd: "journal absent" }, col(kind, { costTrend: true, signed: true }));
      expect(v).toMatchObject({ text: "n.d.", nd: "journal absent", tone: "flat" });
      expect(v.text).not.toMatch(/\d/);
    }
    expect(cellView("", col("eur"))).toMatchObject({ text: "—", na: true, nd: null });
    expect(cellView(undefined, col("eur"))).toMatchObject({ text: "—", na: true });
  });

  it("valeurs en unité de base : centimes, dix-millièmes d'ETP, points de base", () => {
    expect(sp(cellView(123456, col("eur")).text)).toBe("1 234,56 €");
    expect(sp(cellView(-5000, col("eur")).text)).toBe("−50,00 €");
    expect(sp(cellView(5000, col("eur", { signed: true })).text)).toBe("+50,00 €");
    expect(sp(cellView(0, col("eur")).text)).toBe("0,00 €"); // un zéro connu reste un zéro
    expect(cellView(12345, col("etp")).text).toBe("1,23"); // 1,2345 ETP arrondi au centième, demi vers le haut
    expect(cellView(-2500, col("etp", { signed: true })).text).toBe("−0,25");
    expect(sp(cellView(1234, col("nombre")).text)).toBe("1 234");
    expect(cellView(534, col("pourcent")).text.replace(/\s/g, " ")).toBe("5,34 %"); // 534 points de base
    expect(cellView(25, col("pourcent", { points: true, signed: true })).text).toBe("+0,25 pts");
    expect(cellView("2026-03-31", col("date")).text).toBe("31/03/2026");
    expect(cellView("Atelier", col("text")).text).toBe("Atelier");
  });

  it("valeurs exactes dans l'unité affichée : ETP, fraction d'un pourcentage, euros", () => {
    expect(cellView({ exact: 1.23456 }, col("etp")).text).toBe("1,23");
    expect(cellView({ exact: 0.125 }, col("pourcent")).text.replace(/\s/g, " ")).toBe("12,50 %");
    expect(sp(cellView({ exact: 1234.5 }, col("eur")).text)).toBe("1 234,50 €");
    expect(cellView({ exact: 1.5 }, col("text"))).toMatchObject({ text: "n.d.", nd: "valeur numérique dans une colonne de texte" });
    expect(cellView(12.5, col("eur"))).toMatchObject({ text: "n.d.", nd: "valeur hors de l'unité de base" });
  });

  it("ton de tendance seulement sur une colonne d'écart de coût ; l'unité de la ligne remplace celle de la colonne", () => {
    expect(cellView(5000, col("eur", { costTrend: true })).tone).toBe("bad");
    expect(cellView(-5000, col("eur", { costTrend: true })).tone).toBe("good");
    expect(cellView(0, col("eur", { costTrend: true })).tone).toBe("flat");
    expect(cellView(5000, col("eur")).tone).toBe("flat");
    expect(cellView(3, col("nombre")).tone).toBe("flat");
    expect(cellView(12345, col("eur"), { kind: "etp" }).text).toBe("1,23");
    expect(cellView("Atelier", col("text"), { kind: "eur" }).text).toBe("Atelier");
  });
});

// --- Tableau du modèle --------------------------------------------------------------------------------------------------------
const TABLE: CroiseeTable = {
  id: "services",
  title: "Coût par service",
  columns: [
    { key: "service", header: "Service", kind: "text", sortable: true },
    { key: "cout-n", header: "Coût N", kind: "eur", sortable: true },
    { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: "evolution" },
  ],
  rows: [
    { cells: ["Atelier", 100000, 5000] },
    { cells: ["Bureau", { nd: "journal du mois absent" }, ""] },
    { cells: ["Comptoir", 250000, -2000], href: "/e/demo/x?service=Comptoir" },
  ],
  foot: { cells: ["Total", { nd: "journal du mois absent" }, 3000] },
  notes: ["Coût moyen : ce n'est pas un coût par ETP."],
};

describe("ModelTable", () => {
  const html = (p: Partial<Parameters<typeof ModelTable>[0]> = {}) => sp(renderToStaticMarkup(h(ModelTable, { table: TABLE, slug: "demo", ...p })));

  it("rôles, identifiant de test, total en pied ; n.d. en abréviation avec sa raison, raisons listées sous le tableau", () => {
    const out = html();
    expect(out).toContain('data-testid="cx-table-services"');
    expect(out).toContain('role="table"');
    expect(out).toContain('role="columnheader"');
    expect(out).toContain('role="rowheader"');
    expect(out).toContain("<tfoot");
    expect(out.match(/<abbr class="nd" title="journal du mois absent">n\.d\.<\/abbr>/g)).toHaveLength(2);
    expect(out).toContain('data-testid="cx-table-services-nd"');
    expect(out).toContain("<li>journal du mois absent</li>");
    expect(out).toContain('<span class="cx-na" title="sans objet">—</span>');
    expect(out).toContain("Coût moyen : ce n&#x27;est pas un coût par ETP.");
    // Écart de coût en hausse : rouge (trend-bad) ; en baisse : vert (trend-good). Le signe reste écrit.
    expect(out).toMatch(/class="num trend-bad"[^>]*>.*?\+50 €/);
    expect(out).toMatch(/class="num trend-good"[^>]*>.*?−20 €/);
    expect(out).toContain('href="/e/demo/x?service=Comptoir"');
    expect(out).toContain('aria-label="Définition : Écart"');
  });

  it("une cellule n.d. n'est jamais rendue 0", () => {
    const one: CroiseeTable = { id: "t", title: "T", columns: [col("text"), { key: "v", header: "V", kind: "eur" }], rows: [{ cells: ["Mois", { nd: "paie non clôturée" }] }] };
    const out = sp(renderToStaticMarkup(h(ModelTable, { table: one, slug: "demo" })));
    expect(out).not.toMatch(/data-money-cents="0"|0,00|>0 €/);
    expect(out).toContain('title="paie non clôturée">n.d.</abbr>');
    expect(tableNdReasons(TABLE)).toEqual(["journal du mois absent"]);
  });

  it("tri par l'adresse : en-têtes en liens avec aria-sort, n.d. en dernier, total jamais trié", () => {
    expect(sortState(TABLE, "services.cout-n", null)).toEqual({ key: "cout-n", dir: "desc" });
    expect(sortState(TABLE, "service", null)).toEqual({ key: "service", dir: "asc" });
    expect(sortState(TABLE, "autre.cout-n", "asc")).toBeNull();
    expect(sortState(TABLE, "services.ecart", "asc")).toBeNull(); // colonne non triable
    expect(sortRows(TABLE, "cout-n", "desc").map((r) => r.cells[0])).toEqual(["Comptoir", "Atelier", "Bureau"]);
    expect(sortRows(TABLE, "cout-n", "asc").map((r) => r.cells[0])).toEqual(["Atelier", "Comptoir", "Bureau"]);
    expect(sortRows(TABLE, "service", "desc").map((r) => r.cells[0])).toEqual(["Comptoir", "Bureau", "Atelier"]);
    expect(sortHref("/e/demo/c?chapitre=services&tri=x&sens=asc#ancre", "services", "cout-n", "desc")).toBe("/e/demo/c?chapitre=services&tri=services.cout-n&sens=desc#cx-table-services");
    const out = html({ sortBase: "/e/demo/c?chapitre=services", tri: "services.cout-n", sens: "desc" });
    expect(out).toContain('aria-sort="descending"');
    expect(out).toContain('aria-sort="none"');
    expect(out).toContain('href="/e/demo/c?chapitre=services&amp;tri=services.cout-n&amp;sens=asc#cx-table-services"');
    const order = ["Comptoir", "Atelier", "Bureau"].map((s) => out.indexOf(`>${s}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out.indexOf(">Total<")).toBeGreaterThan(order[2]);
    // Sans adresse de tri : aucun lien d'en-tête.
    expect(html()).not.toContain("cx-sort");
  });
});

// --- Mini-courbe -----------------------------------------------------------------------------------------------------------------
describe("Spark", () => {
  it("null reste null, jamais 0 ; un zéro connu reste un zéro", () => {
    expect(sparkValues([100, { nd: "n.d." }, null, undefined, Number.NaN, 0, 300])).toEqual([100, null, null, null, null, 0, 300]);
    expect(sparkDrawable([4, null, 6])).toBe(false); // points isolés : pas de tendance
    expect(sparkDrawable([4, 6, null])).toBe(true);
    expect(sparkDrawable([null, null])).toBe(false);
  });

  it("image nommée, ligne coupée au mois n.d., rien sans deux mois consécutifs connus", () => {
    const out = renderToStaticMarkup(h(Spark, { values: [100, 200, null, 300, 400], label: "Masse chargée sur douze mois" }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Masse chargée sur douze mois"');
    expect(out.match(/<polyline/g)).toHaveLength(2);
    expect(renderToStaticMarkup(h(Spark, { values: [100, null, 300], label: "x" }))).toBe("");
  });
});

// --- Cartes ------------------------------------------------------------------------------------------------------------------------
describe("Tuile", () => {
  const masse: TileSpec = {
    id: "masse",
    label: "Masse salariale chargée",
    term: "masse",
    sub: "janvier → mars 2026",
    value: { text: "300 000,00 €", kind: "value", reason: null },
    cost: true,
    main: true,
    variations: [costVariation("Écart N-1", 1000000, "+10 000,00 € (+3,45 %)"), plainVariation("N-1", "290 000,00 €")],
    spark: { label: "Masse chargée, douze mois", values: [1, 2, 3] },
  };
  it("coût en hausse : rouge (trend-bad) sur la variation, signe écrit ; identifiant cx-tile-<chapitre>-<id>", () => {
    const out = sp(renderToStaticMarkup(h(Tuile, { t: masse, chapter: "synthese", slug: "demo" })));
    expect(out).toContain('data-testid="cx-tile-synthese-masse"');
    expect(out).toMatch(/<span class="trend-bad">.*\+10 000 €/);
    expect(out).toContain('role="img"');
    expect(out).toContain("janvier → mars 2026");
  });
  it("le ton n'est jamais appliqué hors d'une carte de coût (effectif, ETP, taux)", () => {
    const etp: TileSpec = { id: "etp", label: "ETP moyen", value: { text: "12,50", kind: "value", reason: null }, variations: [{ label: "Écart", text: "+1,00 ETP", tone: "bad" }] };
    expect(variationTone(etp, etp.variations![0])).toBe("flat");
    const out = renderToStaticMarkup(h(Tuile, { t: etp, chapter: "effectifs", slug: "demo" }));
    expect(out).not.toContain("trend-");
  });
  it("n.d. : « n.d. » et sa raison écrite, sans valeur ni mini-courbe inventées", () => {
    const t: TileSpec = { id: "budget", label: "Écart au budget", value: { text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" }, cost: true, valueTone: "bad" };
    const out = renderToStaticMarkup(h(Tuile, { t, chapter: "synthese", slug: "demo" }));
    expect(out).toContain('<dd class="nd">n.d.</dd>');
    expect(out).toContain("aucun budget saisi pour 2026");
    expect(out).not.toContain("trend-");
  });
  it("six cartes : grille « six »", () => {
    const tiles = Array.from({ length: 6 }, (_, i) => ({ ...masse, id: `t${i}` }));
    expect(renderToStaticMarkup(h(Tuiles, { tiles, chapter: "synthese", slug: "demo", testid: "cx-tiles-synthese" }))).toContain('class="facts ms-tiles cx-tiles six"');
  });
});

// --- Alertes -------------------------------------------------------------------------------------------------------------------
describe("AlertList", () => {
  const alerts: AlertSpec[] = [
    { id: "mois-provisoire", level: "repere", label: "Mois provisoire", text: "mars 2026 : paie non clôturée." },
    { id: "budget-absent", level: "a-completer", label: "Budget absent", text: "aucun budget saisi pour 2026." },
    { id: "budget-depasse", level: "defavorable", label: "Budget dépassé", text: "+1 000,00 € sur la période." },
    { id: "seuil", level: "repere", label: "Seuil", text: "effectif proche d'un seuil." },
  ];
  it("ordre : défavorable, à compléter, repère ; ordre d'origine conservé dans un niveau ; aucun plafond", () => {
    expect(sortAlerts(alerts).map((a) => a.id)).toEqual(["budget-depasse", "budget-absent", "mois-provisoire", "seuil"]);
    expect(ALERT_LEVEL_LABELS).toEqual({ defavorable: "Défavorable", "a-completer": "À compléter", repere: "Repère" });
  });
  it("niveau écrit, pastille de forme propre, jamais de classe de tendance (rouge / vert)", () => {
    const out = renderToStaticMarkup(h(AlertList, { alerts, slug: "demo" }));
    expect(out).toContain('data-testid="cx-alerts"');
    for (const a of alerts) expect(out).toContain(`data-testid="cx-alert-${a.id}"`);
    expect(out).toContain("Défavorable");
    expect(out).toContain("À compléter");
    expect(out).toContain("Repère");
    expect(out).not.toMatch(/trend|--bad|--good/);
    expect(out.indexOf("cx-alert-budget-depasse")).toBeLessThan(out.indexOf("cx-alert-budget-absent"));
  });
  it("sans alerte : la phrase le dit", () => {
    expect(renderToStaticMarkup(h(AlertList, { alerts: [], slug: "demo" }))).toContain("Aucun point à surveiller sur ce périmètre.");
  });
});

// --- Autres atomes ---------------------------------------------------------------------------------------------------------------
describe("Pliant, NdNote, ChapterPrevu", () => {
  it("Pliant : details fermé par défaut, lien « Définitions et méthode » vers le glossaire (rien de recopié)", () => {
    const out = renderToStaticMarkup(h(Pliant, { title: "Détail", term: "masse", slug: "demo", children: "contenu" }));
    expect(out).toMatch(/^<details class="cx-fold">/);
    expect(out).toContain('href="/e/demo/glossaire#def-masse">Définitions et méthode</a>');
    expect(renderToStaticMarkup(h(Pliant, { title: "Détail", open: true, term: "inconnu", slug: "demo", children: "x" }))).not.toContain("Définitions et méthode");
  });
  it("NdNote : n.d., raison écrite et action", () => {
    const out = renderToStaticMarkup(h(NdNote, { reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" }, testid: "x" }));
    expect(out).toContain("n.d.");
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain('href="/e/demo/parametres#croisee"');
  });
  it("ChapterPrevu : identifiant cx-prevu-<id>, mention « Prévu », raison et liens existants", () => {
    const out = renderToStaticMarkup(h(ChapterPrevu, { slug: "demo", id: "juridique", reason: EN_CONSTRUCTION, links: chapterLinks("demo", chapterDef("juridique")) }));
    expect(out).toContain('data-testid="cx-prevu-juridique"');
    expect(out).toContain('<span class="tag">Prévu</span>');
    expect(out).toContain("Chapitre en cours de construction.");
    expect(out).toContain('href="/e/demo/glossaire"');
  });
});

// --- Les dix coquilles -------------------------------------------------------------------------------------------------------------
describe("coquilles des dix chapitres", () => {
  const views = { synthese: ChSynthese, effectifs: ChEffectifs, absences: ChAbsences, "fixe-variable": ChFixeVariable, services: ChServices, budget: ChBudget, "paie-compta": ChPaieCompta, effets: ChEffets, restructuration: ChRestructuration, juridique: ChJuridique };
  it("chacune rend « Prévu » avec la raison « chapitre en cours de construction »", () => {
    for (const c of CHAPTERS) {
      const ctx = { slug: "demo", chapter: c } as unknown as CroiseeContext;
      const out = renderToStaticMarkup(h(views[c.id], { ctx }));
      expect(out, c.id).toContain(`data-testid="cx-prevu-${c.id}"`);
      expect(out, c.id).toContain(EN_CONSTRUCTION);
    }
  });
});

// --- Contexte -------------------------------------------------------------------------------------------------------------------
const MONTHS = ["2025-01", "2025-02", "2025-03", "2026-01", "2026-02", "2026-03"];
function fakePay() {
  return {
    kpi: {
      collab: { source: { domain: "rh", chosen: "payfit", reason: "API connectée et appliquée.", mode: "auto", apiApplied: true, filesApplied: false, appliedAt: new Date("2026-04-02T08:00:00Z"), modeSetAt: null }, state: { kind: "ready" } },
      settings: { invalid: [] },
      input: null,
    },
    source: "payfit",
    read: { syncId: "s1", startedAt: new Date("2026-04-02T08:00:00Z"), months: MONTHS },
    unavailable: null,
    input: { lines: [], months: MONTHS, openMonths: ["2026-03"], grid: [], serviceAxis: "SVC" },
    service: { axis: "SVC", origin: "single-axis", updatedAt: null },
    axes: ["SVC"],
    compta: async () => ({ source: null, reason: "", lines: [], months: [], nd: {}, error: false }),
  };
}
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const BUDGETS = [
  { id: "b-old", name: "Budget initial", year: "2026", updatedAt: day("2026-01-10"), amounts: {} },
  { id: "b-new", name: "Budget révisé", year: "2026", updatedAt: day("2026-06-01"), amounts: {} },
  { id: "b-2025", name: "Budget 2025", year: "2025", updatedAt: day("2026-07-01"), amounts: {} },
];
const SCENARIOS = [
  { scenario: { id: "s-b", name: "Scénario B", firstMonth: "2027-01", lastMonth: "2027-12", status: "brouillon" }, refMonth: "2026-12" },
  { scenario: { id: "s-a", name: "Scénario A", firstMonth: "2026-04", lastMonth: "2026-12", status: "fige" }, refMonth: "2026-03" },
];

describe("contexte partagé", () => {
  beforeEach(() => {
    Object.assign(state, { pay: fakePay(), payCalls: 0, budgets: BUDGETS, scenarios: SCENARIOS, getScenario: null, getScenarioCalls: 0 });
  });

  it("once : une seule lecture, la même promesse ensuite", async () => {
    let n = 0;
    const f = once(async () => ++n);
    expect(await f()).toBe(1);
    expect(await f()).toBe(1);
    expect(n).toBe(1);
  });

  it("chapitre sans filtres : aucune source lue ; le scénario n'est lu qu'à la demande", async () => {
    const ctx = await loadCroiseeContext("demo", WS, { chapitre: "juridique" });
    expect(ctx.chapter.id).toBe("juridique");
    expect(ctx.period).toBeNull();
    expect(state.payCalls).toBe(0);
    expect(state.getScenarioCalls).toBe(0);
  });

  it("période par défaut : de janvier au dernier mois clos de la dernière année ; N-1 sur les mêmes mois", async () => {
    const ctx = await loadCroiseeContext("demo", WS, {});
    expect(ctx.period).toMatchObject({ year: 2026, from: "01", to: "02", months: ["2026-01", "2026-02"] });
    expect(ctx.prevMonths).toEqual(["2025-01", "2025-02"]);
    expect(ctx.labels).toEqual({ period: "janvier → février 2026", prev: "janvier → février 2025" });
    expect(ctx.openMonths).toEqual([]);
    expect(ctx.periodNd).toBeNull();
    expect(state.payCalls).toBe(1);
    await ctx.load.payroll();
    await ctx.load.kpi();
    expect(state.payCalls).toBe(1); // journal et référentiel lus une seule fois
  });

  it("mois non clos de la période signalé ; service « non ventilé » ; budget et scénario les plus récents de l'année par défaut", async () => {
    const ctx = await loadCroiseeContext("demo", WS, { a: "03", service: "__nv__" });
    expect(ctx.period?.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(ctx.openMonths).toEqual(["2026-03"]);
    expect(ctx.service).toMatchObject({ axis: "SVC", value: null, label: "Non ventilé", reason: null });
    expect(ctx.service.options.map((o) => o.value)).toEqual(["", "Atelier", "Bureau", "__nv__"]);
    expect(ctx.budget.selected?.id).toBe("b-new"); // modifié le plus récemment, parmi les budgets de 2026
    expect(ctx.budget.explicit).toBe(false);
    expect(ctx.budget.options.map((o) => o.value)).toEqual(["b-new", "b-old"]);
    expect(ctx.scenario.selected?.scenario.id).toBe("s-a"); // seul scénario qui couvre 2026
    expect(ctx.scenario.options.map((o) => o.value)).toEqual(["s-a"]);
    expect(ctx.notices).toEqual([]);
    expect(ctx.href({ chapitre: "services" })).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=services&annee=2026&de=01&a=03&service=__nv__");
  });

  it("choix explicites gardés dans l'adresse ; budget d'une autre année, scénario hors année et service inconnu : avis et défaut", async () => {
    const ok = await loadCroiseeContext("demo", WS, { chapitre: "budget", budget: "b-old", scenario: "s-a", service: "Atelier" });
    expect(ok.budget).toMatchObject({ explicit: true, reason: null });
    expect(ok.budget.selected?.id).toBe("b-old");
    expect(ok.scenario.explicit).toBe(true);
    expect(ok.href()).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&annee=2026&de=01&a=02&service=Atelier&budget=b-old&scenario=s-a");
    const ko = await loadCroiseeContext("demo", WS, { budget: "b-2025", scenario: "s-b", service: "Inconnu" });
    expect(ko.budget.selected?.id).toBe("b-new");
    expect(ko.scenario.selected?.scenario.id).toBe("s-a");
    expect(ko.service.value).toBeUndefined();
    expect(ko.notices).toEqual([
      "paramètre ignoré : service=Inconnu (service absent du journal)",
      "paramètre ignoré : budget=b-2025 (aucun budget saisi de ce nom pour 2026)",
      "paramètre ignoré : scenario=s-b (aucun scénario de ce nom ne couvre 2026)",
    ]);
  });

  it("sans budget ni scénario de l'année : n.d. avec la raison ; scénario à base altérée : n.d. avec le message", async () => {
    state.budgets = [BUDGETS[2]];
    state.scenarios = [SCENARIOS[0]];
    const ctx = await loadCroiseeContext("demo", WS, {});
    expect(ctx.budget).toMatchObject({ selected: null, reason: "aucun budget saisi pour 2026" });
    expect(ctx.scenario).toMatchObject({ selected: null, reason: "aucun scénario ne couvre 2026" });
    expect(await ctx.load.scenario()).toEqual({ kind: "nd", reason: "aucun scénario ne couvre 2026" });
    expect(state.getScenarioCalls).toBe(0);
    state.scenarios = SCENARIOS;
    state.getScenario = async () => {
      throw new BudgetError("Base figée altérée.");
    };
    const altered = await loadCroiseeContext("demo", WS, {});
    expect(await altered.load.scenario()).toEqual({ kind: "nd", reason: "Base figée altérée." });
    expect(await altered.load.scenario()).toEqual({ kind: "nd", reason: "Base figée altérée." });
    expect(state.getScenarioCalls).toBe(1); // mémoïsé
  });

  it("aucune source : période n.d. avec la raison, rien d'autre n'est lu", async () => {
    const p = fakePay();
    state.pay = { ...p, input: null, unavailable: "aucune lecture PayFit appliquée : connectez PayFit dans Données", service: { axis: null, origin: "none", updatedAt: null }, axes: [] };
    const ctx = await loadCroiseeContext("demo", WS, { service: "Atelier" });
    expect(ctx.period).toBeNull();
    expect(ctx.periodNd).toBe("Référentiel RH non construit");
    expect(ctx.budget.reason).toBe("Référentiel RH non construit");
    expect(ctx.service.reason).toBe("aucune lecture PayFit appliquée : connectez PayFit dans Données");
    expect(ctx.notices).toEqual(["paramètre ignoré : service=Atelier (aucune lecture PayFit appliquée : connectez PayFit dans Données)"]);
  });
});

// --- La page ---------------------------------------------------------------------------------------------------------------------
describe("page Masse salariale croisée", () => {
  beforeEach(() => {
    Object.assign(state, { pay: fakePay(), payCalls: 0, budgets: BUDGETS, scenarios: SCENARIOS, getScenario: null, getScenarioCalls: 0 });
  });
  const render = async (q: Record<string, string> = {}) => sp(renderToStaticMarkup(await CroiseePage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(q) })));

  it("gabarit : en-tête « Masse salariale », onglet croisée courant et non « Prévu », sommaire, onglets, filtres, chapitre, pied", async () => {
    const out = await render();
    expect(out).toContain("<h1>Masse salariale</h1>");
    expect(out).toMatch(/data-testid="ms-tabs"[\s\S]*?<a href="\/e\/demo\/studio-rh\/masse-salariale\/croisee" aria-current="page" data-tab="croisee">Masse salariale croisée<\/a>/);
    expect(out.match(/data-testid="ms-tabs"[\s\S]*?<\/nav>/)![0].match(/class="soon"/g)).toHaveLength(3);
    for (const id of ["cx-page", "cx-chapter-menu", "cx-chapter-tabs", "cx-chapter-head", "cx-filters", "cx-pager", "cx-foot", "cx-prevu-synthese", "cx-print-synthese", "cx-presets"]) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out).toContain("01 / 10");
    expect(out).toContain("Où en est la masse salariale face au budget, et où finit l&#x27;année ?");
    expect(out).toContain("Début du rapport");
    // Onglets de chapitres : navigation de liens (aria-current), sans tablist.
    expect(out).not.toContain('role="tablist"');
    expect(out).toMatch(/data-testid="cx-chapter-tabs"[\s\S]*?aria-current="page" data-tab="synthese"/);
    // Périmètre écrit une fois, budget et scénario retenus par défaut.
    expect(out).toContain("Budget : « Budget révisé »");
    expect(out).toContain("Scénario : « Scénario A »");
    expect(out.match(/janvier → février 2026/g)!.length).toBeLessThanOrEqual(2); // résumé du tiroir et en-tête d'impression
  });

  it("chapitre inconnu : Synthèse et un avis ; chapitre « Prévu » : pas de filtres ni de bouton de synthèse", async () => {
    const unknown = await render({ chapitre: "zz" });
    expect(unknown).toContain('data-chapter="synthese"');
    expect(unknown).toContain("paramètre ignoré : chapitre=zz (chapitre inconnu : Synthèse affichée)");
    state.payCalls = 0;
    const prevu = await render({ chapitre: "restructuration" });
    expect(prevu).toContain('data-testid="cx-prevu-restructuration"');
    expect(prevu).toContain("09 / 10");
    expect(prevu).not.toContain('data-testid="cx-filters"');
    expect(prevu).not.toContain('data-testid="cx-print-synthese"');
    expect(prevu).toContain('data-testid="cx-print"');
    expect(state.payCalls).toBe(0);
  });

  it("liens de chapitre : même période et service, tri retiré ; précédent / suivant vers l'en-tête du chapitre", async () => {
    const out = await render({ chapitre: "services", service: "Bureau", tri: "services.cout-n", sens: "asc" });
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau"');
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=fixe-variable&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau#cx-chapitre"');
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau#cx-chapitre"');
    // Réinitialiser : le chapitre seul.
    expect(out).toContain('<a class="btn" href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=services">Réinitialiser</a>');
  });
});
