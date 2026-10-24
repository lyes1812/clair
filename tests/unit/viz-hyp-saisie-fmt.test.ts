import { describe, expect, it } from "vitest";
import { deMois, frDates, gridCaption } from "@/lib/viz/hyp-saisie-fmt";

// Un seul format de date dans les écrans de saisie : jj/mm/aaaa pour un jour, « novembre 2026 » pour un mois.
// Cas de référence écrits à la main.
describe("frDates", () => {
  it("un jour : jj/mm/aaaa ; un mois : nom du mois en toutes lettres et année", () => {
    expect(frDates("du 2026-11-16")).toBe("du 16/11/2026");
    expect(frDates("Augmentation toute l'entreprise 2026-11")).toBe("Augmentation toute l'entreprise novembre 2026");
    expect(frDates("2026-02")).toBe("février 2026");
    expect(frDates("2026-12-31")).toBe("31/12/2026");
  });
  it("plusieurs dates dans la même phrase, séparées par une flèche ou une virgule", () => {
    expect(frDates("du 2026-10-26 au 2026-11-25")).toBe("du 26/10/2026 au 25/11/2026");
    expect(frDates("2026-10 → 2026-12")).toBe("octobre 2026 → décembre 2026");
    expect(frDates("2026-11, 2026-12")).toBe("novembre 2026, décembre 2026");
    expect(frDates("2026-11 2026-12")).toBe("novembre 2026 décembre 2026");
  });
  it("date en début ou en fin de texte, entre parenthèses ou après une espace insécable", () => {
    expect(frDates("(lecture du 2026-10-23)")).toBe("(lecture du 23/10/2026)");
    expect(frDates("à compter de 2027-01")).toBe("à compter de janvier 2027");
  });
  it("jamais de date inventée : mois 13, 30 février, jeton collé à un autre nombre ou à un tiret restent tels quels", () => {
    expect(frDates("mois=2026-13")).toBe("mois=2026-13");
    expect(frDates("2026-02-30")).toBe("2026-02-30");
    expect(frDates("2026-02-29")).toBe("2026-02-29"); // 2026 n'est pas bissextile
    expect(frDates("2028-02-29")).toBe("29/02/2028");
    expect(frDates("12026-11")).toBe("12026-11");
    expect(frDates("2026-11-150")).toBe("2026-11-150");
    expect(frDates("A-2026-11")).toBe("A-2026-11");
    expect(frDates("K2026-11")).toBe("K2026-11");
    expect(frDates("2026-11a")).toBe("2026-11a");
    expect(frDates("ref 2026-11-")).toBe("ref 2026-11-");
  });
  it("un texte sans date, une date déjà française et un montant ne sont pas touchés", () => {
    expect(frDates("")).toBe("");
    expect(frDates("16/11/2026 · 22 140,00 € · 2 500,00 € brut")).toBe("16/11/2026 · 22 140,00 € · 2 500,00 € brut");
    expect(frDates("novembre 2026")).toBe("novembre 2026");
  });
});

describe("« de » devant un mois", () => {
  it("s'élide devant avril, août et octobre, pas devant les autres mois", () => {
    expect(frDates("éléments ponctuels de 2026-10")).toBe("éléments ponctuels d'octobre 2026");
    expect(frDates("éléments ponctuels de 2026-04")).toBe("éléments ponctuels d'avril 2026");
    expect(frDates("De 2026-08")).toBe("D'août 2026");
    expect(frDates("éléments ponctuels de 2026-12")).toBe("éléments ponctuels de décembre 2026");
    expect(frDates("fin 2026-10")).toBe("fin octobre 2026");
    expect(frDates("Code-de 2026-10")).toBe("Code-de octobre 2026"); // « de » collé à un tiret : un mot d'un identifiant
  });
  it("deMois : le mois précédé de « de » correctement élidé ; une valeur illisible n'est pas transformée", () => {
    expect(deMois("2026-12")).toBe("de décembre 2026");
    expect(deMois("2026-10")).toBe("d'octobre 2026");
    expect(deMois("2026-08")).toBe("d'août 2026");
    expect(deMois("2026-04")).toBe("d'avril 2026");
    expect(deMois("2026-02")).toBe("de février 2026");
    expect(deMois("2026-13")).toBe("de 2026-13");
  });
});

describe("gridCaption", () => {
  it("une année : unité puis année", () => {
    expect(gridCaption("Taux en %", ["2026-10", "2026-11", "2026-12"])).toBe("Taux en % · 2026");
  });
  it("deux ou trois années : liste lisible", () => {
    expect(gridCaption("Montants en € par mois", ["2026-12", "2027-01"])).toBe("Montants en € par mois · 2026 et 2027");
    expect(gridCaption("Taux en %", ["2026-12", "2027-12", "2028-01"])).toBe("Taux en % · 2026, 2027 et 2028");
  });
  it("aucun mois : l'unité seule, jamais une année inventée", () => {
    expect(gridCaption("Taux en %", [])).toBe("Taux en %");
  });
});
