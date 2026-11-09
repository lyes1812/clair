import { describe, expect, it } from "vitest";
import { budgetSeries, type Layer, type Point, type Series } from "@/lib/budget/series";
import { buildSuivi, type SuiviInput, type SuiviReferenceOption } from "@/lib/viz/suivi-budget";

// Cas entièrement fictifs, montants de référence calculés à la main en centimes.
const option: SuiviReferenceOption = { value: "budget:fixture-budget", label: "Budget fictif", kind: "budget", years: ["2026"], href: "/e/demo/studio-rh/hypotheses" };
const series = (values: Record<string, number | string>, layer: (m: string) => Layer = () => "reel"): Series => ({ key: "fixture", label: "Lecture fictive", points: new Map(Object.entries(values).map(([month, value]): [string, Point] => [month, typeof value === "number" ? { month, kind: "value", cost: value, etp4: null, etpNd: null, layer: layer(month) } : { month, kind: "nd", reason: value }])) });
const input = (change: Partial<SuiviInput> = {}): SuiviInput => ({
  slug: "demo", years: ["2026"], options: [option], selected: option,
  source: { label: "PayFit", readAt: "2026-04-05T08:00:00Z", href: "/e/demo/donnees" },
  state: { annee: "2026", reference: option.value, cloture: "2026-03", affichage: "tout" },
  actual: series({ "2026-01": 1_000_000, "2026-02": 1_100_000, "2026-03": 1_200_000, "2026-04": 1_500_000 }),
  planned: budgetSeries("budget", "Budget fictif", "2026", Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 1_000_000]))),
  cutoff: "2026-03", cutoffOptions: ["2026-01", "2026-02", "2026-03"], notices: [], reason: null,
  actualReason: "Choisis une clôture valide.", referenceReason: "Choisis une référence.", ...change,
});

describe("Suivi réel / budget : modèle agrégé", () => {
  it("janvier–mars : réel 33 000 €, référence 30 000 €, écart +3 000 € (+10 %) ; mêmes mois pour chaque cumul", () => {
    const m = buildSuivi(input());
    expect(m.totals).toEqual({ actual: { kind: "value", cents: 3_300_000 }, reference: { kind: "value", cents: 3_000_000 }, gap: { kind: "value", cents: 300_000, pct: { num: 300_000, den: 3_000_000 }, pctReason: null } });
    expect(m.rows[1].gap).toMatchObject({ kind: "value", cents: 100_000, pct: { num: 100_000, den: 1_000_000 } });
    expect(m.chart.actual.slice(0, 4)).toEqual([1_000_000, 1_100_000, 1_200_000, null]);
    expect(m.rows).toHaveLength(12);
  });
  it("mois postérieurs à la clôture : référence conservée, réel et écart n.d. même si le journal contient un montant", () => {
    const m = buildSuivi(input());
    expect(m.rows[3]).toMatchObject({ afterCutoff: true, actual: { kind: "nd", reason: "après la clôture retenue" }, reference: { kind: "value", cents: 1_000_000 }, gap: { kind: "nd" }, actualHref: null });
    expect(m.chart.reference).toEqual(Array(12).fill(1_000_000));
  });
  it("trou antérieur à la clôture : pas d'intersection partielle, cumuls et écart n.d. ; rupture dans la série", () => {
    const m = buildSuivi(input({ actual: series({ "2026-01": 1_000_000, "2026-02": "journal absent", "2026-03": 1_200_000 }) }));
    expect(m.totals.actual).toMatchObject({ kind: "nd", reason: expect.stringContaining("journal absent") });
    expect(m.totals.reference).toEqual({ kind: "value", cents: 3_000_000 });
    expect(m.totals.gap.kind).toBe("nd");
    expect(m.chart.actual.slice(0, 3)).toEqual([1_000_000, null, 1_200_000]);
  });
  it("budget non saisi n.d. et zéro saisi distincts ; pourcentage sans base positive n.d.", () => {
    const m = buildSuivi(input({ planned: budgetSeries("b", "Budget", "2026", { "2026-01": 0, "2026-02": null, "2026-03": 1_000_000 }) }));
    expect(m.rows[0].reference).toEqual({ kind: "value", cents: 0 });
    expect(m.rows[0].gap).toMatchObject({ kind: "value", cents: 1_000_000, pct: null, pctReason: expect.stringContaining("pourcentage non défini") });
    expect(m.rows[1].reference).toMatchObject({ kind: "nd", reason: "montant du budget non saisi" });
    expect(m.totals.reference.kind).toBe("nd");
    expect(m.totals.gap.kind).toBe("nd");
  });
  it("aucune référence choisie : aucune substitution, cumul réel consultable mais référence et écart n.d.", () => {
    const m = buildSuivi(input({ selected: null, planned: null, reason: "Choisis une référence." }));
    expect(m.reference).toBeNull();
    expect(m.totals.actual).toEqual({ kind: "value", cents: 3_300_000 });
    expect(m.totals.reference).toEqual({ kind: "nd", reason: "Choisis une référence." });
    expect(m.chart.reference).toEqual(Array(12).fill(null));
  });
  it("sans clôture : aucun total vide égal à zéro et aucune valeur réelle affichée", () => {
    const m = buildSuivi(input({ cutoff: null, cutoffOptions: [] }));
    expect(m.totals.actual.kind).toBe("nd");
    expect(m.totals.reference.kind).toBe("nd");
    expect(m.chart.actual).toEqual(Array(12).fill(null));
  });
  it("écarts négatifs exacts de −123,45 € et −0,01 €, cumul négatif : la différence typographique des signes ne les rend pas n.d.", () => {
    const m = buildSuivi(input({
      cutoff: "2026-02", actual: series({ "2026-01": 1, "2026-02": 1 }),
      planned: series({ "2026-01": 12_346, "2026-02": 2 }, () => "budget"),
    }));
    expect(m.rows[0].gap).toMatchObject({ kind: "value", cents: -12_345 });
    expect(m.rows[1].gap).toMatchObject({ kind: "value", cents: -1 });
    expect(m.totals.gap).toMatchObject({ kind: "value", cents: -12_346 });
  });
  it("cellules et cumul réels négatifs : −123,45 € puis −0,01 € restent des montants connus", () => {
    const m = buildSuivi(input({
      cutoff: "2026-02", actual: series({ "2026-01": -12_345, "2026-02": -1 }),
      planned: series({ "2026-01": 0, "2026-02": 0 }, () => "budget"),
    }));
    expect(m.rows.slice(0, 2).map((r) => r.actual)).toEqual([{ kind: "value", cents: -12_345 }, { kind: "value", cents: -1 }]);
    expect(m.totals.actual).toEqual({ kind: "value", cents: -12_346 });
    expect(m.totals.gap).toMatchObject({ kind: "value", cents: -12_346 });
    expect(m.chart.actual.slice(0, 2)).toEqual([-12_345, -1]);
  });
  it("référence négative et zéro signé : montants exacts, pourcentage sans base positive n.d., −0 normalisé à 0", () => {
    const m = buildSuivi(input({
      cutoff: "2026-03", actual: series({ "2026-01": -0, "2026-02": 0, "2026-03": 0 }),
      planned: series({ "2026-01": -12_345, "2026-02": -1, "2026-03": -0 }, () => "budget"),
    }));
    expect(m.rows.slice(0, 3).map((r) => r.reference)).toEqual([{ kind: "value", cents: -12_345 }, { kind: "value", cents: -1 }, { kind: "value", cents: 0 }]);
    expect(m.rows[0].actual).toEqual({ kind: "value", cents: 0 });
    expect(m.rows[0].gap).toMatchObject({ kind: "value", cents: 12_345, pct: null });
    expect(m.totals.reference).toEqual({ kind: "value", cents: -12_346 });
    expect(m.totals.gap).toMatchObject({ kind: "value", cents: 12_346, pct: null });
  });
  it("grand montant négatif : la garde de précision rejette encore un centime perdu à la borne Number", () => {
    const m = buildSuivi(input({
      cutoff: "2026-01", actual: series({ "2026-01": -Number.MAX_SAFE_INTEGER }),
      planned: series({ "2026-01": 0 }, () => "budget"),
    }));
    expect(m.rows[0].actual).toEqual({ kind: "nd", reason: "montant hors de la précision exacte en centimes" });
    expect(m.totals.actual.kind).toBe("nd");
    expect(m.totals.gap.kind).toBe("nd");
    expect(m.chart.actual[0]).toBeNull();
  });
  it("provenance scénario : réel figé, parent, projeté ; lien de détail seulement là où le détail existe", () => {
    const selected: SuiviReferenceOption = { value: "scenario:fixture-scenario", label: "Scénario fictif", kind: "scenario", years: ["2026"], href: "/e/demo/studio-rh/hypotheses?scenario=fixture-scenario" };
    const planned = series({ "2026-01": 1_000_000, "2026-02": 1_050_000, "2026-03": 1_100_000 }, (m) => m === "2026-01" ? "reel" : m === "2026-02" ? "projete-parent" : "projete");
    const m = buildSuivi(input({ selected, planned }));
    expect(m.rows.slice(0, 3).map((r) => r.origin)).toEqual(["Réel figé", "Projeté du parent", "Projeté"]);
    expect(m.rows[0].referenceHref).not.toContain("#proj-detail");
    expect(m.rows[1].referenceHref).not.toContain("#proj-detail");
    expect(m.rows[2].referenceHref).toBe(`${selected.href}&vue=resultat&sous=projection&mois=2026-03&affichage=tableau#proj-detail`);
    expect(m.rows[2].actualHref).toBe("/e/demo/studio-rh/masse-salariale?annee=2026&de=03&a=03&mois=2026-03&affichage=tableau#ms-detail");
    expect(m.rows[3].reference).toMatchObject({ kind: "nd", reason: "mois non couvert par cette lecture" });
  });
  it("précision : pas de somme ni écart publiés lorsqu'un centime n'est plus exact", () => {
    const m = buildSuivi(input({ actual: series({ "2026-01": Number.MAX_SAFE_INTEGER, "2026-02": 2, "2026-03": -Number.MAX_SAFE_INTEGER }) }));
    expect(m.totals.actual).toEqual({ kind: "nd", reason: "montant hors de la précision exacte en centimes" });
    expect(m.totals.gap.kind).toBe("nd");
    // MAX_SAFE_INTEGER est un entier exact, mais /100 puis Intl l'écrit ,90 au lieu de ,91 : ne pas publier ce centime.
    expect(m.rows[0].actual).toEqual({ kind: "nd", reason: "montant hors de la précision exacte en centimes" });
    expect(m.chart.actual[0]).toBeNull();
  });
});
