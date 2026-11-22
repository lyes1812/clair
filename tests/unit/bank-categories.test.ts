import { describe, expect, it } from "vitest";
import { categorizationStats, categorize, emptyCategorization, monthlyOutflow, parseCategorization, ruleFor, tierOf } from "@/lib/bank/categories";
import { fixtureFlows } from "@/lib/bank/categories-fixture";

// Cap 13, lot L4 : catégorisation des flux bancaires. Cas écrits à la main.
const m = (key: string, bookingDate: string, amountCents: number, label: string, counterparty: string | null = null) => ({ key, bookingDate, amountCents, label, counterparty });

describe("référentiel de règles", () => {
  it("motifs usuels, dans le bon sens seulement", () => {
    expect(ruleFor("PRLV SEPA URSSAF IDF", "out")?.category).toBe("social");
    expect(ruleFor("Prélèvement DGFiP TVA 07/2026", "out")?.category).toBe("tax");
    expect(ruleFor("VIR SALAIRE JUILLET", "out")?.category).toBe("payroll");
    expect(ruleFor("ECHEANCE PRET 0042", "out")?.category).toBe("loans");
    expect(ruleFor("FRAIS BANCAIRES TRIMESTRE", "out")?.category).toBe("bank_fees");
    expect(ruleFor("REMISE CB 31/07", "in")?.category).toBe("customers");
    // Un encaissement URSSAF (remboursement) n'est pas une charge sociale : il reste au résidu.
    expect(ruleFor("VIR URSSAF REMBOURSEMENT TROP PERCU", "in")).toBeNull();
    expect(ruleFor("VIR DGFIP REMBOURSEMENT CREDIT TVA", "in")?.category).toBe("other_in");
    expect(ruleFor("VIR CLIENT FICTIF", "in")).toBeNull();
  });

  it("tiers : contrepartie, sinon mots significatifs du libellé sans références chiffrées", () => {
    expect(tierOf({ label: "VIR SEPA RECU X", counterparty: "Grossiste Fictif SAS" })).toBe("GROSSISTE FICTIF");
    expect(tierOf({ label: "VIR SEPA EMIS TRANSPORTS FICTIFS FA-2026-12", counterparty: null })).toBe("TRANSPORTS FICTIFS");
    expect(tierOf({ label: "CB 1234 5678", counterparty: null })).toBeNull();
  });
});

describe("ordre et revue", () => {
  // Cas de référence : 2 mois (juin, juillet 2026), débits 10 000 + 2 000 + 600 + 400 = 13 000 € → moyenne mensuelle 6 500 €,
  // seuil de revue 5 % = 325 €.
  const flows = [
    m("a", "2026-06-05", -1_000_000, "PRLV URSSAF"),
    m("b", "2026-06-10", -200_000, "VIR SEPA EMIS GROSSISTE FICTIF", "GROSSISTE FICTIF"),
    m("c", "2026-07-02", -60_000, "VIR SEPA EMIS TRANSPORTS FICTIFS"),
    m("d", "2026-07-03", -40_000, "CB ACHAT DIVERS"),
    m("e", "2026-07-04", 300_000, "VIR CLIENT FICTIF ALPHA"),
  ];
  it("décaissement mensuel moyen", () => expect(monthlyOutflow(flows.map((f) => ({ date: f.bookingDate, amountCents: f.amountCents })))).toBe(650_000));

  it("décision > apprise > règle > IA ; revue sous 80 % ou au-dessus de 5 % du décaissement mensuel", () => {
    const state = {
      decisions: { a: "tax" as const },
      learned: { "GROSSISTE FICTIF": "suppliers" as const },
      ai: {
        c: { category: "suppliers" as const, confidence: 0.95, reason: "Transport", promptVersion: "categorize-v1" }, // 600 € > 325 € : revue
        d: { category: "other_out" as const, confidence: 0.6, reason: "Divers", promptVersion: "categorize-v1" }, // confiance basse : revue
        e: { category: "payroll" as const, confidence: 0.99, reason: "x", promptVersion: "categorize-v1" }, // mauvais sens : ignorée
      },
    };
    const r = categorize(flows, state);
    expect(r.map((f) => [f.key, f.category, f.source, f.review])).toEqual([
      ["a", "tax", "saisie", false],
      ["b", "suppliers", "apprise", false],
      ["c", "suppliers", "ia", true],
      ["d", "other_out", "ia", true],
      ["e", null, null, true],
    ]);
    expect(r[2].reviewReason).toMatch(/5 %/);
    expect(r[3].reviewReason).toMatch(/60 %/);
    // Sans décision ni apprise, la règle du référentiel s'applique.
    expect(categorize([flows[0]], { decisions: {}, learned: {}, ai: {} })[0]).toMatchObject({ category: "social", source: "regle" });
    expect(categorizationStats(r)).toMatchObject({ total: 5, saisie: 1, apprise: 1, regle: 0, ia: 2, none: 1, review: 3, rulesPermille: 200 });
  });

  it("lecture stricte des saisies enregistrées", () => {
    expect(parseCategorization({})).toEqual(emptyCategorization());
    expect(parseCategorization({ decisions: { a: "inconnue" } })).toBeNull();
    expect(parseCategorization({ ai: { a: { category: "tax", confidence: 2, reason: "", promptVersion: "v" } } })).toBeNull();
    expect(parseCategorization({ noAi: true, learned: { X: "rent" } })).toMatchObject({ noAi: true, learned: { X: "rent" } });
  });
});

describe("jeu d'évaluation fictif (500 flux)", () => {
  const flows = fixtureFlows();
  const r = categorize(flows, { decisions: {}, learned: {}, ai: {} });
  it("au moins 70 % des flux classés par les règles, sans erreur de règle", () => {
    const stats = categorizationStats(r);
    expect(stats.total).toBe(500);
    expect(stats.rulesPermille!).toBeGreaterThanOrEqual(700);
    const wrong = r.filter((f, i) => f.source === "regle" && f.category !== flows[i].expected).map((f) => f.label);
    expect(wrong).toEqual([]);
  });
});
