import { describe, expect, it } from "vitest";
import { monthsAboveBudget, printFold, selectAlerts, type AlertesInput, type BudgetMonth } from "@/lib/croisee/alertes";
import type { AlertSpec } from "@/lib/viz/croisee";

// « À surveiller » (chapitre 01) : cas de référence écrits et calculés à la main, valeurs fictives.
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const HREFS = { parametres: "/e/demo/parametres#croisee", grille: "/e/demo/parametres#masse-salariale", budget: "/e/demo/studio-rh/hypotheses", paieCompta: "/e/demo/croisee?chapitre=paie-compta", donnees: "/e/demo/donnees" };
const SKIP = { compta: { kind: "skip" }, dsn: { kind: "skip" } } as const;

// Quatre mois : janvier au-dessus du budget, février égal (pas au-dessus : comparaison stricte), mars avec un budget saisi de 0 €
// (montant saisi : comparé, donc au-dessus), avril sans montant de budget (exclu et nommé).
const MONTHLY: BudgetMonth[] = [
  { month: "2026-01", real: 10_000_000, budget: 9_500_000 },
  { month: "2026-02", real: 9_000_000, budget: 9_000_000 },
  { month: "2026-03", real: 5_000, budget: 0 },
  { month: "2026-04", real: 8_000_000, budget: null },
];
// Écart de la période sur janvier → mars (mois dotés d'un budget) : réalisé 10 000 000 + 9 000 000 + 5 000 = 19 005 000 c ;
// budget 9 500 000 + 9 000 000 + 0 = 18 500 000 c ; écart + 505 000 c (+ 5 050,00 €).
const base = (over: Partial<AlertesInput> = {}): AlertesInput => ({
  year: 2026,
  budget: { kind: "value", name: "Budget test", gap: { kind: "value", real: 19_005_000, budget: 18_500_000, delta: 505_000 }, monthly: MONTHLY },
  landing: { kind: "na" },
  openMonths: [],
  unclassified: [],
  missing: [],
  seuils: { kind: "skip" },
  checks: SKIP,
  hrefs: HREFS,
  ...over,
});
const ids = (r: ReturnType<typeof selectAlerts>) => r.alerts.map((a) => a.id);
const textOf = (r: ReturnType<typeof selectAlerts>, id: string) => sp(r.alerts.find((a) => a.id === id)?.text ?? "");
const NO_BUDGET = { budget: { kind: "na" } } as const;

describe("monthsAboveBudget : comparaison stricte, mois sans budget exclus", () => {
  it("cas de référence : deux mois au-dessus (dont un budget de 0 €), un égal, un sans budget, un réalisé n.d., un en dessous d'un centime", () => {
    const r = monthsAboveBudget([...MONTHLY, { month: "2026-05", real: null, budget: 7_000_000 }, { month: "2026-06", real: 7_000_000, budget: 7_000_001 }]);
    expect(r.above).toEqual(["2026-01", "2026-03"]);
    expect(r.compared).toEqual(["2026-01", "2026-02", "2026-03", "2026-06"]);
    expect(r.noBudget).toEqual(["2026-04"]);
    expect(r.noReal).toEqual(["2026-05"]);
  });
});

describe("selectAlerts : budget saisi", () => {
  it("budget dépassé (défavorable) et mois au-dessus du budget du mois (repère), avec le mois exclu nommé", () => {
    const r = selectAlerts(base());
    expect(ids(r)).toEqual(["budget-depasse", "budget-mois"]);
    expect(r.alerts[0].level).toBe("defavorable");
    expect(textOf(r, "budget-depasse")).toBe("Réalisé 190 050,00 € pour un budget saisi « Budget test » de 185 000,00 € sur 3 mois : écart +5 050,00 €. 1 mois sans montant de budget exclu (avr. 2026).");
    expect(r.alerts[1].level).toBe("repere");
    expect(textOf(r, "budget-mois")).toBe("2 mois sur 3 : janv. 2026, mars 2026. 1 mois sans montant de budget exclu (avr. 2026).");
  });

  it("au centime près, sans tolérance : +1 centime déclenche l'alerte, 0 ne la déclenche pas", () => {
    const one = selectAlerts(base({ budget: { kind: "value", name: "B", gap: { kind: "value", real: 100_001, budget: 100_000, delta: 1 }, monthly: [{ month: "2026-01", real: 100_001, budget: 100_000 }] } }));
    expect(ids(one)).toEqual(["budget-depasse"]);
    expect(textOf(one, "budget-depasse")).toContain("écart +0,01 €");
    const zero = selectAlerts(base({ budget: { kind: "value", name: "B", gap: { kind: "value", real: 100_000, budget: 100_000, delta: 0 }, monthly: [{ month: "2026-01", real: 100_000, budget: 100_000 }] } }));
    expect(ids(zero)).toEqual([]);
  });

  it("un seul mois comparé : pas de repère mois par mois (c'est l'écart de la période)", () => {
    const r = selectAlerts(base({ budget: { kind: "value", name: "B", gap: { kind: "value", real: 200, budget: 100, delta: 100 }, monthly: [{ month: "2026-01", real: 200, budget: 100 }, { month: "2026-02", real: 300, budget: null }] } }));
    expect(ids(r)).toEqual(["budget-depasse"]);
  });

  it("budget absent, aucun montant sur la période, écart non calculé : « à compléter » ; budget global sous un filtre : rien", () => {
    expect(selectAlerts(base({ budget: { kind: "absent", reason: "aucun budget saisi pour 2026" } })).alerts).toEqual([
      { id: "budget-absent", level: "a-completer", label: "Budget saisi absent", text: "Aucun budget saisi pour 2026.", href: HREFS.budget, linkLabel: "Hypothèses budgétaires" },
    ]);
    const none = selectAlerts(base({ budget: { kind: "value", name: "B", gap: null, monthly: [{ month: "2026-01", real: 1, budget: null }, { month: "2026-02", real: 1, budget: null }] } }));
    expect(ids(none)).toEqual(["budget-non-saisi"]);
    expect(textOf(none, "budget-non-saisi")).toBe("Aucun montant de budget saisi « B » pour janv. 2026, févr. 2026.");
    const nd = selectAlerts(base({ budget: { kind: "value", name: "B", gap: { kind: "nd", reason: "réalisé : paie non clôturée à la lecture" }, monthly: [] } }));
    expect(nd.alerts.map((a) => [a.id, a.level, a.text])).toEqual([["budget-nd", "a-completer", "Réalisé : paie non clôturée à la lecture."]]);
    expect(selectAlerts(base(NO_BUDGET)).alerts).toEqual([]);
  });
});

describe("selectAlerts : atterrissage", () => {
  it("au-dessus du budget annuel : défavorable ; comparaison sur les mois dotés d'un budget, mois exclus nommés", () => {
    const full = selectAlerts(base({ ...NO_BUDGET, landing: { kind: "value", total: 120_000_000, gap: { kind: "value", landing: 120_000_000, budget: 115_000_000, delta: 5_000_000, months: 12, excluded: [] } } }));
    expect(ids(full)).toEqual(["atterrissage-depasse"]);
    expect(textOf(full, "atterrissage-depasse")).toBe("Atterrissage 2026 : 1 200 000,00 € pour un budget saisi de 1 150 000,00 € : écart +50 000,00 €.");
    const part = selectAlerts(base({ ...NO_BUDGET, landing: { kind: "value", total: 120_000_000, gap: { kind: "value", landing: 109_000_000, budget: 105_000_000, delta: 4_000_000, months: 11, excluded: ["2026-12"] } } }));
    expect(textOf(part, "atterrissage-depasse")).toBe("Atterrissage et budget saisi comparés sur 11 mois (1 mois sans montant de budget exclu : déc. 2026) : écart +40 000,00 €.");
  });
  it("écart nul ou négatif : aucune alerte ; atterrissage n.d. : « Atterrissage non calculé » avec la raison", () => {
    expect(ids(selectAlerts(base({ ...NO_BUDGET, landing: { kind: "value", total: 100, gap: { kind: "value", landing: 100, budget: 100, delta: 0, months: 12, excluded: [] } } })))).toEqual([]);
    expect(ids(selectAlerts(base({ ...NO_BUDGET, landing: { kind: "value", total: 90, gap: null } })))).toEqual([]);
    const nd = selectAlerts(base({ ...NO_BUDGET, landing: { kind: "nd", reason: "2026-12 : hors de l'horizon du scénario" } }));
    expect(nd.alerts.map((a) => [a.id, a.level, a.text])).toEqual([["atterrissage-nd", "a-completer", "2026-12 : hors de l'horizon du scénario."]]);
  });
});

describe("selectAlerts : seuils d'effectif (repères calculés par le chapitre 02, aucun seuil ici)", () => {
  const repere: AlertSpec = { id: "effectifs-seuil-n1", level: "repere", label: "Effectif proche d'un seuil", text: "Effectif moyen 2025 : 48,50 pour le seuil « Seuil A » (50) ; marge d'alerte : 2.", href: "/x?chapitre=effectifs#cx-effectifs-seuils", linkLabel: "Effectifs & mouvements" };
  it("réglage absent ou illisible : une mention avec le lien vers Paramètres, aucune alerte", () => {
    const r = selectAlerts(base({ ...NO_BUDGET, seuils: { kind: "mention", id: "seuils-effectif", text: "Seuils d'effectif non définis (Paramètres)", settings: true } }));
    expect(r.alerts).toEqual([]);
    expect(r.mentions).toEqual([{ id: "seuils-effectif", text: "Seuils d'effectif non définis (Paramètres)", href: HREFS.parametres, linkLabel: "Paramètres" }]);
  });
  it("effectif non filtrable par service : une mention sans lien", () => {
    const r = selectAlerts(base({ ...NO_BUDGET, seuils: { kind: "mention", id: "seuils-effectif", text: "Seuils d'effectif : effectif moyen non filtrable par service.", settings: false } }));
    expect(r.mentions).toEqual([{ id: "seuils-effectif", text: "Seuils d'effectif : effectif moyen non filtrable par service." }]);
  });
  it("repères reçus tels quels ; effectif moyen n.d. : un point « à compléter » qui nomme chaque effectif", () => {
    const r = selectAlerts(base({ ...NO_BUDGET, seuils: { kind: "value", alerts: [repere], nd: [{ label: "Effectif moyen 2026 (janvier → mars 2026)", reason: "mars 2026 : mois non clos." }] } }));
    expect(r.alerts).toEqual([{ id: "effectif-nd", level: "a-completer", label: "Effectif moyen non calculé", text: "Effectif moyen 2026 (janvier → mars 2026) : mars 2026 : mois non clos." }, repere]);
    expect(r.mentions).toEqual([]);
  });
});

describe("selectAlerts : comptabilité et DSN de contrôle", () => {
  it("comptabilité non lue : « à compléter » vers Données ; rapprochement n.d. : la raison, mois en clair", () => {
    const absent = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "absent", reason: "aucune source comptable retenue" }, dsn: { kind: "skip" } } }));
    expect(absent.alerts).toEqual([{ id: "source-compta", level: "a-completer", label: "Comptabilité non lue", text: "Aucune source comptable retenue.", href: HREFS.donnees, linkLabel: "Données" }]);
    const nd = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "nd", reason: "comptabilité non lue pour 2026-03" }, dsn: { kind: "skip" } } }));
    expect(nd.alerts.map((a) => [a.id, a.label, a.text, a.href])).toEqual([["source-compta", "Rapprochement avec la comptabilité non calculé", "Comptabilité non lue pour mars 2026.", HREFS.paieCompta]]);
  });
  it("journal ≠ comptabilité : repère seulement si l'écart est non nul (au centime)", () => {
    const one = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "value", ecart: 1 }, dsn: { kind: "skip" } } }));
    expect(ids(one)).toEqual(["journal-compta"]);
    expect(textOf(one, "journal-compta")).toBe("Écart sur les comptes 63 et 64 de la période : +0,01 €.");
    expect(ids(selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "value", ecart: 0 }, dsn: { kind: "skip" } } })))).toEqual([]);
  });
  it("DSN : aucune déposée, mois sans DSN exploitable (« à compléter ») ; écart avec mois de DSN incomplète nommés (repère)", () => {
    const none = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "skip" }, dsn: { kind: "nd", reason: "2026-01 : aucune DSN retenue", months: ["2026-01"], none: true } } }));
    expect(none.alerts.map((a) => [a.id, a.level, a.label, a.text])).toEqual([["source-dsn", "a-completer", "DSN de contrôle non lue", "Aucune DSN déposée dans Données : le brut du journal de paie n'est pas contrôlé."]]);
    const two = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "skip" }, dsn: { kind: "nd", reason: "2026-01 : aucune DSN retenue ; 2026-02 : déclaration bloquée", months: ["2026-01", "2026-02"], none: false } } }));
    expect(two.alerts.map((a) => [a.label, a.text])).toEqual([["DSN de contrôle non déposée pour un mois", "2 mois de la période sans DSN exploitable : janv. 2026 : aucune DSN retenue ; févr. 2026 : déclaration bloquée."]]);
    const gap = selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "skip" }, dsn: { kind: "value", delta: -1_234, incomplete: ["2026-03"] } } }));
    expect(textOf(gap, "journal-dsn")).toBe("Brut du journal moins brut déclaré (DSN, type 001) sur la période : −12,34 €. DSN incomplète : mars 2026.");
    expect(ids(selectAlerts(base({ ...NO_BUDGET, checks: { compta: { kind: "skip" }, dsn: { kind: "value", delta: 0, incomplete: ["2026-03"] } } })))).toEqual([]);
  });
});

describe("selectAlerts : ordre par niveau, aucun plafond", () => {
  it("défavorable, puis à compléter, puis repère ; ordre d'origine dans un niveau ; toutes les alertes sont renvoyées", () => {
    const r = selectAlerts(
      base({
        landing: { kind: "nd", reason: "projection refusée (hypothèses en erreur)" },
        openMonths: ["2026-06", "2025-06"],
        unclassified: ["6459", "6414", "6459"],
        missing: [{ id: "journal", label: "Journal de paie non lu", reason: "journal de paie indisponible", href: "/e/demo/donnees", linkLabel: "Données" }],
        seuils: { kind: "value", alerts: [{ id: "effectifs-seuil-n", level: "repere", label: "Effectif proche d'un seuil", text: "…" }], nd: [] },
        checks: { compta: { kind: "absent", reason: "aucune source comptable retenue" }, dsn: { kind: "value", delta: -1_234, incomplete: [] } },
      }),
    );
    expect(ids(r)).toEqual(["budget-depasse", "atterrissage-nd", "source-journal", "source-compta", "comptes-non-classes", "budget-mois", "effectifs-seuil-n", "mois-non-clos", "journal-dsn"]);
    expect(r.alerts.map((a) => a.level)).toEqual(["defavorable", "a-completer", "a-completer", "a-completer", "a-completer", "repere", "repere", "repere", "repere"]);
    expect(textOf(r, "comptes-non-classes")).toBe("2 comptes de charges de personnel sans rubrique, hors masse chargée : 6414, 6459.");
    expect(r.alerts.find((a) => a.id === "comptes-non-classes")?.href).toBe(HREFS.grille);
    expect(r.alerts.find((a) => a.id === "mois-non-clos")?.label).toBe("Mois non clos (paie ou référentiel RH)");
    expect(textOf(r, "mois-non-clos")).toBe("Non clôturés à la lecture : juin 2025, juin 2026 ; montants provisoires.");
    expect(textOf(r, "journal-dsn")).toBe("Brut du journal moins brut déclaré (DSN, type 001) sur la période : −12,34 €.");
    expect(r.alerts.find((a) => a.id === "source-journal")).toMatchObject({ text: "Journal de paie indisponible.", href: "/e/demo/donnees", linkLabel: "Données" });
  });
});

describe("printFold : « Synthèse en PDF · 1 page », repères regroupés au-delà du plafond", () => {
  const a = (id: string, level: AlertSpec["level"]): AlertSpec => ({ id, level, label: id, text: id });
  it("1 défavorable, 2 à compléter, 5 repères, plafond 3 : 6 imprimés, 2 repères regroupés ; aucun défavorable ni « à compléter » regroupé", () => {
    const list = [a("r1", "repere"), a("d1", "defavorable"), a("r2", "repere"), a("c1", "a-completer"), a("r3", "repere"), a("c2", "a-completer"), a("r4", "repere"), a("r5", "repere")];
    const f = printFold(list, 3);
    expect(f.folded).toBe(2);
    expect(f.shown.map((x) => x.id)).toEqual(["d1", "c1", "c2", "r1", "r2", "r3"]);
  });
  it("trois repères ou moins : rien n'est regroupé ; cinq défavorables : tous imprimés", () => {
    expect(printFold([a("r1", "repere"), a("r2", "repere"), a("r3", "repere")], 3).folded).toBe(0);
    const bad = printFold([1, 2, 3, 4, 5].map((i) => a(`d${i}`, "defavorable")), 3);
    expect(bad).toEqual({ shown: [1, 2, 3, 4, 5].map((i) => a(`d${i}`, "defavorable")), folded: 0 });
  });
});
