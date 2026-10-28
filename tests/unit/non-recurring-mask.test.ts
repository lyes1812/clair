import { describe, expect, it } from "vitest";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { declaredLink, maskNonRecurring } from "@/lib/payroll/non-recurring-mask";

// Éléments non récurrents du réel : seuil de confidentialité par nature, en personnes distinctes (contrats déclarés reliés par le
// référentiel). Données fictives.
const SYNC = "11111111-1111-4111-8111-111111111111";
let n = 0;
const ev = (kind: ActualEvent["kind"], month: string, contractKeys: string[], euros: number | null) => ({
  event: { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, syncId: SYNC, month, kind, chargedCents: euros === null ? null : euros * 100, contractKeys, note: "" } as ActualEvent,
  amount: euros === null ? null : euros * 100,
  reason: euros === null ? "Montant chargé non saisi" : null,
});
const MONTHS = ["2026-01", "2026-02", "2026-03"];
const LINK = declaredLink(["A", "B", "C", "D", "E", "F", "G", "H"].map((x, i) => ({ contractKey: `payfit:c${x}`, externalId: `c${x}`, personKey: `P${i + 1}` })));
const set = (value: number) => ({ kind: "set" as const, value, updatedAt: null, updatedBy: null });
const R3 = "non affiché (seuil de confidentialité : 3 personnes)";

describe("maskNonRecurring — natures des éléments non récurrents, seuil en personnes distinctes", () => {
  // Cas de référence (seuil 3) :
  //   Licenciements : janvier cA (P1) 5 000 €                                   → 1 personne : masqué
  //   Ruptures      : février cB (P2) 8 000 € ; mars cC (P3) 7 000 €, cD (P4) 6 000 € → 3 personnes, 21 000 € : affiché
  //   Tuilages      : février cE+cF (P5, P6) 3 000 € ; mars cG+cH (P7, P8) 2 000 €   → 4 personnes, 5 000 € : secondaire
  //   Autres        : aucun élément                                               → affiché (« Aucun élément identifié »)
  // « Coûts identifiés » (31 000 €) est publié : Licenciements seul se lirait par différence ; parmi Ruptures (21 000 €) et Tuilages
  // (5 000 €), la plus petite valeur qui apporte des personnes est masquée : Tuilages. 31 000 − 21 000 = 10 000 € = deux natures.
  // Mois des ruptures : février (1 personne) et mars (2 personnes) masqués, ensemble 3 personnes ; janvier vide.
  const rows = [
    ev("licenciement", "2026-01", ["payfit:cA"], 5000),
    ev("rupture-conventionnelle", "2026-02", ["payfit:cB"], 8000),
    ev("rupture-conventionnelle", "2026-03", ["payfit:cC"], 7000),
    ev("rupture-conventionnelle", "2026-03", ["payfit:cD"], 6000),
    ev("tuilage", "2026-02", ["payfit:cE", "payfit:cF"], 3000),
    ev("tuilage", "2026-03", ["payfit:cG", "payfit:cH"], 2000),
  ];

  it("cas de référence au seuil 3 : principal, secondaire et mois d'une nature affichée", () => {
    const m = maskNonRecurring(rows, MONTHS, LINK, set(3));
    expect(m.licenciement.reason).toBe(R3);
    expect(m.tuilage.reason).toBe(R3);
    expect(m["rupture-conventionnelle"].reason).toBeNull();
    expect(m.autre.reason).toBeNull();
    expect(m["rupture-conventionnelle"].months).toEqual({ "2026-01": null, "2026-02": R3, "2026-03": R3 });
  });

  it("seuil 1 : tout est affiché ; un même contrat sur deux éléments compte une personne", () => {
    const m = maskNonRecurring([...rows, ev("licenciement", "2026-02", ["payfit:cA"], 100)], MONTHS, LINK, set(1));
    expect(Object.values(m).map((x) => x.reason)).toEqual([null, null, null, null]);
    // Au seuil 2, le licenciement déclaré deux fois pour cA reste une seule personne : masqué.
    expect(maskNonRecurring([...rows, ev("licenciement", "2026-02", ["payfit:cA"], 100)], MONTHS, LINK, set(2)).licenciement.reason).toBe("non affiché (seuil de confidentialité : 2 personnes)");
  });

  it("élément sans contrat : contributeur non relié, jamais protecteur (non vérifiable même au seuil 1)", () => {
    const m = maskNonRecurring([ev("autre", "2026-01", [], 1000), ev("licenciement", "2026-02", ["payfit:cA"], 5000)], MONTHS, LINK, set(1));
    expect(m.autre.reason).toBe("effectif du groupe non dénombré : seuil de confidentialité non vérifiable");
    expect(m.licenciement.reason).toBe("non affiché (seuil de confidentialité : 1 personne)");
  });

  it("montant non saisi : la nature reste un groupe à protéger, jamais un zéro", () => {
    const m = maskNonRecurring([ev("licenciement", "2026-01", ["payfit:cA"], null), ...rows.slice(1)], MONTHS, LINK, set(3));
    expect(m.licenciement.reason).toBe(R3);
  });

  it("seuil absent ou illisible : toute nature non vide est n.d. avec la raison du paramètre ; une nature vide reste affichée", () => {
    const m = maskNonRecurring(rows, MONTHS, LINK, { kind: "absent" });
    expect(m.licenciement.reason).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(m.licenciement.months["2026-01"]).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(m.licenciement.months["2026-02"]).toBeNull();
    expect(m.autre.reason).toBeNull();
    expect(maskNonRecurring(rows, MONTHS, LINK, { kind: "invalid", raw: "x" } as never).tuilage.reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });

  it("aucune clé de contrat ni identifiant ne sort du masque", () => {
    expect(JSON.stringify(maskNonRecurring(rows, MONTHS, LINK, set(3)))).not.toMatch(/payfit:|P[1-8]|00000000/);
  });
});
