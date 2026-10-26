import { describe, expect, it } from "vitest";
import { monthsAboveBudget, nearThreshold, selectAlerts, type AlertesInput, type BudgetMonth } from "@/lib/croisee/alertes";
import type { CroiseeSetting, SeuilEffectif } from "@/lib/croisee-settings";

// « À surveiller » (chapitre 01) : cas de référence écrits et calculés à la main, valeurs fictives.
const sp = (s: string) => s.replace(/[  ]/g, " ");
const set = <T,>(value: T): CroiseeSetting<T> => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const ABSENT = { kind: "absent" } as const;
const HREFS = { parametres: "/e/demo/parametres#croisee", grille: "/e/demo/parametres#masse-salariale", budget: "/e/demo/studio-rh/hypotheses", paieCompta: "/e/demo/croisee?chapitre=paie-compta" };

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
  headcount: { kind: "skip" },
  seuils: ABSENT,
  marge: ABSENT,
  checks: { compta: null, dsn: null },
  hrefs: HREFS,
  ...over,
});
const ids = (r: ReturnType<typeof selectAlerts>) => r.alerts.map((a) => a.id);
const textOf = (r: ReturnType<typeof selectAlerts>, id: string) => sp(r.alerts.find((a) => a.id === id)?.text ?? "");

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
    expect(selectAlerts(base({ budget: { kind: "na" } })).alerts).toEqual([]);
  });
});

describe("selectAlerts : atterrissage", () => {
  it("au-dessus du budget annuel : défavorable ; comparaison sur les mois dotés d'un budget, mois exclus nommés", () => {
    const full = selectAlerts(base({ budget: { kind: "na" }, landing: { kind: "value", total: 120_000_000, gap: { kind: "value", budget: 115_000_000, delta: 5_000_000, months: 12, excluded: [] } } }));
    expect(ids(full)).toEqual(["atterrissage-depasse"]);
    expect(textOf(full, "atterrissage-depasse")).toBe("Atterrissage 2026 : 1 200 000,00 € pour un budget saisi de 1 150 000,00 € : écart +50 000,00 €.");
    const part = selectAlerts(base({ budget: { kind: "na" }, landing: { kind: "value", total: 120_000_000, gap: { kind: "value", budget: 105_000_000, delta: 4_000_000, months: 11, excluded: ["2026-12"] } } }));
    expect(textOf(part, "atterrissage-depasse")).toBe("Atterrissage et budget saisi comparés sur 11 mois (1 mois sans montant de budget exclu : déc. 2026) : écart +40 000,00 €.");
  });
  it("écart nul ou négatif : aucune alerte ; atterrissage n.d. : « Atterrissage non calculé » avec la raison", () => {
    expect(ids(selectAlerts(base({ budget: { kind: "na" }, landing: { kind: "value", total: 100, gap: { kind: "value", budget: 100, delta: 0, months: 12, excluded: [] } } })))).toEqual([]);
    expect(ids(selectAlerts(base({ budget: { kind: "na" }, landing: { kind: "value", total: 90, gap: null } })))).toEqual([]);
    const nd = selectAlerts(base({ budget: { kind: "na" }, landing: { kind: "nd", reason: "2026-12 : hors de l'horizon du scénario" } }));
    expect(nd.alerts.map((a) => [a.id, a.level, a.text])).toEqual([["atterrissage-nd", "a-completer", "2026-12 : hors de l'horizon du scénario."]]);
  });
});

describe("selectAlerts : seuils d'effectif (paramètres, sans valeur par défaut)", () => {
  // Effectif moyen 97/2 = 48,5 ; seuils 11 et 50 : le prochain seuil strictement supérieur est 50, écart 1,5.
  const avg = { kind: "value" as const, average: { num: 97, den: 2 } };
  const SEUILS: SeuilEffectif[] = [{ libelle: "Seuil A", valeur: 50 }, { libelle: "Seuil B", valeur: 11 }];

  it("nearThreshold : écart ≤ marge (inclus), seuil strictement au-dessus, aucun arrondi", () => {
    expect(nearThreshold({ num: 97, den: 2 }, SEUILS, 2)).toEqual({ seuil: { libelle: "Seuil A", valeur: 50 }, gap: { num: 3, den: 2 } });
    expect(nearThreshold({ num: 97, den: 2 }, SEUILS, 1)).toBeNull(); // 1,5 > 1
    expect(nearThreshold({ num: 49, den: 1 }, SEUILS, 1)).toEqual({ seuil: { libelle: "Seuil A", valeur: 50 }, gap: { num: 1, den: 1 } }); // 1 ≤ 1
    expect(nearThreshold({ num: 50, den: 1 }, SEUILS, 5)).toBeNull(); // seuil atteint, aucun seuil au-dessus
  });

  it("seuils et marge définis : repère « Effectif proche d'un seuil »", () => {
    const r = selectAlerts(base({ budget: { kind: "na" }, headcount: avg, seuils: set(SEUILS), marge: set(2) }));
    expect(r.mentions).toEqual([]);
    expect(r.alerts.map((a) => [a.id, a.level])).toEqual([["seuil-effectif", "repere"]]);
    expect(textOf(r, "seuil-effectif")).toBe("Effectif moyen de la période : 48,50 ; seuil « Seuil A » : 50 salariés ; écart 1,50, marge 2.");
  });

  it("seuils absents, liste vide, illisibles, ou marge absente : aucune alerte, une mention et le lien vers Paramètres", () => {
    const absent = selectAlerts(base({ budget: { kind: "na" }, headcount: avg }));
    expect(absent.alerts).toEqual([]);
    expect(absent.mentions).toEqual([{ id: "seuils-effectif", text: "Seuils d'effectif non définis (Paramètres)", href: HREFS.parametres, linkLabel: "Paramètres" }]);
    expect(selectAlerts(base({ budget: { kind: "na" }, headcount: avg, seuils: set([]), marge: set(2) })).mentions[0].text).toBe("Seuils d'effectif non définis (Paramètres)");
    expect(selectAlerts(base({ budget: { kind: "na" }, headcount: avg, seuils: { kind: "invalid", raw: "x" }, marge: set(2) })).mentions[0].text).toBe("Seuils d'effectif illisibles : à ré-enregistrer (Paramètres)");
    const noMarge = selectAlerts(base({ budget: { kind: "na" }, headcount: avg, seuils: set(SEUILS) }));
    expect(noMarge.alerts).toEqual([]);
    expect(noMarge.mentions.map((m) => m.text)).toEqual(["Marge d'alerte des seuils d'effectif non définie (Paramètres)"]);
  });

  it("effectif moyen n.d. avec seuils définis : « à compléter »", () => {
    const r = selectAlerts(base({ budget: { kind: "na" }, headcount: { kind: "nd", reason: "mois en borne basse" }, seuils: set(SEUILS), marge: set(2) }));
    expect(r.alerts.map((a) => [a.id, a.level, a.text])).toEqual([["effectif-nd", "a-completer", "Mois en borne basse."]]);
  });
});

describe("selectAlerts : ordre par niveau, aucun plafond", () => {
  it("défavorable, puis à compléter, puis repère ; ordre d'origine dans un niveau ; toutes les alertes sont renvoyées", () => {
    const r = selectAlerts(
      base({
        landing: { kind: "nd", reason: "projection refusée (hypothèses en erreur)" },
        openMonths: ["2026-06"],
        unclassified: ["6459", "6414", "6459"],
        missing: [{ id: "journal", label: "Journal de paie non lu", reason: "journal de paie indisponible", href: "/e/demo/donnees", linkLabel: "Données" }],
        headcount: { kind: "value", average: { num: 97, den: 2 } },
        seuils: set([{ libelle: "Seuil A", valeur: 50 }]),
        marge: set(2),
        checks: { compta: 0, dsn: -1_234 },
      }),
    );
    expect(ids(r)).toEqual(["budget-depasse", "atterrissage-nd", "source-journal", "comptes-non-classes", "budget-mois", "seuil-effectif", "mois-non-clos", "journal-dsn"]);
    expect(r.alerts.map((a) => a.level)).toEqual(["defavorable", "a-completer", "a-completer", "a-completer", "repere", "repere", "repere", "repere"]);
    expect(textOf(r, "comptes-non-classes")).toBe("2 comptes de charges de personnel sans rubrique, hors masse chargée : 6414, 6459.");
    expect(r.alerts.find((a) => a.id === "comptes-non-classes")?.href).toBe(HREFS.grille);
    expect(textOf(r, "mois-non-clos")).toBe("Paie non clôturée à la lecture : juin 2026 (montants provisoires).");
    expect(textOf(r, "journal-dsn")).toBe("Brut du journal moins brut déclaré (DSN, type 001) sur la période : −12,34 €.");
    expect(r.alerts.find((a) => a.id === "source-journal")).toMatchObject({ text: "Journal de paie indisponible.", href: "/e/demo/donnees", linkLabel: "Données" });
  });

  it("journal et comptabilité : repère seulement si l'écart est non nul (au centime)", () => {
    expect(ids(selectAlerts(base({ budget: { kind: "na" }, checks: { compta: 1, dsn: 0 } })))).toEqual(["journal-compta"]);
    expect(textOf(selectAlerts(base({ budget: { kind: "na" }, checks: { compta: 1, dsn: 0 } })), "journal-compta")).toBe("Écart sur les comptes 63 et 64 de la période : +0,01 €.");
    expect(ids(selectAlerts(base({ budget: { kind: "na" }, checks: { compta: 0, dsn: null } })))).toEqual([]);
  });
});
