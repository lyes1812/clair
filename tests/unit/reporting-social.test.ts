import { describe, expect, it, vi } from "vitest";
import { monthRange } from "@/lib/connectors/months";
import { publicReason } from "@/lib/croisee/public";
import { monthEnd } from "@/lib/dates";
import type { PayrollContext } from "@/lib/payroll/context";
import { monthPayroll, windowPayroll, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { paramsTyped, socialReportOf, type SocialReport } from "@/lib/reporting/social";
import { headcountAt } from "@/lib/rh/headcount";
import { absenteeism } from "@/lib/rh/kpi/absence";
import { etpAverage } from "@/lib/rh/kpi/average";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { countedOpts, previousWindow, rollingWindow } from "@/lib/rh/kpi/period";
import { turnover, windowMovements } from "@/lib/rh/kpi/turnover";
import { payfitHistoryLimit, rawPayfitHistory } from "@/lib/rh/raw-history";
import type { RhBuildResult } from "@/lib/rh/referential/types";
import { averageTile, etpTile, headcountTile, rateTile } from "@/lib/viz/synthese";
import { DSN_ABSENCES, fixtureAbsences, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";

vi.mock("@/db/client", () => ({ db: {} }));

const flat = (s: string) => s.replace(/\s/g, " ");
const months = monthRange("2024-10", "2026-09");
const metric = (r: SocialReport, id: string) => r.metrics.find((m) => m.id === id)!;
const line = (month: string, accountId: string, cents: number | null): LedgerLine => ({
  key: `${month}-PRIVATE-LEDGER-KEY-${accountId}`, month, accountId, accountName: "Compte fictif", debitCents: cents,
  creditCents: null, contractId: "PRIVATE-CONTRACT-KEY",
});
const journal = (): JournalInput => ({ months, openMonths: [], grid: DEFAULT_PREFIXES,
  lines: months.flatMap((m) => [line(m, "641100", 100001), line(m, "645100", 33337)]) });

async function context(data?: RhBuildResult): Promise<PayrollContext> {
  const d = data ?? await payfitFixtureBuild();
  const input = kpiInput(d, await fixtureAbsences());
  // Contexte entièrement fictif : aucune base ni API réelle. Les champs non utilisés ne traversent pas l'adaptateur.
  return {
    kpi: { input, settings: { invalid: [], values: input.params, origins: {} }, readTypes: [], collab: {
      chosen: "payfit", source: { chosen: "payfit", reason: "API connectée et appliquée." }, data: d,
      state: null, switchedAt: null, payfitHistory: { mode: "flagged", limit: null },
    } },
    source: "payfit", input: journal(), read: { syncId: "PRIVATE-SYNC", startedAt: new Date("2026-10-21T08:00:00Z"), months },
    unavailable: null, etpQualifiers: ["quotités à la date de lecture, non historisées par PayFit"],
  } as unknown as PayrollContext;
}

describe("Reporting social V1 : adaptateur pur des moteurs existants", () => {
  it("paramètres typés, dernier mois clos réellement lu, invalides signalés sans recopier l'URL libre", async () => {
    expect(paramsTyped({ mode: ["civil", "glissant"], fin: "2026-09" })).toEqual({ mode: "civil", fin: "2026-09", annee: "" });
    const ctx = await context();
    // Le journal peut porter un mois plus récent que le référentiel RH : les dates restent distinctes.
    ctx.input = { ...ctx.input!, months: [...months, "2026-10"], lines: [...ctx.input!.lines, line("2026-10", "641100", 90001)] };
    ctx.read = { ...ctx.read!, startedAt: new Date("2026-11-05T09:00:00Z") };
    const r = socialReportOf(ctx, { mode: "PRIVATE-PARAM", fin: "PRIVATE-PARAM", annee: "PRIVATE-PARAM" });
    expect(r.kind).toBe("ready");
    expect(r.selection.fin).toBe("2026-10");
    expect(r.window).toEqual(rollingWindow("2026-10"));
    expect(r.previousWindow).toEqual(previousWindow(rollingWindow("2026-10")));
    expect(r.source).toMatchObject({ kind: "payfit", readAt: "2026-10-21T08:00:00.000Z", payrollKind: "payfit", payrollReadAt: "2026-11-05T09:00:00.000Z" });
    expect(r.notices).toHaveLength(3);
    expect(JSON.stringify(r)).not.toContain("PRIVATE-PARAM");
    expect(r.rows.at(-1)!.etp.kind).toBe("nd");
  });

  it("mêmes effectifs, ETP, mouvements et taux que les moteurs, N−1 sur la même fenêtre", async () => {
    const ctx = await context();
    const r = socialReportOf(ctx, { mode: "glissant", fin: "2026-09" });
    const input = ctx.kpi.input!;
    const w = rollingWindow("2026-09");
    for (const [side, period] of [["current", w], ["previous", previousWindow(w)]] as const) {
      const pairs = [
        ["effectif", headcountTile(headcountAt(input.data, monthEnd(period.to), countedOpts(input)))],
        ["etp-fin", etpTile(etpMonthEnd(input, period.to))],
        ["etp-moyen", averageTile(etpAverage(input, period))],
        ["turnover", rateTile(turnover(input, period))],
        ["absenteisme", rateTile(absenteeism(input, period))],
      ] as const;
      for (const [id, expected] of pairs) expect(metric(r, id)[side]).toMatchObject({ ...expected, reason: expected.reason === null ? null : publicReason(expected.reason) });
      const mv = windowMovements(input, period);
      for (const [id, value] of [["entrees", mv.entries], ["sorties", mv.exits]] as const) {
        if (value.kind === "nd") expect(metric(r, id)[side]).toMatchObject({ kind: "nd", reason: publicReason(value.nd.reason) });
        else expect(metric(r, id)[side].text).toBe(`${value.kind === "lower_bound" ? "≥ " : ""}${value.value}`);
      }
    }
    // Cas de référence écrit à la main : 12 × (1 000,01 € + 333,37 €) = 16 000,56 €.
    expect(metric(r, "masse").current.cents).toBe(1600056);
    expect(flat(metric(r, "masse").current.text)).toBe("16 000,56 €");
    const total = windowPayroll(ctx.input!, w.months);
    expect(total.kind).toBe("value");
    if (total.kind === "value") expect(metric(r, "masse").current.cents).toBe(total.masse);
    for (const row of r.rows) {
      const source = monthPayroll(ctx.input!, row.month);
      expect(source.kind).toBe("value");
      if (source.kind === "value") expect(row.masse.cents).toBe(source.masse);
    }
    // Le modèle est une seule photographie sérialisable pour l'écran et l'impression.
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("scope absences manquant : raison conservée, jamais remplacé par zéro ; autres indicateurs indépendants", async () => {
    const ctx = await context();
    ctx.kpi.input = { ...ctx.kpi.input!, absences: { status: "unavailable", nd: { code: "scope-missing", reason: "droit absences:read non accordé" } } };
    const r = socialReportOf(ctx, {});
    expect(metric(r, "absenteisme").current).toMatchObject({ kind: "nd", text: "n.d.", reason: "absences non lues : droit absences:read non accordé" });
    expect(r.rows.every((row) => row.absenteeism.kind === "nd")).toBe(true);
    expect(metric(r, "etp-fin").current.kind).toBe("value");
    expect(metric(r, "masse").current.cents).toBe(1600056);
    expect(r.previous.available).toBe(false);
  });

  it("couverture partielle : borne basse conservée, moyenne et N−1 incomplets explicites", async () => {
    const d = await payfitFixtureBuild();
    const r = socialReportOf(await context(d), { fin: "2025-09" });
    expect(metric(r, "effectif").current.kind).toBe("lower");
    expect(metric(r, "effectif").current.text).toMatch(/^≥ /);
    expect(metric(r, "effectif").current.qualifiers.join(" ")).toContain("contrats archivés");
    expect(metric(r, "etp-moyen").current.kind).toBe("nd");
    expect(r.rows.at(-1)!.coverage).toMatchObject({ text: "borne basse", kind: "lower" });
    const ctx = await context();
    ctx.input = { ...ctx.input!, months: ctx.input!.months.filter((m) => m !== "2025-02") };
    const prevMissing = socialReportOf(ctx, {});
    expect(metric(prevMissing, "masse").previous).toMatchObject({ text: "n.d.", kind: "nd" });
    expect(prevMissing.previous).toMatchObject({ available: false });
    expect(prevMissing.previous.reason).toContain("incomplet");
  });

  it("mode PayFit brut : mêmes chiffres API, limite des archives et cutoff conservés pour la période et N−1", async () => {
    const original = await payfitFixtureBuild();
    const limit = payfitHistoryLimit(original)!;
    expect(limit).toMatchObject({ lowerFrom: "2024-10", lowerTo: "2025-10", exactFrom: "2025-10-21" });
    const raw = rawPayfitHistory(original);
    expect(original.coverage.some((c) => c.presenceStatus === "lower_bound")).toBe(true);
    expect(raw.coverage.some((c) => c.presenceStatus === "lower_bound")).toBe(false);
    const ctx = await context(raw);
    ctx.kpi.collab.payfitHistory = { mode: "raw", origin: "setting", limit };
    ctx.etpQualifiers.push(`historique PayFit brut : ETP des mois ${limit.lowerFrom} → ${limit.lowerTo} sans les contrats archivés depuis plus de 12 mois`);
    const r = socialReportOf(ctx, { mode: "glissant", fin: "2026-09" });
    for (const [side, period] of [["current", r.window!], ["previous", r.previousWindow!]] as const) {
      const input = ctx.kpi.input!;
      expect(metric(r, "effectif")[side]).toMatchObject(headcountTile(headcountAt(input.data, monthEnd(period.to), countedOpts(input))));
      expect(metric(r, "etp-fin")[side]).toMatchObject(etpTile(etpMonthEnd(input, period.to)));
      expect(metric(r, "etp-moyen")[side]).toMatchObject(averageTile(etpAverage(input, period)));
      const expected = rateTile(turnover(input, period));
      expect(metric(r, "turnover")[side]).toMatchObject({ ...expected, reason: expected.reason === null ? null : publicReason(expected.reason) });
    }
    expect(metric(r, "effectif").previous.kind).toBe("value");
    expect(metric(r, "etp-fin").previous.kind).toBe("value");
    expect(metric(r, "effectif").previous.qualifiers.join(" ")).toContain("voir Vigilance");
    expect(metric(r, "etp-fin").previous.qualifiers.join(" ")).toContain("voir Vigilance");
    expect(metric(r, "effectif").current.qualifiers.join(" ")).not.toContain("voir Vigilance");
    expect(metric(r, "masse").previous).toMatchObject({ kind: "value", cents: 1600056, qualifiers: [] });
    expect(r.rows.find((row) => row.month === "2025-10")!.coverage).toMatchObject({ kind: "value", text: "brut (API PayFit)" });
    expect(r.rows.find((row) => row.month === "2025-11")!.coverage).toMatchObject({ kind: "value", text: "complet" });
    // Octobre 2025 finit après la date d'effectif complet : stock connu, mouvements du mois encore limités.
    const cutoff = r.rows.find((row) => row.month === "2025-10")!;
    expect(cutoff.headcount.qualifiers.join(" ")).not.toContain("voir Vigilance");
    expect(cutoff.entries.qualifiers.join(" ")).toContain("voir Vigilance");
    const warnings = r.limits.join(" ");
    expect(warnings).toContain("2024-10 → 2025-10 (avant le 21/10/2025)");
    expect(warnings).toContain("effectifs, ETP et sorties peuvent être sous-estimés");
    expect(warnings).toContain("entrées, turnover et absentéisme faussés dans un sens ou dans l'autre");
    expect(warnings).toContain("Cette limite concerne aussi N-1");
    expect(warnings).toContain(ctx.etpQualifiers.at(-1)!);
    expect(r.previous).toMatchObject({ available: false, reason: expect.stringContaining("N-1 en historique PayFit brut") });
    // Même si l'année N est postérieure au cutoff, N−1 porte encore la limite.
    const after = socialReportOf(ctx, { mode: "civil", annee: "2026" });
    expect(after.previous.reason).toContain("historique PayFit brut");
    const noArchive = await context(raw);
    noArchive.kpi.collab.payfitHistory = { mode: "raw", origin: "setting", limit: null };
    const noLimit = socialReportOf(noArchive, {});
    expect(noLimit.limits.join(" ")).toContain("Aucun mois de la lecture n'est antérieur");
    expect(noLimit.previous.reason ?? "").not.toContain("historique PayFit brut");
  });

  it("mois ouverts exclus du défaut ; une année non close garde ses n.d. et ses montants provisoires", async () => {
    const ctx = await context();
    ctx.input = { ...ctx.input!, openMonths: ["2026-09"] };
    ctx.kpi.input = { ...ctx.kpi.input!, openMonths: ["2026-09"] };
    const auto = socialReportOf(ctx, {});
    expect(auto.selection.fin).toBe("2026-08");
    expect(auto.selection.closed).not.toContain("2026-09");
    const r = socialReportOf(ctx, { mode: "civil", annee: "2026" });
    expect(r.window!.months).toEqual(monthRange("2026-01", "2026-12"));
    expect(metric(r, "etp-moyen").current).toMatchObject({ kind: "nd", reason: expect.stringContaining("non clôturée") });
    const open = r.rows.find((row) => row.month === "2026-09")!;
    expect(open.coverage.kind).toBe("nd");
    // Le stock contractuel fin de mois reste celui du moteur existant ; la couverture dit séparément que la paie est ouverte.
    expect(open.etp).toMatchObject(etpTile(etpMonthEnd(ctx.kpi.input!, "2026-09")));
    expect(open.masse).toMatchObject({ kind: "value", cents: 133338, qualifiers: [expect.stringContaining("provisoires")] });
    const future = r.rows.find((row) => row.month === "2026-12")!;
    for (const key of ["coverage", "headcount", "etp", "entries", "exits", "absenteeism", "masse"] as const) expect(future[key].kind).toBe("nd");
    expect(future.headcount.reason).toContain("postérieure à la date de référence");
  });

  it("paramètres workspace invalides refusent RH ; aucune source ni mois clos donne un état explicite", async () => {
    const ctx = await context();
    ctx.kpi.settings.invalid = ["turnoverFormula"];
    const bad = socialReportOf(ctx, {});
    expect(metric(bad, "etp-fin").current).toMatchObject({ kind: "nd", reason: expect.stringContaining("paramètres des KPI illisibles") });
    expect(metric(bad, "masse").current.kind).toBe("value");
    const absent = await context();
    absent.input = null; absent.read = null; absent.kpi.input = null; absent.kpi.collab.data = null; absent.kpi.collab.chosen = null;
    absent.kpi.collab.source.chosen = null;
    expect(socialReportOf(absent, {})).toMatchObject({ kind: "no-period", window: null, metrics: [], rows: [], previous: { available: false } });
  });

  it("absence de journal DSN : aucune masse chargée reconstituée ni provenance PayFit inventée", async () => {
    const ctx = await context(dsnFixtureBuild());
    ctx.source = "dsn"; ctx.kpi.collab.chosen = "dsn"; ctx.input = null; ctx.read = null;
    ctx.kpi.input = { ...ctx.kpi.input!, absences: DSN_ABSENCES };
    const r = socialReportOf(ctx, {});
    expect(r.source).toMatchObject({ kind: "dsn", payrollKind: null, payrollReadAt: null });
    expect(metric(r, "masse").current).toMatchObject({ kind: "nd", reason: expect.stringContaining("non reconstituée") });
  });

  it("réutilise les paramètres workspace et la grille ; signale les comptes hors masse sans publier leurs identifiants", async () => {
    const ctx = await context();
    ctx.kpi.input = { ...ctx.kpi.input!, params: { ...ctx.kpi.input!.params, natures: ["01"], fullTimeIsOne: false,
      turnoverFormula: "exits_over_start", neutralizeContinuity: false, dayBasis: "weekdays", absenceTypes: [] } };
    ctx.input = { ...ctx.input!, lines: [...ctx.input!.lines, line("2026-09", "649000", 500000)] };
    const r = socialReportOf(ctx, {});
    expect(metric(r, "turnover").current).toMatchObject(rateTile(turnover(ctx.kpi.input, r.window!)));
    expect(metric(r, "etp-fin").current).toMatchObject(etpTile(etpMonthEnd(ctx.kpi.input, "2026-09")));
    expect(metric(r, "absenteisme").current).toMatchObject({ kind: "nd", reason: "motifs d'absence non choisis (Paramètres › Définitions des KPI)" });
    expect(metric(r, "masse").current.cents).toBe(1600056);
    expect(r.limits.join(" ")).toContain("hors masse salariale");
  });

  it("raisons et limites publiques : aucun nom, contrat, NIR, absence, ligne, paramètre libre ou détail moteur", async () => {
    const d = await payfitFixtureBuild();
    const person = d.persons[0];
    person.familyName = "NomFictifSecret"; person.givenNames = "PrenomFictifSecret"; person.employeeNumber = "123456789012345";
    const ctx = await context(d);
    ctx.kpi.input = { ...ctx.kpi.input!, absences: { status: "unavailable", nd: { code: "scope-missing", reason: `indisponible pour NomFictifSecret PrenomFictifSecret 123456789012345 ${d.contracts[0].contractKey}` } } };
    ctx.etpQualifiers.push(`absence ABS-SECRET rattachée au contrat CONTRACT-SECRET inconnu du référentiel`, "référence fictive 1 85 05 75 123 456 78");
    ctx.input = { ...ctx.input!, lines: ctx.input!.lines.map((l) => l.month === "2026-09" ? { ...l, debitCents: null } : l) };
    const text = JSON.stringify(socialReportOf(ctx, { fin: "2026-09" }));
    for (const token of ["NomFictifSecret", "PrenomFictifSecret", "123456789012345", "1 85 05 75 123 456 78", d.contracts[0].contractKey, "ABS-SECRET", "CONTRACT-SECRET", "PRIVATE-LEDGER-KEY", "PRIVATE-SYNC", "contributions", "personKey", "contractId"]) expect(text).not.toContain(token);
    expect(text).toContain("ligne comptable du compte");
    expect(text).toContain("détail dans KPI RH");
  });

  it("centimes exacts et garde BigInt : zéro confirmé distinct de n.d., aucun dépassement d'entiers sûrs publié", async () => {
    const ctx = await context();
    ctx.input = { ...ctx.input!, lines: ctx.input!.lines.map((l) => ({ ...l, debitCents: 0 })) };
    const zero = socialReportOf(ctx, {});
    expect(metric(zero, "masse").current).toMatchObject({ kind: "value", cents: 0 });
    const exactCents = 1_234_567_890_123_456;
    ctx.input = { ...ctx.input!, lines: [line("2026-09", "641100", exactCents)] };
    const precise = socialReportOf(ctx, {});
    const row = precise.rows.at(-1)!;
    expect(row.masse).toMatchObject({ kind: "value", cents: exactCents });
    expect(flat(row.masse.text)).toBe("12 345 678 901 234,56 €");
    ctx.input = { ...ctx.input!, lines: [line("2026-09", "641100", Number.MAX_SAFE_INTEGER), line("2026-09", "645100", 100)] };
    const overflow = socialReportOf(ctx, {}).rows.at(-1)!.masse;
    expect(overflow).toMatchObject({ kind: "nd", reason: expect.stringContaining("capacité de calcul sûre") });
    expect(overflow).not.toHaveProperty("cents");
    ctx.input = { ...ctx.input!, lines: [line("2026-09", "641100", Number.MAX_SAFE_INTEGER)] };
    // Même un entier sûr ne doit pas perdre son dernier centime dans le formateur partagé (division Number par 100).
    expect(socialReportOf(ctx, {}).rows.at(-1)!.masse.kind).toBe("nd");
  });
});
