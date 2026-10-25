import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ExportMenu } from "@/components/ExportMenu";

describe("menus d'actions compacts", () => {
  it("garde les liens exacts et un résumé natif accessible, fermé initialement", () => {
    const href = "/export?annee=2026&de=01&a=09&format=xlsx";
    const html = renderToStaticMarkup(h(DropdownMenu, { label: "Exporter", testid: "fixture-export", children: [h("a", { key: "xlsx", href }, "Excel (.xlsx)"), h("a", { key: "csv", href: "/export?annee=2026&de=01&a=09" }, "CSV")] }));
    expect(html).toContain('<details class="ui-dropdown" data-testid="fixture-export">');
    expect(html).toContain('<summary class="btn">Exporter');
    expect(html).toContain('href="/export?annee=2026&amp;de=01&amp;a=09&amp;format=xlsx"');
    expect(html).toContain('href="/export?annee=2026&amp;de=01&amp;a=09"');
    expect(html).not.toContain(" open=");
  });
  it("conserve les champs d'un formulaire même si le panneau est fermé", () => {
    const html = renderToStaticMarkup(h(DropdownMenu, { label: "Comparer avec", children: h("input", { type: "checkbox", name: "cmp", value: "scenario:fixture", defaultChecked: true }) }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="cmp" checked="" value="scenario:fixture"');
    expect(html).not.toContain("disabled");
  });
  it("ne propose aucun format absent et conserve l'adresse d'export fournie", () => {
    const html = renderToStaticMarkup(h(ExportMenu, { testid: "export", options: [{ href: "/export?de=01&a=09&rub=etp", label: "CSV (.csv)", testid: "csv" }] }));
    expect(html).toContain('href="/export?de=01&amp;a=09&amp;rub=etp" data-testid="csv"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("xlsx");
  });
});
