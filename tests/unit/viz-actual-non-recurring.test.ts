import { describe, expect, it } from "vitest";
import { buildActualNonRecurringChart } from "@/lib/viz/actual-non-recurring";
import { buildActualNonRecurring, type ActualEvent } from "@/lib/payroll/non-recurring";
import { windowPayroll, type JournalInput } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { estimateActualOverlap } from "@/lib/payroll/actual-overlap";

const SYNC = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const months = ["2026-01", "2026-02", "2026-03"];
const journal = (): JournalInput => ({ months, openMonths: [], grid: structuredClone(DEFAULT_PREFIXES), lines: months.flatMap((month) => [
  { key: `LIGNE_SOURCE_PRIVEE_${month}`, month, accountId: "6411", accountName: "LIBELLE_COMPTE_PRIVE", debitCents: 100000, creditCents: 0, contractId: "CONTRAT_SOURCE_PRIVE" },
  { key: `COTISATION_SOURCE_PRIVEE_${month}`, month, accountId: "6451", accountName: null, debitCents: 40000, creditCents: 0, contractId: "CONTRAT_SOURCE_PRIVE" },
]) });
const event = (patch: Partial<ActualEvent> = {}): ActualEvent => ({ id: id(1), syncId: SYNC, month: "2026-01", kind: "rupture-conventionnelle", chargedCents: 12345, contractKeys: ["CONTRAT_IDENTIFICATION_PRIVE"], note: "NOTE_SOURCE_PRIVEE", ...patch });

describe("Graphique des non récurrents — agrégats fictifs du modèle existant", () => {
  it("montre les coûts identifiés par mois et nature sans les ajouter au réel ni modifier ses entrées", () => {
    const input = journal();
    const events = [event(), event({ id: id(2), month: "2026-02", kind: "tuilage", contractKeys: ["ENTRANT_PRIVE", "SORTANT_PRIVE"], chargedCents: 23456 }), event({ id: id(3), month: "2026-02", kind: "autre", chargedCents: 1000 })];
    const before = JSON.stringify([input, events]);
    const raw = windowPayroll(input, months);
    const result = buildActualNonRecurringChart(input, events, months, SYNC);
    expect(result.points).toEqual([
      { month: "2026-01", amount: 12345, count: 1, reason: null },
      { month: "2026-02", amount: 24456, count: 2, reason: null },
      { month: "2026-03", amount: 0, count: 0, reason: null },
    ]);
    expect(result.rows.map(({ month, label, amount }) => [month, label, amount])).toEqual([["2026-01", "Ruptures conventionnelles", 12345], ["2026-02", "Tuilages passés", 23456], ["2026-02", "Autres éléments non récurrents", 1000]]);
    expect(result.total).toBe(36801);
    expect(result.total).toBe(buildActualNonRecurring(input, events, months, SYNC).nonRecurring);
    expect(result.count).toBe(3);
    expect(windowPayroll(input, months)).toEqual(raw);
    expect(raw).toMatchObject({ kind: "value", masse: 420000 });
    expect(JSON.stringify([input, events])).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/CONTRAT|ENTRANT_PRIVE|SORTANT_PRIVE|NOTE_SOURCE_PRIVEE|LIGNE_SOURCE_PRIVEE|LIBELLE_COMPTE_PRIVE|11111111|00000000/);
  });

  it("zéro coût identifié reste qualifié non exhaustif et ne devient pas une absence prouvée", () => {
    const result = buildActualNonRecurringChart(journal(), [], months, SYNC);
    expect(result.points.every((point) => point.amount === 0 && point.count === 0)).toBe(true);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.qualification).toContain("Liste non exhaustive");
    expect(result.qualification).toContain("0 signifie aucun coût identifié");
    expect(result.qualification).toContain("à ne pas ajouter");
  });

  it("un montant inconnu bloque seulement le mois concerné et le total, jamais remplacé par zéro ou un cumul partiel", () => {
    const result = buildActualNonRecurringChart(journal(), [event({ chargedCents: null }), event({ id: id(2), month: "2026-02", kind: "licenciement", chargedCents: 5000 })], months, SYNC);
    expect(result.points[0]).toMatchObject({ amount: null, count: 1, reason: expect.stringContaining("Montant chargé non saisi") });
    expect(result.points[1]).toMatchObject({ amount: 5000, reason: null });
    expect(result.points[2]).toMatchObject({ amount: 0, count: 0 });
    expect(result.total).toBeNull();
    expect(result.rows[0].amount).toBeNull();
  });

  it("une ancienne lecture n’est pas validée par le graphique, même avec un journal identique", () => {
    const result = buildActualNonRecurringChart(journal(), [event({ syncId: OLD }), event({ id: id(2), month: "2026-02", chargedCents: 5000 })], months, SYNC);
    expect(result.points[0]).toMatchObject({ amount: null, reason: expect.stringContaining("autre lecture de paie") });
    expect(result.points[1].amount).toBe(5000);
    expect(result.total).toBeNull();
    expect(result.rows[0].amount).toBeNull();
    expect(JSON.stringify(result)).not.toContain(OLD);
  });

  it("qualifie une estimation de tuilage existante sans exporter sa provenance individuelle", () => {
    const estimated = estimateActualOverlap({ month: "2026-02", syncId: SYNC,
      incoming: { contractKey: "ENTRANT_PRIVE", syncId: SYNC, startDate: "2026-02-11", endDate: null },
      outgoing: { contractKey: "SORTANT_PRIVE", syncId: SYNC, startDate: "2020-01-01", endDate: "2026-02-20" },
      payroll: { month: "2026-02", syncId: SYNC, contractKey: "ENTRANT_PRIVE", chargedCents: 18000, lineKeys: ["LIGNE_PROVENANCE_PRIVEE"] } });
    if (estimated.kind !== "value") throw new Error("Estimation fictive refusée");
    const result = buildActualNonRecurringChart(journal(), [event({ month: "2026-02", kind: "tuilage", contractKeys: ["ENTRANT_PRIVE", "SORTANT_PRIVE"], chargedCents: estimated.amountCents, calculation: estimated.calculation })], months, SYNC);
    expect(result.rows).toEqual([{ month: "2026-02", kind: "tuilage", label: "Tuilages passés", amount: 10000, count: 1, estimatedCount: 1, reason: null }]);
    expect(result.qualification).toContain("estimations calendaires");
    expect(JSON.stringify(result)).not.toMatch(/ENTRANT_PRIVE|SORTANT_PRIVE|LIGNE_PROVENANCE_PRIVEE|2026-02-11|2026-02-20|2020-01-01/);
  });

  it("les doublons d’identifiant entre deux mois restent bloqués par le modèle de toute la période", () => {
    const result = buildActualNonRecurringChart(journal(), [event(), event({ month: "2026-02" })], months, SYNC);
    expect(result.points.slice(0, 2).every((point) => point.amount === null && point.reason?.includes("doublon"))).toBe(true);
    expect(result.total).toBeNull();
    expect(result.rows.every((row) => row.amount === null)).toBe(true);
  });

  it("une identification invalide ne transmet aucun champ libre au graphique", () => {
    const invalid = { ...event(), chargedCents: "MONTANT_PRIVE_INVALIDE", note: "NOTE_PRIVEE_INVALIDE", contractKeys: ["CONTRAT_PRIVE_INVALIDE"] } as unknown as ActualEvent;
    const result = buildActualNonRecurringChart(journal(), [invalid], months, SYNC);
    expect(result.points[0]).toMatchObject({ amount: null, reason: "Événement réalisé invalide." });
    expect(result.total).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/MONTANT_PRIVE_INVALIDE|NOTE_PRIVEE_INVALIDE|CONTRAT_PRIVE_INVALIDE/);
  });

  it("les raisons du journal sont agrégées sans divulguer les références individuelles des lignes", () => {
    const input = journal();
    input.lines[0] = { ...input.lines[0], debitCents: null, creditCents: null };
    const result = buildActualNonRecurringChart(input, [], months, SYNC);
    expect(result.reasons).toContain("Journal de paie réel indisponible ou incomplet pour la période.");
    expect(JSON.stringify(result)).not.toContain("LIGNE_SOURCE_PRIVEE");
  });

  it("une période invalide n’invente aucune catégorie ou ligne affichable", () => {
    for (const range of [[], ["2026-01", "2026-01"], ["2026-13"]]) {
      const result = buildActualNonRecurringChart(journal(), [event()], range, SYNC);
      expect(result.points).toEqual([]);
      expect(result.rows).toEqual([]);
      expect(result.total).toBeNull();
    }
  });
});
