import { describe, expect, it } from "vitest";
import { companyAddress, companyRouteDecision } from "@/lib/company-routing";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const base = { slug: "fixture", relative: "/e/fixture/studio-rh", method: "GET", selectedId: A, companyCount: 2, error: false };
describe("adresses de société et onglets", () => {
  it("conserve les filtres dans l'adresse canonique", () => {
    expect(companyAddress("/e/fixture/studio-rh?annee=2026#details", A)).toBe(`/e/fixture/studio-rh?annee=2026&societe=${A}#details`);
    expect(companyRouteDecision(base)).toBe(`/e/fixture/studio-rh?societe=${A}`);
  });
  it("ne remplace pas la société explicite d'un onglet par le cookie d'un autre", () => {
    expect(companyRouteDecision({ ...base, relative: `${base.relative}?societe=${A}`, selectedId: B })).toBeNull();
  });
  it("retrouve le périmètre d'un ancien lien vers une ressource", () => {
    expect(companyRouteDecision({ ...base, resourceId: B })).toBe(`/e/fixture/studio-rh?societe=${B}`);
  });
  it("exige une sélection pour une clé brute présente dans plusieurs sociétés", () => {
    expect(companyRouteDecision({ ...base, resourceId: "ambiguous" })).toContain("vue=societes&selection=requise");
  });
  it("bloque un ancien formulaire sans société lorsqu'il existe plusieurs sociétés", () => {
    expect(companyRouteDecision({ ...base, method: "POST" })).toContain("selection=onglet");
    expect(companyRouteDecision({ ...base, method: "POST", relative: `${base.relative}?societe=${A}` })).toBeNull();
  });
  it("ne reprend pas le cookie après une société explicite invalide", () => {
    expect(companyRouteDecision({ ...base, relative: `${base.relative}?societe=`, error: true, selectedId: null })).toContain("selection=requise");
  });
  it("laisse accéder au choix des sociétés sans sélection préalable", () => {
    expect(companyRouteDecision({ ...base, relative: "/e/fixture/studio-rh/hypotheses?vue=societes", error: true, selectedId: null })).toBeNull();
  });
  it("n'applique pas le choix à un espace dont le slug partage seulement le préfixe", () => {
    expect(companyRouteDecision({ ...base, relative: "/e/fixture-other/studio-rh" })).toBeNull();
  });
});
