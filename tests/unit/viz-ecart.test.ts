import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyseChart } from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/AnalyseChart";
import { EcartChart } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/EcartChart";
import { LiveLink, LiveViewSwitch } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/LiveRub";
import type { Cascade, StepId } from "@/lib/budget/cascade";
import type { Bridge } from "@/lib/budget/series";
import { nd, val, type Cell, type MonthFacts, type Version } from "@/lib/budget/versions";
import { CHART_LABELS, ecartChartData, etpWaterfall, masseWaterfall, periodText, pontWaterfall, rubricGroups, RUBRIC_KEYS, type MasseRubric } from "@/lib/viz/ecart";

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
