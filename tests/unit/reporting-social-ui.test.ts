import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/app/e/[slug]/studio-rh/reporting-social/ReportView";
import { REPORTING_VUES, resolveReportingVue } from "@/app/e/[slug]/studio-rh/reporting-social/tabs";
import { rollingWindow, previousWindow } from "@/lib/rh/kpi/period";
import type { SocialCell, SocialReport, SocialRow } from "@/lib/reporting/social";

// Agrégats entièrement fictifs ; le composant les présente sans recalculer leur valeur.
const known = (text: string): SocialCell => ({ text, kind: "value", reason: null, qualifiers: [] });
const amount = (cents: number): SocialCell => ({ ...known("Montant fictif"), cents });
const missing = (): SocialCell => ({ text: "n.d.", kind: "nd", reason: "Absences non lues dans la source fictive.", qualifiers: [] });
function fixture(): SocialReport {
  const window = rollingWindow("2026-02");
  const row = (month: string): SocialRow => ({ month, coverage: known("complet"), headcount: known("8"), etp: known("7,50"), entries: known("0"), exits: known("0"), absenteeism: missing(), brut: amount(100_000), cotisations: amount(40_000), masse: amount(140_000) });
  return {
    kind: "ready", selection: { mode: "glissant", fin: "2026-02", year: 2025, closed: ["2025-12", "2026-01", "2026-02"], years: [{ year: 2025, closed: true }, { year: 2026, closed: false }] },
    window, previousWindow: previousWindow(window),
    source: { kind: "payfit", referenceDate: "2026-03-05", readAt: "2026-03-05T10:00:00.000Z", payrollKind: "payfit", payrollReadAt: "2026-03-05T10:00:00.000Z", changedAt: null },
    notices: [], limits: ["Quotités fictives lues à la date de référence, non historisées."], previous: { available: false, reason: "Une partie de N-1 n’est pas couverte." },
    metrics: [
      { id: "headcount", label: "Effectif fin de mois", term: "headcount-persons", unit: "number", period: "fin février 2026", current: known("8"), previous: { text: "≥ 6", kind: "lower", reason: null, qualifiers: ["Historique fictif incomplet : borne basse."] } },
      { id: "absenteeism", label: "Absentéisme", term: "absenteeism", unit: "rate", period: window.label, current: missing(), previous: missing() },
      { id: "masse", label: "Masse chargée", term: "masse", unit: "money", period: window.label, current: amount(1_680_000), previous: amount(0) },
    ], rows: window.months.map(row),
  };
}
const html = (report = fixture()) => renderToStaticMarkup(createElement(ReportView, { report, slug: "espace-fictif", workspaceName: "Entreprise fictive" }));
const table = (value: string, id: string) => value.match(new RegExp(`<table[^>]*data-testid="${id}"[\\s\\S]*?<\\/table>`))?.[0] ?? "";

describe("Reporting social — présentation des agrégats fictifs", () => {
  it("affiche la population du turnover à côté de sa période, sans codes techniques", () => {
    const report = fixture();
    report.metrics.push({ id: "turnover", label: "Turnover", term: "turnover", unit: "rate", period: report.window!.label, population: "CDI, CDI intermittent", current: known("12,50 %"), previous: known("10,00 %") });
    const value = html(report);
    expect(value).toContain('data-testid="rs-metric-turnover-population"');
    expect(value).toContain("Population : CDI, CDI intermittent");
    expect(value).toContain(report.window!.label);
  });
  it("regroupe réserves et provenance dans un seul accès fermé, sans perdre leurs références", () => {
    const value = html();
    expect(value.match(/data-testid="rs-context"/g)).toHaveLength(1);
    expect(value).toContain('Vigilance (');
    expect(value).toContain('et sources');
    expect(value).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(value).toContain('aria-describedby="rs-note-');
    const notes = value.match(/<section[^>]*data-testid="rs-notes"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(notes).toContain('Absences non lues dans la source fictive.');
    const css = readFileSync('src/styles/rh-payroll-reporting.css', 'utf8');
    expect(css).toContain('.rh-studio .rs-context::details-content { content-visibility: visible !important; display: block !important; }');
    expect(css).toContain('@media screen { .rh-studio .rs-note-ref { display: none; } }');
  });
  it("affiche la période exacte, son N-1 et les deux lectures avec leur date de référence", () => {
    const value = html();
    expect(value).toContain("12 mois glissants : mars 2025 → février 2026");
    expect(value).toContain("N-1 : 12 mois glissants : mars 2024 → février 2025");
    for (const text of ["Source RH", "PayFit", "Journal comptable PayFit", "05/03/2026", "fin février 2026"]) expect(value).toContain(text);
    expect(value).toContain('data-testid="rs-provenance"');
    expect(value).toContain('data-testid="rs-workspace">Espace : Entreprise fictive');
  });

  it("transmet les choix de période par GET et conserve le choix inactif", () => {
    const value = html();
    expect(value).toContain('method="get"');
    expect(value).toContain('action="/e/espace-fictif/studio-rh/reporting-social"');
    expect(value).toContain('name="vue" value="rapport"');
    expect(value).toContain('value="glissant" selected=""');
    expect(value).toContain('value="2026-02" selected=""');
    expect(value).toContain('name="annee" value="2025"');
    const civil = fixture(); civil.selection.mode = "civil";
    const civilHtml = html(civil);
    expect(civilHtml).toContain('value="civil" selected=""');
    expect(civilHtml).toContain('name="fin" value="2026-02"');
    expect(civilHtml).toContain('value="2026">2026 (non close)</option>');
  });

  it("conserve n.d., borne basse et zéro explicite avec des renvois vers les raisons complètes", () => {
    const value = html();
    expect(value).toContain("≥ 6");
    expect(value).toContain('data-money-cents="0"');
    expect(value).toContain('data-money-cents="1680000"');
    expect(value).toContain("n.d.");
    expect(value).toContain('href="#rs-note-');
    for (const reason of ["Absences non lues dans la source fictive.", "Historique fictif incomplet : borne basse.", "Une partie de N-1 n’est pas couverte."]) expect(value.split(reason)).toHaveLength(2);
    expect(value).not.toContain("n.d. — 0");
  });

  it("garde tous les mois dans deux tableaux, avec les montants reçus et les unités monétaires communes", () => {
    const value = html();
    const rh = table(value, "rs-rh-table");
    const payroll = table(value, "rs-payroll-table");
    for (const month of fixture().window!.months) {
      expect(rh).toContain(`data-month="${month}"`);
      expect(payroll).toContain(`data-month="${month}"`);
    }
    expect(payroll.match(/data-money-cents="100000"/g)).toHaveLength(12);
    expect(payroll.match(/data-money-cents="40000"/g)).toHaveLength(12);
    expect(payroll.match(/data-money-cents="140000"/g)).toHaveLength(12);
    expect(payroll).toContain("montants en €");
    expect(value).toContain('tabindex="0" role="region" aria-label="RH · mois par mois"');
    expect(rh).toContain('scope="row"');
  });

  it("la source DSN reste explicite sans désigner un journal PayFit absent", () => {
    const report = fixture(); report.source.kind = "dsn"; report.source.payrollKind = null; report.source.payrollReadAt = null;
    const value = html(report);
    expect(value).toContain("DSN");
    expect(value).toMatch(/Source paie<\/dt><dd>n\.d\./);
    expect(value).not.toContain("Journal comptable PayFit");
  });

  it("sans période, conserve les sources et la raison sans bouton PDF ni tableau vide rempli de zéro", () => {
    const report = fixture(); report.kind = "no-period"; report.window = null; report.previousWindow = null; report.metrics = []; report.rows = [];
    const value = html(report);
    expect(value).toContain('data-testid="rs-no-period"');
    expect(value).toContain("aucune période disponible");
    expect(value).toContain('data-testid="rs-provenance"');
    expect(value).not.toContain('data-testid="rs-print"');
    expect(value).not.toContain('data-testid="rs-payroll-table"');
    expect(value).not.toContain('data-money-cents=');
  });

  it("le rapport est l’entrée par défaut et les deux entrées réglementaires restent prévues avec leur identifiant", () => {
    expect(resolveReportingVue("")).toBe("rapport");
    expect(resolveReportingVue("inconnue")).toBe("rapport");
    expect(REPORTING_VUES).toEqual([
      { key: "rapport", label: "Rapport de synthèse" },
      { key: "index", label: "Index égalité FH", soon: true },
      { key: "bdese", label: "BDESE", soon: true },
    ]);
    const page = readFileSync("src/app/e/[slug]/studio-rh/reporting-social/page.tsx", "utf8");
    expect(page).toContain('vue === "rapport"');
    expect(page).toContain('vue === "index"');
    expect(page).toContain("ne valide aucune obligation légale");
    expect(page).toContain("Données");
  });

  it("l’impression navigateur utilise le même rapport et conserve les tableaux, raisons, sources et période", () => {
    const button = readFileSync("src/app/e/[slug]/studio-rh/reporting-social/PrintAction.tsx", "utf8");
    const css = readFileSync("src/styles/reporting-social.css", "utf8");
    expect(button).toContain("window.print()");
    expect(button).toContain("Imprimer / Enregistrer en PDF");
    expect(button).not.toMatch(/fetch\(|application\/pdf|\.pdf/);
    expect(css).toContain("@page clair-social-report");
    expect(css).toContain("size: A4 portrait");
    expect(css).toContain("overflow: visible");
    expect(css).toContain("table-header-group");
    expect(css).not.toMatch(/\.rs-(?:notes|monthly|provenance|workspace|metrics|table)[^{]*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/line-clamp|max-height:\s*\d|nth-child\([^)]*\)[^{]*\{[^}]*display:\s*none/);
  });
});
