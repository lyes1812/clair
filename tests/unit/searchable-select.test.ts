import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchableSelect, matchingChoices, visibleChoices, type SelectChoice } from "@/components/SearchableSelect";

const choices: SelectChoice[] = [{ value: "", label: "Tous les services" }, ...["Équipe finance", "Pôle agricole", "Équipe technique", "Communication", "Opérations", "Direction", "Support", "Relations partenaires"].map((label, index) => ({ value: `fixture-${index}`, label }))];
describe("recherche locale des choix", () => {
  it("cherche les mots sans tenir compte des accents, de la casse ou des espaces, sans modifier les libellés", () => {
    expect(matchingChoices(choices, "  EQUIPE fin  ").map((o) => o.label)).toEqual(["Équipe finance"]);
    expect(matchingChoices(choices, "pole AGRI").map((o) => o.value)).toEqual(["fixture-1"]);
    expect(choices[1].label).toBe("Équipe finance");
  });
  it("conserve le choix courant et l'option vide, y compris sans résultat", () => {
    expect(visibleChoices(choices, "aucun résultat", "fixture-0").map((o) => o.value)).toEqual(["", "fixture-0"]);
    expect(visibleChoices(choices, "technique", "fixture-0").map((o) => o.value)).toEqual(["", "fixture-0", "fixture-2"]);
    expect(visibleChoices(choices, "", "fixture-0")).toEqual(choices);
  });
  it("cherche aussi les groupes et conserve les choix désactivés sans les activer", () => {
    const options = [{ value: "a", label: "Cotisations", group: "Masse salariale", disabled: true }, { value: "b", label: "Inscrits", group: "Effectifs" }];
    expect(matchingChoices(options, "salariale")).toEqual([options[0]]);
    expect(visibleChoices(options, "salariale", "b").map((o) => o.disabled)).toEqual([true, undefined]);
  });
  it("conserve aussi l'option initiale pour que le reset natif retrouve sa valeur après une recherche", () => {
    expect(visibleChoices(choices, "agricole", "fixture-2", "fixture-0").map((o) => o.value)).toEqual(["", "fixture-0", "fixture-1", "fixture-2"]);
  });
});

describe("sélecteur natif conservé", () => {
  it("ne charge pas la recherche sur une courte liste et préserve noms, aides et valeurs", () => {
    const html = renderToStaticMarkup(h(SearchableSelect, { id: "service", name: "service", className: "select", searchLabel: "Service", defaultValue: "fixture-0", options: choices.slice(0, 3), "aria-describedby": "service-help" }));
    expect(html).toContain('<select id="service" name="service" class="select" aria-describedby="service-help">');
    expect(html).toContain('<option value="fixture-0" selected="">Équipe finance</option>');
    expect(html).not.toMatch(/<button|type="search"|type="hidden"/);
  });
  it("offre une recherche facultative pour une longue liste sans champ GET supplémentaire ni soumission", () => {
    const html = renderToStaticMarkup(h(SearchableSelect, { id: "service", name: "service", className: "select", searchLabel: "Service", defaultValue: "fixture-2", options: choices }));
    expect(html).toContain('aria-label="Rechercher : Service" aria-expanded="false"');
    expect(html).toContain('type="button"');
    expect(html.match(/name="service"/g)).toHaveLength(1);
    expect(html).not.toMatch(/type="submit"|name="q"/);
    expect(html).toContain('<option value="fixture-2" selected="">Équipe technique</option>');
  });
  it("conserve les groupes, les titres, le choix contrôlé et les refus natifs", () => {
    const options = choices.map((option, index) => ({ ...option, group: index < 4 ? "Groupe A" : "Groupe B", disabled: index === 2, title: `Détail ${index}` }));
    const html = renderToStaticMarkup(h(SearchableSelect, { id: "rub", name: "rub", searchLabel: "Rubrique", value: "fixture-0", options, disabled: true }));
    expect(html.match(/<optgroup /g)).toHaveLength(2);
    expect(html).toContain('label="Groupe A"');
    expect(html).toContain('value="fixture-1" disabled="" title="Détail 2"');
    expect(html).toContain('<select id="rub" name="rub" disabled="">');
    expect(html).toContain('type="button" class="btn filter-choice-toggle" disabled=""');
  });
});
