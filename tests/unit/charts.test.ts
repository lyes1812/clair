import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, DonutChart, LineChart, WaterfallChart } from "@/components/charts";
import { arcPath, barDomain, barLayout, niceTicks, sliceAngles } from "@/components/charts/scale";
import { compactEuros, unitFormat } from "@/components/charts/units";

// Graphiques : géométrie et rendu serveur, cas écrits à la main.
describe("graduations rondes", () => {
  it("0 → 1 640 000 : pas de 500 000, de 0 à 2 000 000", () => {
    expect(niceTicks(0, 1640000)).toMatchObject({ step: 500000, min: 0, max: 2000000, ticks: [0, 500000, 1000000, 1500000, 2000000] });
  });
  it("axe ajusté 545 → 585 : pas de 10, de 540 à 590", () => {
    expect(niceTicks(545, 585).ticks).toEqual([540, 550, 560, 570, 580, 590]);
  });
  it("entiers : un effectif de 0 à 3 se gradue de 1 en 1, jamais 0,5", () => {
    expect(niceTicks(0, 3, 5, true).ticks).toEqual([0, 1, 2, 3]);
  });
  it("valeur unique non nulle : marge de 10 % ; zéro seul : 0 → 1 ; négatifs inclus", () => {
    expect(niceTicks(5, 5)).toMatchObject({ min: 4.4, max: 5.6 });
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-30, 70).ticks).toEqual([-40, -20, 0, 20, 40, 60, 80]);
  });
  it("décimales sans bruit flottant", () => {
    expect(niceTicks(0, 0.5).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe("barres", () => {
  it("groupées : 2 catégories de 100 px, 2 séries, une cellule absente sans barre (jamais zéro)", () => {
    const l = barLayout({ series: [[10, null], [5, 2]], categories: 2, mode: "grouped", plotW: 200, plotH: 100, yMin: 0, yMax: 10 });
    expect(l.band).toBe(100);
    expect(l.barW).toBe(38);
    expect(l.bars).toEqual([
      { cat: 0, ser: 0, v: 10, x: 11, y: 0, w: 38, h: 100 },
      { cat: 0, ser: 1, v: 5, x: 51, y: 50, w: 38, h: 50 },
      { cat: 1, ser: 1, v: 2, x: 151, y: 80, w: 38, h: 20 },
    ]);
  });
  it("empilées avec une valeur négative : les positives montent, les négatives descendent depuis zéro", () => {
    const series = [[3, -2], [4, 1]];
    expect(barDomain(series, 2, "stacked")).toEqual({ lo: -2, hi: 7 });
    const l = barLayout({ series, categories: 2, mode: "stacked", plotW: 200, plotH: 90, yMin: -2, yMax: 7 });
    const at = (c: number, s: number) => l.bars.find((b) => b.cat === c && b.ser === s)!;
    expect([at(0, 0).y, at(0, 0).h, at(0, 1).y, at(0, 1).h]).toEqual([40, 30, 0, 40]);
    expect([at(1, 0).y, at(1, 0).h, at(1, 1).y, at(1, 1).h]).toEqual([70, 20, 60, 10]);
  });
  it("domaine groupé : toujours depuis zéro", () => {
    expect(barDomain([[120, 140], [130, null]], 2, "grouped")).toEqual({ lo: 0, hi: 140 });
  });
});

describe("secteurs", () => {
  it("parts 1, 1, 2 : quarts et moitié, tour complet ; les zéros n'ont pas de secteur", () => {
    const s = sliceAngles([1, 0, 1, 2]);
    expect(s.map((x) => x.index)).toEqual([0, 2, 3]);
    expect(s.map((x) => x.share)).toEqual([0.25, 0.25, 0.5]);
    expect(s.at(-1)!.end).toBeCloseTo(Math.PI * 2, 10);
    expect(sliceAngles([0, 0])).toEqual([]);
  });
  it("un secteur de 100 % se dessine sans valeur invalide", () => {
    expect(arcPath(100, 100, 80, 50, 0, Math.PI * 2)).not.toMatch(/NaN|Infinity/);
  });
});

describe("unités", () => {
  it("euros compacts : 1,64 M€, 42 k€, 1,23 k€, 850 €, 12,5 k€", () => {
    expect([compactEuros(164_000_000), compactEuros(4_200_000), compactEuros(123_400), compactEuros(85_000), compactEuros(1_250_000)]).toEqual(["1,64 M€", "42 k€", "1,23 k€", "850 €", "12,5 k€"]);
  });
  it("ETP : 61 000 dix-millièmes = 6,10 ; nombre entier : séparateur de milliers", () => {
    expect(unitFormat("etp").fmt(61000)).toBe("6,10");
    expect(unitFormat("nombre").integer).toBe(true);
  });
});

describe("rendu serveur", () => {
  const flat = (html: string) => html.replace(/[\u202f\u00a0]/g, " ");
  const base = { testid: "t", label: "Test", unit: "eur" as const };
  it("barres : valeur n.d. lue « n.d. » avec sa raison, mois entièrement n.d. hachuré, aucune valeur NaN", () => {
    const html = renderToStaticMarkup(h(BarChart, { ...base, categories: ["janv.", "févr."], categoryTitles: ["janvier 2026", "février 2026"], series: [{ key: "a", name: "Réel", values: [120000, null], reasons: [null, "paie non clôturée"] }], toggle: true }));
    expect(flat(html)).toContain("janvier 2026 : Réel 1 200,00");
    expect(html).toContain("février 2026 : Réel n.d.");
    expect(html).not.toMatch(/NaN|undefined/);
    expect(html).toContain('data-testid="t"');
  });
  it("courbes : une valeur absente coupe la ligne et n'est pas dessinée comme zéro", () => {
    const html = renderToStaticMarkup(h(LineChart, { ...base, categories: ["a", "b", "c"], series: [{ key: "r", name: "Réel", values: [100, null, 120], reasons: [null, "non lu", null] }] }));
    expect(html).toContain("b : Réel n.d.");
    expect(html).not.toMatch(/NaN/);
    expect((html.match(/<circle/g) ?? []).length).toBe(2);
  });
  it("anneau : part n.d. listée avec sa raison, hors de l'anneau ; total au centre", () => {
    const html = renderToStaticMarkup(h(DonutChart, { ...base, parts: [{ key: "a", name: "CDI", value: 30000 }, { key: "b", name: "CDD", value: 10000 }, { key: "c", name: "Apprenti", value: null, reason: "quotité absente" }] }));
    expect(flat(html)).toContain("CDI : 300,00");
    expect(flat(html)).toContain("75,00 %");
    expect(html).toContain("quotité absente");
    expect((html.match(/data-slice/g) ?? []).length).toBe(2);
  });
  it("anneau au-delà de huit parts : barres horizontales, pas d'anneau", () => {
    const parts = Array.from({ length: 9 }, (_, i) => ({ key: String(i), name: `G${i}`, value: 100 * (i + 1) }));
    const html = renderToStaticMarkup(h(DonutChart, { ...base, parts }));
    expect(html).not.toContain("data-slice");
    expect(html).toContain("G8");
  });
  it("cascade : départ, contributions signées et arrivée avec leur valeur signée", () => {
    const html = renderToStaticMarkup(h(WaterfallChart, { ...base, startLabel: "Départ", endLabel: "Arrivée", start: 100000, end: 105000, steps: [{ label: "Hausse", value: 8000 }, { label: "Baisse", value: -3000 }] }));
    expect(flat(html)).toContain("Hausse : +80,00");
    expect(flat(html)).toContain("Baisse : -30,00");
    expect(html).not.toMatch(/NaN/);
  });
});
