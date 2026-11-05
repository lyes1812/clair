import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestructuringView } from "@/app/e/[slug]/studio-restructuring/RestructuringView";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { buildRestructuring, type RestructuringScenario } from "@/lib/restructuring/model";

type Props = Parameters<typeof RestructuringView>[0];
const addHire = async () => ({ ok: "Embauche fictive enregistrée" });
const base = (key: string, service: string): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-09", syncId: "fixture-only", readAt: "2026-10-01T09:00:00.000Z",
  contracts: [{ contractKey: key, externalId: `fixture-${key}`, label: `Profil fictif ${key}`, service, serviceNd: null,
    startDate: "2025-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null,
    base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null }],
  actuals: [], refMasse: 420000, refBaseCost: 420000, etpNote: null,
});
const scenario = (id: string, key: string, service: string, hypotheses: Hypothesis[]): RestructuringScenario => ({
  id, name: `Scénario fictif ${key}`, status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-12",
  baseHash: `base-fictive-${key}`, base: base(key, service), hypotheses, conventions: { prorata: "calendaire" },
});
function props(patch: Partial<Props> = {}): Props {
  const reference = scenario("11111111-1111-4111-8111-111111111111", "reference-seulement", "Service référence fictive", [
    { id: "depart-reference", kind: "depart", label: "Départ référence seulement", contractKey: "reference-seulement", lastPaidDate: "2026-10-31", exitCost: { mode: "charge", costCents: 0 } },
  ]);
  const proposal = scenario("22222222-2222-4222-8222-222222222222", "projet-seulement", "Service projet fictif", [
    { id: "depart-projet", kind: "depart", label: "Départ projet seulement", contractKey: "projet-seulement", lastPaidDate: "2026-10-31", exitCost: { mode: "charge", costCents: 0 } },
    { id: "embauche-projet", kind: "embauche", label: "Poste futur fictif", service: "Service futur fictif", start: "2026-10-15", end: null, grossFullTimeCents: 250000, quotaBps: 8000, chargesBps: 4000, counted: true, replaces: "depart-projet" },
  ]);
  return { slug: "espace-fictif", workspaceName: "Espace fictif", view: "measures", canEdit: true, reference, proposal,
    options: [reference, proposal].map(({ id, name, firstMonth, lastMonth }) => ({ id, name, firstMonth, lastMonth, status: "brouillon" as const })),
    model: buildRestructuring(reference, proposal), notices: [], addHire, ...patch };
}
const html = (patch: Partial<Props> = {}) => renderToStaticMarkup(createElement(RestructuringView, props(patch)));
const form = (value: string) => value.match(/<form[^>]*data-testid="hyp-form-embauche"[\s\S]*?<\/form>/)?.[0] ?? "";
const select = (value: string, id: string) => value.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?<\\/select>`))?.[0] ?? "";
const input = (value: string, name: string) => value.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

describe("Restructuring — formulaire RH réutilisé sur projet fictif", () => {
  it("propose les profils, départs et services du projet sélectionné, jamais ceux de la référence", () => {
    const value = html();
    const hire = form(value);
    expect(hire).toBeTruthy();
    expect(hire).toContain("Ajouter l&#x27;embauche");
    const profiles = select(hire, "hire-copy");
    expect(profiles).toContain('value="projet-seulement"');
    expect(profiles).toContain("Profil fictif projet-seulement");
    expect(profiles).toContain('value="embauche:embauche-projet"');
    expect(profiles).toContain("Poste futur fictif (embauche)");
    expect(profiles).not.toContain("reference-seulement");
    expect(profiles).toContain('value="" selected=""');
    const departures = select(hire, "hire-replaces");
    expect(departures).toContain('value="depart-projet"');
    expect(departures).toContain("Départ projet seulement");
    expect(departures).not.toContain("depart-reference");
    expect(departures).not.toContain("embauche-projet");
    expect(departures).toContain('value="" selected=""');
    const services = value.match(/<datalist id="hyp-services">[\s\S]*?<\/datalist>/)?.[0] ?? "";
    expect(services).toContain('value="Service projet fictif"');
    expect(services).toContain('value="Service futur fictif"');
    expect(services).not.toContain("Service référence fictive");
    expect(value).toContain("son coût est déjà inclus dans le projet");
  });

  it("la saisie libre ne préremplit ni rémunération, ni dates, ni remplacement", () => {
    const hire = form(html());
    for (const name of ["copiedFrom", "start", "end", "gross", "quota", "charges", "service"]) {
      const control = input(hire, name);
      expect(control).toBeTruthy();
      expect(control.match(/\bvalue="([^"]*)"/)?.[1] ?? "").toBe("");
    }
    expect(input(hire, "count")).toContain('value="1"');
    expect(select(hire, "hire-counted")).toContain('value="" disabled="" selected=""');
    expect(hire).toContain("Vide : sans fin prévue");
  });

  it.each(["overview", "monthly"] as const)("%s reste sans formulaire ni profils de saisie", (view) => {
    const value = html({ view });
    expect(form(value)).toBe("");
    expect(value).not.toContain('id="hire-copy"');
    expect(value).not.toContain('id="hyp-services"');
  });

  it("un lecteur ne reçoit ni formulaire ni profils individuels malgré une action fournie", () => {
    const value = html({ canEdit: false });
    expect(form(value)).toBe("");
    expect(value).toContain("synthèse agrégée");
    for (const forbidden of ["Profil fictif projet-seulement", "Poste futur fictif", 'id="hire-copy"', 'id="hyp-services"']) expect(value).not.toContain(forbidden);
  });

  it("un projet figé conserve ses mesures et propose de le dupliquer sans formulaire d’embauche", () => {
    const p = props();
    p.proposal!.status = "fige";
    const value = renderToStaticMarkup(createElement(RestructuringView, p));
    expect(form(value)).toBe("");
    expect(value).not.toContain('id="hire-copy"');
    expect(value).not.toContain('id="hyp-services"');
    expect(value).toContain('data-testid="restructuring-hire-frozen"');
    expect(value).toContain(`hypotheses?scenario=${p.proposal!.id}`);
    expect(value).toContain("Ouvrir ou dupliquer dans Hypothèses");
    expect(value).toContain("Poste futur fictif");
  });

  it("sans action ou sans projet sélectionné, aucun formulaire ni liste de profils n’est rendu", () => {
    for (const patch of [{ addHire: undefined }, { proposal: null }] satisfies Partial<Props>[]) {
      const value = html(patch);
      expect(form(value)).toBe("");
      expect(value).not.toContain('id="hire-copy"');
      expect(value).not.toContain('id="hyp-services"');
    }
  });
});
