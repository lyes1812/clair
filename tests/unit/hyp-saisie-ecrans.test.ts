import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { ActionForm } from "@/app/e/[slug]/studio-rh/hypotheses/ActionForm";
import { BasesView } from "@/app/e/[slug]/studio-rh/hypotheses/BasesView";
import { ControlesChangements, ControlesEffectifs } from "@/app/e/[slug]/studio-rh/hypotheses/ControlesView";
import { EnveloppesView } from "@/app/e/[slug]/studio-rh/hypotheses/EnveloppesView";
import { GlobalesView } from "@/app/e/[slug]/studio-rh/hypotheses/GlobalesView";
import { HireForm } from "@/app/e/[slug]/studio-rh/hypotheses/HireForm";
import { PostesView } from "@/app/e/[slug]/studio-rh/hypotheses/PostesView";
import { CardTitle, Verdict } from "@/app/e/[slug]/studio-rh/hypotheses/shared";

// Écrans de saisie, deuxième vague : titres sur un seul motif, un seul format de date, légende d'unité et d'année au-dessus des
// grilles, états vides explicites, contrôles à état unique, actions destructrices compactes. Rendu côté serveur ; les attendus
// sont écrits à la main.
const scenarioOf = (firstMonth: string, lastMonth: string) => ({ id: "11111111-1111-1111-1111-111111111111", name: "Révisé T4", kind: "revise", status: "brouillon", firstMonth, lastMonth }) as unknown as ScenarioRow;
const render = (el: React.ReactElement) => {
  const html = renderToStaticMarkup(el);
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2025-01-06", endDate: null, counted: true, etp4: 10000, etpNd: null, category: "cdi", executive: false, base: null, baseNd: null, ...over,
});
const A = contract("A", { label: "Alice", service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } });
const B = contract("B", { label: "Bruno", service: "SALES", endDate: "2026-12-31", base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: [A, B],
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 2, etp4: 20000, etpNd: null })),
  refMasse: 700000, refBaseCost: null, etpNote: "quotités PayFit à la date de lecture (2026-10-24), non historisées",
};
const sc = scenarioOf("2026-10", "2026-12");
const noHyps: Hypothesis[] = [];

describe("titres de carte : un seul motif", () => {
  it("titre puis phrase dessous ; le lien « règle » est dans la phrase, jamais dans le titre", () => {
    const html = render(h(CardTitle, { title: "Contrôle de la base" }, "Effectif comparé au réel. ", h("a", { href: "#def-controles" }, "Règle")));
    expect(html).toBe('<div class="hs-title"><h2>Contrôle de la base</h2><p class="desc">Effectif comparé au réel. <a href="#def-controles">Règle</a></p></div>');
    expect(render(h(CardTitle, { title: "Seul" }))).toBe('<div class="hs-title"><h2>Seul</h2></div>');
  });
  it("aucun écran de saisie ne met de sous-titre ou de lien dans le h2", () => {
    const base2 = { ...base, origin: undefined };
    const screens = [
      render(h(BasesView, { slug: "d", scenario: sc, base: base2, hypotheses: noHyps, canEdit: true })),
      render(h(ControlesEffectifs, { base, hypotheses: noHyps, proj: project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }) })),
      render(h(ControlesChangements, { slug: "d", scenario: sc, base, hypotheses: noHyps, proj: project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }), canEdit: true, others: [{ id: "x", name: "Autre", label: "Autre (Révisé, figé, octobre 2026 → décembre 2026)" }] })),
      render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: true })),
      render(h(EnveloppesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, axis: "rubrique", canEdit: true })),
    ];
    for (const html of screens) for (const h2 of html.match(/<h2>.*?<\/h2>/g) ?? []) {
      expect(h2).not.toContain("<span");
      expect(h2).not.toContain("<a ");
      expect(h2).not.toContain(" — ");
    }
  });
});

describe("grilles : unité et année au-dessus, états vides, en-têtes alignés", () => {
  it("taux : légende « Taux en % du salaire · 2026 », périmètre sur deux lignes, tableau de saisie marqué hs-edit", () => {
    const html = render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: true }));
    expect(html).toContain('<p class="hs-unit">Taux en % du salaire · 2026</p>');
    expect(html).toContain('<span class="hs-scope-note">hors embauches et entrées après la base</span>');
    expect(html).toMatch(/<table class="data-table month-grid sticky sticky-first hs-rates hs-edit" data-testid="glob-rates-table">/);
    // L'intitulé complet reste porté par les champs (lecteurs d'écran) et par l'info-bulle.
    expect(html).toContain('aria-label="Toute l&#x27;entreprise (hors embauches et entrées après la base), oct. (%)"');
    const read = render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: false }));
    expect(read).not.toContain("hs-edit");
  });
  it("deux années : la légende nomme les deux", () => {
    const html = render(h(GlobalesView, { slug: "d", scenario: scenarioOf("2026-12", "2027-02"), base, hypotheses: noHyps, canEdit: true }));
    expect(html).toContain("Taux en % du salaire · 2026 et 2027");
    expect(html).toContain("Valeurs mensuelles, dans l&#x27;unité de chaque ligne · 2026 et 2027");
  });
  it("constantes : sans constante saisie, l'état vide le dit ; avec une constante, il disparaît", () => {
    const empty = render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: true }));
    expect(empty).toContain('data-testid="glob-consts-empty"');
    const cst = { id: "c1", kind: "constante", label: "Plafond", unit: "eur", source: "Notice 2026", values: { "2026-10": 400500 } } as unknown as Hypothesis;
    expect(render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: [cst], canEdit: true }))).not.toContain('data-testid="glob-consts-empty"');
    // En lecture seule il n'y a rien à saisir : pas d'invitation à saisir.
    expect(render(h(GlobalesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: false }))).not.toContain('data-testid="glob-consts-empty"');
  });
  it("enveloppes : légende d'unité, état vide, « centre de coûts » partout, un mode de saisie lisible", () => {
    const html = render(h(EnveloppesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, axis: "service", canEdit: true }));
    expect(html).toContain("Montants en € par mois (coût chargé, ou brut selon la saisie de la ligne) · 2026");
    expect(html).toContain('data-testid="env-service-empty"');
    expect(html).toContain('placeholder="Nouveau centre de coûts"');
    expect(html).not.toContain("Nouveau centre de coût\"");
    expect(html).toContain("rattaché à ce centre de coûts");
    expect(html).toMatch(/hs-env hs-edit/);
    const env = { id: "e1", kind: "enveloppe", label: "Enveloppe TECH", axis: "service", target: "TECH", monthly: { "2026-11": 100000 }, chargesBps: null } as unknown as Hypothesis;
    expect(render(h(EnveloppesView, { slug: "d", scenario: sc, base, hypotheses: [env], axis: "service", canEdit: true }))).not.toContain('data-testid="env-service-empty"');
  });
});

describe("un seul format de date", () => {
  it("bases : entrée et fin connue en jj/mm/aaaa, notes et raisons sans date ISO", () => {
    const html = render(h(BasesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: false }));
    expect(html).toContain("<td>06/01/2025</td>");
    expect(html).toContain("<td>31/12/2026</td>"); // fin connue de Bruno
    expect(html).toContain("quotités PayFit à la date de lecture (24/10/2026), non historisées");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("base dérivée d'un scénario : les éléments non repris sont écrits avec le mois en toutes lettres, le « de » élidé devant octobre", () => {
    const origin = { kind: "scenario" as const, scenarioId: "p", scenarioName: "Révisé T4", month: "2026-12", at: "2026-10-24", notCarried: ["Prime 2026-12 (1 300,00 €)"], gap: [{ label: "éléments ponctuels de 2026-12", cost: 130000 }, { label: "éléments ponctuels de 2026-10", cost: 5000 }] };
    const chained = { ...base, refMonth: "2026-10", refBaseCost: 600000, origin };
    const html = render(h(BasesView, { slug: "d", scenario: sc, base: chained, hypotheses: noHyps, canEdit: false })).replace(/[\u00a0\u202f]/g, " "); // espaces insécables des montants
    expect(html).toContain("non repris dans la base : éléments ponctuels de décembre 2026 1 300,00 € ; éléments ponctuels d&#x27;octobre 2026 50,00 €");
    expect(html).toContain("Coût projeté d&#x27;octobre 2026 par « Révisé T4 »");
    expect(html).toContain("Prime décembre 2026 (1 300,00 €)");
    expect(html).not.toMatch(/\d{4}-\d{2}/);
  });
  it("bases : « Correction » et non l'impératif « Corrige » ; chiffres de référence en tuiles", () => {
    const html = render(h(BasesView, { slug: "d", scenario: sc, base, hypotheses: noHyps, canEdit: true }));
    expect(html).toContain("Correction de la base d&#x27;un contrat");
    expect(html).not.toContain("Corrige ");
    expect(html).toContain('class="facts hs-tiles"');
  });
  it("contrôle des changements : libellé et détail en français, l'attribut data-hyp garde le libellé enregistré", () => {
    const list = [
      { id: "g1", kind: "augmentation", label: "Augmentation toute l'entreprise 2026-11", from: "2026-11", rateBps: 200, scope: { kind: "global" } },
      { id: "e1", kind: "embauche", label: "Remplaçant", service: "TECH", category: "cdi", metier: null, motif: null, start: "2026-11-16", end: null, grossFullTimeCents: 250000, quotaBps: 5000, chargesBps: 2000, counted: true, replaces: null, copiedFrom: null },
    ] as unknown as Hypothesis[];
    const html = render(h(ControlesChangements, { slug: "d", scenario: sc, base, hypotheses: list, proj: project(base, "2026-10", "2026-12", list, { prorata: "calendaire" }), canEdit: true, others: [] }));
    expect(html).toContain('data-hyp="Augmentation toute l&#x27;entreprise 2026-11"');
    expect(html).toContain("<td>Augmentation toute l&#x27;entreprise novembre 2026</td>");
    expect(html).toContain("du 16/11/2026");
    expect(html).not.toContain("du 2026-11-16");
  });
  it("reprise d'hypothèses : types en grille de cases dans un groupe à bord arrondi, légende du groupe", () => {
    const html = render(h(ControlesChangements, { slug: "d", scenario: sc, base, hypotheses: noHyps, proj: project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }), canEdit: true, others: [{ id: "x", name: "Autre", label: "Autre" }] }));
    expect(html).toContain('<fieldset class="hs-group"><legend>Types à reprendre</legend><div class="hs-checks">');
    expect(html).not.toContain("check-group");
    expect(html.match(/<input type="checkbox" name="kind"/g)?.length).toBe(11);
  });
});

describe("contrôles : état unique, suppression compacte", () => {
  it("état d'un contrôle : même composant, icône cachée aux lecteurs d'écran, libellé en toutes lettres", () => {
    expect(render(h(Verdict, { ok: true, children: "Conforme" }))).toBe('<span class="hs-verdict"><span aria-hidden="true">✓</span><span>Conforme</span></span>');
    expect(render(h(Verdict, { ok: false, testid: "t", children: "Écart de 1" }))).toBe('<span class="hs-verdict is-gap" data-testid="t"><span aria-hidden="true">!</span><span>Écart de 1</span></span>');
  });
  it("contrôles effectifs : base et tableau disent « Conforme » avec le même composant", () => {
    const proj = project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" });
    const html = render(h(ControlesEffectifs, { base, hypotheses: noHyps, proj }));
    expect(html).toContain('<span class="hs-verdict" data-testid="ctrl-base-ok"><span aria-hidden="true">✓</span><span>Conforme</span></span>');
    expect(html).toContain("Conforme : égalité vérifiée");
    expect(html).not.toContain("concordant");
  });
  it("contrôles effectifs : un écart entre la base et le réel est dit avec le même composant, en rouge pâle", () => {
    const off = { ...base, actuals: base.actuals.map((a) => (a.month === "2026-09" ? { ...a, headcount: 5 } : a)) };
    const html = render(h(ControlesEffectifs, { base: off, hypotheses: noHyps, proj: project(off, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }) }));
    expect(html).toContain('<span class="hs-verdict is-gap" data-testid="ctrl-base-gap"><span aria-hidden="true">!</span><span>Écart de -3</span></span>');
  });
  it("suppression d'une hypothèse : bouton compact de style destructif ; formulaire sans confirmation dans le rendu serveur", () => {
    const noop = async () => undefined;
    const html = render(h(ActionForm, { action: noop, submit: "Supprimer", testid: "d", className: "inline-form", danger: true, compact: true, confirm: "Sûr ?", hint: "Supprimer l'événement" }));
    expect(html).toContain('<button class="btn danger hs-compact" type="submit" title="Supprimer l&#x27;événement">Supprimer</button>');
    expect(render(h(ActionForm, { action: noop, submit: "Dupliquer", testid: "x", plain: true }))).toContain('<button class="btn" type="submit">Dupliquer</button>');
    expect(render(h(ActionForm, { action: noop, submit: "Enregistrer", testid: "x" }))).toContain('<button class="btn primary" type="submit">Enregistrer</button>');
    // Boutons répétés d'un tableau : le nom accessible dit ce qui est supprimé (suite réservée aux lecteurs d'écran).
    expect(render(h(ActionForm, { action: noop, submit: "Supprimer", testid: "y", danger: true, compact: true, srLabel: "l'événement « Prime »" }))).toContain('>Supprimer<span class="sr-only"> l&#x27;événement « Prime »</span></button>');
  });
  it("modifications de postes : lien explicite vers la saisie en masse ; une seule page, pas de boutons de pagination grisés", () => {
    const html = render(h(PostesView, { slug: "d", scenario: sc, base, hyps: noHyps, proj: project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }), q: "", selected: "", canEdit: true }));
    expect(html).toContain(">Aller à la saisie en masse</a>");
    expect(html).toContain('<label for="sal-q">Recherche</label>');
    expect(html).toContain('<p class="tile-foot" data-testid="sal-pager">1–2 sur 2</p>');
    // Aucun salarié : pas de « 0–0 sur 0 » sous le tableau vide.
    const none = render(h(PostesView, { slug: "d", scenario: sc, base, hyps: noHyps, proj: project(base, "2026-10", "2026-12", noHyps, { prorata: "calendaire" }), q: "zzz", selected: "", canEdit: true }));
    expect(none).not.toContain("0–0 sur 0");
    expect(none).toContain("Aucun salarié ne correspond");
    expect(html).not.toContain("Précédente");
    expect(html).not.toContain("Suivante");
  });
});

describe("formulaire d'embauche", () => {
  it("placeholder court, groupes dans une grille régulière (même classe de groupe)", () => {
    const html = render(h(HireForm, { action: async () => undefined, profiles: [], deps: [] }));
    expect(html).toContain('placeholder="Existant ou nouveau"');
    expect(html).not.toContain("vide : non ventilé)\"");
    expect(html.match(/<fieldset class="hs-group">/g)?.length).toBe(5);
  });
});
