import { describe, expect, it } from "vitest";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import {
  buildDsnPayrollItems, buildPayfitPayrollItems, filterPayrollItems, formatPayrollItemCents, sumPayrollItemAmounts,
  type DsnPayrollItemCoverage, type DsnPayrollItemRecord, type PayrollItemsRh,
} from "@/lib/rh/payroll-items";

// Données exclusivement fictives. Les résultats de référence sont écrits à la main.
const M = "2026-10";
const person = (source: "payfit" | "dsn", key = "person-fixture") => ({
  personKey: `${source}:${key}`, familyName: "Fictif", givenNames: "Alice",
  provenance: { familyName: { collection: source === "payfit" ? "collaborators" : "people", syncId: "sync-fixture", recordKey: "row-fixture", period: null, path: "familyName", label: "Source fictive" } },
});
function rh(source: "payfit" | "dsn" = "payfit"): PayrollItemsRh {
  return { build: { source, inputs: { source, ...(source === "payfit" ? { syncId: "sync-fixture" } : {}) } }, persons: [person(source)], contracts: [{ contractKey: `${source}:contract-fixture`, externalId: source === "dsn" ? "NUMERO-FICTIF-008" : "contract-fixture", personKey: `${source}:person-fixture` }] };
}
const line = (key: string, accountId: string, debitCents: number | null, creditCents: number | null = null, contractId: string | null = "contract-fixture"): LedgerLine => ({
  key, month: M, accountId, accountName: "Libellé fictif", debitCents, creditCents, contractId,
});
const journal = (lines: LedgerLine[]): JournalInput => ({ lines, months: [M], openMonths: [], grid: DEFAULT_PREFIXES });
const payfit = (lines: LedgerLine[], reference = rh()) => buildPayfitPayrollItems({ month: M, input: journal(lines), rh: reference, syncId: "sync-fixture", readAt: "2026-11-05T11:00:00Z" });
const coverage = (change: Partial<DsnPayrollItemCoverage> = {}): DsnPayrollItemCoverage[] => [{ month: M, status: "complete", selected: [{ sourceId: "sync-A", key: "declaration-A" }], ...change }];
const occurrence = (id: string, amountCents: number | string | null = 100, change: Partial<DsnPayrollItemRecord> = {}): DsnPayrollItemRecord => ({
  id, syncId: "sync-A", declarationKey: "declaration-A", month: M, personId: "person-fixture", contractId: "contract-fixture", type: "001",
  amountCents, paymentDate: "2026-11-02", startDate: "2026-10-01", endDate: "2026-10-31", ...change,
});
const dsn = (records: DsnPayrollItemRecord[], cov = coverage()) => buildDsnPayrollItems({ month: M, records, coverage: cov, rh: rh("dsn") });

describe("Rubriques individuelles : journal PayFit", () => {
  it("rattache par contrat exact et classe selon la grille sans perdre hors-masse ni non-classé", () => {
    const result = payfit([line("salary", "641100", 100_000), line("bonus", "641300", 12_345), line("charges", "645100", 40_000),
      line("cp", "641200", 5_000), line("other", "649999", 77), line("counterparty", "421000", null, 157_422)]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({ attachment: "linked", personKey: "payfit:person-fixture", contractKey: "payfit:contract-fixture", personLabel: "Fictif Alice" });
    expect(result.totals.map((t) => [t.rubricKey, t.amount])).toEqual([
      ["salaires", { kind: "value", cents: 100_000 }], ["primes", { kind: "value", cents: 12_345 }], ["cotisations", { kind: "value", cents: 40_000 }],
      ["provisions-cp", { kind: "value", cents: 5_000 }], ["non-classe", { kind: "value", cents: 77 }],
    ]);
    expect(result.rubrics.find((r) => r.key === "provisions-cp")?.role).toBe("hors-masse");
    expect(result.rows[0].provenance).toEqual([{ recordId: "salary", syncId: "sync-fixture", period: M, path: "debitCents − creditCents" }]);
  });
  it("conserve les signes : débit 1023 − crédit 1478 = −455 centimes et zéro source explicite", () => {
    const result = payfit([line("negative", "641100", 1023, 1478), line("zero", "641100", 0)]);
    expect(result.rows.map((r) => r.amount)).toEqual([{ kind: "value", cents: -455 }, { kind: "value", cents: 0 }]);
    expect(result.totals[0].amount).toEqual({ kind: "value", cents: -455 });
  });
  it("préserve lignes sans contrat et contrat absent sans répartition individuelle", () => {
    const result = payfit([line("none", "641100", 100, null, null), line("archived", "641100", 200, null, "not-in-reference")]);
    expect(result.rows.map((r) => [r.attachment, r.personKey, r.contractKey])).toEqual([["no-contract", null, null], ["unlinked", null, null]]);
    expect(result.totals[0].amount).toEqual({ kind: "value", cents: 300 });
  });
  it("refuse même nom, source DSN, doublon d'identité et fiche stub sans preuve source", () => {
    const base = [line("one", "641100", 100)];
    expect(payfit(base, rh("dsn")).rows[0].attachment).toBe("unlinked");
    const duplicate = rh(); duplicate.contracts.push({ ...duplicate.contracts[0] });
    expect(payfit(base, duplicate).rows[0].attachment).toBe("unlinked");
    const stub = rh(); stub.persons[0].provenance = {} as typeof stub.persons[0]["provenance"];
    expect(payfit(base, stub).rows[0].personKey).toBeNull();
    const wrongId = rh(); wrongId.contracts[0].externalId = "other";
    expect(payfit(base, wrongId).rows[0].attachment).toBe("unlinked");
  });
  it("une lecture différente ou non vérifiable conserve les montants sans rattachement nominatif", () => {
    const lines = [line("one", "641100", 1234)];
    const changed = rh(); changed.build!.inputs!.syncId = "another-sync";
    const missing = rh(); delete missing.build!.inputs;
    for (const reference of [changed, missing]) {
      const result = payfit(lines, reference);
      expect(result.rows[0]).toMatchObject({ attachment: "unlinked", personKey: null, contractKey: null, amount: { kind: "value", cents: 1234 } });
      expect(result.totals[0].amount).toEqual({ kind: "value", cents: 1234 });
      expect(result.notices.join(" ")).toContain("recharge la page");
    }
    const noSync = buildPayfitPayrollItems({ month: M, input: journal(lines), rh: rh() });
    expect(noSync.rows[0].attachment).toBe("unlinked");
  });
  it("une absence de montant ne devient pas zéro et ferme le total de sa rubrique", () => {
    const result = payfit([line("known", "641100", 100), line("absent", "641100", null)]);
    expect(result.rows[1].amount.kind).toBe("nd");
    expect(result.totals[0].amount.kind).toBe("nd");
    expect(filterPayrollItems(result, { q: "aucune correspondance fictive" }).totals[0].amount.kind).toBe("nd");
  });
  it("vérifie la précision des montants, différences et sommes avant conversion finale", () => {
    expect(payfit([line("unsafe", "641100", Number.MAX_SAFE_INTEGER + 1)]).rows[0].amount.kind).toBe("nd");
    expect(payfit([line("difference", "641100", Number.MAX_SAFE_INTEGER, -1)]).rows[0].amount.kind).toBe("nd");
    const result = payfit([line("a", "641100", Number.MAX_SAFE_INTEGER), line("b", "641100", 1)]);
    expect(result.rows.every((r) => r.amount.kind === "value")).toBe(true);
    expect(result.totals[0].amount.kind).toBe("nd");
    expect(sumPayrollItemAmounts([{ amount: { kind: "value", cents: Number.MAX_SAFE_INTEGER } }, { amount: { kind: "value", cents: 1 } }, { amount: { kind: "value", cents: -1 } }])).toEqual({ kind: "value", cents: Number.MAX_SAFE_INTEGER });
  });
  it("signale lecture absente, mois non lu, journal absent et paie provisoire", () => {
    expect(buildPayfitPayrollItems({ month: M, input: null, rh: null, unavailable: "Droit comptable absent" }).reason).toBe("Droit comptable absent");
    expect(buildPayfitPayrollItems({ month: "2026-09", input: journal([]), rh: null }).kind).toBe("nd");
    expect(payfit([]).kind).toBe("nd");
    expect(buildPayfitPayrollItems({ month: "not-a-month", input: journal([]), rh: null }).kind).toBe("nd");
    const input = journal([line("one", "641100", 100)]); input.openMonths = [M];
    expect(buildPayfitPayrollItems({ month: M, input, rh: null }).notices.join(" ")).toContain("provisoires");
  });
});

describe("Rubriques individuelles : rémunérations DSN", () => {
  it("garde les types séparés et chaque versement source, même de montant identique", () => {
    const first = occurrence("one", 1234);
    const result = dsn([first, occurrence("two", 1234), occurrence("three", 5000, { type: "002" }), first]);
    expect(result.rows).toHaveLength(3);
    expect(result.totals.map((r) => [r.rubricKey, r.amount])).toEqual([["dsn:001", { kind: "value", cents: 2468 }], ["dsn:002", { kind: "value", cents: 5000 }]]);
    expect(result.rows[0]).toMatchObject({ attachment: "linked", contractKey: "dsn:contract-fixture", contractLabel: "NUMERO-FICTIF-008", personKey: "dsn:person-fixture", paymentDate: "2026-11-02", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(result.rows[0].provenance[0]).toMatchObject({ recordId: "one", path: "S21.G00.51.013" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("declaration-A");
    expect(serialized).not.toContain("personId");
    expect(serialized).not.toContain("contractId");
  });
  it("sélectionne le couple exact dépôt/déclaration, sans addition des copies ou des mois voisins", () => {
    const result = dsn([occurrence("good", 100), occurrence("other-sync", 500, { syncId: "sync-B" }), occurrence("other-declaration", 600, { declarationKey: "declaration-B" }), occurrence("other-month", 700, { month: "2026-09" })]);
    expect(result.rows.map((r) => r.id)).toEqual(["good"]);
    expect(result.totals[0].amount).toEqual({ kind: "value", cents: 100 });
  });
  it("conserve deux fractions distinctes sans dédupliquer leurs montants égaux", () => {
    const cov = coverage(); cov[0].selected.push({ sourceId: "sync-B", key: "declaration-B" });
    const result = dsn([occurrence("one", 100), occurrence("two", 100, { syncId: "sync-B", declarationKey: "declaration-B" })], cov);
    expect(result.rows).toHaveLength(2);
    expect(result.totals[0].amount).toEqual({ kind: "value", cents: 200 });
  });
  it.each(["incomplete", "blocked"] as const)("refuse l'agrégation quand la couverture est %s", (status) => {
    const result = dsn([occurrence("one")], coverage({ status }));
    expect(result.kind).toBe("nd"); expect(result.coverage.status).toBe(status);
    expect(result.rows).toEqual([]); expect(result.totals).toEqual([]);
  });
  it("refuse couverture absente ou complète mais sans déclaration sélectionnée", () => {
    expect(dsn([occurrence("one")], []).coverage.status).toBe("missing");
    expect(dsn([occurrence("one")], coverage({ selected: [] })).coverage.status).toBe("incomplete");
  });
  it("ne rattache pas par numéro de contrat lisible ni par personne de même nom", () => {
    const result = dsn([occurrence("number", 100, { contractId: "NUMERO-FICTIF-008" }), occurrence("wrong-person", 100, { personId: "other-person" }), occurrence("no-contract", 100, { contractId: null })]);
    expect(result.rows.map((r) => r.attachment)).toEqual(["unlinked", "unlinked", "no-contract"]);
    expect(result.rows.every((r) => r.personKey === null && r.contractKey === null)).toBe(true);
    expect(result.totals[0].amount).toEqual({ kind: "value", cents: 300 });
  });
  it("garde type inconnu, montant absent et dépassement sans en faire des zéros", () => {
    const result = dsn([occurrence("negative", -455), occurrence("zero", 0), occurrence("unknown", null, { type: null }), occurrence("overflow", "9007199254740992", { type: "002" })]);
    expect(result.rows[0].amount).toEqual({ kind: "value", cents: -455 });
    expect(result.rows[1].amount).toEqual({ kind: "value", cents: 0 });
    expect(result.totals.find((r) => r.rubricKey === "dsn:001")?.amount).toEqual({ kind: "value", cents: -455 });
    expect(result.totals.find((r) => r.rubricKey === "dsn:nd")?.amount.kind).toBe("nd");
    expect(result.totals.find((r) => r.rubricKey === "dsn:002")?.amount.kind).toBe("nd");
  });
});

describe("Filtres et affichage des rubriques", () => {
  it("recalcule les seuls totaux affichés sans modifier le modèle source", () => {
    const source = payfit([line("salary", "641100", 100), { ...line("bonus", "641300", 200), accountName: "Prime été fictive" }, line("negative", "641300", null, 50)]);
    const before = JSON.stringify(source);
    const result = filterPayrollItems(source, { q: "ÉTÉ", rubricKey: "primes" });
    expect(result.sourceRows).toBe(3); expect(result.rows).toHaveLength(1);
    expect(result.totals).toEqual([{ rubricKey: "primes", label: "Primes", amount: { kind: "value", cents: 200 } }]);
    expect(result.filter).toEqual({ q: "ÉTÉ", rubricKey: "primes" });
    expect(JSON.stringify(source)).toBe(before);
    expect(filterPayrollItems(source, { rubricKey: "absent" }).reason).toContain("Rubrique absente");
  });
  it("formate les centimes entiers sans perte à la borne de précision et conserve les signes", () => {
    expect(formatPayrollItemCents(Number.MAX_SAFE_INTEGER)).toBe("90 071 992 547 409,91 €");
    expect(formatPayrollItemCents(-455)).toBe("−4,55 €");
    expect(formatPayrollItemCents(0)).toBe("0,00 €");
    expect(formatPayrollItemCents(Number.MAX_SAFE_INTEGER + 1)).toBe("n.d.");
  });
});
