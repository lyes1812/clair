import { describe, expect, it } from "vitest";
import { workspaceFingerprint } from "@/lib/crypto";
import { monthRange } from "@/lib/connectors/months";
import { parseDsn } from "@/lib/dsn/parser";
import { DSN_END_CANCELLATION_UNSUPPORTED } from "@/lib/dsn/issues";
import { selectDeclarations, type SelectableDeclaration } from "@/lib/dsn/selection";
import { buildFromDsn } from "@/lib/rh/referential/build-dsn";
import { buildDsnPayrollItems, type DsnPayrollItemRecord } from "@/lib/rh/payroll-items";
import { HISTORY_CONTRACT, HISTORY_NIR, historyDsnBytes, historyDsnText, type HistoryDsnOptions } from "../fixtures/dsn-history";
import { dsnInput, type DsnFile } from "./helpers/rh";

// Clé de test uniquement : aucun secret, aucune source réelle ni base de données.
const testKey = Buffer.alloc(32, 35).toString("base64");
const fingerprint = (workspace = "test-history") => (value: string) => workspaceFingerprint(workspace, value, testKey);
const parse = (options: HistoryDsnOptions = {}, workspace?: string) => parseDsn(historyDsnBytes(options), { fingerprint: fingerprint(workspace) });
const file = (options: HistoryDsnOptions = {}, syncId = "sync-history-fictif"): DsnFile => ({
  bytes: historyDsnBytes(options), filename: `${options.month ?? "2023-01"}-100-pour-cent-fictif.dsn`, syncId,
});
const reframe = (text: string, edit: (lines: string[]) => string[]) => {
  const lines = edit(text.trimEnd().split(/\r?\n/).filter((line) => !line.startsWith("S90.G00.90.")));
  return `${lines.join("\r\n")}\r\nS90.G00.90.001,'${lines.length + 2}'\r\nS90.G00.90.002,'1'\r\n`;
};
const parseText = (text: string) => parseDsn(new TextEncoder().encode(text), { fingerprint: fingerprint() });
const textFile = (text: string): DsnFile => ({ bytes: new TextEncoder().encode(text), filename: "historique-100-pour-cent-fictif.dsn" });
const withEnd = (options: HistoryDsnOptions = {}, reason = "059") => {
  const month = options.month ?? "2023-01";
  return reframe(historyDsnText(options), (lines) => lines.flatMap((line) => line.startsWith("S21.G00.50.001,")
    ? [`S21.G00.62.001,'31${month.slice(5, 7)}${month.slice(0, 4)}'`, `S21.G00.62.002,'${reason}'`, line] : [line]));
};
const selectable = (text: string, sourceId: string): SelectableDeclaration => {
  const parsed = parseText(text);
  const declaration = parsed.declarations[0];
  return { ...declaration, sourceId, contentHash: parsed.hash };
};

function payrollItems(files: DsnFile[], month = "2023-01") {
  const input = dsnInput(files);
  const rh = buildFromDsn(input);
  const text = (value: unknown) => typeof value === "string" ? value : null;
  const records: DsnPayrollItemRecord[] = input.records.filter((record) => record.collection === "remunerations").map((record) => ({
    id: record.key, syncId: record.syncId, declarationKey: String(record.data.declarationKey), month: String(record.period),
    personId: text(record.data.personId), contractId: text(record.data.contractId), type: text(record.data.type),
    amountCents: typeof record.data.amountCents === "number" ? record.data.amountCents : null,
    paymentDate: text(record.data.paymentDate), startDate: text(record.data.startDate), endDate: text(record.data.endDate),
  }));
  return buildDsnPayrollItems({ month, records, coverage: input.coverage, rh });
}

describe("historique DSN — janvier 2023 réellement renseigné", () => {
  it("lit P23V01, le contrat commencé en 2022 et les montants et temps exactement déclarés", () => {
    const result = parse();
    expect(result.norm).toBe("P23V01");
    const declaration = result.declarations[0];
    expect(declaration).toMatchObject({ month: "2023-01", eligible: true, blocking: [], siret: "00000000000011" });
    expect(declaration.people).toHaveLength(1);
    expect(declaration.contracts).toHaveLength(1);
    expect(declaration.contracts[0]).toMatchObject({ contractNumber: HISTORY_CONTRACT, startDate: "2022-09-01", endDate: null,
      nature: "01", unit: "10", referenceQuota: 151.67, contractQuota: 121.33, modality: "20" });
    expect(declaration.remunerations).toHaveLength(1);
    expect(declaration.remunerations[0]).toMatchObject({ type: "001", amountCents: 123456, currency: "EUR", contractNumber: HISTORY_CONTRACT,
      startDate: "2023-01-01", endDate: "2023-01-31", paymentDate: "2023-01-31" });
    expect(declaration.activities).toHaveLength(1);
    expect(declaration.activities[0]).toMatchObject({ remunerationType: "001", type: "01", unit: "10", measure: 121.33,
      startDate: "2023-01-01", endDate: "2023-01-31", contractId: declaration.contracts[0].contractId });
    expect(result.warnings.join(" ")).toContain("Lecture partielle");
  });

  it.each([
    ["P24V01", "2024-01"], ["P25V01", "2025-01"], ["P26V01", "2026-01"],
  ])("conserve la lecture de %s sans changement des rubriques ni conversion des montants", (norm, month) => {
    const declaration = parse({ norm, month }).declarations[0];
    expect(declaration).toMatchObject({ month, eligible: true, blocking: [] });
    expect(declaration.remunerations[0].amountCents).toBe(123456);
    expect(declaration.activities[0].measure).toBe(121.33);
    expect(declaration.contracts[0].startDate).toBe("2022-09-01");
  });

  it("la norme et l'année n'altèrent pas les identifiants HMAC propres à l'espace", () => {
    const declarations = ["P23V01", "P24V01", "P25V01", "P26V01"].map((norm) => parse({ norm }).declarations[0]);
    expect(new Set(declarations.map((declaration) => declaration.people[0].personId)).size).toBe(1);
    expect(new Set(declarations.map((declaration) => declaration.contracts[0].contractId)).size).toBe(1);
    const other = parse({}, "autre-espace-fictif").declarations[0];
    expect(other.people[0].personId).not.toBe(declarations[0].people[0].personId);
    expect(other.contracts[0].contractId).not.toBe(declarations[0].contracts[0].contractId);
    expect(JSON.stringify(declarations)).not.toContain(HISTORY_NIR);
  });

  it("reconstruit janvier 2023 sans projeter les mois antérieurs au premier dépôt", () => {
    const input = dsnInput([file()]);
    const result = buildFromDsn(input);
    expect(result.build).toMatchObject({ source: "dsn", presenceFrom: "2023-01", presenceTo: "2023-01", referenceDate: "2023-01-31",
      summary: { persons: 1, contracts: 1, months: 1 } });
    expect(result.coverage).toMatchObject([{ month: "2023-01", presenceStatus: "complete", timeStatus: "paid_only" }]);
    expect(result.months).toHaveLength(1);
    expect(result.months[0]).toMatchObject({ month: "2023-01", presenceBasis: "declared", presentAnyDay: true, presentMonthEnd: true,
      paidTime: 121.33, workedTime: null, timeUnit: "10", referenceQuota: 151.67, contractQuota: 121.33, paymentCount: 1 });
    expect(result.months[0].fieldsNd.workedTime?.code).toBe("not-in-source");
    expect(result.months[0].provenance.paidTime).toMatchObject({ path: "S21.G00.53.002", period: "2023-01" });
    expect(result.persons[0].teamName).toBeNull();
    expect(result.persons[0].fieldsNd.teamName?.code).toBe("not-in-source");
    const items = payrollItems([file()]);
    expect(items.kind).toBe("value");
    expect(items.totals).toMatchObject([{ rubricKey: "dsn:001", amount: { kind: "value", cents: 123456 } }]);
    expect(items.rows[0]).toMatchObject({ attachment: "linked", contractLabel: HISTORY_CONTRACT, paymentDate: "2023-01-31" });
    expect(items.rows[0].provenance[0]).toMatchObject({ period: "2023-01", path: "S21.G00.51.013" });
  });

  it("cumule plusieurs dépôts historiques : 46 mois retenus de janvier 2023 à octobre 2026", () => {
    const files = monthRange("2023-01", "2026-10").map((month) => file({ month }, `sync-fictif-${month.slice(0, 4)}`));
    const result = buildFromDsn(dsnInput(files));
    expect(result.coverage).toHaveLength(46);
    expect(result.coverage.every((row) => row.presenceStatus === "complete")).toBe(true);
    expect(result.months).toHaveLength(46);
    expect(result.persons).toHaveLength(1);
    expect(result.contracts).toHaveLength(1);
    expect(result.build).toMatchObject({ presenceFrom: "2023-01", presenceTo: "2026-10", referenceDate: "2026-10-31" });
    expect(result.months.find((row) => row.month === "2023-01")?.paidTime).toBe(121.33);
    expect(result.months.find((row) => row.month === "2026-10")?.paidTime).toBe(121.33);
  });

  it("un mois historique manquant reste missing, sans temps ni versement à zéro", () => {
    const result = buildFromDsn(dsnInput([file(), file({ month: "2023-03" })]));
    expect(result.coverage.find((row) => row.month === "2023-02")).toMatchObject({ presenceStatus: "missing" });
    expect(result.months.find((row) => row.month === "2023-02")).toBeUndefined();
    expect(result.events.filter((event) => event.kind === "exit")).toHaveLength(0);
    const items = payrollItems([file(), file({ month: "2023-03" })], "2023-02");
    expect(items).toMatchObject({ kind: "nd", rows: [], totals: [], coverage: { status: "missing" } });
  });

  it("une rémunération à zéro est connue ; les temps et quotités absents restent n.d.", () => {
    const options = { gross: "0.00", paidTime: null, referenceQuota: null, contractQuota: null };
    const declaration = parse(options).declarations[0];
    expect(declaration).toMatchObject({ eligible: true, activities: [] });
    expect(declaration.remunerations[0].amountCents).toBe(0);
    expect(declaration.contracts[0]).toMatchObject({ referenceQuota: null, contractQuota: null });
    const result = buildFromDsn(dsnInput([file(options)]));
    expect(result.months[0]).toMatchObject({ paidTime: null, workedTime: null, referenceQuota: null, contractQuota: null });
    expect(result.months[0].fieldsNd.paidTime?.code).toBe("no-activity");
    expect(result.months[0].fieldsNd.contractQuota?.code).toBe("not-provided");
    expect(payrollItems([file(options)]).totals[0].amount).toEqual({ kind: "value", cents: 0 });
    expect(payrollItems([file({ gross: null })])).toMatchObject({ kind: "nd", rows: [], totals: [] });
  });
});

describe("historique DSN — types et régularisations conservés", () => {
  it("en 2023 le montant net social 027 reste séparé du brut 001", () => {
    const options = { month: "2023-07", netSocial: { amount: "950.03", startDate: "2023-07-01", endDate: "2023-07-31" } };
    const declaration = parse(options).declarations[0];
    expect(declaration.eligible).toBe(true);
    expect(declaration.remunerations.map((row) => [row.type, row.amountCents])).toEqual([["001", 123456], ["027", 95003]]);
    const items = payrollItems([file(options)], "2023-07");
    expect(items.totals.map((total) => [total.rubricKey, total.amount])).toEqual([
      ["dsn:001", { kind: "value", cents: 123456 }], ["dsn:027", { kind: "value", cents: 95003 }],
    ]);
  });

  it("en 2024 un rappel 027 de 2023 garde sa période et sa date de versement", () => {
    const options = { month: "2024-01", netSocial: { amount: "-0.03", startDate: "2023-12-01", endDate: "2023-12-31" } };
    const declaration = parse(options).declarations[0];
    expect(declaration.eligible).toBe(true);
    expect(declaration.warnings.join(" ")).toContain("régularisation possible");
    expect(declaration.remunerations[1]).toMatchObject({ type: "027", amountCents: -3, paymentDate: "2024-01-31",
      startDate: "2023-12-01", endDate: "2023-12-31" });
    const items = payrollItems([file(options)], "2024-01");
    expect(items.totals.map((total) => [total.rubricKey, total.amount])).toEqual([
      ["dsn:001", { kind: "value", cents: 123456 }], ["dsn:027", { kind: "value", cents: -3 }],
    ]);
    expect(items.rows.find((row) => row.rubricKey === "dsn:027")).toMatchObject({ startDate: "2023-12-01", endDate: "2023-12-31", paymentDate: "2024-01-31" });
  });

  it("l'annule et remplace historique fait foi, sans double rémunération", () => {
    const normal = file();
    const replacement = file({ type: "03", order: "2", gross: "1200.01" }, "sync-remplacement-fictif");
    const input = dsnInput([normal, replacement]);
    expect(input.coverage[0]).toMatchObject({ status: "complete", selected: [{ sourceId: "sync-remplacement-fictif", type: "03", order: "2" }] });
    expect(input.coverage[0].selected).toHaveLength(1);
    expect(payrollItems([normal, replacement]).totals[0].amount).toEqual({ kind: "value", cents: 120001 });
    expect(buildFromDsn(input).persons).toHaveLength(1);
  });

  it("une fraction historique seule est incomplète et n'offre aucun total partiel présenté comme complet", () => {
    const files = [file({ fraction: "12" })];
    expect(parse({ fraction: "12" }).declarations[0].eligible).toBe(true);
    const input = dsnInput(files);
    expect(input.coverage[0]).toMatchObject({ status: "incomplete" });
    expect(input.coverage[0].messages.join(" ")).toContain("manque 2/2");
    expect(buildFromDsn(input).build.presenceFrom).toBeNull();
    expect(payrollItems(files)).toMatchObject({ kind: "nd", rows: [], totals: [], coverage: { status: "incomplete" } });
  });
});

describe("historique DSN — les refus existants restent appliqués", () => {
  it.each([
    ["P23V01", "2023-01"], ["P24V01", "2024-01"], ["P25V01", "2025-01"], ["P26V01", "2026-01"],
  ])("%s : le motif 099 annule une fin et ne produit aucune rupture", (norm, month) => {
    const endDate = `31${month.slice(5, 7)}${month.slice(0, 4)}`;
    const text = reframe(historyDsnText({ norm, month }), (lines) => lines.flatMap((line) => line.startsWith("S21.G00.50.001,")
      ? [`S21.G00.62.001,'${endDate}'`, "S21.G00.62.002,'099'", line] : [line]));
    const declaration = parseText(text).declarations[0];
    expect(declaration.eligible).toBe(false);
    expect(declaration.blocking.join(" ")).toContain("annulation de fin (motif 099) non prise en charge");
    expect(declaration.contracts[0]).toMatchObject({ endDate: null, endReason: null });
    const result = buildFromDsn(dsnInput([textFile(text)]));
    expect(result.coverage[0].presenceStatus).toBe("blocked");
    expect(result.contracts).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it.each(["P22V01", "P23V02", "P24V02", "P27V01"])("%s n'est pas accepté par extrapolation", (norm) => {
    const declaration = parse({ norm }).declarations[0];
    expect(declaration.eligible).toBe(false);
    expect(declaration.blocking.join(" ")).toContain(`Norme ${norm} non prise en charge`);
    const result = buildFromDsn(dsnInput([file({ norm })]));
    expect(result.coverage[0].presenceStatus).toBe("blocked");
    expect(result.persons).toEqual([]);
    expect(result.contracts).toEqual([]);
    expect(result.months).toEqual([]);
  });

  it.each([
    ["S21.G00.30.001", "NIR ou identifiant temporaire absent ou invalide"],
    ["S21.G00.40.001", "date de début invalide"],
    ["S21.G00.50.001", "sans versement"],
  ])("une rubrique obligatoire absente en 2023 reste bloquante : %s", (code, reason) => {
    const incomplete = reframe(historyDsnText(), (lines) => lines.filter((line) => !line.startsWith(`${code},`)));
    const declaration = parseText(incomplete).declarations[0];
    expect(declaration.eligible).toBe(false);
    expect(declaration.blocking.join(" ")).toContain(reason);
  });

  it("une norme absente ou répétée ne devient pas implicitement P23V01", () => {
    for (const text of [
      reframe(historyDsnText(), (lines) => lines.filter((line) => !line.startsWith("S10.G00.00.006,"))),
      reframe(historyDsnText(), (lines) => [...lines.slice(0, 2), "S10.G00.00.006,'P24V01'", ...lines.slice(2)]),
    ]) {
      const result = parseText(text);
      expect(result.norm).toBeNull();
      expect(result.declarations[0].eligible).toBe(false);
      expect(result.declarations[0].blocking.join(" ")).toContain("Version de norme");
    }
  });

  it("les montants historiques invalides ne sont pas arrondis ni remplacés par zéro", () => {
    for (const gross of ["12.345", "non-disponible", "90071992547409.92"]) {
      const declaration = parse({ gross }).declarations[0];
      expect(declaration.eligible).toBe(false);
      expect(declaration.remunerations).toEqual([]);
      expect(declaration.blocking.join(" ")).toContain("montant invalide");
      expect(payrollItems([file({ gross })])).toMatchObject({ kind: "nd", rows: [], totals: [], coverage: { status: "blocked" } });
    }
  });

  it("une date de janvier 2023 invalide reste bloquante, sans correction automatique", () => {
    const invalid = historyDsnText().replace("S21.G00.51.002,'31012023'", "S21.G00.51.002,'32012023'");
    const declaration = parseText(invalid).declarations[0];
    expect(declaration.eligible).toBe(false);
    expect(declaration.blocking.join(" ")).toContain("période invalide");
    expect(buildFromDsn(dsnInput([textFile(invalid)])).months).toEqual([]);
  });
});

describe("historique DSN — une annulation de fin ne réactive pas l'ancienne sortie", () => {
  it("une normale avec fin suivie d'une annulation 03 d'ordre 2 bloque le mois, le référentiel et les rémunérations", () => {
    const normal = textFile(withEnd());
    const cancellation = textFile(withEnd({ type: "03", order: "2" }, "099"));
    expect(buildFromDsn(dsnInput([normal])).events.filter((event) => event.kind === "exit")).toHaveLength(1);
    const input = dsnInput([normal, cancellation]);
    expect(input.coverage[0]).toMatchObject({ status: "blocked", selected: [] });
    expect(input.coverage[0].messages.join(" ")).toContain(DSN_END_CANCELLATION_UNSUPPORTED);
    const result = buildFromDsn(input);
    expect(result.months).toEqual([]);
    expect(result.contracts).toEqual([]);
    expect(result.events).toEqual([]);
    expect(payrollItems([normal, cancellation])).toMatchObject({ kind: "nd", rows: [], totals: [], coverage: { status: "blocked" } });
  });

  it("un remplacement éligible d'ordre 3 rétablit la lecture sans résoudre implicitement le motif 099", () => {
    const files = [textFile(withEnd()), textFile(withEnd({ type: "03", order: "2" }, "099")), file({ type: "03", order: "3", gross: "1200.01" })];
    const input = dsnInput(files);
    expect(input.coverage[0]).toMatchObject({ status: "complete", selected: [{ type: "03", order: "3" }] });
    expect(input.coverage[0].selected).toHaveLength(1);
    const result = buildFromDsn(input);
    expect(result.contracts[0]).toMatchObject({ endDate: null, endReason: null, endStatus: "none_cdi" });
    expect(result.months[0]).toMatchObject({ month: "2023-01", presentMonthEnd: true });
    expect(result.events.filter((event) => event.kind === "exit")).toEqual([]);
    expect(payrollItems(files).totals[0].amount).toEqual({ kind: "value", cents: 120001 });
  });

  it("une annulation d'ordre ancien n'empêche pas une normale valide d'ordre supérieur de faire foi", () => {
    const input = dsnInput([textFile(withEnd({ type: "03", order: "2" }, "099")), textFile(withEnd({ order: "3" }))]);
    expect(input.coverage[0]).toMatchObject({ status: "complete", selected: [{ type: "01", order: "3" }] });
    expect(buildFromDsn(input).events.filter((event) => event.kind === "exit")).toHaveLength(1);
  });

  it.each([
    ["2", "2"], ["9007199254740993", "9007199254740994"],
  ])("ordres %s / %s : l'annulation au même rang ou plus récente bloque sans perte de précision", (normalOrder, cancellationOrder) => {
    const input = dsnInput([textFile(withEnd({ order: normalOrder })), textFile(withEnd({ type: "03", order: cancellationOrder }, "099"))]);
    expect(input.coverage[0]).toMatchObject({ status: "blocked", selected: [] });
    expect(buildFromDsn(input).events).toEqual([]);
  });

  it.each(["order", "nature", "fraction", "siret", "month"] as const)("une annulation dont %s manque bloque prudemment les groupes potentiellement concernés", (field) => {
    const normal = selectable(withEnd({ order: "3" }), "normale-fictive");
    const cancellation = { ...selectable(withEnd({ type: "03", order: "2" }, "099"), "annulation-fictive"), [field]: null };
    const coverage = selectDeclarations([normal, cancellation]);
    expect(coverage.find((row) => row.month === "2023-01" && row.siret === "00000000000011")).toMatchObject({ status: "blocked", selected: [] });
  });

  it.each(["month", "siret", "nature", "fraction"] as const)("une annulation connue d'un autre %s n'écarte pas le groupe éligible", (field) => {
    const normal = selectable(withEnd(), "normale-fictive");
    const other = { month: "2023-03", siret: "00000000000029", nature: "02", fraction: "22" };
    const cancellation = { ...selectable(withEnd({ type: "03", order: "2" }, "099"), "annulation-autre-groupe-fictif"), [field]: other[field] };
    const coverage = selectDeclarations([normal, cancellation]);
    expect(coverage.find((row) => row.month === "2023-01" && row.siret === "00000000000011")).toMatchObject({ status: "complete", selected: [{ key: normal.key }] });
  });

  it("une autre fraction à chaîne incomplète ne peut pas remplacer le blocage 099 par un simple incomplet", () => {
    const input = dsnInput([
      textFile(withEnd({ fraction: "12" })),
      textFile(withEnd({ type: "03", order: "2", fraction: "12" }, "099")),
      file({ type: "03", order: "2", fraction: "22" }),
    ]);
    expect(input.coverage[0].status).toBe("blocked");
    expect(input.coverage[0].messages.join(" ")).toContain(DSN_END_CANCELLATION_UNSUPPORTED);
    expect(buildFromDsn(input).events).toEqual([]);
  });

  it("le constat 099 reste bloquant même si l'identité de la nouvelle déclaration est invalide", () => {
    const cancellation = reframe(withEnd({ type: "03", order: "2" }, "099"), (lines) => lines.filter((line) => !line.startsWith("S21.G00.30.001,")));
    const declaration = parseText(cancellation).declarations[0];
    expect(declaration.blocking.join(" ")).toContain(DSN_END_CANCELLATION_UNSUPPORTED);
    const input = dsnInput([textFile(withEnd()), textFile(cancellation)]);
    expect(input.coverage[0]).toMatchObject({ status: "blocked", selected: [] });
    expect(buildFromDsn(input).events).toEqual([]);
  });

  it("la troncature de nombreux autres constats ne masque pas le garde-fou 099", () => {
    const cancellation = reframe(withEnd({ type: "03", order: "2" }, "099"), (lines) => [
      ...lines.slice(0, 2), ...Array.from({ length: 202 }, () => "S80.G00.01.001,'FICTIF-NON-PRIS-EN-CHARGE'"), ...lines.slice(2),
    ]);
    const declaration = parseText(cancellation).declarations[0];
    expect(declaration.blocking).toContain("Liste tronquée : d'autres constats existent.");
    expect(declaration.blocking.join(" ")).toContain(DSN_END_CANCELLATION_UNSUPPORTED);
    const input = dsnInput([textFile(withEnd()), textFile(cancellation)]);
    expect(input.coverage[0]).toMatchObject({ status: "blocked", selected: [] });
    expect(buildFromDsn(input).events).toEqual([]);
  });

  it("des rémunérations 001 et 027, y compris un montant 99, ne sont pas des annulations de fin", () => {
    const files = [file({ month: "2023-07", netSocial: { amount: "99.00", startDate: "2023-07-01", endDate: "2023-07-31" } })];
    const input = dsnInput(files);
    expect(input.coverage[0].status).toBe("complete");
    expect(input.coverage[0].messages).toEqual([]);
    expect(payrollItems(files, "2023-07").totals.map((total) => [total.rubricKey, total.amount])).toEqual([
      ["dsn:001", { kind: "value", cents: 123456 }], ["dsn:027", { kind: "value", cents: 9900 }],
    ]);
  });
});
