import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyseChart } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/AnalyseChart";
import { STEP_COMMENTS } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/comments";
import { TitledWaterfall } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/TitledWaterfall";
import { Weight, weightText } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/Weight";
import { PickerForm, VersionChain } from "@/app/e/[slug]/studio-rh/masse-salariale/EcartParts";
import type { Loaded } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { WaterfallChart } from "@/components/charts";
import { EcartChart } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/EcartChart";
import { LiveLink, LiveViewSwitch } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/LiveRub";
import type { Cascade, StepId } from "@/lib/budget/cascade";
import type { Bridge } from "@/lib/budget/series";
import { nd, val, type Cell, type MonthFacts, type Version } from "@/lib/budget/versions";
import { CHART_LABELS, ecartChartData, etpWaterfall, eurosSigned, masseWaterfall, neg, periodText, pontWaterfall, rubricGroups, RUBRIC_KEYS, waterfallAxisBadge, type MasseRubric } from "@/lib/viz/ecart";

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
    expect(html).toContain("Version 1 · Réel 2025 : 1 mois"); // mars n.d. (courbe interrompue)
    expect(html).toContain("Axe vertical ajusté aux valeurs"); // l'axe ne part pas de zéro : dit sous le graphique
  });
  it("lecture (au-dessus) et limites (en dessous) séparées ; l'aire d'un scénario n'est pas tracée sur un axe ajusté", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "masse" }));
    const reading = /data-testid="ecart-chart-lecture">([^<]*)</.exec(html)?.[1] ?? "";
    expect(reading).toContain("Trait plein : version 1 · pointillés : versions suivantes.");
    expect(reading).not.toContain("zone teintée"); // axe ajusté : pas d'aire
    expect(reading).toContain("Chaque point est la valeur du mois");
    expect(html).not.toContain('opacity="0.1"'); // aucune aire dans le tracé
    expect(html.indexOf("ecart-chart-lecture")).toBeLessThan(html.indexOf('data-testid="ecart-chart"')); // lecture avant le graphique
    const note = /<p class="chart-note">([^<]*)</.exec(html)?.[1] ?? "";
    expect(note).toContain("Le tableau donne la valeur de la période");
    expect(note).not.toContain("Trait plein"); // la note ne reprend pas la lecture
  });
  it("version sans aucune valeur sur une rubrique : sa raison est écrite sous le graphique (pas seulement au survol)", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "autres" }));
    expect(html).toContain('data-testid="ecart-chart"');
    expect(html).toContain("Aucune valeur à tracer : Version 1 · Réel 2025 (rubrique sans objet pour cette version)");
    expect(html).not.toContain("Version 2 · Révisé 2026 (");
  });
  it("note : valeur du mois (et non de la période), chaque version lue sur son année", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "etp" }));
    expect(html).toContain("Chaque point est la valeur du mois");
    expect(html).toContain("sur sa propre année à rang de mois égal");
    expect(html).toContain("ETP de fin de mois");
  });
  it("rubrique sans aucune valeur : pas de courbe, un bloc n.d. avec la raison de chaque version", () => {
    const html = renderToStaticMarkup(h(EcartChart, { ...props, initial: "nonventile" }));
    expect(html).not.toContain('data-testid="ecart-chart"');
    expect(html).toContain('data-testid="ecart-chart-nd"');
    expect(html).toContain("n.d. — aucune valeur à tracer");
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
    expect(v).toContain('href="/p?v1=a&amp;rub=etp"');
    expect(v).toContain('href="/p?v1=a&amp;affichage=graphique&amp;rub=etp"');
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
      const html = renderToStaticMarkup(h(WaterfallChart, { testid: "wf", label: "test", startLabel: "A", endLabel: "B", ...c }));
      const fromNote = /il commence à ([^<]*?)\.(?:<| )/.exec(html)?.[1];
      const badge = waterfallAxisBadge(c);
      if (fromNote === undefined) expect(badge).toBeNull();
      else expect(badge).toBe(`Axe tronqué à ${fromNote}${c.unit === "etp" ? " ETP" : ""}`);
    }
  });
});

describe("cascade titrée", () => {
  const base = { label: "Cascade de test", startLabel: "A", endLabel: "B" };
  it("axe tronqué : le badge est écrit à côté du titre, la note est hors de la zone qui défile", () => {
    const html = renderToStaticMarkup(h(TitledWaterfall, { ...base, testid: "wf-pont", title: "Du coût de la version 1 à celui de la version 2", note: "Note de test.", start: 6642000, end: 6997000, steps: pontSteps, unit: "eur" }));
    expect(html).toMatch(/<h3 class="chart-title" id="wf-pont-titre">Du coût de la version 1 à celui de la version 2<\/h3><span class="wf-badge" data-testid="wf-pont-axe"[^>]*>Axe tronqué à 64 k€<\/span>/);
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
    expect(etp).toContain("faire défiler le graphique horizontalement");
    expect(etp).toContain("Axe tronqué à 5,8 ETP");
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

describe("vocabulaire de l'analyse des écarts", () => {
  it("les commentaires du tableau d'ETP parlent de « version 1 » et « version 2 », jamais de version A ou B", () => {
    const ids = Object.keys(STEP_COMMENTS);
    expect(ids.sort()).toEqual(["entrees-new", "entrees-report", "etp-change", "sorties", "sorties-deport"]);
    for (const text of Object.values(STEP_COMMENTS)) {
      expect(text).not.toMatch(/\b(version|versions) [AB]\b/);
      expect(text).not.toMatch(/ (en|pendant|de) [AB]\b/);
      expect(text).toMatch(/version [12]/);
    }
    expect(STEP_COMMENTS["entrees-new"]).toBe("Salariés présents dans la version 2 et jamais présents dans la version 1.");
    expect(STEP_COMMENTS.sorties).toBe("Salariés présents dans la version 1 et jamais présents dans la version 2.");
  });
});

describe("pages « Prévu » de la masse salariale", () => {
  const src = readFileSync("src/app/e/[slug]/studio-rh/masse-salariale/[vue]/page.tsx", "utf8");
  it("chaque phrase d'état commence par « Non réalisé : » ou « Non disponible avec les données lues : »", () => {
    const leads = [...src.matchAll(/lead: "([^"]+)"/g)].map((m) => m[1]);
    expect(leads).toHaveLength(4);
    for (const l of leads) expect(l).toMatch(/^(Non réalisé|Non disponible avec les données lues) : /);
  });
  it("aucun terme interdit dans l'interface (outil observé, cahier, webinaire, capture, recette juridique, tutoiement, « rien n'est simulé »)", () => {
    for (const w of ["outil observé", "cahier", "webinaire", "capture", "recette juridique", "rien n'est simulé", " toi ", "avec toi", "tu "]) expect(src.toLowerCase()).not.toContain(w);
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
