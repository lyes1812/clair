import { describe, expect, it } from "vitest";
import { buildActualNonRecurring, parseActualEvent, type ActualEvent } from "@/lib/payroll/non-recurring";
import { windowPayroll, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";

const SYNC = "00000000-0000-4000-8000-000000000001";
const OLD_SYNC = "00000000-0000-4000-8000-000000000002";
const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const event = (over: Partial<ActualEvent> = {}): ActualEvent => ({ id: id(1), syncId: SYNC, month: "2026-09", kind: "licenciement", chargedCents: 10_000, contractKeys: ["payfit:contrat-fictif"], note: "Saisie fictive", ...over });
const line = (month: string, accountId: string, debitCents: number | null, creditCents: number | null, extra: Partial<LedgerLine> = {}): LedgerLine => ({ key: `fictif-${accountId}-${month}`, month, accountId, accountName: null, debitCents, creditCents, contractId: "contrat-fictif", ...extra });
const journal = (): JournalInput => ({
  months: ["2026-06", "2026-09"], openMonths: [], grid: DEFAULT_PREFIXES,
  lines: [line("2026-06", "641000", 100_000, 0), line("2026-06", "645000", 30_000, 0),
    line("2026-09", "641000", 120_000, 0), line("2026-09", "645000", 40_000, 0), line("2026-09", "641400", 20_000, 0),
    line("2026-09", "641200", 50_000, 0), line("2026-09", "421000", 0, 999_999)],
});

describe("saisie stricte d’un élément non récurrent réalisé", () => {
  it("admet les quatre catégories et les montants nuls ou non saisis, sans les confondre", () => {
    for (const kind of ["licenciement", "rupture-conventionnelle", "tuilage", "autre"] as const) {
      const input = event({ kind, contractKeys: kind === "tuilage" ? ["payfit:fictif-a", "payfit:fictif-b"] : [], chargedCents: 0 });
      expect(parseActualEvent(input)).toEqual(input);
    }
    expect(parseActualEvent(event({ chargedCents: null }))!.chargedCents).toBeNull();
    expect(parseActualEvent(event({ chargedCents: 100_000_000_000_000 }))!.chargedCents).toBe(100_000_000_000_000);
  });

  it("refuse les types, champs supplémentaires, identifiants, mois, notes et montants invalides", () => {
    const invalid = [
      { ...event(), extra: true }, { ...event(), id: "non-uuid" }, { ...event(), syncId: "non-uuid" },
      { ...event(), month: "2026-13" }, { ...event(), month: "septembre" }, { ...event(), kind: "rc" },
      { ...event(), chargedCents: -1 }, { ...event(), chargedCents: 0.5 }, { ...event(), chargedCents: "100" },
      { ...event(), chargedCents: 100_000_000_000_001 }, { ...event(), chargedCents: Infinity },
      { ...event(), note: "x".repeat(301) }, { ...event(), note: null }, { ...event(), contractKeys: [""] },
      { ...event(), contractKeys: ["  "] }, { ...event(), contractKeys: [" payfit:fictif"] }, { ...event(), contractKeys: ["x".repeat(301)] },
      null, [], {},
    ];
    expect(invalid.map(parseActualEvent)).toEqual(invalid.map(() => null));
  });

  it("exige deux contrats distincts pour un tuilage et au plus un pour les autres catégories", () => {
    expect(parseActualEvent(event({ kind: "tuilage", contractKeys: [] }))).toBeNull();
    expect(parseActualEvent(event({ kind: "tuilage", contractKeys: ["fictif-a"] }))).toBeNull();
    expect(parseActualEvent(event({ kind: "tuilage", contractKeys: ["fictif-a", "fictif-a"] }))).toBeNull();
    expect(parseActualEvent(event({ kind: "tuilage", contractKeys: ["fictif-a", "fictif-b", "fictif-c"] }))).toBeNull();
    expect(parseActualEvent(event({ contractKeys: ["fictif-a", "fictif-b"] }))).toBeNull();
    expect(parseActualEvent(event({ contractKeys: ["fictif-a"] }))).not.toBeNull();
  });
});

describe("réel source et retraitement séparés", () => {
  it("garde les indemnités 6414 dans le réel et retire uniquement les montants manuellement désignés", () => {
    const input = journal(), selected = ["2026-06", "2026-09"];
    const events = [event(), event({ id: id(2), kind: "tuilage", month: "2026-06", chargedCents: 15_000, contractKeys: ["fictif-a", "fictif-b"] })];
    const before = windowPayroll(input, selected);
    expect(before).toMatchObject({ kind: "value", masse: 310_000 });
    expect(buildActualNonRecurring(input, events, selected, SYNC)).toEqual({
      rows: events.map((event) => ({ event, amount: event.chargedCents, reason: null })),
      raw: 310_000, nonRecurring: 25_000, adjusted: 285_000, reasons: [],
    });
    expect(windowPayroll(input, selected)).toEqual(before);
  });

  it("filtre les événements par mois sans montant de tuilage automatique ni prorata du binôme", () => {
    const input = journal();
    const sep = event({ kind: "tuilage", chargedCents: null, contractKeys: ["fictif-a", "fictif-b"] });
    const june = event({ id: id(2), month: "2026-06", chargedCents: 15_000 });
    const result = buildActualNonRecurring(input, [sep, june], ["2026-09"], SYNC);
    expect(result.rows).toEqual([{ event: sep, amount: null, reason: expect.stringContaining("Montant chargé non saisi") }]);
    expect(result.raw).toBe(180_000); expect(result.nonRecurring).toBeNull(); expect(result.adjusted).toBeNull();
    const empty = buildActualNonRecurring(input, [june], ["2026-09"], SYNC);
    expect(empty.rows).toEqual([]); expect(empty.nonRecurring).toBe(0); expect(empty.adjusted).toBe(180_000);
  });

  it("un zéro explicite reste calculable ; un seul montant absent interdit tout total partiel", () => {
    const a = event({ chargedCents: 0 });
    expect(buildActualNonRecurring(journal(), [a], ["2026-09"], SYNC)).toMatchObject({ nonRecurring: 0, adjusted: 180_000, rows: [{ amount: 0, reason: null }] });
    const b = event({ id: id(2), kind: "rupture-conventionnelle", chargedCents: null });
    const result = buildActualNonRecurring(journal(), [event(), b], ["2026-09"], SYNC);
    expect(result.rows.map((row) => row.amount)).toEqual([10_000, null]);
    expect(result.raw).toBe(180_000); expect(result.nonRecurring).toBeNull(); expect(result.adjusted).toBeNull();
  });

  it("ne reporte pas une saisie sur une nouvelle lecture, même si les lignes de paie sont identiques", () => {
    const prior = event({ syncId: OLD_SYNC }), current = event({ id: id(2), kind: "autre" });
    const result = buildActualNonRecurring(journal(), [prior, current], ["2026-09"], SYNC);
    expect(result.rows[0]).toMatchObject({ amount: null, reason: expect.stringContaining("autre lecture de paie") });
    expect(result.rows[1].amount).toBe(10_000);
    expect(result.raw).toBe(180_000); expect(result.nonRecurring).toBeNull(); expect(result.adjusted).toBeNull();
    expect(buildActualNonRecurring(journal(), [current], ["2026-09"], null).nonRecurring).toBeNull();
  });

  it("refuse les identifiants dupliqués et les mêmes catégorie/mois/contrats, quel que soit l’ordre du binôme", () => {
    const duplicateId = [event(), event({ kind: "autre" })];
    const duplicatePair = [event({ kind: "tuilage", contractKeys: ["a", "b"] }), event({ id: id(2), kind: "tuilage", contractKeys: ["b", "a"] })];
    for (const events of [duplicateId, duplicatePair]) {
      const result = buildActualNonRecurring(journal(), events, ["2026-09"], SYNC);
      expect(result.raw).toBe(180_000); expect(result.nonRecurring).toBeNull(); expect(result.adjusted).toBeNull();
      expect(result.rows.every((row) => row.amount === null)).toBe(true); expect(result.reasons.join(" ")).toContain("doublon");
    }
    const separate = [event(), event({ id: id(2), contractKeys: ["payfit:autre-fictif"] })];
    expect(buildActualNonRecurring(journal(), separate, ["2026-09"], SYNC).nonRecurring).toBe(20_000);
  });

  it("refuse un retraitement sous filtre de service, mais conserve le réel source du service", () => {
    const input = journal(); input.serviceAxis = "service"; input.serviceFilter = { value: "A" };
    input.lines = input.lines.map((line) => ({ ...line, analytic: [{ type: "service", code: "A", value: "A" }] }));
    const result = buildActualNonRecurring(input, [event()], ["2026-09"], SYNC);
    expect(result.raw).toBe(180_000); expect(result.nonRecurring).toBeNull(); expect(result.adjusted).toBeNull();
    expect(result.rows[0].reason).toContain("pas ventilés par service");
    expect(buildActualNonRecurring(input, [], ["2026-09"], SYNC).adjusted).toBeNull();
  });

  it("un journal ou un mois source n.d. ne se reconstruit pas à partir des montants déclarés", () => {
    const absent = buildActualNonRecurring(null, [event()], ["2026-09"], SYNC);
    expect(absent.raw).toBeNull(); expect(absent.nonRecurring).toBe(10_000); expect(absent.adjusted).toBeNull();
    const missingMonth = buildActualNonRecurring(journal(), [], ["2026-09", "2026-10"], SYNC);
    expect(missingMonth.raw).toBeNull(); expect(missingMonth.adjusted).toBeNull(); expect(missingMonth.reasons.join(" ")).toContain("2026-10");
    const missingAmount = journal(); missingAmount.lines[3] = { ...missingAmount.lines[3], debitCents: null, creditCents: null };
    expect(buildActualNonRecurring(missingAmount, [], ["2026-09"], SYNC).raw).toBeNull();
  });

  it("borne les totaux déclarés, le réel et la soustraction en entiers exacts", () => {
    const many = Array.from({ length: 91 }, (_, i) => event({ id: id(i + 1), kind: "autre", contractKeys: [`fictif-${i}`], chargedCents: 100_000_000_000_000 }));
    const total = buildActualNonRecurring(journal(), many, ["2026-09"], SYNC);
    expect(total.raw).toBe(180_000); expect(total.nonRecurring).toBeNull(); expect(total.adjusted).toBeNull();
    const over = journal(); over.lines = [line("2026-09", "641000", Number.MAX_SAFE_INTEGER, 0), line("2026-09", "645000", 1, 0)];
    expect(buildActualNonRecurring(over, [], ["2026-09"], SYNC).raw).toBeNull();
    const negative = journal(); negative.lines = [line("2026-09", "641000", 0, Number.MAX_SAFE_INTEGER)];
    const subtraction = buildActualNonRecurring(negative, [event({ chargedCents: 1 })], ["2026-09"], SYNC);
    expect(subtraction.raw).toBe(-Number.MAX_SAFE_INTEGER); expect(subtraction.nonRecurring).toBe(1); expect(subtraction.adjusted).toBeNull();
  });

  it("refuse une période vide ou répétée et une ligne déclarative invalide sans lancer de correction implicite", () => {
    expect(buildActualNonRecurring(journal(), [], [], SYNC)).toMatchObject({ raw: null, nonRecurring: null, adjusted: null });
    expect(buildActualNonRecurring(journal(), [], ["2026-09", "2026-09"], SYNC).raw).toBeNull();
    const invalid = event({ chargedCents: 0.5 });
    const result = buildActualNonRecurring(journal(), [invalid], ["2026-09"], SYNC);
    expect(result.rows[0]).toMatchObject({ amount: null, reason: "Événement réalisé invalide." }); expect(result.nonRecurring).toBeNull();
  });

  it("ne modifie pas le journal ni les déclarations et conserve un résultat déterministe", () => {
    const input = journal(), events = [event()], months = ["2026-09"];
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
    const before = JSON.stringify([input, events]); freeze(input); freeze(events);
    expect(buildActualNonRecurring(input, events, months, SYNC)).toEqual(buildActualNonRecurring(input, events, months, SYNC));
    expect(JSON.stringify([input, events])).toBe(before);
  });
});
