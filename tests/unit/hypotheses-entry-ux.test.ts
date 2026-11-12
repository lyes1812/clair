import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FrenchMonthInput, monthFromParts } from "@/app/e/[slug]/studio-rh/hypotheses/FrenchMonthInput";

describe("Création d’un scénario — mois explicite et création repliée", () => {
  it("présente douze mois français et une année, en soumettant un seul mois ISO", () => {
    const value = renderToStaticMarkup(createElement(FrenchMonthInput, { id: "dernier-mois", name: "lastMonth", defaultValue: "2026-12", required: true, "aria-describedby": "aide-existante" }));
    expect(value).not.toContain('type="month"');
    expect(value).toContain('<select class="select" id="dernier-mois"');
    expect(value.match(/<option value="\d{2}"/g)).toHaveLength(12);
    for (const month of ["Janvier", "Février", "Août", "Décembre"]) expect(value).toContain(`>${month}</option>`);
    expect(value).toContain('<option value="12" selected="">Décembre</option>');
    expect(value).toContain('id="dernier-mois-year" type="number"');
    expect(value).toContain('value="2026"');
    expect(value.match(/name="lastMonth"/g)).toHaveLength(1);
    expect(value).toContain('<input type="hidden" name="lastMonth" value="2026-12"');
    expect(value.match(/required=""/g)).toHaveLength(2);
    expect(value).toContain('aria-describedby="aide-existante dernier-mois-fr"');
    expect(value).toContain('Décembre 2026'); expect(value).not.toContain('December');
  });
  it("ne transforme pas une saisie vide ou incomplète en un mois inventé", () => {
    for (const [year, month] of [["", ""], ["2026", ""], ["", "12"], ["202", "12"], ["2e3", "12"], ["2026", "13"], ["2026", "2"]]) expect(monthFromParts(year, month)).toBe("");
    expect(monthFromParts("2027", "12")).toBe("2027-12");
    expect(monthFromParts("2026", "02")).toBe("2026-02");
    const empty = renderToStaticMarkup(createElement(FrenchMonthInput, { id: "mois-vide", name: "lastMonth", defaultValue: "", required: true }));
    expect(empty).toContain('<input type="hidden" name="lastMonth" value=""');
    expect(empty).toContain('Choisir un mois et une année');
    expect(empty).not.toContain('value="2026"');
  });
  it("préserve les champs désactivés et le formulaire externe sans soumettre les contrôles visibles", () => {
    const value = renderToStaticMarkup(createElement(FrenchMonthInput, { id: "mois-bloque", name: "lastMonth", form: "creation", defaultValue: "2026-12", disabled: true }));
    expect(value.match(/disabled=""/g)).toHaveLength(3);
    expect(value.match(/form="creation"/g)).toHaveLength(3);
    expect(value.match(/name=/g)).toHaveLength(1);
  });
  it("la création démarre repliée et conseille un nom neutre sans modifier les scénarios existants", () => {
    const page = readFileSync('src/app/e/[slug]/studio-rh/hypotheses/page.tsx', 'utf8');
    expect(page).toContain('<details className="panel hs-create-disclosure" data-testid="hyp-create">');
    expect(page).toContain('Nouveau scénario</summary>');
    expect(page).toContain('sans nom de salarié');
    expect(page).toContain('>{s.name}</a>');
  });
});
