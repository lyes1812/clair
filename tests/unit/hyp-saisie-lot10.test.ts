import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Contribution, Hypothesis, Projection } from "@/lib/budget/types";
import { BUDGET_DEFINITIONS } from "@/lib/budget/definitions";
import { BUDGET_TERMS, engineText, GLOSSARY_BUDGET, TEXT_FIXES } from "@/lib/glossary/budget";
import { GLOSSARY, GLOSSARY_FAMILIES, glossaryEntry } from "@/lib/glossary";
import { BasesView } from "@/app/e/[slug]/studio-rh/hypotheses/BasesView";
import { ControlesChangements, ControlesEffectifs } from "@/app/e/[slug]/studio-rh/hypotheses/ControlesView";
import { EnveloppesView } from "@/app/e/[slug]/studio-rh/hypotheses/EnveloppesView";
import { GlobalesView } from "@/app/e/[slug]/studio-rh/hypotheses/GlobalesView";
import { GridTools } from "@/app/e/[slug]/studio-rh/hypotheses/GridTools";
import { HireForm } from "@/app/e/[slug]/studio-rh/hypotheses/HireForm";
import { PostesView } from "@/app/e/[slug]/studio-rh/hypotheses/PostesView";
import { signedEuros, trendOf } from "@/app/e/[slug]/studio-rh/hypotheses/shared";

// Hypothèses budgétaires, écrans de saisie et de contrôle (lot 10) : univers bleu / blanc / noir, rouge et vert réservés à la tendance
// d'un montant de coût, plus de narratif sous les titres (tout est au glossaire, un « ? » par carte). Cas écrits à la main.
const norm = (html: string) => html.replace(/[  ]/g, " "); // espaces insécables des montants
const render = (el: React.ReactElement) => {
  const html = norm(renderToStaticMarkup(el));
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
const scenarioOf = (firstMonth: string, lastMonth: string) => ({ id: "11111111-1111-1111-1111-111111111111", name: "Révisé T4", kind: "revise", status: "brouillon", firstMonth, lastMonth }) as unknown as ScenarioRow;
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2025-01-06", endDate: null, counted: true, etp4: 10000, etpNd: null, category: "cdi", executive: false, base: null, baseNd: null, ...over,
});
// Alice : 3 000,00 € de salaire, charges 1 320,00 ÷ 3 300,00 = 40 % ; Bruno : 2 000,00 €, charges 900,00 ÷ 2 000,00 = 45 %.
const A = contract("A", { label: "Alice", service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } });
const B = contract("B", { label: "Bruno", service: "SALES", base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } });
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: [A, B],
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 2, etp4: 20000, etpNd: null })),
  refMasse: 700000, refBaseCost: 710000, etpNote: null,
};
const sc = scenarioOf("2026-10", "2026-12");
const noHyps: Hypothesis[] = [];
const projOf = (list: Hypothesis[]) => project(base, "2026-10", "2026-12", list, { prorata: "calendaire" });
const SLUG = "demo";

describe("glossaire de la famille « Hypothèses budgétaires » (saisie)", () => {
  it("chaque identifiant cité par les écrans existe, une seule fois, dans la bonne famille", () => {
    for (const id of Object.values(BUDGET_TERMS)) {
      const entry = glossaryEntry(id);
      expect(entry, id).toBeDefined();
      expect(entry!.family, id).toBe("Hypothèses budgétaires");
      expect(GLOSSARY.filter((e) => e.id === id).length, id).toBe(1);
    }
    const ids = GLOSSARY_BUDGET.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GLOSSARY_FAMILIES).toContain("Hypothèses budgétaires");
  });
  it("les définitions du moteur gardent leur identifiant d'ancre et leur texte, les formules tiennent en une ligne", () => {
    for (const d of BUDGET_DEFINITIONS) {
      const entry = GLOSSARY_BUDGET.find((e) => e.id === d.id);
      expect(entry, d.id).toBeDefined();
      expect(entry!.term).toBe(d.title);
      expect(entry!.definition.startsWith(engineText(d.id, d.text)), d.id).toBe(true);
      // Seule la liste des types repris (reprise d'un autre scénario) est complétée ; tout autre texte est repris à l'identique.
      if (!TEXT_FIXES[d.id]) expect(entry!.definition.startsWith(d.text), d.id).toBe(true);
    }
    for (const e of GLOSSARY_BUDGET) if (e.formula) expect(e.formula).not.toContain("\n");
  });
  it("le texte déplacé des écrans est au glossaire (cas écrits à la main)", () => {
    const text = (id: string) => glossaryEntry(id)!.definition;
    // Priorité entre augmentations : contrat, puis service ou statut, puis toute l'entreprise ; service et statut au même niveau.
    expect(text("hs-priorite-augmentations")).toContain("L'augmentation d'un contrat prime sur celle d'un service ou d'un statut");
    expect(text("hs-priorite-augmentations")).toContain("Un service et un statut sont au même niveau");
    // Base figée, brouillon et figé.
    expect(text("base")).toContain("Elle ne change plus, même après une nouvelle synchronisation PayFit.");
    expect(text("base")).toContain("hors base");
    expect(text("hs-scenario-statut")).toContain("Figer un scénario verrouille ses hypothèses");
    expect(text("hs-scenario-statut")).toContain("La suppression d'un brouillon est définitive");
    // Enveloppes, constantes, bases individuelles, changement, contrôles, recopie.
    expect(text("enveloppe")).toContain("un mois vide n'a pas d'enveloppe (jamais compté pour 0)");
    expect(text("hs-constantes")).toContain("aucune règle de calcul ne les lit");
    expect(text("hs-bases-individuelles")).toContain("Les deux champs vides : pas de correction, et une correction existante est retirée");
    expect(text("changement")).toContain("salaire × nouvelle quotité ÷ quotité de la base");
    expect(text("hs-controles-effectifs")).toContain("Un salarié en congé non payé reste dans l'effectif");
    expect(text("hs-controles-changements")).toContain("la somme, sur les mois projetés, des lignes de la projection rattachées à l'hypothèse");
    expect(text("hs-controle-base")).toContain("Paramètres › KPI");
    // La reprise liste les onze types de l'écran, une seule fois, dans le texte du moteur.
    expect(text("recopie")).toContain("changements de service ou de quotité, corrections de base, éléments ponctuels, enveloppes, constantes de référence, non récurrents réalisés)");
    expect(text("recopie").match(/constantes de référence/g)?.length).toBe(1);
    expect(text("saisie-masse")).toContain("pour les saisir en brut et taux de charges, utiliser la fiche du salarié");
    expect(text("hs-grilles")).toContain("Entrée ou flèche bas passent à la cellule du dessous");
    expect(glossaryEntry("controles")!.formula).toBe("effectif de fin = effectif de début + entrées − sorties");
    expect(glossaryEntry("augmentation")!.formula).toBe("salaire après = salaire avant × (1 + taux)");
  });
  it("français de produit : ni vocabulaire interne, ni tutoiement", () => {
    for (const e of GLOSSARY_BUDGET) {
      const t = `${e.term} ${e.definition} ${e.formula ?? ""}`;
      for (const bad of ["outil observé", "cahier", "webinaire", "Lyes", "Codex"]) expect(t, `${e.id} : ${bad}`).not.toContain(bad);
      expect(t, `${e.id} : tutoiement`).not.toMatch(/\b(tu|toi|ton|ta|tes|tiens|peux|veux|dois)\b/i);
      expect(e.definition.trim().length, e.id).toBeGreaterThan(40);
      expect(e.id, e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("tendance d'un montant de coût", () => {
  it("hausse rouge avec flèche haute, baisse verte avec flèche basse, nul ou n.d. ni couleur ni flèche", () => {
    expect(trendOf(500)).toEqual({ cls: "hs-trend trend-bad", sign: "up" });
    expect(trendOf(-1)).toEqual({ cls: "hs-trend trend-good", sign: "down" });
    expect(trendOf(0)).toEqual({ cls: "hs-trend", sign: "zero" });
    expect(trendOf(null)).toEqual({ cls: "hs-trend", sign: "zero" });
    expect(trendOf(undefined)).toEqual({ cls: "hs-trend", sign: "zero" });
  });
  it("le signe est écrit : « + » devant une hausse, « − » devant une baisse, rien devant zéro", () => {
    expect(norm(signedEuros(140000))).toBe("+1 400,00 €");
    expect(norm(signedEuros(-250000))).toBe("−2 500,00 €");
    expect(norm(signedEuros(1))).toBe("+0,01 €");
    expect(signedEuros(0)).toMatch(/^0,00\s€$/);
  });
  it("contrôles des changements : coût attribué rouge s'il ajoute du coût, vert s'il en retire, neutre pour une base corrigée, « — » pour un réalisé", () => {
    const hyps = [
      { id: "e1", kind: "embauche", label: "Chargé de mission", service: "TECH", category: "cdi", metier: null, motif: null, start: "2026-11-16", end: null, grossFullTimeCents: 250000, quotaBps: 10000, chargesBps: 4000, counted: true, replaces: null, copiedFrom: null },
      { id: "d1", kind: "depart", label: "Départ Bruno", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: null, motif: "Démission" },
      { id: "b1", kind: "base", label: "Base Alice", contractKey: "A", salaryCents: 300000, chargesBps: 4000 },
      { id: "p1", kind: "ponctuel", label: "Prime nulle", month: "2026-11", amount: { mode: "charge", costCents: 0 }, service: null, nonRecurring: false },
      { id: "k1", kind: "constante", label: "Plafond", unit: "eur", source: "Notice 2026", values: { "2026-10": 400500 } },
      { id: "r1", kind: "realise", label: "Rupture réalisée", category: "rupture", month: "2026-09", costCents: 120000 },
    ] as unknown as Hypothesis[];
    const contribution = (hypothesisId: string, cost: number): Contribution => ({ hypothesisId, kind: "ponctuel", label: hypothesisId, contractKey: null, who: "x", service: null, brut: null, charges: null, cost });
    const month = (m: string, contributions: Contribution[]) => ({ month: m, kind: "value" as const, brut: null, charges: null, cost: 0, headcount: 2, etp4: 20000, etpNd: null, contributions });
    // Embauche : 4 000,00 € + 1 000,00 € = 5 000,00 € ; départ : −3 000,00 € de paie, +500,00 € de sortie = −2 500,00 € ; base : 4 000,00 € ; prime : 0.
    const proj: Projection = {
      kind: "value",
      months: [month("2026-10", [contribution("b1", 400000)]), month("2026-11", [contribution("e1", 400000), contribution("d1", -300000), contribution("p1", 0)]), month("2026-12", [contribution("e1", 100000), contribution("d1", 50000)])],
    };
    const html = render(h(ControlesChangements, { slug: SLUG, scenario: sc, base, hypotheses: hyps, proj, canEdit: false, others: [] }));
    const effet = (id: string) => /<td class="([^"]*)" data-col="effet"( data-sign="[a-z]+")?>([^<]*)<\/td>/.exec(html.split(`data-hyp="${id}"`)[1].split("</tr>")[0]);
    expect(effet("Chargé de mission")!.slice(1)).toEqual(["num hs-trend trend-bad", ' data-sign="up"', "+5 000,00 €"]);
    expect(effet("Départ Bruno")!.slice(1)).toEqual(["num hs-trend trend-good", ' data-sign="down"', "−2 500,00 €"]);
    expect(effet("Base Alice")!.slice(1)).toEqual(["num", undefined, "4 000,00 €"]);
    expect(effet("Prime nulle")!.slice(1)).toEqual(["num hs-trend", ' data-sign="zero"', "0,00 €"]);
    expect(effet("Plafond")!.slice(1)).toEqual(["num", undefined, "—"]);
    expect(effet("Rupture réalisée")!.slice(1)).toEqual(["num", undefined, "—"]);
  });
  it("contrôles des changements : une projection refusée laisse la colonne n.d., sans couleur, avec les raisons", () => {
    const hyps = [{ id: "p1", kind: "ponctuel", label: "Prime", month: "2026-11", amount: { mode: "charge", costCents: 100000 }, service: null, nonRecurring: false }] as unknown as Hypothesis[];
    const proj: Projection = { kind: "error", errors: ["deux départs pour le même contrat"] };
    const html = render(h(ControlesChangements, { slug: SLUG, scenario: sc, base, hypotheses: hyps, proj, canEdit: false, others: [] }));
    expect(html).toContain('<td class="num" data-col="effet">n.d.</td>');
    expect(html).toContain("deux départs pour le même contrat");
    expect(html).not.toContain("trend-bad");
    expect(html).not.toContain("trend-good");
  });
  it("modifications de postes : le taux d'une augmentation est rouge (hausse) ou vert (baisse), toujours écrit avec son signe", () => {
    const hyps = [
      { id: "r1", kind: "augmentation", label: "Augmentation Alice", from: "2026-11", rateBps: 250, scope: { kind: "contrat", key: "A" } },
      { id: "r2", kind: "augmentation", label: "Baisse Bruno", from: "2026-12", rateBps: -100, scope: { kind: "contrat", key: "B" } },
    ] as unknown as Hypothesis[];
    const html = render(h(PostesView, { slug: SLUG, scenario: sc, base, hyps, proj: projOf(hyps), q: "", selected: "", canEdit: false }));
    const row = (name: string) => html.split(`data-salarie="${name}"`)[1].split("</tr>")[0];
    expect(row("Alice")).toContain('<span class="hs-trend trend-bad" data-sign="up">+2,50 % dès novembre 2026</span>');
    expect(row("Bruno")).toContain('<span class="hs-trend trend-good" data-sign="down">−1,00 % dès décembre 2026</span>');
    // Aucune hypothèse sur ce salarié : « — » dans la colonne, sans couleur.
    const none = render(h(PostesView, { slug: SLUG, scenario: sc, base, hyps: noHyps, proj: projOf(noHyps), q: "", selected: "", canEdit: false }));
    expect(none).not.toContain("hs-trend");
  });
  it("effectifs, ETP, entrées et sorties ne portent jamais de rouge ni de vert", () => {
    const hyps = [{ id: "d1", kind: "depart", label: "Départ Bruno", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: null, motif: null }] as unknown as Hypothesis[];
    const html = render(h(ControlesEffectifs, { slug: SLUG, base, hypotheses: hyps, proj: projOf(hyps) }));
    expect(html).not.toContain("trend-");
    expect(html).not.toContain("hs-trend");
  });
});

describe("moins de narratif, un « ? » vers le glossaire par carte", () => {
  const link = (term: string) => `href="/e/${SLUG}/glossaire#def-${term}"`;
  const forbidden = ['class="hs-rules"', 'href="#def-', "Définitions et règles de calcul", ">Règle<", "hs-defs", "Lecture du tableau", "Règles de saisie"];
  const noNarrative = (html: string) => { for (const f of forbidden) expect(html, f).not.toContain(f); };
  const cst = { id: "c1", kind: "constante", label: "Plafond", unit: "eur", source: "Notice 2026", values: { "2026-10": 400500 } } as unknown as Hypothesis;

  it("modifications de postes : titre et saisie en masse portent un « ? », les phrases de règle ont disparu", () => {
    const html = render(h(PostesView, { slug: SLUG, scenario: sc, base, hyps: noHyps, proj: projOf(noHyps), q: "", selected: "A", canEdit: true }));
    noNarrative(html);
    expect(html).toContain(link(BUDGET_TERMS.postes));
    expect(html).toContain(link(BUDGET_TERMS.saisieMasse));
    expect(html).toContain(link(BUDGET_TERMS.evenement));
    for (const gone of ["Cherchez un salarié, ouvrez sa fiche", "les lignes vides sont ignorées et le lot est enregistré", "Chaque événement est daté et enregistré directement", "Service : les coûts de ce salarié sont attribués", "Effet au 1er du mois choisi, en pourcentage du salaire déjà augmenté", "la projection reconduit sa base"]) expect(html, gone).not.toContain(gone);
    // Les libellés de champs, les contraintes de saisie et les raisons de n.d. restent.
    expect(html).toContain("Taux (%)");
    expect(html).toContain("Entre octobre 2026 et décembre 2026.");
    expect(html).toContain("Service, quotité, ou les deux.");
  });
  it("bases individuelles : « ? » sur la carte, la formule du coût et la composition de l'écart sont au glossaire", () => {
    const html = render(h(BasesView, { slug: SLUG, scenario: sc, base, hypotheses: noHyps, canEdit: true }));
    noNarrative(html);
    expect(html).toContain(link(BUDGET_TERMS.base));
    expect(html).toContain(link(BUDGET_TERMS.baseContrat));
    expect(html).toContain(link(BUDGET_TERMS.bases));
    for (const gone of ["Base de départ de la projection, contrat par contrat", "salaires et gratifications de stage + charges au taux observé", "primes, indemnités, contrats sortis dans le mois", "la base figée est lue à gauche"]) expect(html, gone).not.toContain(gone);
    // Réel 7 000,00 € moins base 7 100,00 € : l'écart est écrit, sans sa composition.
    expect(html).toContain("hors base : -100,00 €");
    // Une ligne d'état en une phrase : salaire et taux vont ensemble, deux champs vides retirent la correction.
    expect(html).toContain("Correction de la base d&#x27;un contrat : salaire et taux vont ensemble ; les deux champs vides retirent la correction.");
  });
  it("base sans contrat n.d. : la raison reste écrite", () => {
    const nd = { ...base, contracts: [A, contract("C", { label: "Chloé", baseNd: "entrée en cours du mois de référence" })], refBaseCost: null };
    const html = render(h(BasesView, { slug: SLUG, scenario: sc, base: nd, hypotheses: noHyps, canEdit: false }));
    expect(html).toContain("1 contrat(s) sans base : la projection est n.d. tant qu&#x27;une correction de base n&#x27;est pas saisie.");
    expect(html).toContain("n.d. — entrée en cours du mois de référence");
  });
  it("enveloppes : « ? » par carte, règles et explications retirées, légende d'unité conservée", () => {
    const html = render(h(EnveloppesView, { slug: SLUG, scenario: sc, base, hypotheses: noHyps, axis: "rubrique", canEdit: true }));
    noNarrative(html);
    expect(html).toContain(link(BUDGET_TERMS.enveloppe));
    expect(html).toContain(link(BUDGET_TERMS.ponctuels));
    expect(html).toContain(link(BUDGET_TERMS.grilles));
    for (const gone of ["Un mois vide n&#x27;a pas d&#x27;enveloppe", "les charges sont le brut × le taux saisi", "Le journal PayFit ne distingue pas ces éléments", "Ajouté à la projection au mois choisi", "retiré de l&#x27;atterrissage retraité"]) expect(html, gone).not.toContain(gone);
    expect(html).toContain("Montants en € par mois (chargés ou bruts selon la ligne) · 2026");
    expect(html).toContain("Aucune enveloppe saisie.");
  });
  it("hypothèses globales : « ? » par carte, la limite « sans effet sur le calcul » reste en légende", () => {
    const html = render(h(GlobalesView, { slug: SLUG, scenario: sc, base, hypotheses: [cst], canEdit: true }));
    noNarrative(html);
    expect(html).toContain(link(BUDGET_TERMS.globales));
    expect(html).toContain(link(BUDGET_TERMS.constantes));
    expect(html).toContain("Valeurs mensuelles, sans effet sur le calcul · 2026");
    for (const gone of ["Chaque cellule renseignée est une augmentation distincte", "Sur un même mois, la plus ciblée s&#x27;applique seule", "Multidevise : différé", "Documentaires, sans effet sur le calcul : chaque valeur"]) expect(html, gone).not.toContain(gone);
    // Le périmètre de « toute l'entreprise » reste écrit : il change la lecture d'une ligne.
    expect(html).toContain("hors embauches et entrées après la base");
  });
  it("contrôles : « ? » par carte, plus de phrase de règle ; l'effectif compté et la raison d'un n.d. restent", () => {
    const off = { ...base, actuals: base.actuals.map((a) => (a.month === "2026-09" ? { ...a, headcount: 5 } : a)) };
    const eff = render(h(ControlesEffectifs, { slug: SLUG, base: off, hypotheses: noHyps, proj: projOf(noHyps) }));
    noNarrative(eff);
    expect(eff).toContain(link(BUDGET_TERMS.controleBase));
    expect(eff).toContain(link(BUDGET_TERMS.controlesEffectifs));
    expect(eff).toContain("contrats comptés de la base");
    expect(eff).toContain("Écart de -3");
    expect(eff).not.toContain("Un écart vient d&#x27;un contrat présent à la date de lecture");
    // Sans adresse d'espace, aucun lien n'est rendu (jamais de lien mort).
    expect(render(h(ControlesEffectifs, { base, hypotheses: noHyps, proj: projOf(noHyps) }))).not.toContain("gloss-link");
    const chg = render(h(ControlesChangements, { slug: SLUG, scenario: sc, base, hypotheses: noHyps, proj: projOf(noHyps), canEdit: true, others: [{ id: "x", name: "Autre", label: "Autre" }] }));
    noNarrative(chg);
    expect(chg).toContain(link(BUDGET_TERMS.controlesChangements));
    expect(chg).toContain(link(BUDGET_TERMS.recopie));
    expect(chg).toContain("0 hypothèse · coût attribué sur l&#x27;horizon, en euros");
    expect(chg).toContain("Aucune hypothèse dans ce scénario.");
    for (const gone of ["de quoi vérifier d&#x27;un coup d&#x27;œil", "Copie, dans ce scénario, les hypothèses du type choisi", "Lecture de la colonne"]) expect(chg, gone).not.toContain(gone);
  });
  it("contrôles effectifs : projection refusée, la raison reste écrite et le « ? » est là", () => {
    const html = render(h(ControlesEffectifs, { slug: SLUG, base, hypotheses: noHyps, proj: { kind: "error", errors: ["deux départs pour le même contrat"] } }));
    expect(html).toContain("deux départs pour le même contrat");
    expect(html).toContain(link(BUDGET_TERMS.controlesEffectifs));
  });
  it("fiche d'un salarié : un « ? » même en lecture seule (événements et coût mensuel projeté)", () => {
    const html = render(h(PostesView, { slug: SLUG, scenario: sc, base, hyps: noHyps, proj: projOf(noHyps), q: "", selected: "A", canEdit: false }));
    expect(html).toContain('data-testid="sal-fiche"');
    expect(html).toContain(link(BUDGET_TERMS.evenement));
    expect(html).toContain(link(BUDGET_TERMS.contribution));
    expect(html).not.toContain('data-testid="sal-add"');
  });
  it("service n.d. : aucune pastille d'alerte colorée, un renvoi écrit vers la note qui donne la raison", () => {
    const nd = { ...base, contracts: [contract("C", { label: "Chloé", service: null, serviceNd: "lignes de paie sur plusieurs services", base: A.base })] };
    const html = render(h(BasesView, { slug: SLUG, scenario: sc, base: nd, hypotheses: noHyps, canEdit: false }));
    expect(html).toContain("Non ventilé (voir note)");
    expect(html).toContain("Chloé : lignes de paie sur plusieurs services");
    expect(html).not.toContain("⚠");
  });
  it("mois projetés n.d. : le nombre de mois dont le coût n'est pas compté reste écrit", () => {
    const proj: Projection = { kind: "value", months: [{ month: "2026-10", kind: "nd", reasons: ["base n.d."] }] };
    const html = render(h(ControlesChangements, { slug: SLUG, scenario: sc, base, hypotheses: noHyps, proj, canEdit: false, others: [] }));
    expect(html).toContain("1 mois projeté(s) n.d. : leurs contributions ne sont pas comptées dans la colonne « Coût attribué sur l&#x27;horizon ».");
  });
  it("formulaire d'embauche : aides longues retirées, contraintes courtes et libellés conservés", () => {
    const html = render(h(HireForm, { action: async () => undefined, profiles: [], deps: [] }));
    for (const gone of ["Facultatif : reprend le service", "Intitulé du poste, repris dans les contrôles", "autant d&#x27;embauches indépendantes", "Le prorata du premier et du dernier mois suit la règle", "Brut d&#x27;un temps plein ; la quotité s&#x27;applique ensuite", "Un départ saisi dans ce scénario ; sinon création de poste"]) expect(html, gone).not.toContain(gone);
    for (const kept of ["De 1 à 50.", "Vide : non ventilé.", "Entre 0 et 100 %.", "Ex. 42,5.", "Brut mensuel temps plein (€)", "Remplace (un seul poste)"]) expect(html, kept).toContain(kept);
    expect(html.match(/<fieldset class="hs-group">/g)?.length).toBe(5);
  });
  it("outils de grille : le « ? » rendu côté serveur est placé dans la barre, la consigne tient en une ligne", () => {
    const help = h("a", { className: "gloss-link", href: `/e/${SLUG}/glossaire#def-hs-grilles` }, "?");
    const html = render(h(GridTools, { filename: "x.csv", help }));
    expect(html).toContain('<a class="gloss-link" href="/e/demo/glossaire#def-hs-grilles">?</a>');
    expect(html).toContain("Cliquez dans une cellule pour la choisir comme point de départ.");
    expect(render(h(GridTools, { filename: "x.csv" }))).not.toContain("gloss-link");
  });
});

describe("univers de couleurs : bleu, blanc, noir et gris ; rouge réservé aux erreurs, aux écarts détectés et aux tendances de coût", () => {
  const css = readFileSync("src/styles/hypotheses-saisie.css", "utf8");
  // Teinte (0–360) et saturation (0–1) d'une couleur hexadécimale.
  const hsl = (hex: string) => {
    let v = hex.slice(1);
    if (v.length === 3) v = [...v].map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return { hue: 0, sat: 0 };
    const l = (max + min) / 2;
    const sat = d / (1 - Math.abs(2 * l - 1));
    const hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    return { hue, sat };
  };
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  const isRedOk = (selector: string) => /danger|is-gap|invalid|trend-/.test(selector);

  it("toute couleur de la feuille est un gris, un bleu, ou un rouge de la famille « erreur »", () => {
    let seen = 0;
    for (const { selector, body } of rules) {
      for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        seen++;
        const { hue, sat } = hsl(m[0].length > 7 ? m[0].slice(0, 7) : m[0]);
        const neutral = sat < 0.12;
        const blue = hue >= 195 && hue <= 265;
        const red = hue >= 330 || hue <= 15;
        expect(neutral || blue || (red && isRedOk(selector)), `${m[0]} dans « ${selector} »`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(10);
    for (const name of ["green", "amber", "orange", "purple", "violet", "teal", "turquoise", "yellow", "pink"]) expect(css, name).not.toContain(name);
  });
  it("les variables de teinte employées sont celles de la charte (bleu, encre, gris, danger) ou les tendances partagées", () => {
    const vars = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    for (const v of vars) expect(["ink", "muted", "line", "blue", "blue-soft", "surface", "sidebar-bg", "danger", "danger-bg", "good", "font"].includes(v) || v.startsWith("clair-type-"), v).toBe(true);
    // Le vert n'apparaît que pour la tendance d'un coût en baisse.
    for (const { selector, body } of rules) if (body.includes("var(--good)")) expect(selector).toContain("trend-good");
  });
  it("aucune couleur codée en dur dans les écrans de la zone", () => {
    const files = ["page.tsx", "PostesView.tsx", "BasesView.tsx", "EnveloppesView.tsx", "GlobalesView.tsx", "ControlesView.tsx", "HireForm.tsx", "GridTools.tsx", "ActionForm.tsx", "shared.tsx"];
    for (const f of files) {
      const src = readFileSync(`src/app/e/[slug]/studio-rh/hypotheses/${f}`, "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/style=\{\{[^}]*color/);
    }
  });
  it("la page n'a plus de bloc « Définitions et règles de calcul » ni de lien d'ancre vers lui", () => {
    const src = readFileSync("src/app/e/[slug]/studio-rh/hypotheses/page.tsx", "utf8");
    for (const gone of ["Définitions et règles de calcul", "BUDGET_DEFINITIONS", 'id="definitions"', "hs-defs", "hs-manage-help"]) expect(src, gone).not.toContain(gone);
    expect(src).toContain("GlossaryLink");
  });
});
