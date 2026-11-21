import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SalaryAnalysisView } from "@/app/e/[slug]/studio-rh/kpi/SalaryAnalysisView";
import { buildPayfitPayrollItems, payrollItemsUnavailable } from "@/lib/rh/payroll-items";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

// Sources fictives uniquement. Les identités servent à détecter une fuite dans
// cette nouvelle vue agrégée, jamais à alimenter un tableau nominatif.
function payroll() {
  return buildPayfitPayrollItems({ month: "2026-10", syncId: "sync-fictif", readAt: "2026-11-05T12:00:00Z",
    input: { months: ["2026-10"], openMonths: [], grid: DEFAULT_PREFIXES,
      lines: [{ key: "line-fictive", month: "2026-10", accountId: "641100", accountName: null, debitCents: 123456, creditCents: null, contractId: "contract-fictif" }] },
    rh: { build: { source: "payfit", inputs: { source: "payfit", syncId: "sync-fictif" } },
      persons: [{ personKey: "payfit:person-fictive", familyName: "IDENTITE-FICTIVE-PRIVEE", givenNames: "PRENOM-FICTIF-PRIVE", provenance: { familyName: { collection: "collaborators", syncId: "sync-fictif", recordKey: "collaborator-fictif", period: null, path: "familyName", label: "Fictif" } } }],
      contracts: [{ contractKey: "payfit:contract-fictif", externalId: "contract-fictif", personKey: "payfit:person-fictive" }] },
  });
}
const render = (data = payroll()) => renderToStaticMarkup(createElement(SalaryAnalysisView, { slug: "espace-fictif", month: data.month, months: ["2026-10"], rubricKey: "", payroll: data, notices: [] }));

describe("Analyse des salaires : lecture agrégée et source", () => {
  it("montre les valeurs et le lien vers les lignes existantes sans nouvelle divulgation nominative", () => {
    const html = render();
    for (const tile of ["persons", "total", "mean", "median"]) expect(html).toContain(`data-testid="salary-tile-${tile}"`);
    expect(html).toContain('data-money-cents="123456"');
    expect(html).toContain('/e/espace-fictif/studio-rh/collaborateurs/rubrique?mois=2026-10&amp;rubrique=salaires');
    expect(html).toContain('aria-label="Mois et rémunérations analysées"');
    expect(html).toContain("Personnes distinctes ayant au moins une occurrence");
    expect(html).not.toMatch(/IDENTITE-FICTIVE|PRENOM-FICTIF|payfit:person-fictive|contract-fictif|collaborator-fictif/);
    expect(html).not.toContain('data-testid="salary-status"');
  });
  it("explique les statistiques indisponibles et garde les montants sources sans masquer les lignes non rattachées", () => {
    const data = payroll();
    data.rows[0] = { ...data.rows[0], attachment: "unlinked", personKey: null, contractKey: null };
    const html = render(data);
    expect(html).toContain("Couverture à vérifier");
    expect(html).toContain("1 non rattachée(s)");
    expect(html).toContain("sans rattachement certain");
    expect(html).toContain('data-money-cents="123456"');
    expect(html).toContain("Pourquoi n.d. ?");
  });
  it("un mois ouvert indisponible ne présente ni zéro monétaire ni statistiques d'un autre mois", () => {
    const html = render(payrollItemsUnavailable("payfit", "2026-11", "Paie non clôturée à la lecture."));
    expect(html).toContain("Paie non clôturée à la lecture.");
    expect(html).not.toContain("data-money-cents");
    expect(html).toContain('data-testid="salary-status"');
    expect(html).toContain("Vérifier les sources");
  });
  it("conserve la vraie cause sans source plutôt que de signaler un mois invalide", () => {
    const html = render(payrollItemsUnavailable(null, "", "Aucune source RH retenue. Connecte PayFit ou applique des DSN dans Données."));
    expect(html).toContain("Aucune source RH retenue.");
    expect(html).not.toContain("Mois invalide");
    expect(html).not.toContain("data-money-cents");
  });
});
