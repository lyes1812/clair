import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActualNonRecurring } from "@/app/e/[slug]/studio-rh/masse-salariale/ActualNonRecurring";
import type { JournalInput } from "@/lib/payroll/engine";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { estimateActualOverlap } from "@/lib/payroll/actual-overlap";

type Props = Parameters<typeof ActualNonRecurring>[0];
const SYNC = "11111111-1111-4111-8111-111111111111";
const LIC = "22222222-2222-4222-8222-222222222222";
const TUILAGE = "33333333-3333-4333-8333-333333333333";
const RC = "44444444-4444-4444-8444-444444444444";
const journal = (): JournalInput => ({ months: ["2026-01", "2026-02"], openMonths: [], grid: structuredClone(DEFAULT_PREFIXES), lines: ["2026-01", "2026-02"].flatMap((month, index) => [
  { key: `salaire-fictif-${month}`, month, accountId: "6411", accountName: "Salaire fictif", debitCents: 100000, creditCents: 0, contractId: index ? "entrant" : "sortant" },
  { key: `charges-fictives-${month}`, month, accountId: "6451", accountName: "Charges fictives", debitCents: 40000, creditCents: 0, contractId: index ? "entrant" : "sortant" },
]) });
const events = (): ActualEvent[] => [
  { id: LIC, syncId: SYNC, month: "2026-01", kind: "licenciement", chargedCents: 12345, contractKeys: ["sortant"], note: "SOURCE_INDIVIDUELLE_LIC_FICTIVE" },
  { id: TUILAGE, syncId: SYNC, month: "2026-02", kind: "tuilage", chargedCents: 23456, contractKeys: ["sortant", "entrant"], note: "SOURCE_BINOME_PERSONNELLE_FICTIVE" },
];
const props = (patch: Partial<Props> = {}): Props => ({ slug: "espace-fictif", input: journal(), events: events(), months: ["2026-01", "2026-02"], syncId: SYNC, contracts: [{ key: "sortant", label: "NOM_SORTANT_FICTIF" }, { key: "entrant", label: "NOM_ENTRANT_FICTIF" }], editable: false, ...patch });
const html = (patch: Partial<Props> = {}) => renderToStaticMarkup(createElement(ActualNonRecurring, props(patch)));
const form = (value: string, id: string) => value.match(new RegExp(`<form[^>]*data-testid="${id}"[\\s\\S]*?<\\/form>`))?.[0] ?? "";
const select = (value: string, name: string) => value.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?<\\/select>`))?.[0] ?? "";
const input = (value: string, name: string) => value.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const save = async () => ({ ok: "Déclaration fictive" });

describe("éléments non récurrents du réel — interface et données fictives", () => {
  it("présente le réel intact, la somme déclarée et la lecture séparée sans revendiquer une liste exhaustive", () => {
    const value = html();
    expect(value).toContain('data-money-cents="280000"');
    expect(value).toContain('data-money-cents="35801"');
    expect(value).toContain('data-money-cents="244199"');
    expect(value).toContain("la masse salariale réelle, qui reste inchangée");
    expect(value).toContain("Cette liste déclarative n’est pas exhaustive");
    expect(value).toContain("Réel − coûts identifiés · lecture analytique");
    expect(value).toContain("aucun prorata");
    for (const label of ["Licenciements", "Ruptures conventionnelles", "Tuilages passés", "Autres éléments non récurrents"]) expect(value).toContain(label);
  });

  it("un lecteur ne reçoit ni noms de contrats, ni binômes, ni sources individuelles, ni formulaire", () => {
    const value = html({ save });
    for (const privateText of ["NOM_SORTANT_FICTIF", "NOM_ENTRANT_FICTIF", "SOURCE_INDIVIDUELLE_LIC_FICTIVE", "SOURCE_BINOME_PERSONNELLE_FICTIVE", LIC, TUILAGE]) expect(value).not.toContain(privateText);
    expect(value).not.toContain('data-testid="actual-non-recurring-details"');
    expect(value).not.toContain('data-testid="actual-non-recurring-create"');
    expect(value).not.toContain('<form');
    expect(value).toContain('data-testid="actual-non-recurring-categories"');
  });

  it("un coût non renseigné garde le cumul et le retraitement n.d., tandis que zéro explicite reste zéro", () => {
    const missing: ActualEvent = { id: RC, syncId: SYNC, month: "2026-02", kind: "rupture-conventionnelle", chargedCents: null, contractKeys: [], note: "" };
    const value = html({ events: [...events(), missing] });
    expect(value).toContain("Montant chargé non saisi");
    expect(value).toContain("Un montant non renseigné rend le cumul n.d.");
    expect(value).not.toContain('data-money-cents="35801"');
    expect(value).not.toContain('data-money-cents="244199"');
    const zero = html({ events: [{ ...missing, chargedCents: 0, note: "Coût nul confirmé sur justificatif fictif" }] });
    expect(zero).toContain('data-money-cents="0"');
    expect(zero).not.toContain("Montant chargé non saisi");
    expect(html({ events: [] })).toContain("Aucun élément identifié : cela ne prouve pas son absence");
  });

  it("un filtre Service ne reçoit aucune imputation du montant global déclaré", () => {
    const source = journal(); source.serviceAxis = "SERVICE"; source.serviceFilter = { value: "support" };
    source.lines = source.lines.map((line) => ({ ...line, analytic: [{ type: "SERVICE", code: "support", value: "Support fictif" }] }));
    const value = html({ input: source });
    expect(value).toContain("ne sont pas ventilés par service");
    expect(value).not.toContain('data-money-cents="35801"');
    expect(value).not.toContain('data-money-cents="12345"');
    expect(value).not.toContain('data-money-cents="23456"');
  });

  it("l’éditeur lit les détails, mais aucun formulaire n’apparaît sans action serveur ou sans lecture retenue", () => {
    const value = html({ editable: true });
    expect(value).toContain("NOM_SORTANT_FICTIF · NOM_ENTRANT_FICTIF");
    expect(value).toContain("SOURCE_BINOME_PERSONNELLE_FICTIVE");
    expect(value).not.toContain('<form');
    expect(html({ editable: true, save, syncId: null })).not.toContain('<form');
    expect(html({ editable: true, save, input: null })).not.toContain('<form');
  });

  it("création : choix explicites, montant facultatif vide, sources et contrats sans scénario ni mode juridique", () => {
    const value = html({ editable: true, save });
    const create = form(value, "actual-non-recurring-new");
    expect(create).toBeTruthy();
    expect(create).not.toContain('name="id"');
    for (const name of ["kind", "month"]) {
      const control = select(create, name);
      expect(control).toContain('required=""');
      expect(control).toContain('value="" disabled="" selected=""');
    }
    for (const kind of ["licenciement", "rupture-conventionnelle", "tuilage", "autre"]) expect(select(create, "kind")).toContain(`value="${kind}"`);
    for (const month of ["2026-01", "2026-02"]) expect(select(create, "month")).toContain(`value="${month}"`);
    for (const name of ["contract1", "contract2"]) expect(select(create, name)).toContain('value="" selected=""');
    expect(create).toContain("Contrat concerné / entrant du tuilage");
    expect(create).toContain("Sortant du tuilage");
    expect(select(create, "valuation")).toContain('<option value="manual" selected="">');
    expect(select(create, "valuation")).toContain('value="calendar"');
    expect(input(create, "chargedEuros")).toContain('value=""');
    expect(input(create, "chargedEuros")).not.toContain('required');
    expect(create).toContain("Coût chargé isolé (€)");
    expect(create).toContain('name="note" maxLength="300"');
    expect(create).toContain("Requise lorsqu’un montant est renseigné");
    expect(create).toContain("deux contrats distincts");
    expect(create).not.toContain('name="scenario"');
    expect(create).not.toContain('name="exitMode"');
  });

  it("édition : id et binôme conservés, euros exacts ou zéro explicite ; contrat absent jamais remplacé automatiquement", () => {
    const sourceEvents = events(); sourceEvents[1].chargedCents = 0; sourceEvents[1].contractKeys[1] = "contrat-absent-fictif";
    const value = html({ editable: true, save, events: sourceEvents });
    const lic = form(value, `actual-non-recurring-${LIC}`);
    expect(input(lic, "id")).toContain(`value="${LIC}"`);
    expect(input(lic, "chargedEuros")).toContain('value="123,45"');
    expect(select(lic, "kind")).toContain('<option value="licenciement" selected="">');
    expect(select(lic, "month")).toContain('<option value="2026-01" selected="">');
    const tuilage = form(value, `actual-non-recurring-${TUILAGE}`);
    expect(input(tuilage, "chargedEuros")).toContain('value="0"');
    expect(select(tuilage, "contract1")).toContain('<option value="sortant" selected="">');
    expect(select(tuilage, "contract2")).toContain('<option value="contrat-absent-fictif" selected="">Contrat indisponible');
    expect(value).not.toContain("Supprimer l’identification");
    expect(input(lic, "confirmReplace")).toContain('type="checkbox"');
    expect(lic).toContain("remplace le montant fourni");
  });

  it("garde l’estimation calendaire visible aux lecteurs sans sa provenance individuelle, et les rôles explicites en édition", () => {
    const result = estimateActualOverlap({ month: "2026-02", syncId: SYNC,
      incoming: { contractKey: "entrant", syncId: SYNC, startDate: "2026-02-11", endDate: null },
      outgoing: { contractKey: "sortant", syncId: SYNC, startDate: "2020-01-01", endDate: "2026-02-19" },
      payroll: { syncId: SYNC, month: "2026-02", contractKey: "entrant", chargedCents: 140_000, lineKeys: ["SOURCE_LIGNE_FICTIVE_PRIVEE"] } });
    if (result.kind !== "value") throw new Error("Fixture refusée");
    const calculated: ActualEvent = { ...events()[1], contractKeys: ["entrant", "sortant"], chargedCents: result.amountCents, calculation: result.calculation };
    const reader = html({ events: [calculated] });
    expect(reader).toContain('data-testid="actual-overlap-qualification"'); expect(reader).toContain("ventilation journalière est calculée, pas observée");
    expect(reader).not.toMatch(/SOURCE_LIGNE_FICTIVE_PRIVEE|NOM_ENTRANT_FICTIF|SOURCE_BINOME_PERSONNELLE_FICTIVE/);
    const editor = html({ events: [calculated], editable: true, save });
    expect(editor).toContain("9/18 jours"); expect(editor).toContain("2026-02-11 → 2026-02-19");
    const edit = form(editor, `actual-non-recurring-${TUILAGE}`);
    expect(select(edit, "valuation")).toContain('<option value="calendar" selected="">');
    expect(select(edit, "contract1")).toContain('<option value="entrant" selected="">');
    expect(select(edit, "contract2")).toContain('<option value="sortant" selected="">');
    expect(edit).toContain("le serveur recalcule depuis la paie");
  });
});
