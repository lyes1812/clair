import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickerForm } from "@/app/e/[slug]/studio-rh/masse-salariale/EcartParts";
import { NV, type Loaded } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { PeriodBar } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { EcartChart } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/EcartChart";
import { rubricGroups } from "@/lib/viz/ecart";

const services = ["Atelier A", "Atelier B", "Atelier C", "Atelier D", "Atelier E", "Atelier F", "Atelier G", "Atelier H"];
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const selectOf = (html: string, id: string): string => new RegExp(`<select\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/select>`).exec(html)?.[0] ?? "";
const optionValues = (html: string) => [...html.matchAll(/<option\b[^>]*value="([^"]*)"/g)].map((m) => m[1]);

describe("recherche des services de la masse salariale", () => {
  const props = {
    years: [2025, 2026], year: 2026, from: "01", to: "09", hidden: { vue: "paie-compta", affichage: "tableau" },
    presets: [], resetHref: "/e/demo/studio-rh/masse-salariale?vue=paie-compta",
    service: { value: "Atelier C", options: services.map((value) => ({ value, label: value })) },
  };

  it("une longue liste reste un filtre GET avec les mêmes options, valeur courante et remise à zéro", () => {
    const html = renderToStaticMarkup(h(PeriodBar, props));
    const select = selectOf(html, "service");
    expect(html).toContain('method="get"');
    expect(html).toContain('name="vue" value="paie-compta"');
    expect(html).toContain('name="affichage" value="tableau"');
    expect(html).toContain('aria-label="Rechercher : Service"');
    expect(select).toContain('name="service"');
    expect(select).toMatch(/<option value="Atelier C" selected="">Atelier C<\/option>/);
    expect(optionValues(select)).toEqual(["", ...services]);
    expect(select).toContain('value="">Tous les services</option>');
    expect(html).toContain(`href="${escape(props.resetHref)}"`);
    expect(optionValues(selectOf(html, "de"))).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    expect(optionValues(selectOf(html, "annee"))).toEqual(["2025", "2026"]);
  });

  it("une petite liste reste native, et une vue sans filtre service n'en ajoute pas", () => {
    const html = renderToStaticMarkup(h(PeriodBar, { ...props, service: { value: "Atelier A", options: props.service.options.slice(0, 2) } }));
    expect(html).not.toContain('aria-label="Rechercher : Service"');
    expect(optionValues(selectOf(html, "service"))).toEqual(["", "Atelier A", "Atelier B"]);
    const without = renderToStaticMarkup(h(PeriodBar, { ...props, service: undefined }));
    expect(without).not.toContain('name="service"');
  });
});

describe("versions et services des écarts et de leur analyse", () => {
  const versions = [
    { value: "reel:2025", label: "Réel PayFit 2025" },
    ...Array.from({ length: 7 }, (_, i) => ({ value: `scenario:variante-${i + 1}:2026`, label: `Scénario « Variante ${i + 1} » (Révisé, brouillon) 2026` })),
  ];
  const loaded = {
    options: versions, selected: [versions[0].value, versions[7].value], from: "01", to: "09",
    services, hasNv: true, filter: { value: null },
  } as unknown as Loaded;

  it("garde les options et références des trois versions, la période, Non ventilé et la rubrique courante", () => {
    const html = renderToStaticMarkup(h(PickerForm, { path: "/e/demo/ecart", loaded, columns: 3, hidden: { rub: "etp", affichage: "graphique" } }));
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/e/demo/ecart"');
    expect(html).toContain('name="rub" value="etp"');
    expect(html).toContain('name="affichage" value="graphique"');
    for (const index of [1, 2, 3]) {
      const select = selectOf(html, `v${index}`);
      expect(select).toContain(`name="v${index}"`);
      expect(optionValues(select)).toEqual(["", ...versions.map((version) => version.value)]);
      expect(html).toContain(`aria-label="Rechercher : Version ${index}"`);
    }
    expect(selectOf(html, "v2")).toContain(`title="${versions[7].label}"`);
    expect(selectOf(html, "v2")).toMatch(/value="scenario:variante-7:2026" selected=""/);
    expect(selectOf(html, "v3")).toMatch(/value="" selected=""/);
    expect(optionValues(selectOf(html, "service"))).toEqual(["", ...services, NV]);
    expect(selectOf(html, "service")).toContain(`value="${NV}" selected="">Non ventilé</option>`);
    expect(html).toContain('href="/e/demo/ecart"');
    expect(optionValues(selectOf(html, "de"))).toHaveLength(12);
    expect(selectOf(html, "a")).toMatch(/value="09" selected=""/);
  });

  it("les deux versions de l'analyse et un petit nombre de services gardent leurs select natifs", () => {
    const html = renderToStaticMarkup(h(PickerForm, { path: "/e/demo/analyse", loaded: { ...loaded, options: versions.slice(0, 2), services: ["Atelier A"], hasNv: false, filter: null }, columns: 2 }));
    expect(html).not.toContain('aria-label="Rechercher : Version');
    expect(html).not.toContain('aria-label="Rechercher : Service"');
    expect(html).not.toContain('name="v3"');
    expect(optionValues(selectOf(html, "service"))).toEqual(["", "Atelier A"]);
    expect(selectOf(html, "service")).toContain('value="" selected="">Tous les services</option>');
  });
});

describe("recherche de rubrique du graphique des écarts", () => {
  it("conserve les douze rubriques, leurs deux groupes et le choix initial, sans remplacer les données absentes par des valeurs", () => {
    const groups = rubricGroups();
    const html = renderToStaticMarkup(h(EcartChart, { testid: "chart", initial: "brut", groups, categories: [], categoryTitles: [], data: { brut: { unit: "eur", series: [] } }, period: "de janvier à septembre", scope: "tous les services" }));
    const select = /<select\b[^>]*data-testid="chart-rubrique"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    expect(html).toContain('aria-label="Rechercher : Rubrique"');
    expect(optionValues(select)).toEqual(groups.flatMap((group) => group.options.map((option) => option.key)));
    expect(select.match(/<optgroup\b/g)).toHaveLength(2);
    expect(select).toContain('<optgroup label="Effectifs">');
    expect(select).toContain('<optgroup label="Masse salariale">');
    expect(select).toMatch(/value="brut" selected=""/);
    expect(html).toContain("n.d. — aucune valeur à tracer");
    expect(html).not.toContain('data-testid="chart"');
  });
});
