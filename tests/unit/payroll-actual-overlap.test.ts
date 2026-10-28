import { describe, expect, it } from "vitest";
import { actualOverlapFromJournal, estimateActualOverlap, type ActualOverlapInput } from "@/lib/payroll/actual-overlap";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

const SYNC = "00000000-0000-4000-8000-000000000001";
const OLD = "00000000-0000-4000-8000-000000000002";
const fixture = (): ActualOverlapInput => ({
  month: "2026-09", syncId: SYNC,
  incoming: { contractKey: "payfit:entrant-fictif", syncId: SYNC, startDate: "2026-09-11", endDate: null },
  outgoing: { contractKey: "payfit:sortant-fictif", syncId: SYNC, startDate: "2020-01-01", endDate: "2026-09-20" },
  payroll: { syncId: SYNC, month: "2026-09", contractKey: "payfit:entrant-fictif", chargedCents: 280_000, lineKeys: ["2026-09#salaire-fictif", "2026-09#charges-fictives"] },
});

const journalFixture = () => {
  const f = fixture();
  const line = (key: string, accountId: string, debitCents: number, contractId = "entrant-fictif"): LedgerLine => ({ key, month: f.month, accountId, accountName: null, debitCents, creditCents: 0, contractId });
  const input: JournalInput = { months: [f.month], openMonths: [], grid: DEFAULT_PREFIXES, lines: [
    line("salaire-fictif", "6411", 200_000), line("prime-fictive", "6413", 20_000), line("indemnite-fictive", "6414", 10_000),
    line("cotisation-fictive", "6451", 60_000), line("taxe-fictive", "6311", 10_000),
    line("sortant-salaire-fictif", "6411", 400_000, "sortant-fictif"), line("sortant-cotisations-fictives", "6451", 160_000, "sortant-fictif"),
    line("provision-fictive", "6412", 99_999), line("contrepartie-fictive", "421", 99_999),
  ] };
  return { input, month: f.month, syncId: SYNC, incoming: { ...f.incoming, externalId: "entrant-fictif" }, outgoing: { ...f.outgoing, externalId: "sortant-fictif" } };
};

describe("raccord pur au journal complet de l’entrant", () => {
  it("inclut salaire, primes, indemnités, charges et taxes classées ; exclut provisions, contreparties et paie du sortant", () => {
    const source = journalFixture(), before = JSON.stringify(source);
    const result = actualOverlapFromJournal(source);
    expect(result).toMatchObject({ kind: "value", amountCents: 150_000, source: { chargedCents: 300_000 }, calculation: { basis: "calendar-estimate", incoming: { contractKey: source.incoming.contractKey }, outgoing: { contractKey: source.outgoing.contractKey } } });
    expect(result.source?.lineKeys).toEqual(["cotisation-fictive", "indemnite-fictive", "prime-fictive", "salaire-fictif", "taxe-fictive"]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("refuse un mois hors lecture, absent, ouvert ou filtré, sans coût partiel", () => {
    const absent = journalFixture(); absent.input.months = [];
    expect(actualOverlapFromJournal(absent).code).toBe("month-not-read");
    const empty = journalFixture(); empty.input.lines = [];
    expect(actualOverlapFromJournal(empty).code).toBe("no-journal");
    const open = journalFixture(); open.input.openMonths = [open.month];
    expect(actualOverlapFromJournal(open).code).toBe("month-open");
    const filtered = journalFixture(); filtered.input.serviceFilter = { value: "SERVICE_FICTIF" };
    expect(actualOverlapFromJournal(filtered).code).toBe("service-filter");
    expect(actualOverlapFromJournal({ ...journalFixture(), input: null }).code).toBe("journal-unavailable");
  });

  it("ne suppose pas zéro cotisation et refuse les lignes non attribuées, non classées ou sans montant", () => {
    const noCharges = journalFixture(); noCharges.input.lines = noCharges.input.lines.filter((line) => line.contractId !== "entrant-fictif" || !/^(645|63)/.test(line.accountId));
    expect(actualOverlapFromJournal(noCharges).code).toBe("contributions-missing");
    const unassigned = journalFixture(); unassigned.input.lines[3].contractId = null;
    expect(actualOverlapFromJournal(unassigned).code).toBe("unassigned-lines");
    const unclassified = journalFixture(); unclassified.input.lines[3].accountId = "6499";
    expect(actualOverlapFromJournal(unclassified).code).toBe("unclassified-lines");
    const missing = journalFixture(); missing.input.lines[3].debitCents = missing.input.lines[3].creditCents = null;
    expect(actualOverlapFromJournal(missing).code).toBe("amount-missing");
    const explicitZero = journalFixture(); explicitZero.input.lines[3].debitCents = explicitZero.input.lines[4].debitCents = 0;
    expect(actualOverlapFromJournal(explicitZero)).toMatchObject({ kind: "value", source: { chargedCents: 230_000 }, amountCents: 115_000 });
  });

  it("garde les crédits/régularisations dans le solde source et refuse le coût négatif, les doublons et dépassements", () => {
    const credit = journalFixture(); credit.input.lines[1].creditCents = 10_000;
    expect(actualOverlapFromJournal(credit)).toMatchObject({ kind: "value", source: { chargedCents: 290_000 }, amountCents: 145_000 });
    const duplicate = journalFixture(); duplicate.input.lines.push({ ...duplicate.input.lines[0] });
    expect(actualOverlapFromJournal(duplicate).code).toBe("duplicate-lines");
    const unsafe = journalFixture(); unsafe.input.lines[0].debitCents = Number.MAX_SAFE_INTEGER;
    expect(actualOverlapFromJournal(unsafe).code).toBe("unsafe-result");
    const negative = journalFixture(); negative.input.lines[0].creditCents = 400_000;
    expect(actualOverlapFromJournal(negative).code).toBe("negative-cost");
  });
});

describe("tuilage passé : attribution calendaire explicite du coût de l’entrant", () => {
  it("proratise le coût déjà versé sur les jours de présence, sans double prorata ni coût du sortant", () => {
    // Entrant payé 20 jours ; 10 jours de chevauchement : 2 800 × 10/20 = 1 400 EUR, pas 2 800 × 10/30.
    const result = estimateActualOverlap(fixture());
    expect(result).toMatchObject({ kind: "value", amountCents: 140_000, basis: "calendar-estimate", method: "calendar-prorata",
      days: { incomingPresence: 20, overlap: 10 }, interval: { from: "2026-09-11", to: "2026-09-20" } });
    expect(result.source?.chargedCents).toBe(280_000);
    expect(result.warnings.join(" ")).toContain("primes et régularisations");
  });

  it("reprend le coût mensuel entier quand toute la présence de l’entrant est en chevauchement, sans revendiquer une paie journalière exacte", () => {
    const input = fixture(); input.outgoing.endDate = "2026-10-10";
    const result = estimateActualOverlap(input);
    expect(result).toMatchObject({ kind: "value", amountCents: 280_000, method: "whole-month", basis: "calendar-estimate", days: { incomingPresence: 20, overlap: 20 } });
    expect(result.warnings.join(" ")).toContain("ne prouve pas une période de rémunération exacte");
  });

  it("respecte la fin de l’entrant, les bornes inclusives et le février bissextile", () => {
    const input = fixture(); input.month = input.payroll.month = "2024-02";
    input.incoming.startDate = "2024-02-20"; input.incoming.endDate = "2024-02-29";
    input.outgoing.endDate = "2024-02-20"; input.payroll.chargedCents = 10_000;
    expect(estimateActualOverlap(input)).toMatchObject({ amountCents: 1_000, days: { incomingPresence: 10, overlap: 1 }, interval: { from: "2024-02-20", to: "2024-02-20" } });
  });

  it("borne le chevauchement au mois demandé et au début du sortant", () => {
    const input = fixture(); input.incoming.startDate = "2026-08-10"; input.incoming.endDate = "2026-10-05";
    input.outgoing.startDate = "2026-09-25"; input.outgoing.endDate = "2026-10-10"; input.payroll.chargedCents = 300_000;
    expect(estimateActualOverlap(input)).toMatchObject({ amountCents: 60_000, days: { incomingPresence: 30, overlap: 6 }, interval: { from: "2026-09-25", to: "2026-09-30" } });
  });

  it("affiche zéro seulement pour une absence de chevauchement démontrée ou un coût source explicitement nul", () => {
    const input = fixture(); input.outgoing.endDate = "2026-09-10";
    expect(estimateActualOverlap(input)).toMatchObject({ kind: "value", amountCents: 0, method: "no-overlap", days: { incomingPresence: 20, overlap: 0 }, interval: null });
    input.outgoing.endDate = "2026-09-20"; input.payroll.chargedCents = 0;
    expect(estimateActualOverlap(input)).toMatchObject({ kind: "value", amountCents: 0, method: "calendar-prorata" });
    input.payroll.chargedCents = null;
    expect(estimateActualOverlap(input)).toMatchObject({ kind: "nd", amountCents: null, code: "amount-missing" });
  });

  it("réemploie l’arrondi du moteur : un demi-centime est arrondi à l’écart de zéro", () => {
    const input = fixture(); input.payroll.chargedCents = 1;
    expect(estimateActualOverlap(input)).toMatchObject({ amountCents: 1, days: { incomingPresence: 20, overlap: 10 } });
    input.payroll.chargedCents = 5;
    expect(estimateActualOverlap(input).amountCents).toBe(3);
  });

  it("conserve les fractions et produits exacts avant l’unique arrondi, même près de la limite des entiers sûrs", () => {
    const input = fixture(); input.payroll.chargedCents = Number.MAX_SAFE_INTEGER;
    expect(estimateActualOverlap(input).amountCents).toBe(4_503_599_627_370_496);
    input.outgoing.endDate = "2026-09-30";
    expect(estimateActualOverlap(input).amountCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuse les dates absentes nécessaires et les intervalles inversés, sans durée implicite", () => {
    for (const [side, field, code] of [["incoming", "startDate", "incoming-start-missing"], ["outgoing", "startDate", "outgoing-start-missing"], ["outgoing", "endDate", "outgoing-end-missing"]] as const) {
      const input = fixture(); input[side][field] = null;
      expect(estimateActualOverlap(input)).toMatchObject({ kind: "nd", amountCents: null, code });
    }
    const reversed = fixture(); reversed.incoming.endDate = "2026-09-10";
    expect(estimateActualOverlap(reversed).code).toBe("invalid-contract-dates");
    const out = fixture(); out.outgoing.startDate = "2026-10-01";
    expect(estimateActualOverlap(out).code).toBe("invalid-contract-dates");
  });

  it("refuse une paie hors présence contractuelle plutôt que de diviser par zéro ou d’attribuer un rappel", () => {
    const input = fixture(); input.incoming.startDate = "2026-10-01";
    expect(estimateActualOverlap(input)).toMatchObject({ kind: "nd", amountCents: null, code: "incoming-not-present" });
  });

  it("exige la même lecture pour les deux contrats et la paie, ainsi que le mois et le contrat entrant exacts", () => {
    for (const source of ["incoming", "outgoing", "payroll"] as const) {
      const input = fixture(); input[source].syncId = OLD;
      expect(estimateActualOverlap(input).code).toBe("sync-mismatch");
    }
    const month = fixture(); month.payroll.month = "2026-08";
    expect(estimateActualOverlap(month).code).toBe("payroll-month-mismatch");
    const wrongRole = fixture(); wrongRole.payroll.contractKey = wrongRole.outgoing.contractKey;
    expect(estimateActualOverlap(wrongRole).code).toBe("payroll-contract-mismatch");
    const same = fixture(); same.outgoing.contractKey = same.incoming.contractKey;
    expect(estimateActualOverlap(same).code).toBe("same-contract");
    const duplicate = fixture(); duplicate.payroll.lineKeys.push(duplicate.payroll.lineKeys[0]);
    expect(estimateActualOverlap(duplicate).code).toBe("duplicate-lines");
  });

  it("valide strictement les dates ISO, mois, identifiants, références de lignes et centimes", () => {
    const invalid: unknown[] = [null, {}, { ...fixture(), month: "2026-13" }, { ...fixture(), syncId: "lecture-inconnue" }];
    for (const date of ["2026-02-30", "2026-9-11", "2026-09-11T00:00:00Z", " 2026-09-11"]) {
      const input = fixture(); input.incoming.startDate = date; invalid.push(input);
    }
    for (const cents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      const input = fixture(); (input.payroll as Record<string, unknown>).chargedCents = cents; invalid.push(input);
    }
    const noLines = fixture(); noLines.payroll.lineKeys = []; invalid.push(noLines);
    const blank = fixture(); blank.incoming.contractKey = " "; invalid.push(blank);
    for (const input of invalid) expect(estimateActualOverlap(input as ActualOverlapInput)).toMatchObject({ kind: "nd", code: "invalid-input", amountCents: null });
  });

  it("ne modifie aucune entrée et détache les références source retournées", () => {
    const input = fixture(), before = JSON.stringify(input);
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
    freeze(input);
    const result = estimateActualOverlap(input);
    expect(result.source).not.toBe(input.payroll); expect(result.source?.lineKeys).not.toBe(input.payroll.lineKeys);
    result.source?.lineKeys.push("autre-reference-fictive");
    expect(JSON.stringify(input)).toBe(before);
    expect(estimateActualOverlap(input).amountCents).toBe(140_000);
  });
});
