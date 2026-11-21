import { describe, expect, it, vi } from "vitest";
import type { PayrollContext } from "@/lib/payroll/context";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { monthRange } from "@/lib/connectors/months";
import { PUBLISHER_BLOCKS, publisherNotes, publisherReportOf, publisherSelection } from "@/lib/reporting/publisher";
import { socialReportOf } from "@/lib/reporting/social";
import { kpiSuiviOf } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";
vi.mock("@/db/client", () => ({ db: {} }));

async function context(dsn = false, months?: string[]): Promise<PayrollContext> {
  const data = dsn ? dsnFixtureBuild(months) : await payfitFixtureBuild();
  const input = kpiInput(data, dsn ? DSN_ABSENCES : await fixtureAbsences());
  return {
    kpi: { input, settings: { invalid: [], values: input.params, origins: {} }, readTypes: [], collab: {
      slug: "espace-fictif", workspace: { id: "workspace-fictif", name: "Espace fictif" },
      chosen: dsn ? "dsn" : "payfit", source: { chosen: dsn ? "dsn" : "payfit", reason: "Source fictive appliquée." },
      data, state: null, switchedAt: null, establishments: [],
      natures: { codes: input.params.natures, origin: "default" }, payfitHistory: { mode: "flagged", limit: null },
    } },
    source: dsn ? "dsn" : "payfit", input: { months: ["2026-10"], openMonths: [], grid: DEFAULT_PREFIXES,
      lines: [{ key: "PRIVATE-LEDGER-FICTIF", month: "2026-10", accountId: "641100", accountName: "Compte fictif", debitCents: 5456789, creditCents: null, contractId: "PRIVATE-CONTRACT-FICTIF" }] },
    read: { syncId: "PRIVATE-SYNC-FICTIF", startedAt: new Date("2026-11-05T12:00:00Z"), months: ["2026-10"] },
    unavailable: null, etpQualifiers: ["quotités PayFit à la date de lecture, non historisées"],
  } as unknown as PayrollContext;
}
const reportFor = (ctx: PayrollContext, search: Record<string, string | string[] | undefined> = {}) => publisherReportOf(ctx, kpiSuiviOf(ctx.kpi, { vue: "suivi", mode: search.mode, fin: search.fin, annee: search.annee }), publisherSelection(search));

describe("Publisher : composition explicite d'indicateurs existants", () => {
  it("ouvre tous les blocs et le mensuel ; une soumission vide ne rétablit aucun défaut", () => {
    expect(publisherSelection({})).toEqual({ blocks: PUBLISHER_BLOCKS.map((b) => b.key), monthly: true, submitted: false, notices: [] });
    const empty = publisherSelection({ composition: "1" });
    expect(empty).toMatchObject({ blocks: [], monthly: false, submitted: true });
    expect(empty.notices).toContain("Choisis au moins un bloc pour prévisualiser et imprimer le rapport.");
  });
  it("borne la sélection aux valeurs autorisées, déduplique et ne recopie pas les valeurs libres", () => {
    const result = publisherSelection({ composition: "PRIVATE-COMPOSITION", bloc: ["mouvements", "PRIVATE-NOM", "mouvements"], mensuel: ["1", "PRIVATE-CHOIX"] });
    expect(result).toMatchObject({ blocks: ["mouvements"], monthly: false, submitted: true });
    expect(result.notices).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(publisherSelection({ bloc: "PRIVATE-NOM" }).blocks).toEqual([]);
  });
  it("reprend exactement la période RH, même si le journal de paie est plus récent", async () => {
    const ctx = await context();
    const period = kpiSuiviOf(ctx.kpi, { vue: "suivi" });
    expect(period.kind).toBe("ready");
    const social = socialReportOf(ctx, {});
    expect(social.selection.fin).toBe("2026-10");
    const report = reportFor(ctx);
    expect(report.kind).toBe("ready");
    expect(report.period?.fin).toBe("2026-09");
    if (period.kind !== "ready") throw new Error("Période fictive attendue");
    expect(report.window).toEqual(period.w);
    expect(report.metrics).toHaveLength(7);
    // Références écrites à la main sur le profil A, photographie 1.
    expect(report.metrics.find((m) => m.id === "effectif")?.current.text).toBe("7");
    expect(report.metrics.find((m) => m.id === "etp-fin")?.current.text).toBe("6,10");
    const canonicalSocial = socialReportOf(ctx, { mode: period.mode, fin: period.fin, annee: String(period.year) });
    expect(report.metrics).toEqual(canonicalSocial.metrics.filter((m) => m.unit !== "money"));
    expect(report.source).not.toHaveProperty("payrollKind");
    expect(report.rows[0]).not.toHaveProperty("brut");
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE-|5456789|contractKey|personKey|cents/);
  });
  it("une composition ne garde que ses repères et colonnes, avec leurs définitions et paramètres", async () => {
    const report = reportFor(await context(), { composition: "1", bloc: "mouvements" });
    expect(report.metrics.map((m) => m.id)).toEqual(["entrees", "sorties", "turnover"]);
    expect(report.columns).toEqual(["entries", "exits"]);
    expect(report.parameters.map((p) => p.label)).toContain("Population du turnover");
    expect(report.parameters.map((p) => p.label)).not.toContain("Quotité plafonnée à 1");
    expect(report.definitions.map((d) => d.id)).toEqual(["movements", "turnover"]);
    expect(publisherNotes(report).join(" ")).not.toContain("quotités PayFit");
    expect(report.source.kind).toBe("payfit");
  });
  it("requalifie N-1 selon les seuls blocs choisis, sans réserve paie ni absentéisme exclu", async () => {
    const ctx = await context(true);
    const report = reportFor(ctx, { composition: "1", bloc: "effectifs", fin: "2026-09" });
    expect(report.previous).toEqual({ available: true, reason: null });
    expect(publisherNotes(report).join(" ")).not.toMatch(/arrêts non extraits|journal de paie|masse chargée|cotisations/i);
    const absence = reportFor(ctx, { composition: "1", bloc: "absenteisme", fin: "2026-09" });
    expect(absence.previous.available).toBe(false);
    expect(absence.metrics[0].current.kind).toBe("nd");
    expect(publisherNotes(absence).join(" ")).toContain("arrêts non extraits de la DSN");
    const movements = reportFor(await context(true, monthRange("2024-09", "2026-09")), { composition: "1", bloc: "mouvements", fin: "2026-09" });
    expect(movements.metrics.find((m) => m.id === "turnover")?.previous.qualifiers.length).toBeGreaterThan(0);
    expect(movements.previous).toEqual({ available: true, reason: null });
  });
  it("l’annexe annonce la formule de turnover réellement choisie dans l’espace", async () => {
    const ctx = await context(true);
    ctx.kpi.settings.values.turnoverFormula = "exits_over_start";
    ctx.kpi.input!.params.turnoverFormula = "exits_over_start";
    const report = reportFor(ctx, { composition: "1", bloc: "mouvements" });
    expect(report.definitions.find((d) => d.id === "turnover")?.formula).toBe("sorties ÷ effectif du premier jour");
    expect(report.parameters.find((p) => p.label === "Formule du turnover")?.value).toBe("sorties ÷ effectif du premier jour");
  });
  it("conserve l'année civile et signale les paramètres invalides sans imprimer leur contenu libre", async () => {
    const ctx = await context();
    const civil = reportFor(ctx, { mode: "civil", annee: "2025" });
    expect(civil.window).toMatchObject({ from: "2025-01", to: "2025-12" });
    const invalid = reportFor(ctx, { mode: "PRIVATE-PARAM", fin: "PRIVATE-PARAM", annee: "PRIVATE-PARAM" });
    expect(invalid.notices).toHaveLength(3);
    expect(JSON.stringify(invalid)).not.toContain("PRIVATE-PARAM");
  });
  it("les paramètres illisibles, l'absence de lecture et la composition vide ne donnent aucun faux indicateur", async () => {
    const ctx = await context();
    ctx.kpi.settings.invalid = ["dayBasis"];
    const invalid = reportFor(ctx);
    expect(invalid.kind).toBe("settings-invalid"); expect(invalid.metrics).toEqual([]); expect(invalid.rows).toEqual([]);
    expect(invalid.reason).toContain("aucun indicateur n’est calculé");
    ctx.kpi.settings.invalid = [];
    expect(reportFor(ctx, { composition: "1" })).toMatchObject({ kind: "empty", metrics: [], rows: [] });
    ctx.kpi.input = null; ctx.kpi.collab.data = null; ctx.kpi.collab.chosen = null;
    expect(reportFor(ctx)).toMatchObject({ kind: "no-period", window: null, metrics: [], rows: [] });
  });
  it("les raisons n.d. restent publiques sans identité ni contribution individuelle", async () => {
    const ctx = await context();
    const data = ctx.kpi.input!.data;
    data.persons[0].familyName = "NomFictifSecret"; data.persons[0].givenNames = "PrenomFictifSecret";
    ctx.kpi.input!.absences = { status: "unavailable", nd: { code: "scope-missing", reason: `indisponible pour NomFictifSecret PrenomFictifSecret ${data.contracts[0].contractKey}` } };
    const report = reportFor(ctx, { composition: "1", bloc: "absenteisme", mensuel: "1" });
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/NomFictifSecret|PrenomFictifSecret|contractKey|personKey|contributions/);
    expect(report.metrics[0].current.kind).toBe("nd");
    expect(publisherNotes(report).join(" ")).toContain("indisponible pour [identifiant masqué]");
  });
});
