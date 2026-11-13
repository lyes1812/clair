import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RcPayslipDetails } from "@/app/e/[slug]/studio-rh/masse-salariale/RcPayslipDetails";
import type { RcPayslipPeriod, RcPayslipRecord } from "@/lib/payroll/rc-payslips";

const record = (patch: Partial<RcPayslipRecord> = {}): RcPayslipRecord => ({
  month: "2026-02", collaboratorId: "COLLAB_PRIVE_FICTIF", contractId: "CONTRAT_PRIVE_FICTIF", payslipId: "PDF_PRIVE_FICTIF", pdfHash: "a".repeat(64), parserVersion: "fictif-v2", status: "identified", code: "identified", indemnityCents: 125000,
  components: [{ label: "INDEMNITE_LIBELLE_PRIVE_FICTIF", amountCents: 125000, page: 1, line: 6 }],
  cost: { status: "value", code: "explicit-employer-rc-cost", employerChargesCents: 15000, chargedCents: 140000, components: [{ label: "CONTRIBUTION_LIBELLE_PRIVE_FICTIF", amountCents: 15000, page: 1, line: 8 }] }, ...patch,
});
const period = (patch: Partial<RcPayslipPeriod> = {}): RcPayslipPeriod => ({ status: "value", amountCents: 125000, identifiedCount: 1, mergedCount: 1, reviewCount: 0, reason: "Indemnités confirmées.", rows: [record()], costStatus: "value", employerChargesCents: 15000, chargedCents: 140000, costReason: "Contributions RC explicites.", ...patch });
const render = (value = period(), editable = false) => renderToStaticMarkup(createElement(RcPayslipDetails, { slug: "fictif", period: value, scan: null, editable, contracts: [{ key: "payfit:CONTRAT_PRIVE_FICTIF", label: "NOM_PRIVE_FICTIF" }] }));

describe("détail RC — coût chargé des bulletins fictifs", () => {
  it("présente indemnité, contributions RC et coût chargé dans le mensuel sans exposer les sources au lecteur", () => {
    const html = render();
    for (const value of ["Indemnité RC · bulletin", "Contributions patronales RC", "Coût chargé RC", 'data-money-cents="125000"', 'data-money-cents="15000"', 'data-money-cents="140000"']) expect(html).toContain(value);
    for (const value of ["NOM_PRIVE", "COLLAB_PRIVE", "CONTRAT_PRIVE", "PDF_PRIVE", "LIBELLE_PRIVE", "a".repeat(12)]) expect(html).not.toContain(value);
    expect(html).toContain("Aucun taux n’est reconstitué");
  });

  it("garde le nominal lorsque les contributions ne sont pas isolées, sans total chargé partiel", () => {
    const ambiguous = record({ month: "2026-01", payslipId: "AUTRE_PDF_PRIVE_FICTIF", cost: { status: "review", code: "CODE_TECHNIQUE_PRIVE_FICTIF", chargedCents: null, employerChargesCents: null, components: [] } });
    const html = render(period({ amountCents: 250000, identifiedCount: 2, mergedCount: 2, rows: [record(), ambiguous], costStatus: "review", chargedCents: null, employerChargesCents: null, costReason: "Contributions propres aux RC non isolées ; aucun coût chargé partiel." }));
    expect(html.match(/data-money-cents="125000"/g)).toHaveLength(2);
    expect(html).not.toContain('data-money-cents="140000"');
    expect(html).not.toContain('data-money-cents="15000"');
    expect(html).toContain("aucun coût chargé partiel");
    expect(html).not.toContain("CODE_TECHNIQUE_PRIVE_FICTIF");
  });

  it("réserve les composantes des contributions et leurs pages/lignes à l’éditeur", () => {
    const html = render(period(), true);
    expect(html).toContain("NOM_PRIVE_FICTIF");
    expect(html).toContain("CONTRIBUTION_LIBELLE_PRIVE_FICTIF · p. 1, ligne 8");
    expect(html).toContain("INDEMNITE_LIBELLE_PRIVE_FICTIF · p. 1, ligne 6");
    expect(html).toContain('/e/fictif/studio-rh/masse-salariale/bulletins/PDF_PRIVE_FICTIF');
  });

  it("humanise un coût ambigu dans les sources et ne remplace pas son montant par zéro", () => {
    const row = record({ cost: { status: "review", code: "CODE_TECHNIQUE_PRIVE_FICTIF", chargedCents: null, employerChargesCents: null, components: [] } });
    const html = render(period({ rows: [row], costStatus: "review", employerChargesCents: null, chargedCents: null, costReason: "Coût chargé à vérifier." }), true);
    expect(html).toContain("Contributions patronales propres à la RC non isolées");
    expect(html).toContain('data-money-cents="125000"');
    expect(html).not.toContain('data-money-cents="0"');
    expect(html).not.toContain("CODE_TECHNIQUE_PRIVE_FICTIF");
  });
});
