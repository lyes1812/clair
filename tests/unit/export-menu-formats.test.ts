import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportButtons } from "@/components/ExportButtons";

describe("formats regroupés sans modifier les exports", () => {
  it("conserve toutes les références et filtres et propose Excel puis CSV", () => {
    const html = renderToStaticMarkup(h(ExportButtons, { href: "/e/fixture/export", params: "scenario=fixture&annee=2026&de=01&a=09&service=Atelier&format=csv", label: "Exporter le détail", xlsxTestId: "xlsx", csvTestId: "csv" }));
    expect(html).toContain('<summary class="btn">Exporter le détail');
    expect(html).toContain('href="/e/fixture/export?scenario=fixture&amp;annee=2026&amp;de=01&amp;a=09&amp;service=Atelier&amp;format=xlsx" data-testid="xlsx"');
    expect(html).toContain('href="/e/fixture/export?scenario=fixture&amp;annee=2026&amp;de=01&amp;a=09&amp;service=Atelier" data-testid="csv"');
    expect(html.indexOf("Excel (.xlsx)")).toBeLessThan(html.indexOf("CSV (.csv)"));
    expect(html).not.toContain("format=csv");
  });
  it("sans filtre, garde l'adresse CSV originale et les identifiants des liens", () => {
    const html = renderToStaticMarkup(h(ExportButtons, { href: "/export" }));
    expect(html).toContain('href="/export?format=xlsx" data-testid="export-xlsx"');
    expect(html).toContain('href="/export" data-testid="export-csv"');
    expect(html.match(/<a /g)).toHaveLength(2);
  });
});
