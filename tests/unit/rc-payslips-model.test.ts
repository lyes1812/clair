import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildRcPayslipPeriod, parseRcPayslipScan, type RcPayslipRecord, type RcPayslipScan } from "@/lib/payroll/rc-payslips";
import { ActualNonRecurringSummary } from "@/components/ActualNonRecurringSummary";
import { RcPayslipDetails } from "@/app/e/[slug]/studio-rh/masse-salariale/RcPayslipDetails";
import { buildActualNonRecurring, type ActualEvent } from "@/lib/payroll/non-recurring";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

const SYNC = "11111111-1111-4111-8111-111111111111";
const fixtureRecord = (patch: Partial<RcPayslipRecord> = {}): RcPayslipRecord => ({
  month: "2026-02", collaboratorId: "COLLAB_PRIVE_FICTIF", contractId: "CONTRAT_PRIVE_FICTIF", payslipId: "BULLETIN_PRIVE_FICTIF",
  pdfHash: "a".repeat(64), parserVersion: "rc-test-v1", status: "identified", code: "identified", indemnityCents: 125000,
  components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 100000, page: 1, line: 12 }, { label: "Indemnité de rupture conventionnelle exonérée", amountCents: 25000, page: 2, line: 3 }], ...patch,
});
const scan = (patch: Partial<RcPayslipScan> = {}): RcPayslipScan => ({
  version: 1, id: "22222222-2222-4222-8222-222222222222", payrollSyncId: SYNC, companyId: "SOCIETE_FICTIVE",
  from: "2026-01", to: "2026-02", status: "complete", startedAt: "2026-03-05T10:00:00.000Z", finishedAt: "2026-03-05T10:01:00.000Z",
  closedMonths: ["2026-01", "2026-02"], unavailableMonths: [], totalCollaborators: 2, completedCollaborators: 2, checkedPayslips: 4,
  records: [fixtureRecord()], issues: [], ...patch,
});
const manual = (patch: Partial<ActualEvent> = {}): ActualEvent => ({ id: "33333333-3333-4333-8333-333333333333", syncId: SYNC, month: "2026-02", kind: "rupture-conventionnelle", chargedCents: null, contractKeys: ["payfit:CONTRAT_PRIVE_FICTIF"], note: "JUSTIFICATIF_PRIVE_FICTIF", ...patch });
const period = (value = scan(), events: ActualEvent[] = []) => buildRcPayslipPeriod(value, ["2026-01", "2026-02"], SYNC, events);

describe("RC des bulletins — faits distincts du coût chargé", () => {
  it("additionne exactement les composantes imposable et exonérée sans les appeler coût chargé", () => {
    expect(period()).toMatchObject({ status: "value", amountCents: 125000, identifiedCount: 1, mergedCount: 1 });
    expect(period().reason).toContain("cotisations propres à la RC ne sont pas isolées");
    const journal = { months: ["2026-02"], openMonths: [], grid: DEFAULT_PREFIXES, lines: [{ key: "salaire-fictif", month: "2026-02", accountId: "6411", accountName: null, debitCents: 400000, creditCents: 0, contractId: "CONTRAT_PRIVE_FICTIF" }] };
    const original = manual();
    const model = buildActualNonRecurring(journal, [original], ["2026-02"], SYNC);
    expect(model).toMatchObject({ raw: 400000, nonRecurring: null, adjusted: null });
    expect(original.chargedCents).toBeNull();
  });

  it("fusionne seulement l’identité exacte mois + contrat sans dupliquer ni modifier la déclaration", () => {
    const event = manual({ chargedCents: 150000 }); const before = structuredClone(event);
    expect(period(scan(), [event])).toMatchObject({ amountCents: 125000, mergedCount: 1 });
    expect(event).toEqual(before);
    expect(period(scan(), [manual({ contractKeys: ["payfit:AUTRE_CONTRAT_FICTIF"] })])).toMatchObject({ mergedCount: 2 });
    const ambiguous = period(scan(), [manual({ contractKeys: [] })]);
    expect(ambiguous).toMatchObject({ status: "review", amountCents: null, mergedCount: 1 });
    expect(ambiguous.reason).toContain("sans contrat");
  });

  it("ne présente jamais une lecture partielle comme le cumul complet", () => {
    expect(period(scan({ status: "partial" }))).toMatchObject({ status: "review", amountCents: null, identifiedCount: 1 });
    expect(period(scan({ records: [fixtureRecord(), fixtureRecord({ payslipId: "AUTRE_PDF_FICTIF", contractId: "AUTRE_CONTRAT_FICTIF", status: "review", indemnityCents: null, components: [], pdfHash: null })] }))).toMatchObject({ status: "review", amountCents: null, reviewCount: 1 });
  });

  it("exige un mois explicitement clôturé et couvert par la lecture", () => {
    const missing = period(scan({ closedMonths: ["2026-01"] }));
    expect(missing).toMatchObject({ status: "review", amountCents: null });
    expect(missing.reason).toContain("paies clôturées");
    expect(buildRcPayslipPeriod(scan(), ["2025-12"], SYNC)).toMatchObject({ status: "review", amountCents: null });
  });

  it("une autre lecture de paie, une vue Service ou un échec restent n.d.", () => {
    expect(buildRcPayslipPeriod(scan(), ["2026-02"], "44444444-4444-4444-8444-444444444444")).toMatchObject({ status: "review", amountCents: null, rows: [] });
    expect(buildRcPayslipPeriod(scan(), ["2026-02"], SYNC, [], true)).toMatchObject({ status: "review", amountCents: null });
    expect(period(scan({ status: "failed" }))).toMatchObject({ status: "review", amountCents: null });
    expect(period(scan({ status: "running", finishedAt: null, completedCollaborators: 1 }))).toMatchObject({ status: "running", amountCents: null });
  });

  it("reconnaît l’idempotence documentaire sans choisir une version rectifiée", () => {
    const value = fixtureRecord();
    expect(period(scan({ records: [value, structuredClone(value)] }))).toMatchObject({ status: "value", amountCents: 125000, identifiedCount: 1 });
    expect(period(scan({ records: [value, { ...value, payslipId: "COPIE_PDF_FICTIVE" }] }))).toMatchObject({ status: "value", amountCents: 125000, identifiedCount: 1 });
    const conflict = period(scan({ records: [value, { ...value, payslipId: "RECTIFICATION_FICTIVE", pdfHash: "b".repeat(64) }] }));
    expect(conflict).toMatchObject({ status: "review", amountCents: null });
    expect(conflict.reason).toContain("Plusieurs versions");
  });

  it("distingue aucune indemnité repérée, zéro explicite et aucun bulletin lu", () => {
    expect(period(scan({ records: [] }))).toMatchObject({ status: "none", amountCents: null });
    expect(period(scan({ records: [fixtureRecord({ status: "none", indemnityCents: null, components: [] })] }))).toMatchObject({ status: "none", amountCents: null });
    expect(period(scan({ records: [fixtureRecord({ indemnityCents: 0, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: 0, page: 1, line: 4 }] })] }))).toMatchObject({ status: "value", amountCents: 0 });
    expect(buildRcPayslipPeriod(null, ["2026-02"], SYNC)).toMatchObject({ status: "not-read", amountCents: null });
  });

  it("refuse un état corrompu, un total incohérent et des bornes non sûres", () => {
    expect(parseRcPayslipScan(scan())).not.toBeNull();
    for (const invalid of [scan({ completedCollaborators: 3 }), scan({ completedCollaborators: 1 }), scan({ closedMonths: ["2026-01", "2026-01"] }), scan({ records: [fixtureRecord({ indemnityCents: 1 })] }), scan({ records: [fixtureRecord({ indemnityCents: -125000 })] }), { ...scan(), extra: "interdit" }, scan({ records: [fixtureRecord({ indemnityCents: Number.MAX_SAFE_INTEGER + 1 })] })]) expect(parseRcPayslipScan(invalid)).toBeNull();
    expect(period(scan({ records: [fixtureRecord({ indemnityCents: 1 })] }))).toMatchObject({ status: "review", amountCents: null });
    expect(buildRcPayslipPeriod(scan(), ["2026-02", "2026-02"], SYNC).status).toBe("review");
    const large = fixtureRecord({ indemnityCents: Number.MAX_SAFE_INTEGER, components: [{ label: "Indemnité de rupture conventionnelle", amountCents: Number.MAX_SAFE_INTEGER, page: 1, line: 4 }] });
    expect(period(scan({ records: [large, { ...large, contractId: "AUTRE_CONTRAT_FICTIF", payslipId: "AUTRE_PDF_FICTIF" }] }))).toMatchObject({ status: "review", amountCents: null });
  });
});

describe("RC des bulletins — synthèse et confidentialité", () => {
  const renderSummary = (rc = period(scan(), [manual()])) => renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: [{ event: manual(), amount: null, reason: "Montant chargé non saisi" }], href: "/detail#actual-non-recurring", rc }));
  const renderDetails = (editable: boolean) => renderToStaticMarkup(createElement(RcPayslipDetails, { slug: "fictif", period: period(), scan: scan(), editable, contracts: [{ key: "payfit:CONTRAT_PRIVE_FICTIF", label: "NOM_PRIVE_FICTIF" }] }));
  it("montre l’indemnité du bulletin tout en gardant le coût chargé n.d.", () => {
    const html = renderSummary();
    expect(html).toContain("Indemnité RC · bulletin");
    expect(html).toContain('data-money-cents="125000"');
    expect(html).toContain("Coût chargé identifié : n.d.");
    expect(html).toContain("1 élément identifié");
    for (const value of ["COLLAB_PRIVE_FICTIF", "CONTRAT_PRIVE_FICTIF", "BULLETIN_PRIVE_FICTIF", "JUSTIFICATIF_PRIVE_FICTIF", "a".repeat(64)]) expect(html).not.toContain(value);
  });
  it("le lecteur reçoit seulement le montant mensuel agrégé, l’éditeur accède aux références", () => {
    const reader = renderDetails(false);
    expect(reader).toContain('data-testid="rc-payslip-monthly"');
    expect(reader).toContain('data-money-cents="125000"');
    for (const value of ["NOM_PRIVE_FICTIF", "COLLAB_PRIVE_FICTIF", "CONTRAT_PRIVE_FICTIF", "BULLETIN_PRIVE_FICTIF", "Indemnité de rupture conventionnelle exonérée", "a".repeat(12)]) expect(reader).not.toContain(value);
    const editor = renderDetails(true);
    expect(editor).toContain("NOM_PRIVE_FICTIF"); expect(editor).toContain("BULLETIN_PRIVE_FICTIF");
    expect(editor).toContain("Indemnité de rupture conventionnelle exonérée");
    expect(editor).not.toContain("JUSTIFICATIF_PRIVE_FICTIF");
    expect(reader).toContain('/e/fictif/donnees/payfit#indemnites-rc');
  });
});
