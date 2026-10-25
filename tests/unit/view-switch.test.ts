import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewSwitch, type ViewOption } from "@/components/ViewSwitch";
import { liveViewHref } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart/LiveRub";

const options: ViewOption[] = [
  { key: "tout", label: "Afficher tout", href: "/e/demo/resultat?scenario=fixture&service=Atelier#resultat" },
  { key: "graphique", label: "Graphique", href: "/e/demo/resultat?scenario=fixture&service=Atelier&affichage=graphique#resultat" },
  { key: "tableau", label: "Tableau", href: "/e/demo/resultat?scenario=fixture&service=Atelier&affichage=tableau#resultat" },
];

afterEach(() => vi.unstubAllGlobals());

describe("sélecteur d'affichage", () => {
  it("un select natif nommé, trois options et la vue actuelle, sans navigation supplémentaire", () => {
    const html = renderToStaticMarkup(h(ViewSwitch, { options, current: "graphique", label: "Affichage des résultats", testid: "vue" }));
    expect(html).toContain('<label class="view-select" data-testid="vue"><span>Affichage</span>');
    expect(html).toContain('<select class="select" aria-label="Affichage des résultats">');
    expect(html.match(/<option\b/g)?.length).toBe(3);
    expect(html).toContain('data-view="graphique" selected=""');
    expect(html).toContain('value="/e/demo/resultat?scenario=fixture&amp;service=Atelier&amp;affichage=tableau#resultat"');
    expect(html).not.toMatch(/<a\b|<nav\b|role="menu"/);
  });

  it("navigue vers l'adresse fournie, sans perdre les filtres, les références ou l'ancre", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    const element = ViewSwitch({ options, current: "tout", testid: "vue" });
    const select = element.props.children[1];
    select.props.onChange({ currentTarget: { value: options[2].href } });
    expect(assign).toHaveBeenCalledExactlyOnceWith(options[2].href);
    select.props.onChange({ currentTarget: { value: "/adresse-non-proposee" } });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("résout la rubrique courante au changement, même si le rendu a encore l'ancienne adresse", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    let currentHref = "http://clair.local/e/demo/resultat?rub=etp";
    const element = ViewSwitch({ options, current: "tout", testid: "vue", resolveHref: (href) => liveViewHref(href, "etp", currentHref) });
    currentHref = "http://clair.local/e/demo/resultat?rub=primes";
    element.props.children[1].props.onChange({ currentTarget: { value: options[1].href } });
    expect(assign).toHaveBeenCalledExactlyOnceWith(`${options[1].href.split("#")[0]}&rub=primes#resultat`);
  });

  it("un choix inconnu reprend la première option ; aucune option donne un select désactivé", () => {
    const html = renderToStaticMarkup(h(ViewSwitch, { options, current: "inconnu", testid: "vue" }));
    expect(html).toContain('data-view="tout" selected=""');
    expect(renderToStaticMarkup(h(ViewSwitch, { options: [], current: "tout", testid: "vide" }))).toContain('disabled=""');
  });
});

describe("rubrique conservée dans le choix d'affichage", () => {
  it("remplace seulement la rubrique, en gardant les deux versions, la période, le service, le zoom et l'ancre", () => {
    const href = "/e/demo/ecart?v1=reel%3A2025&v2=scenario%3Afixture&de=01&a=09&service=Atelier&rub=masse&zoom=masse%3A1&affichage=tableau#zoom";
    expect(liveViewHref(href, "etp", "/e/demo/ecart?rub=primes")).toBe(href.replace("rub=masse", "rub=primes"));
  });

  it("sans rubrique dans l'adresse ou sans adresse lisible, garde la valeur connue", () => {
    expect(liveViewHref("/p?v1=fixture#tableau", "etp")).toBe("/p?v1=fixture&rub=etp#tableau");
    expect(liveViewHref("/p?v1=fixture#tableau", "etp", "/p?de=01&a=09")).toBe("/p?v1=fixture&rub=etp#tableau");
    expect(liveViewHref("/p?v1=fixture#tableau", "etp", "http://")).toBe("/p?v1=fixture&rub=etp#tableau");
  });
});
