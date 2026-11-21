import { describe, expect, it } from "vitest";
import { bankStart, buildBankLedger, businessDaysBetween, continuityOf, dedupKey, type AccountRecord, type MovementRecord, type StatementRecord } from "@/lib/bank/ledger";
import { occurrenceRanks, type BankMovement } from "@/lib/bank/model";

const mv = (bookingDate: string, amountCents: number, label: string): BankMovement => ({ bookingDate, valueDate: null, amountCents, label, counterparty: null, reference: null });
const acc = (accountKey: string): AccountRecord => ({ accountKey, masked: `FR76 … ${accountKey}`, identifierKind: "iban", bank: null });
const st = (accountKey: string, from: string, to: string, closing: number | null, filename = `${from}.xml`): StatementRecord => ({
  accountKey, filename, format: "camt053", from, to, opening: null, closing: closing === null ? null : { date: to, cents: closing }, movementCount: 0, netCents: 0, continuity: { kind: "ok" },
});
function records(accountKey: string, ms: BankMovement[], filename: string): MovementRecord[] {
  const ranks = occurrenceRanks(ms);
  return ms.map((m, k) => ({ key: dedupKey(accountKey, m, ranks[k]), accountKey, ...m, filename }));
}

describe("continuité des soldes", () => {
  it("cas de référence : 1 000,00 + 250,00 − 40,10 = 1 209,90", () => {
    const movements = [mv("2026-02-01", 25000, "A"), mv("2026-02-02", -4010, "B")];
    const base = { opening: { date: "2026-02-01", cents: 100000 }, movements, rowBreaks: null };
    expect(continuityOf({ ...base, closing: { date: "2026-02-02", cents: 120990 } }, "camt053")).toEqual({ kind: "ok" });
    expect(continuityOf({ ...base, closing: { date: "2026-02-02", cents: 121000 } }, "camt053")).toEqual({ kind: "gap", gapCents: 10 });
    expect(continuityOf({ ...base, opening: null, closing: { date: "2026-02-02", cents: 1 } }, "ofx")).toMatchObject({ kind: "nd", reason: expect.stringMatching(/OFX/) });
    expect(continuityOf({ ...base, rowBreaks: [{ line: 3, gapCents: -1000 }], closing: null }, "csv")).toEqual({ kind: "gap", gapCents: -1000 });
  });
});

describe("dédoublonnage", () => {
  it("deux relevés qui se chevauchent : 0 doublon, mouvements identiques le même jour conservés", () => {
    // Relevé 1 : 1er au 15 ; relevé 2 : 10 au 31. Les 10 et 12 figurent dans les deux. Le 12, deux prélèvements identiques.
    const r1 = [mv("2026-01-05", -100, "LOYER"), mv("2026-01-10", 500, "CLIENT"), mv("2026-01-12", -20, "FRAIS"), mv("2026-01-12", -20, "FRAIS")];
    const r2 = [mv("2026-01-10", 500, "Client"), mv("2026-01-12", -20, "FRAIS"), mv("2026-01-12", -20, "FRAIS"), mv("2026-01-20", -300, "URSSAF")];
    const ledger = buildBankLedger([acc("K1")], [st("K1", "2026-01-01", "2026-01-15", null), st("K1", "2026-01-10", "2026-01-31", null)], [...records("K1", r1, "a"), ...records("K1", r2, "b")]);
    expect(ledger[0].duplicates).toBe(3);
    expect(ledger[0].movements.map((m) => [m.bookingDate, m.amountCents])).toEqual([["2026-01-05", -100], ["2026-01-10", 500], ["2026-01-12", -20], ["2026-01-12", -20], ["2026-01-20", -300]]);
    expect(ledger[0].movements.reduce((t, m) => t + m.amountCents, 0)).toBe(60);
  });
  it("la clé dépend du compte : deux comptes ne se dédoublonnent pas entre eux", () => {
    expect(dedupKey("K1", mv("2026-01-05", -100, "X"), 1)).not.toBe(dedupKey("K2", mv("2026-01-05", -100, "X"), 1));
    expect(dedupKey("K1", mv("2026-01-05", -100, "X"), 1)).not.toBe(dedupKey("K1", mv("2026-01-05", -100, "X"), 2));
  });
});

describe("contrôles par compte", () => {
  it("jours ouvrés entre deux dates (bornes exclues)", () => {
    expect(businessDaysBetween("2026-01-30", "2026-02-02")).toBe(0); // vendredi → lundi
    expect(businessDaysBetween("2026-01-31", "2026-02-09")).toBe(5);
    expect(businessDaysBetween("2026-01-31", "2026-02-10")).toBe(6);
  });
  it("trou de plus de 5 jours ouvrés et historique de moins de 6 mois signalés", () => {
    const l = buildBankLedger([acc("K1")], [st("K1", "2026-01-01", "2026-01-31", 1), st("K1", "2026-02-10", "2026-02-28", 2)], [])[0];
    expect(l.gaps).toEqual([{ after: "2026-01-31", before: "2026-02-10", businessDays: 6 }]);
    expect(l.historyOk).toBe(false);
    expect(l.warnings.join(" ")).toMatch(/Trou de 6 jours ouvrés/);
    expect(l.lastClosing).toEqual({ date: "2026-02-28", cents: 2 });
  });
  it("6 mois pleins : historique suffisant", () => {
    const l = buildBankLedger([acc("K1")], [st("K1", "2025-09-01", "2026-02-28", 1)], [])[0];
    expect(l.historyOk).toBe(true);
    expect(buildBankLedger([acc("K1")], [st("K1", "2025-09-02", "2026-02-28", 1)], [])[0].historyOk).toBe(false);
  });
});

describe("solde de départ lu dans les relevés", () => {
  it("cas de référence : deux comptes, 12 000,00 € au 31/03 et −1 500,50 € au 30/03 → 10 499,50 € au 31/03", () => {
    const ledger = buildBankLedger([acc("K1"), acc("K2")], [st("K1", "2026-03-01", "2026-03-31", 1_200_000), st("K2", "2026-03-01", "2026-03-30", -150_050)], []);
    expect(bankStart(ledger)).toEqual({ kind: "value", date: "2026-03-31", cents: 1_049_950, accounts: [{ masked: "FR76 … K1", date: "2026-03-31", cents: 1_200_000 }, { masked: "FR76 … K2", date: "2026-03-30", cents: -150_050 }] });
  });
  it("compte au dernier solde de plus de 3 jours : n.d., solde du jour à saisir", () => {
    const ledger = buildBankLedger([acc("K1"), acc("K2")], [st("K1", "2026-03-01", "2026-03-31", 1), st("K2", "2026-03-01", "2026-03-27", 1)], []);
    expect(bankStart(ledger)).toMatchObject({ kind: "nd", reason: expect.stringMatching(/K2.*plus de 3 jours.*Saisis le solde du jour/) });
  });
  it("compte sans solde de clôture (OFX sans LEDGERBAL, CSV sans solde) : n.d., jamais zéro", () => {
    const ledger = buildBankLedger([acc("K1"), acc("K2")], [st("K1", "2026-03-01", "2026-03-31", 1), st("K2", "2026-03-01", "2026-03-31", null)], []);
    expect(bankStart(ledger)).toMatchObject({ kind: "nd", reason: expect.stringMatching(/K2 : aucun solde de clôture/) });
    expect(bankStart([])).toMatchObject({ kind: "nd" });
  });
  it("borne de date : seuls les soldes antérieurs ou égaux comptent", () => {
    const ledger = buildBankLedger([acc("K1")], [st("K1", "2026-02-01", "2026-02-28", 700), st("K1", "2026-03-01", "2026-03-31", 900)], []);
    expect(bankStart(ledger, "2026-03-15")).toMatchObject({ kind: "value", date: "2026-02-28", cents: 700 });
  });
});
