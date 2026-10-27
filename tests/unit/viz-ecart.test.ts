import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyseChart } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/AnalyseChart";
import { TitledWaterfall } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/TitledWaterfall";
import { Weight, weightText } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/Weight";
import { MsHeader, PanelTitle, PickerForm, toneClass, TrendLegend, VersionChain } from "@/app/e/[slug]/studio-rh/masse-salariale/EcartParts";
import type { Loaded } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { WaterfallChart } from "@/components/charts";
import { EcartChart } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/EcartChart";
import { LiveLink, LiveViewSwitch } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/LiveRub";
import { ECART_DEFINITIONS } from "@/lib/budget/ecart-definitions";
import { STEP_LABELS, type Cascade, type StepId } from "@/lib/budget/cascade";
import type { Bridge } from "@/lib/budget/series";
import { diff, nd, ROW_UNIT, val, type Agg, type Cell, type MonthFacts, type RowKey, type Version } from "@/lib/budget/versions";
import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { ECART_TERMS, GLOSSARY_ECART, STEP_TERMS } from "@/lib/glossary/ecart";
import { cascadeView, CHART_LABELS, COST_ROWS, ecartChartData, etpWaterfall, etpWaterfallOf, eurosSigned, gapTone, isCostRow, masseWaterfall, neg, periodText, pontWaterfall, rubricGroups, RUBRIC_KEYS, waterfallAxisBadge, type MasseRubric } from "@/lib/viz/ecart";

// Adaptateurs de l'écart budgétaire vers les graphiques : valeurs, raisons n.d., unités, styles de courbe, cascades.
// Cas écrits à la main (mêmes chiffres que le cas de référence de l'écran : base 66 420,00 €, variante 69 970,00 €).
const NA: Cell = { kind: "na" };
const facts = (month: string, over: Partial<MonthFacts>): MonthFacts => ({
  month, layer: "reel", source: "test",
  etp4: nd("ETP absent"), headcount: nd("effectif absent"), entrees: nd("entrées absentes"), sorties: nd("sorties absentes"),
  masse: nd("masse absente"), brut: nd("brut absent"), remun: nd("rémunération absente"), primes: nd("primes absentes"), indemnites: nd("indemnités absentes"),
  autres: NA, charges: nd("charges absentes"), nonventile: NA, free: {}, people: { kind: "nd", reason: "composition absente" }, ...over,
});
const version = (key: string, label: string, kind: Version["kind"], year: string, list: MonthFacts[]): Version => ({ key, label, kind, year, months: new Map(list.map((f) => [f.month, f])) });

// Réel 2025 : janvier 100 000 c, février 110 000 c, mars non clôturé (n.d.). ETP 1,00 / 1,00 / 1,20.
const reel = version("reel", "Réel PayFit 2025", "reel", "2025", [
  facts("2025-01", { masse: val(100000), etp4: val(10000), autres: NA }),
  facts("2025-02", { masse: val(110000), etp4: val(10000), autres: NA }),
  facts("2025-03", { masse: nd("paie non clôturée à la lecture"), etp4: val(12000), autres: NA }),
]);
// Scénario 2026 : trois mois projetés ; « autres » porte un vrai zéro en janvier (une valeur, pas un n.d.).
const scen = version("scen", "Scénario Révisé 2026", "scenario", "2026", [
  facts("2026-01", { layer: "projete", masse: val(120000), etp4: val(11000), autres: val(0) }),
  facts("2026-02", { layer: "projete", masse: val(130000), etp4: val(11000), autres: val(5000) }),
  facts("2026-03", { layer: "projete", masse: val(140000), etp4: val(13000), autres: val(0) }),
]);
const monthsOf = (v: Version) => (v.year === "2025" ? ["2025-01", "2025-02", "2025-03"] : ["2026-01", "2026-02", "2026-03"]);

const g = rubricGroups;
const visible = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

describe("courbes par version", () => {
  const d = ecartChartData([reel, scen], ["Réel 2025", "Révisé 2026"], monthsOf);
  it("axe : rangs de mois de la première version, libellés courts et titres complets", () => {
    expect(d.categories).toEqual(["janv.", "févr.", "mars"]);
    expect(d.categoryTitles).toEqual(["janvier", "février", "mars"]);
  });
  it("masse : version 1 en trait plein sans aire (réel), version 2 en pointillés avec aire (scénario) ; un mois n.d. reste null avec sa raison", () => {
    const m = d.byRubric.masse;
    expect(m.unit).toBe("eur");
    expect(m.series[0]).toEqual({ key: "v1", name: "Version 1 · Réel 2025", values: [100000, 110000, null], reasons: [null, null, "paie non clôturée à la lecture"], color: "var(--chart-1)", dashed: false, area: false });
    expect(m.series[1]).toEqual({ key: "v2", name: "Version 2 · Révisé 2026", values: [120000, 130000, 140000], reasons: [null, null, null], color: "var(--chart-3)", dashed: true, area: true });
  });
  it("ETP en dix-millièmes d'ETP, effectifs et mouvements en nombres, montants en centimes", () => {
    expect(d.byRubric.etp.unit).toBe("etp");
    expect(d.byRubric.etp.series[0].values).toEqual([10000, 10000, 12000]);
    expect(d.byRubric.headcount.unit).toBe("nombre");
    expect(d.byRubric.entrees.unit).toBe("nombre");
    expect(d.byRubric.charges.unit).toBe("eur");
  });
  it("rubrique sans objet pour une version (réel) : null et raison « sans objet », jamais zéro ; un vrai zéro de l'autre version reste 0", () => {
    const a = d.byRubric.autres;
    expect(a.series[0].values).toEqual([null, null, null]);
    expect(a.series[0].reasons).toEqual(Array(3).fill("rubrique sans objet pour cette version"));
    expect(a.series[1].values).toEqual([0, 5000, 0]);
  });
  it("mois absent de la version : n.d. « mois non couvert »", () => {
    const short = version("court", "Budget court", "budget", "2027", [facts("2027-01", { masse: val(90000) })]);
    const x = ecartChartData([short], ["Budget court"], () => ["2027-01", "2027-02"], ["masse"]);
    expect(x.byRubric.masse.series[0].values).toEqual([90000, null]);
    expect(x.byRubric.masse.series[0].reasons).toEqual([null, "mois non couvert par la version"]);
  });
  it("trois versions : la troisième prend la troisième teinte, en pointillés ; sans version, aucune série", () => {
    const x = ecartChartData([reel, scen, scen], ["a", "b", "c"], monthsOf, ["masse"]);
    expect(x.byRubric.masse.series.map((s) => [s.color, s.dashed])).toEqual([["var(--chart-1)", false], ["var(--chart-3)", true], ["var(--chart-2)", true]]);
    expect(ecartChartData([], [], () => []).byRubric.masse.series).toEqual([]);
  });
  it("rubriques du sélecteur : douze, sans doublon, dans les deux groupes Effectifs / Masse salariale", () => {
    expect(RUBRIC_KEYS).toHaveLength(12);
    expect(new Set(RUBRIC_KEYS).size).toBe(12);
    const g = rubricGroups();
    expect(g.map((x) => [x.label, x.options.length])).toEqual([["Effectifs", 4], ["Masse salariale", 8]]);
    expect(g[1].options[0]).toEqual({ key: "masse", label: "Masse salariale chargée" });
  });
  it("libellés du sélecteur : le graphique donne la valeur du mois, pas celle de la période du tableau", () => {
    expect(g().find((x) => x.label === "Effectifs")!.options.map((o) => o.label)).toEqual(["ETP de fin de mois", "Inscrits en fin de mois", "Entrées du mois", "Sorties du mois"]);
    expect(CHART_LABELS.masse).toBe("Masse salariale chargée");
    expect(CHART_LABELS.etp).not.toContain("moyenne");
  });
});

const step = (id: StepId, etp4: number) => ({ id, label: String(id), etp4, people: [] });
const sum = (w: { start: number; end: number; steps: { value: number }[] }) => w.start + w.steps.reduce((s, x) => s + x.value, 0);

describe("période en toutes lettres", () => {
  it("année entière, élision devant une voyelle, mois unique, rang inconnu", () => {
    expect(periodText("01", "12")).toBe("de janvier à décembre");
    expect(periodText("04", "06")).toBe("d'avril à juin");
    expect(periodText("08", "10")).toBe("d'août à octobre");
    expect(periodText("03", "03")).toBe("en mars");
    expect(periodText("13", "14")).toBe("rangs de mois 13–14");
  });
});

describe("cascades", () => {
  it("ETP : cinq contributions, départ + contributions = arrivée (61,00 + 0,33 ... en dix-millièmes), pas de résiduel quand il est nul", () => {
    const c: Cascade = { kind: "value", months: 3, start: 61000, end: 64300, residual: 0, steps: [step("entrees-new", 3300), step("entrees-report", 0), step("sorties", -1200), step("sorties-deport", 800), step("etp-change", 400)] };
    const w = etpWaterfall(c);
    expect(w).toMatchObject({ kind: "value", unit: "etp", start: 61000, end: 64300 });
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(w.steps.map((s) => s.value)).toEqual([3300, 0, -1200, 800, 400]);
    expect(sum(w)).toBe(w.end);
  });
  it("ETP : un résiduel d'arrondi non nul devient une barre, la somme reste égale à l'arrivée", () => {
    const c: Cascade = { kind: "value", months: 3, start: 61000, end: 64307, residual: 7, steps: [step("entrees-new", 3300), step("entrees-report", 0), step("sorties", -1200), step("sorties-deport", 800), step("etp-change", 400)] };
    const w = etpWaterfall(c);
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(w.steps.at(-1)).toEqual({ label: "Résiduel d'arrondi", value: 7 });
    expect(sum(w)).toBe(w.end);
  });
  it("ETP n.d. : la raison est transmise telle quelle", () => {
    expect(etpWaterfall({ kind: "nd", reason: "Réel 2025, 2025-03 : composition absente" })).toEqual({ kind: "nd", reason: "Réel 2025, 2025-03 : composition absente" });
  });
  it("ETP après seuil de confidentialité : tracée seulement quand aucun palier n'est n.d. ; un palier masqué ou un seuil non défini donne la raison, jamais une barre reconstituée", () => {
    const c: Cascade = { kind: "value", months: 3, start: 61000, end: 64300, residual: 0, steps: [step("entrees-new", 3300), step("entrees-report", 0), step("sorties", -1200), step("sorties-deport", 800), step("etp-change", 400)] };
    // Seuil 1 : aucun palier dénombré n'est masqué ; paliers sans salarié (people vides) : aucune personne à protéger.
    const shown = cascadeView(c, { kind: "set", value: 1 }, new Map(), null);
    expect(etpWaterfallOf(shown)).toEqual(etpWaterfall(c));
    const absent = cascadeView(c, { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" }, new Map(), null);
    expect(etpWaterfallOf(absent)).toEqual({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
    if (absent.kind !== "value") throw new Error("attendu : valeur");
    expect([absent.start, absent.end, absent.param]).toEqual([61000, 64300, true]); // totaux conservés, lien vers les Paramètres
    expect(etpWaterfallOf(cascadeView(c, { kind: "set", value: 1 }, new Map(), { reason: "non affiché (seuil de confidentialité : 2 personnes)", param: false }))).toEqual({ kind: "nd", reason: "non affiché (seuil de confidentialité : 2 personnes)" });
  });

  const rub = (key: string, label: string, delta: number | null, reason: string | null = null) => ({ key, label, delta, reason });
  it("masse : cas de l'écran (66 420,00 € → 69 970,00 €), une barre par rubrique, résiduel nul sans barre", () => {
    const m: MasseRubric = { kind: "value", start: 6642000, end: 6997000, residual: 0, steps: [rub("remun", "Rémunération de base", 187500), rub("primes", "Primes et éléments variables", 100000), rub("indemnites", "Indemnités et avantages", 0), rub("autres", "Autres rubriques saisies", 0), rub("charges", "Charges patronales", 67500), rub("nonventile", "Coûts chargés non ventilés", 0)] };
    const w = masseWaterfall(m);
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(w.unit).toBe("eur");
    expect(w.steps.map((s) => s.value)).toEqual([187500, 100000, 0, 0, 67500, 0]);
    expect(sum(w)).toBe(6997000);
  });
  it("masse : une rubrique n.d. n'est pas tracée ; sa part de l'écart (le résiduel) forme la barre « Rubriques n.d. »", () => {
    const m: MasseRubric = { kind: "value", start: 6642000, end: 6997000, residual: 100000, steps: [rub("remun", "Rémunération de base", 187500), rub("primes", "Primes et éléments variables", null, "Réel 2025 : primes absentes"), rub("charges", "Charges patronales", 67500)] };
    const w = masseWaterfall(m);
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(w.steps).toEqual([{ label: "Rémunération de base", value: 187500 }, { label: "Charges patronales", value: 67500 }, { label: "Rubriques n.d.", value: 100000 }]);
    expect(sum(w)).toBe(6997000);
  });
  it("masse : résiduel non nul sans rubrique n.d. = barre « Résiduel » ; masse n.d. ou résiduel null = n.d.", () => {
    const w = masseWaterfall({ kind: "value", start: 1000, end: 1500, residual: 20, steps: [rub("remun", "Rémunération de base", 480)] });
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(w.steps.at(-1)).toEqual({ label: "Résiduel", value: 20 });
    expect(masseWaterfall({ kind: "nd", reason: "Budget : montant non saisi" })).toEqual({ kind: "nd", reason: "Budget : montant non saisi" });
    expect(masseWaterfall({ kind: "value", start: 1, end: 2, residual: null, steps: [] }).kind).toBe("nd");
  });
  it("pont : coût de la version 1, effet volume +3 629,51 €, effet coût moyen −79,51 €, coût de la version 2", () => {
    const p: Bridge = { kind: "value", a: { cost: 6997000, etpMonths4: 193000 }, b: { cost: 6642000, etpMonths4: 183000 }, delta: 355000, volume: 362951, averageCost: -7951 };
    const w = pontWaterfall(p);
    expect(w).toEqual({ kind: "value", unit: "eur", start: 6642000, end: 6997000, steps: [{ label: "Effet volume", value: 362951 }, { label: "Effet coût moyen", value: -7951 }] });
    if (w.kind !== "value") throw new Error("attendu : valeur");
    expect(sum(w)).toBe(6997000);
    expect(pontWaterfall({ kind: "nd", reason: "ETP-mois nuls" })).toEqual({ kind: "nd", reason: "ETP-mois nuls" });
  });
});

describe("graphiques client rendus côté serveur", () => {
  const data = ecartChartData([reel, scen], ["Réel 2025", "Révisé 2026"], monthsOf);
  const props = { testid: "ecart-chart", groups: rubricGroups(), categories: data.categories, categoryTitles: data.categoryTitles, data: data.byRubric, period: "de janvier à mars", scope: "tous les services" };
  it("courbes : rubrique initiale, sélecteur par groupes, légende des versions, mois n.d. dits sous le graphique", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "masse" }));
    expect(html).toContain('data-testid="ecart-chart"');
    expect(html).toContain("<optgroup");
    expect(html).toContain("Version 1 · Réel 2025");
    expect(html).toContain("Version 2 · Révisé 2026");
    expect(html).toContain("Axe vertical à partir de zéro");
    expect(html).toContain("Mois sans valeur : Version 1 · Réel 2025 : 1 mois (paie non clôturée à la lecture)"); // mars n.d. : courbe interrompue, raison écrite
    expect(html).toContain("Axe vertical ajusté aux valeurs"); // mention d'axe du composant partagé : une seule ligne sous le graphique
  });
  it("sous le graphique : une seule limite de lecture (valeur du mois, pas de la période), les mois sans valeur et l'axe ; aucune phrase de lecture", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "masse" }));
    expect(html).not.toContain("ecart-chart-lecture");
    expect(html).not.toContain("ecart-reading");
    for (const phrase of ["Trait plein", "pointillés : versions suivantes", "zone teintée", "propre année", "moyenne des ETP"]) expect(html).not.toContain(phrase);
    expect(html).not.toContain('opacity="0.1"'); // axe ajusté : aucune aire dans le tracé
    const notes = [...html.matchAll(/<p class="chart-note">([^<]*)</g)].map((m) => m[1]);
    expect(notes).toHaveLength(1); // une seule note : limite de lecture, mois sans valeur, mention d'axe du composant
    expect(notes[0]).toMatch(/^Chaque point est la valeur du mois ; le tableau donne celle de la période\. Mois sans valeur : /);
  });
  it("le « ? » de l'axe est rendu à côté de la case d'axe quand le serveur le fournit", () => {
    const help = h("a", { className: "gloss-link", href: "/e/demo/glossaire#def-axe-ajuste" }, "?");
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "masse", axisHelp: help }));
    expect(html.indexOf("Axe vertical à partir de zéro")).toBeLessThan(html.indexOf("glossaire#def-axe-ajuste"));
    expect(renderToStaticMarkup(h(EcartChart, { ...props, initial: "masse" }))).not.toContain("gloss-link");
  });
  it("version sans aucune valeur sur une rubrique : sa raison est écrite sous le graphique (pas seulement au survol)", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "autres" }));
    expect(html).toContain('data-testid="ecart-chart"');
    expect(html).toContain("Aucune valeur à tracer : Version 1 · Réel 2025 (rubrique sans objet pour cette version)");
    expect(html).not.toContain("Version 2 · Révisé 2026 (");
  });
  it("ETP : l'option du sélecteur dit « de fin de mois » ; la limite « valeur du mois » est écrite une seule fois sous le graphique", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "etp" }));
    expect(html).toContain("ETP de fin de mois");
    expect(html).toContain("Chaque point est la valeur du mois ; le tableau donne celle de la période.");
    expect(html).not.toContain("moyenne des ETP");
  });
  it("rubrique sans aucune valeur : pas de courbe, un bloc n.d. avec la raison de chaque version", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "nonventile" }));
    expect(html).not.toContain('data-testid="ecart-chart"');
    expect(html).toContain('data-testid="ecart-chart-nd"');
    expect(html).toContain("n.d. — aucune valeur à tracer pour « Coûts chargés non ventilés");
    expect(html).not.toContain("chaque version est n.d. ou sans objet"); // la raison de chaque version est listée, pas de phrase en plus
    expect(html).toContain("rubrique sans objet pour cette version");
  });
  it("cascade : la rubrique initiale est tracée, une rubrique n.d. donne sa raison", () => {
    const etp = etpWaterfall({ kind: "value", months: 3, start: 61000, end: 64300, residual: 0, steps: [step("entrees-new", 3300), step("entrees-report", 0), step("sorties", -1200), step("sorties-deport", 800), step("etp-change", 400)] });
    const items = {
      etp: { label: "ETP", title: "ETP — de A à B", ariaLabel: "Cascade des ETP", startLabel: "A", endLabel: "B", data: etp },
      masse: { label: "Masse salariale chargée", title: "Masse", ariaLabel: "Cascade de la masse", startLabel: "A", endLabel: "B", data: { kind: "nd" as const, reason: "Budget : montant non saisi" } },
    };
    const options = [{ key: "etp", label: "ETP" }, { key: "masse", label: "Masse salariale chargée" }];
    const a = renderToStaticMarkup(h(AnalyseChart, { initial: "etp", options, items }));
    expect(a).toContain('data-testid="wf-etp"');
    expect(a).toContain("Rubrique analysée");
    const b = renderToStaticMarkup(h(AnalyseChart, { initial: "masse", options, items }));
    expect(b).not.toContain('data-testid="wf-masse"');
    expect(b).toContain("n.d. — Budget : montant non saisi");
  });
});

describe("liens qui gardent la rubrique du graphique", () => {
  it("sans adresse lisible, le lien et la bascule gardent la rubrique du rendu serveur ; ancre et paramètres conservés", () => {
    const l = renderToStaticMarkup(h(LiveLink, { initialRub: "primes", href: "/e/x/studio-rh/masse-salariale/ecart?v1=reel%3A2025&rub=masse&zoom=masse%3A1#zoom", title: "Détail", children: "+3 550,00 €" }));
    expect(l).toContain("rub=primes");
    expect(l).toContain("v1=reel%3A2025");
    expect(l).toContain("#zoom");
    const v = renderToStaticMarkup(h(LiveViewSwitch, { initialRub: "etp", testid: "t", label: "Affichage", current: "tout", options: [{ key: "tout", label: "Afficher tout", href: "/p?v1=a" }, { key: "graphique", label: "Graphique", href: "/p?v1=a&affichage=graphique" }] }));
    expect(v).toContain('value="/p?v1=a&amp;rub=etp"');
    expect(v).toContain('value="/p?v1=a&amp;affichage=graphique&amp;rub=etp"');
  });
});

// Axe d'une cascade : hauteur des totaux 61,00 → 64,30 ETP, contributions de quelques dixièmes. Calcul à la main : niveaux 61,00 ;
// 64,30 ; 64,30 ; 63,10 ; 63,90 ; 64,30 ; bas 61,00, haut 64,30, écart 3,30 = 5,1 % du haut (< 30 %) : axe tronqué. Départ de l'axe
// = 61,00 − 3,30 × 0,5 = 59,35, ramené par pas de 2,00 à 58,00 → « 5,8 » (dix-millièmes : 58 000 ÷ 10 000).
const wfSteps = (...v: number[]) => v.map((value, i) => ({ label: `étape ${i + 1}`, value }));
const etpSteps = wfSteps(3300, 0, -1200, 800, 400);
// Pont : 66 420,00 € → 70 049,51 € → 69 970,00 € ; bas 66 420,00 €, écart 3 629,51 € = 5,2 % du haut ; départ de l'axe 64 604,25 €, ramené par
// pas de 2 000,00 € à 64 000,00 € → « 64 k€ ».
const pontSteps = [{ label: "Effet volume", value: 362951 }, { label: "Effet coût moyen", value: -7951 }];

describe("badge d'axe tronqué des cascades", () => {
  it("ETP : « Axe tronqué à 5,8 ETP »", () => {
    expect(waterfallAxisBadge({ start: 61000, end: 64300, steps: etpSteps, unit: "etp" })).toBe("Axe tronqué à 5,8 ETP");
  });
  it("pont en euros : « Axe tronqué à 64 k€ » (l'unité est déjà dans la graduation)", () => {
    expect(waterfallAxisBadge({ start: 6642000, end: 6997000, steps: pontSteps, unit: "eur" })).toBe("Axe tronqué à 64 k€");
  });
  it("axe non tronqué : pas de badge (écart de 80 % du haut, départ à zéro, valeurs négatives, seuil exactement à 30 %)", () => {
    expect(waterfallAxisBadge({ start: 100000, end: 500000, steps: [{ label: "x", value: 400000 }], unit: "eur" })).toBeNull();
    expect(waterfallAxisBadge({ start: 0, end: 3000, steps: [{ label: "x", value: 3000 }], unit: "eur" })).toBeNull();
    expect(waterfallAxisBadge({ start: 5000, end: -2000, steps: [{ label: "x", value: -7000 }], unit: "eur" })).toBeNull();
    expect(waterfallAxisBadge({ start: 700, end: 1000, steps: [{ label: "x", value: 300 }], unit: "nombre" })).toBeNull(); // (1000 − 700) ÷ 1000 = 30 % pile
    expect(waterfallAxisBadge({ start: 701, end: 1000, steps: [{ label: "x", value: 299 }], unit: "nombre" })).toMatch(/^Axe tronqué à /); // 29,9 %
  });
  it("le badge dit la même valeur que la note du composant partagé (si le composant change de règle, ce test échoue)", () => {
    const cases = [
      { start: 61000, end: 64300, steps: etpSteps, unit: "etp" as const },
      { start: 6642000, end: 6997000, steps: pontSteps, unit: "eur" as const },
      { start: 100000, end: 500000, steps: [{ label: "x", value: 400000 }], unit: "eur" as const },
    ];
    for (const c of cases) {
      const html = renderToStaticMarkup(h(TitledWaterfall, { testid: "wf", title: "test", label: "test", startLabel: "A", endLabel: "B", ...c }));
      const fromNote = /il commence à (.*?)\./.exec(visible(html))?.[1];
      const badge = /Axe tronqué à .*$/.exec(visible(html.split('<div class="wf-scroll">')[0]))?.[0];
      if (fromNote === undefined) expect(badge).toBeUndefined();
      else expect(badge).toBe(`Axe tronqué à ${fromNote}${c.unit === "etp" ? " ETP" : ""}`);
    }
  });
});

describe("cascade titrée", () => {
  const base = { label: "Cascade de test", startLabel: "A", endLabel: "B" };
  it("axe tronqué : le badge est écrit à côté du titre, la note est hors de la zone qui défile", () => {
    const html = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-pont", title: "Du coût de la version 1 à celui de la version 2", note: "Note de test.", start: 6642000, end: 6997000, steps: pontSteps, unit: "eur" }));
    expect(html).toMatch(/<h3 class="chart-title" id="wf-pont-titre">Du coût de la version 1 à celui de la version 2<\/h3><span class="wf-badge" data-testid="wf-pont-axe"[^>]*>Axe tronqué à /);
    expect(visible(html.split('<div class="wf-scroll">')[0])).toContain("Axe tronqué à 64 000 €");
    expect(html).toContain('data-money-cents="6400000"');
    expect(html).toContain('aria-labelledby="wf-pont-titre"');
    expect(html).toContain('data-testid="wf-pont"'); // la figure du composant partagé est conservée
    expect(html.indexOf('class="wf-scroll"')).toBeLessThan(html.indexOf('data-testid="wf-pont"'));
    expect(html.indexOf('data-testid="wf-pont"')).toBeLessThan(html.indexOf("Note de test."));
    expect(html.indexOf("Note de test.")).toBeGreaterThan(html.indexOf("</figure>"));
  });
  it("largeur minimale du tracé : 58 px par barre + 56 px de marge ; mention de défilement à partir de 5 barres", () => {
    const pont = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-pont", title: "Pont", start: 6642000, end: 6997000, steps: pontSteps, unit: "eur" }));
    expect(pont).toContain("--wf-min:288px"); // 4 barres : (2 + 2) × 58 + 56
    expect(pont).not.toContain("wf-hint");
    const etp = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-etp", title: "ETP", start: 61000, end: 64300, steps: etpSteps, unit: "etp" }));
    expect(etp).toContain("--wf-min:462px"); // 7 barres : (5 + 2) × 58 + 56
    expect(etp).toContain("Axe tronqué à 5,8 ETP");
    expect(etp).not.toContain("wf-hint"); // plus de phrase sur le défilement : le glossaire la porte, le dégradé de bord l'indique
    expect(etp).not.toContain("faire défiler");
  });
  it("badge d'axe : texte seul (plus d'infobulle explicative), suivi du « ? » fourni par le serveur ; pas de « ? » sans badge", () => {
    const help = h("a", { className: "gloss-link", href: "/e/demo/glossaire#def-axe-ajuste" }, "?");
    const props = { ...base, testid: "wf-pont", title: "Pont", unit: "eur" as const };
    const tronque = renderToStaticMarkup(h(TitledWaterfall, { ...props, start: 6642000, end: 6997000, steps: pontSteps, axisHelp: help }));
    expect(tronque).not.toContain("proportionnelle");
    expect(tronque).toMatch(/data-testid="wf-pont-axe">Axe tronqué à <span class="money-display"[^>]*>[^<]*<\/span><\/span><a class="gloss-link"/);
    expect(visible(tronque.split('<div class="wf-scroll">')[0])).toContain("Axe tronqué à 64 000 €");
    const large = renderToStaticMarkup(h(TitledWaterfall, { ...props, start: 100000, end: 500000, steps: [{ label: "x", value: 400000 }], axisHelp: help }));
    expect(large).not.toContain("gloss-link");
  });
  it("tendance : « cost » colore les cascades en euros (légende « Hausse de coût / Baisse de coût »), sans la prop la cascade d'ETP reste bleue et grise", () => {
    const eur = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-pont", title: "Pont", start: 6642000, end: 6997000, steps: pontSteps, unit: "eur", trend: "cost" }));
    expect(eur).toContain("Hausse de coût");
    expect(eur).toContain("Baisse de coût");
    expect(eur).toContain('fill="var(--bad)"'); // effet volume : hausse de coût
    expect(eur).toContain('fill="var(--good)"'); // effet coût moyen : baisse de coût
    const etp = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-etp", title: "ETP", start: 61000, end: 64300, steps: etpSteps, unit: "etp" }));
    expect(etp).not.toContain("var(--bad)");
    expect(etp).not.toContain("var(--good)");
    expect(etp).not.toContain("de coût");
  });
  it("axe non tronqué : pas de badge", () => {
    const html = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-x", title: "Large", start: 100000, end: 500000, steps: [{ label: "x", value: 400000 }], unit: "eur" }));
    expect(html).not.toContain("wf-badge");
    expect(html).not.toContain("Axe tronqué");
  });
});

describe("signe moins des montants affichés", () => {
  it("« − » typographique pour les montants négatifs et les nombres, « + » écrit pour un écart positif, zéro sans signe", () => {
    const norm = (t: string) => t.replace(/\s/g, " ");
    expect(norm(neg("-79,51 €"))).toBe("−79,51 €");
    expect(neg("−0,50")).toBe("−0,50"); // déjà typographique : inchangé
    expect(neg("-1")).toBe("−1");
    expect(neg("12 €")).toBe("12 €");
    expect(norm(eurosSigned(-7951))).toBe("−79,51 €");
    expect(norm(eurosSigned(355000))).toBe("+3 550,00 €");
    expect(norm(eurosSigned(0))).toBe("0,00 €");
  });
});

describe("barre de filtres commune à l'écart budgétaire et à l'analyse des écarts", () => {
  const long = "Scénario « Variante T4 » (Révisé, brouillon) 2026";
  const loaded = {
    options: [{ value: "reel:2025", label: "Réel PayFit 2025" }, { value: "scenario:s1:2026", label: long }],
    selected: ["reel:2025", "scenario:s1:2026"], from: "01", to: "12", services: ["A", "B"], hasNv: false, filter: null,
  } as unknown as Loaded;
  const count = (html: string, cls: string) => (html.match(new RegExp(`class="field-row ${cls}(?: [^"]*)?"`, "g")) ?? []).length;
  it("même grille : versions (3 ou 2) sur la première ligne, puis premier mois, dernier mois, service et boutons", () => {
    const three = renderToStaticMarkup(h(PickerForm, { path: "/p", loaded, columns: 3 }));
    const two = renderToStaticMarkup(h(PickerForm, { path: "/p", loaded, columns: 2 }));
    expect([count(three, "ef-v"), count(two, "ef-v")]).toEqual([3, 2]);
    for (const html of [three, two]) {
      expect([count(html, "ef-m"), count(html, "ef-s")]).toEqual([2, 1]);
      expect(html).toContain('class="filters ecart-filters"');
      expect(html.indexOf('id="v1"')).toBeLessThan(html.indexOf('id="de"'));
      expect(html.indexOf('id="a"')).toBeLessThan(html.indexOf('id="service"'));
      expect(html.indexOf('id="service"')).toBeLessThan(html.indexOf("ecart-filter-actions"));
      expect(html).toContain(">Afficher<");
      expect(html).toContain(">Réinitialiser<");
    }
    expect(three.match(/ef-m1/g)).toHaveLength(1); // le premier mois ouvre la seconde ligne de la grille, même avec 2 versions seulement
    expect(two.match(/ef-m1/g)).toHaveLength(1);
    expect(three).toContain('id="v3"');
    expect(two).not.toContain('id="v3"');
  });
  it("avec l'espace, le premier mois porte son « ? » vers « Rangs de mois » ; sans l'espace, aucun lien", () => {
    const withHelp = renderToStaticMarkup(h(PickerForm, { path: "/p", loaded, columns: 2, slug: "demo" }));
    expect(withHelp).toMatch(/Premier mois<a class="gloss-link" href="\/e\/demo\/glossaire#def-rangs-de-mois"/);
    expect(withHelp.match(/gloss-link/g)).toHaveLength(1);
    expect(renderToStaticMarkup(h(PickerForm, { path: "/p", loaded, columns: 2 }))).not.toContain("gloss-link");
  });
  it("le libellé complet de la version choisie est répété en infobulle du champ", () => {
    const html = renderToStaticMarkup(h(PickerForm, { path: "/p", loaded, columns: 2 }));
    expect(html).toContain(`title="${long}"`);
  });
  it("versions en toutes lettres : pastille, mot « Version n » pour la lecture à voix haute, libellé complet", () => {
    const html = renderToStaticMarkup(h(VersionChain, { labels: ["Réel PayFit 2025", long] }));
    expect(html).toContain("Version 1 : ");
    expect(html).toContain("Version 2 : ");
    expect(html).toContain(long);
    expect(html).toContain('<span class="ver-badge" aria-hidden="true">2</span>');
    const second = renderToStaticMarkup(h(VersionChain, { labels: ["B", "C"], first: 2 }));
    expect(second).toContain('<span class="ver-badge" aria-hidden="true">2</span>');
    expect(second).toContain('<span class="ver-badge" aria-hidden="true">3</span>');
  });
});

// Glossaire des écarts : chaque explication retirée des écrans y est (cas écrits à la main : les phrases d'origine, reprises).
describe("glossaire des écarts", () => {
  const entry = (id: string) => GLOSSARY_ECART.find((e) => e.id === id)!;
  it("chaque identifiant vers lequel les écrans renvoient existe, une seule fois dans tout le glossaire", () => {
    const ids = [...Object.values(ECART_TERMS), ...Object.values(STEP_TERMS)];
    expect(ids.length).toBeGreaterThanOrEqual(22);
    for (const id of ids) {
      expect(glossaryEntry(id), id).toBeDefined();
      expect(GLOSSARY.filter((e) => e.id === id), id).toHaveLength(1);
    }
    expect(new Set(GLOSSARY_ECART.map((e) => e.id)).size).toBe(GLOSSARY_ECART.length);
  });
  it("les anciennes ancres #def-<id> sont conservées (mêmes identifiants que les définitions d'origine)", () => {
    expect(ECART_DEFINITIONS.map((d) => d.id).sort()).toEqual(["cascade", "contributions", "ecart", "effectifs", "rubriques", "versions", "zoom"]);
    for (const d of ECART_DEFINITIONS) expect(entry(d.id)?.family, d.id).toBe("Écarts");
  });
  it("un « ? » par palier de la cascade d'ETP : mêmes cinq paliers que les libellés de la cascade", () => {
    expect(Object.keys(STEP_TERMS).sort()).toEqual(Object.keys(STEP_LABELS).sort());
    expect(entry(STEP_TERMS["entrees-new"]).definition).toContain("présents dans la version 2 et jamais présents dans la version 1");
    expect(entry(STEP_TERMS.sorties).definition).toContain("présents dans la version 1 et jamais présents dans la version 2");
    expect(entry(STEP_TERMS["entrees-report"]).definition).toContain("plus de mois de présence dans la version 2 que dans la version 1");
    expect(entry(STEP_TERMS["sorties-deport"]).definition).toContain("moins de mois de présence dans la version 2 que dans la version 1");
    expect(entry(STEP_TERMS["etp-change"]).definition).toContain("quotité moyenne diffère");
  });
  it("vocabulaire : version 1 et version 2, jamais A ou B ; aucun terme interdit ni tutoiement", () => {
    for (const e of GLOSSARY_ECART) {
      const text = `${e.term} ${e.definition} ${e.formula ?? ""}`;
      expect(text, e.id).not.toMatch(/\b(version|versions) [AB]\b/);
      expect(text, e.id).not.toMatch(/ (en|pendant|de) [AB]\b/);
      for (const w of ["outil observé", "cahier", "webinaire", "capture", " toi ", "avec toi", " tu "]) expect(text.toLowerCase(), `${e.id} : ${w}`).not.toContain(w);
    }
  });
  it("écart, écart en pourcentage, poids : les règles écrites sous les tableaux sont déplacées", () => {
    expect(entry("ecart").definition).toContain("valeur de la version suivante − valeur de la version précédente");
    expect(entry("ecart").formula).toBe("écart = version suivante − version précédente");
    expect(entry("ecart-pourcentage").definition).toContain("n.d. quand cette valeur est nulle");
    expect(entry("ecart-pourcentage").definition).toContain("Une contribution d'ETP n'a pas de valeur de départ propre");
    expect(entry("poids-ecarts").formula).toBe("poids = contribution ÷ écart total");
    expect(entry("poids-ecarts").definition).toContain("écart total est nul");
  });
  it("courbes, cascades, axe ajusté, rangs de mois, pont, résiduel : les notes de lecture sont déplacées", () => {
    const courbes = entry("ecart-courbes").definition;
    for (const phrase of ["Trait plein : version 1", "zone teintée", "valeur du mois", "valeur de la période", "interrompt la courbe"]) expect(courbes, phrase).toContain(phrase);
    expect(entry("axe-ajuste").definition).toContain("ne part pas de zéro");
    expect(entry("axe-ajuste").definition).toContain("Axe tronqué à");
    expect(entry("ecart-cascades").definition).toContain("départ + contributions (+ résiduel) = arrivée");
    expect(entry("ecart-cascades").definition).toContain("Rubriques n.d.");
    expect(entry("rangs-de-mois").definition).toContain("appliqués à l'année de chaque version");
    expect(entry("pont-volume-cout").definition).toContain("effet de structure");
    expect(entry("pont-volume-cout").formula).toContain("coût par ETP-mois v1");
    expect(entry("residuel").definition).toContain("nul par construction");
    expect(entry("analyse-ecarts").definition).toContain("réservé aux administrateurs et aux éditeurs");
    expect(entry("zoom").definition).toContain("chevron");
  });
  it("« Voir aussi » : les graphiques et les tableaux renvoient à leurs définitions voisines (rubriques, effectifs, paliers, résiduel)", () => {
    expect(entry("ecart-courbes").see).toEqual(expect.arrayContaining(["rubriques", "effectifs", "rangs-de-mois", "axe-ajuste"]));
    expect(entry("contributions").see).toEqual(expect.arrayContaining(["rubriques", "residuel", "poids-ecarts"]));
    expect(entry("cascade").see).toEqual(expect.arrayContaining(Object.values(STEP_TERMS)));
    for (const id of Object.values(STEP_TERMS)) expect(entry(id).see, id).toEqual(["cascade"]);
    for (const e of GLOSSARY_ECART) for (const id of e.see ?? []) {
      expect(glossaryEntry(id), `${e.id} → ${id}`).toBeDefined();
      expect(id, e.id).not.toBe(e.id);
    }
  });
  it("couleurs : rouge = coût en hausse, vert = coût en baisse, effectifs neutres, la couleur n'est jamais seule", () => {
    const d = entry("ecart-couleurs").definition;
    expect(d).toContain("une hausse est une tendance défavorable, en rouge");
    expect(d).toContain("une baisse est une tendance favorable, en vert");
    expect(d).toContain("ne portent ni rouge ni vert");
    expect(d).toContain("La couleur n'est jamais seule");
  });
});

// Tendances : seules les rubriques qui sont des montants de coût portent rouge / vert (cas écrits à la main : écart de masse
// 66 420,00 € → 69 970,00 € = +3 550,00 €, pourcentage 355 000 ÷ 6 642 000).
describe("tendance des écarts de coût", () => {
  const agg = (num: number, den = 1): Agg => ({ kind: "value", num, den });
  const hausse = diff(agg(6642000), agg(6997000));
  const baisse = diff(agg(6997000), agg(6642000));
  const nul = diff(agg(6642000), agg(6642000));
  it("masse chargée : une hausse est rouge (écart et pourcentage), une baisse verte, un écart nul neutre", () => {
    expect(gapTone("masse", hausse)).toBe("bad");
    expect(gapTone("masse", hausse, "pct")).toBe("bad");
    expect(gapTone("masse", baisse)).toBe("good");
    expect(gapTone("masse", baisse, "pct")).toBe("good");
    expect(gapTone("masse", nul)).toBe("flat");
    expect(gapTone("masse", nul, "pct")).toBe("flat");
  });
  it("toutes les rubriques en euros sont des coûts ; ETP, inscrits, entrées et sorties restent neutres même en hausse", () => {
    const euros = (Object.keys(ROW_UNIT) as RowKey[]).filter((k) => ROW_UNIT[k] === "eur");
    expect(euros.sort()).toEqual([...COST_ROWS].sort());
    expect(euros).toHaveLength(8);
    for (const k of euros) expect(gapTone(k, hausse), k).toBe("bad");
    for (const k of ["etp", "headcount", "entrees", "sorties"] as RowKey[]) {
      expect(isCostRow(k)).toBe(false);
      expect(gapTone(k, diff(agg(61000, 10000), agg(64300, 10000))), k).toBe("flat");
      expect(gapTone(k, diff(agg(64300, 10000), agg(61000, 10000)), "pct"), k).toBe("flat");
    }
  });
  it("valeur n.d. ou sans objet : aucune couleur ; pourcentage n.d. (départ nul) : aucune couleur, l'écart de coût reste rouge", () => {
    expect(gapTone("masse", diff({ kind: "nd", reason: "paie non clôturée" }, agg(100)))).toBe("flat");
    expect(gapTone("autres", diff({ kind: "na" }, agg(100)))).toBe("flat");
    const departNul = diff(agg(0), agg(120000));
    expect(departNul).toMatchObject({ kind: "value", num: 120000, pct: null });
    expect(gapTone("primes", departNul)).toBe("bad");
    expect(gapTone("primes", departNul, "pct")).toBe("flat");
  });
  it("classe de la cellule : trend-bad / trend-good pour un coût, rien pour un écart neutre ; légende unique « Coût en hausse / Coût en baisse » avec son « ? »", () => {
    expect(toneClass("num gap", "bad")).toBe("num gap trend-bad");
    expect(toneClass("num gap", "good")).toBe("num gap trend-good");
    expect(toneClass("num gap", "flat")).toBe("num gap");
    const legend = renderToStaticMarkup(h(TrendLegend, { slug: "demo" }));
    expect(legend).toContain('class="trend-legend ecart-legend"');
    expect(legend).toContain('<i class="dot bad" aria-hidden="true"></i>Coût en hausse');
    expect(legend).toContain('<i class="dot good" aria-hidden="true"></i>Coût en baisse');
    expect(legend).toContain('href="/e/demo/glossaire#def-ecart-couleurs"');
    expect(legend.match(/class="trend-legend/g)).toHaveLength(1);
  });
  it("cascade de masse : barres rouges / vertes ; cascade d'ETP : bleu et gris (AnalyseChart suit la tendance de chaque rubrique)", () => {
    const etp = etpWaterfall({ kind: "value", months: 3, start: 61000, end: 64300, residual: 0, steps: [step("entrees-new", 3300), step("entrees-report", 0), step("sorties", -1200), step("sorties-deport", 800), step("etp-change", 400)] });
    const masse = masseWaterfall({ kind: "value", start: 6642000, end: 6997000, residual: 0, steps: [{ key: "remun", label: "Rémunération de base", delta: 187500, reason: null }, { key: "primes", label: "Primes", delta: -100000, reason: null }, { key: "charges", label: "Charges", delta: 267500, reason: null }] });
    const items = {
      etp: { label: "ETP", title: "ETP", ariaLabel: "Cascade des ETP", startLabel: "A", endLabel: "B", trend: "neutral" as const, data: etp },
      masse: { label: "Masse", title: "Masse", ariaLabel: "Cascade de la masse", startLabel: "A", endLabel: "B", trend: "cost" as const, data: masse },
    };
    const options = [{ key: "etp", label: "ETP" }, { key: "masse", label: "Masse salariale chargée" }];
    const a = renderToStaticMarkup(h(AnalyseChart, { initial: "etp", options, items }));
    expect(a).not.toContain("var(--bad)");
    expect(a).not.toContain("var(--good)");
    const b = renderToStaticMarkup(h(AnalyseChart, { initial: "masse", options, items }));
    expect(b).toContain('fill="var(--bad)"');
    expect(b).toContain('fill="var(--good)"');
    expect(b).toContain("Hausse de coût");
  });
});

// Moins de narratif : titre court + « ? », une seule ligne de contexte, plus de bloc de définitions ni de phrase sous les tableaux.
describe("écrans sans narratif", () => {
  const dir = "src/app/e/[slug]/studio-rh/masse-salariale";
  const ecart = readFileSync(`${dir}/ecart/page.tsx`, "utf8");
  const analyse = readFileSync(`${dir}/analyse/page.tsx`, "utf8");
  it("l'en-tête ne répète plus le résumé du module sous le titre", () => {
    const html = renderToStaticMarkup(h(MsHeader, { title: "Masse salariale", summary: "Brut, charges et coût chargé par mois." }));
    expect(html).toContain("<h1>Masse salariale</h1>");
    expect(html).not.toContain("Brut, charges");
    expect(html).not.toContain('class="desc"');
  });
  it("titre de panneau : titre, « ? » vers le glossaire, et sous-titre seulement pour la ligne de contexte", () => {
    const sans = renderToStaticMarkup(h(PanelTitle, { title: "Écart par rubrique", slug: "demo", term: ECART_TERMS.ecart, label: "Écart" }));
    expect(sans).toContain("<h2>Écart par rubrique</h2>");
    expect(sans).toContain('href="/e/demo/glossaire#def-ecart"');
    expect(sans).not.toContain('class="desc"');
    expect(renderToStaticMarkup(h(PanelTitle, { title: "Sans lien" }))).not.toContain("gloss-link");
  });
  it("plus de bloc « Définitions et règles de calcul », d'ancres #def- locales ni d'import des définitions", () => {
    for (const src of [ecart, analyse]) {
      expect(src).not.toContain("Définitions et règles de calcul");
      expect(src).not.toContain("ECART_DEFINITIONS");
      expect(src).not.toContain('href="#def-');
      expect(src).not.toContain("ecart-defs");
    }
  });
  it("phrases d'explication retirées (écart, pourcentage, poids, rangs de mois, axe, flèche, pont)", () => {
    for (const phrase of ["Écart = version suivante", "Écart (%) = écart ÷", "Poids = contribution", "La flèche indique seulement", "rangs de mois appliqués", "Le graphique est une lecture", "Le même écart de masse, en deux effets", "Valeurs exactes", "Nul par construction", "Somme des contributions et du résiduel", "écart d'ETP-mois", "Un écart souligné en pointillés"]) {
      expect(ecart, phrase).not.toContain(phrase);
      expect(analyse, phrase).not.toContain(phrase);
    }
    expect(analyse).not.toContain("Commentaire");
    expect(analyse).not.toContain("STEP_COMMENTS");
  });
  it("la ligne qui répétait versions → période → service sous le formulaire n'existe plus ; la chaîne de versions reste dans le détail par salarié", () => {
    expect(ecart).not.toContain("ecart-selection");
    expect(analyse).not.toContain("analyse-context");
    expect(analyse).not.toContain("VersionChain");
    expect(ecart.match(/<VersionChain/g)).toHaveLength(1); // détail par salarié : la paire de versions peut être 2 → 3
    expect(analyse).toContain('data-testid="analyse-vers-ecart"');
    expect(ecart.match(/<PickerForm[^>]*slug=\{slug\}/g)).toHaveLength(1);
    expect(analyse.match(/<PickerForm[^>]*slug=\{slug\}/g)).toHaveLength(1);
  });
  it("une seule légende de tendance par page : le détail par salarié ou le pont ne la répètent que si le tableau précédent est absent", () => {
    expect(ecart.match(/<TrendLegend/g)).toHaveLength(2); // tableau d'écart ; détail par salarié
    expect(ecart).toContain("{!showTable && <TrendLegend slug={slug} />}");
    expect(analyse.match(/<TrendLegend/g)).toHaveLength(2); // tableau de masse ; pont
    expect(analyse).toContain("!legendInMasse && <TrendLegend");
  });
  it("tendances branchées : écart et pourcentage des coûts via gapTone, ETP neutre, cascades de masse et pont en « cost »", () => {
    expect(ecart).toContain('gapTone(r.key, g)');
    expect(ecart).toContain('gapTone(r.key, g, "pct")');
    expect(ecart).toContain("costTone(r.d)"); // détail par salarié : écart de coût de chaque ligne
    expect(analyse).toContain('trend: "cost"');
    expect(analyse).toContain('trend="cost"');
    expect(analyse).toContain('trend: "neutral"');
  });
});

describe("pages « Prévu » de la masse salariale", () => {
  const src = readFileSync("src/app/e/[slug]/studio-rh/masse-salariale/[vue]/page.tsx", "utf8");
  it("chaque phrase d'état commence par « Non réalisé : » ou « Non disponible avec les données lues : »", () => {
    const leads = [...src.matchAll(/lead: "([^"]+)"/g)].map((m) => m[1]);
    expect(leads).toHaveLength(3); // organisation, reel, suivi : « Masse salariale croisée » a sa propre page (croisee/)
    for (const l of leads) expect(l).toMatch(/^(Non réalisé|Non disponible avec les données lues) : /);
  });
  it("aucun terme interdit dans l'interface (outil observé, cahier, webinaire, capture, recette juridique, tutoiement, « rien n'est simulé »)", () => {
    for (const w of ["outil observé", "cahier", "webinaire", "capture", "recette juridique", "rien n'est simulé", " toi ", "avec toi", "tu "]) expect(src.toLowerCase()).not.toContain(w);
  });
  it("pages courtes : phrase d'état d'une ligne, textes des liens et des points ouverts en quelques mots", () => {
    for (const l of [...src.matchAll(/lead: "([^"]+)"/g)].map((m) => m[1])) expect(l.length).toBeLessThanOrEqual(170);
    for (const t of [...src.matchAll(/ text: "([^"]+)"/g)].map((m) => m[1])) expect(t.length).toBeLessThanOrEqual(80);
    for (const o of [...src.matchAll(/open: \["([^"]+)"\]/g)].map((m) => m[1])) expect(o.length).toBeLessThanOrEqual(110);
    expect([...src.matchAll(/open: \[/g)]).toHaveLength(3);
  });
  it("le titre de la page écrit « Masse salariale par organisation » en toutes lettres (l'onglet garde « MS »)", () => {
    expect(src).toContain('"Masse salariale par organisation"');
  });
});

// Poids d'une contribution = contribution ÷ écart total. Cas de référence du tableau de masse (calcul à la main) : écart total
// 3 550,00 € = 1 875,00 € (rémunération) + 1 000,00 € (primes) + 675,00 € (charges) ; 187 500 ÷ 355 000 = 52,8169 % ;
// 100 000 ÷ 355 000 = 28,1690 % ; 67 500 ÷ 355 000 = 19,0141 % ; les trois arrondis font 100,00 %.
describe("poids des écarts", () => {
  const sp = (t: string) => t.replace(/\s/g, " "); // espaces insécables → espace
  const cell = (n: number | null, total: number, reason?: string | null) => sp(renderToStaticMarkup(h(Weight, { n, total, reason })));
  it("poids exact des contributions, signe écrit", () => {
    expect(sp(weightText(187500, 355000))).toBe("+52,82 %");
    expect(sp(weightText(100000, 355000))).toBe("+28,17 %");
    expect(sp(weightText(67500, 355000))).toBe("+19,01 %");
    expect(sp(weightText(-7951, 355000))).toBe("−2,24 %"); // 7 951 ÷ 355 000 = 2,2397 % : contribution en sens inverse de l'écart total
    expect(sp(weightText(-100, -400))).toBe("+25,00 %"); // même sens que l'écart total (tous deux négatifs)
    expect(cell(187500, 355000)).toBe("+52,82 %");
  });
  it("contribution nulle : « — » ; écart total nul ou contribution n.d. : « n.d. » avec sa raison, jamais un pourcentage reconstitué", () => {
    expect(cell(0, 355000)).toBe("—");
    const totalZero = cell(500, 0);
    expect(totalZero).toContain(">n.d.</abbr>");
    expect(totalZero).toContain("écart total nul");
    expect(totalZero).not.toContain("%");
    const nd = cell(null, 355000, "compte 64 absent de la version 2");
    expect(nd).toContain('title="compte 64 absent de la version 2"');
    expect(nd).toContain(">n.d.</abbr>");
  });
});
