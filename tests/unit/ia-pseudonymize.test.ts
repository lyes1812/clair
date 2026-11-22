import { describe, expect, it } from "vitest";
import { createPseudonymizer } from "@/lib/ia/pseudonymize";

describe("pseudonymisation avant envoi au modèle", () => {
  const p = createPseudonymizer(["Camille Testard", "Testard", "Dominique Exemplier", "Exemplier", "Al"]);
  it("noms connus remplacés par des jetons stables ; IBAN, e-mail et références retirés", () => {
    const a = p.apply("VIR SEPA SALAIRE 07/2026 Camille TESTARD FR76 3000 6000 0112 3456 7890 189 mandat 2026123456");
    // « 2026 » et le n° de mandat (4 chiffres et plus) sont retirés comme toute référence chiffrée.
    expect(a).toBe("VIR SEPA SALAIRE 07 PERSONNE_1 MANDAT");
    expect(p.apply("Remboursement note de frais testard")).toBe("REMBOURSEMENT NOTE DE FRAIS PERSONNE_2");
    expect(p.apply("VIR Exemplier Dominique contact@exemple.test")).toBe("VIR PERSONNE_3 DOMINIQUE");
    expect(p.leaks(a)).toEqual([]);
  });
  it("civilité suivie d'un nom inconnu : pseudonymisée aussi", () => {
    expect(p.apply("VIR M INCONNU FICTIF LOYER")).toBe("VIR PERSONNE_4 LOYER");
    // Nom connu après une civilité : jeton du nom, la civilité ne crée pas de second jeton.
    expect(p.apply("CHQ MME TESTARD")).toBe("CHQ MME PERSONNE_2");
  });
  it("noms de 2 lettres ignorés ; détection des fuites", () => {
    expect(p.apply("FRAIS AL")).toBe("FRAIS AL");
    expect(p.leaks("PAIEMENT TESTARD")).toEqual(["TESTARD"]);
  });
});
