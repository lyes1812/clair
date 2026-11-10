import { describe, expect, it } from "vitest";
import { buildExploration, explorationDefaultMonth, explorationPivot, explorationTimeGap, explorationTree, type ExplorationTreeNode } from "@/lib/rh/exploration";
import type { ContractDraft, ContractMonthDraft, PersonDraft, Provenance, RhBuildData } from "@/lib/rh/referential/types";

// Référence écrite à la main : 5 contrats, 3 personnes, 1 contrat orphelin. P-A porte deux contrats ; P-A et P-B sont
// homonymes. C-1 est observé dans deux établissements : 6 observations ne deviennent ni 6 contrats ni 4 personnes.
const MONTH = "2026-09";
const prov = (path: string, period: string | null = MONTH): Provenance => ({ syncId: "lecture-fictive", collection: "worked_time", recordKey: "ligne-fictive", period, path, label: "Source entièrement fictive" });
function person(id: string, team: string | null): PersonDraft {
  return { personKey: `payfit:${id}`, externalId: id, identifierKind: "payfit", siren: null, establishmentIds: ["ETAB-A"], familyName: "FICTIF", givenNames: "Alex", usageName: null, employeeNumber: null, teamName: team, hasContract: true, firstDeclaredMonth: null, lastDeclaredMonth: null, fieldsNd: {}, provenance: {} };
}
function contract(id: string, personKey: string | null, nature = "01"): ContractDraft {
  return { contractKey: `payfit:${id}`, externalId: id, personKey, establishmentId: "ETAB-A", startDate: "2026-01-01", endDate: null, endReason: null, endStatus: "none_cdi", nature, statusSource: "ACTIVE", fteAtRead: 1, weeklyHoursAtRead: 35, isFullTimeAtRead: true, modalityAtRead: null, executive: null, firstDeclaredMonth: null, lastDeclaredMonth: null, fieldsNd: {}, provenance: { fteAtRead: { ...prov("fullTimeEquivalent", null), collection: "contracts" } } };
}
function observation(id: string, nature = "01", establishmentId = "ETAB-A"): ContractMonthDraft {
  return { contractKey: `payfit:${id}`, month: MONTH, establishmentId, presenceBasis: "dates", presentAnyDay: true, presentMonthEnd: true, nature, referenceQuota: null, contractQuota: null, quotaUnit: null, modality: null, paidTime: 150, workedTime: 140, timeUnit: "hours", paymentCount: null, flags: [], fieldsNd: {}, provenance: { paidTime: prov("paidWorkedTime"), workedTime: prov("effectiveWorkedTime") } };
}
function reference(): RhBuildData {
  return {
    build: { source: "payfit", referenceDate: "2026-10-21", presenceFrom: MONTH, presenceTo: "2026-10", unavailableReason: null },
    persons: [person("P-A", "Équipe A"), person("P-B", "Non renseigné"), person("P-C", null)],
    contracts: [contract("C-1", "payfit:P-A"), contract("C-2", "payfit:P-A", "02"), contract("C-3", "payfit:P-B"), contract("C-4", "payfit:P-C", "02"), contract("C-5", null)],
    months: [observation("C-1"), observation("C-1", "01", "ETAB-B"), observation("C-2", "02"), observation("C-3"), observation("C-4", "02"), observation("C-5")],
    events: [],
    coverage: ["ETAB-A", "ETAB-B"].map((establishmentId) => ({ establishmentId, month: MONTH, presenceStatus: "complete", presenceReason: null, timeStatus: "read", timeReason: null, declarationKeys: [], provenance: {} })),
    findings: [],
  };
}
const opts = { natures: ["01", "02"] };
const model = () => buildExploration(reference(), MONTH, opts);

describe("Mois par défaut — présence et mois réellement lus", () => {
  const presence = ["2026-09", "2026-10", "2026-11"];
  it.each([
    { mode: "tree", reads: ["2026-09"], reference: "2026-11-10", expected: "2026-10" },
    { mode: "pivot", reads: ["2026-09"], reference: "2026-11-10", expected: "2026-10" },
    { mode: "pointage", reads: ["2026-09"], reference: "2026-11-10", expected: "2026-09" },
    { mode: "rubrique", reads: ["2026-09"], reference: "2026-11-10", expected: "2026-09" },
    { mode: "pointage", reads: null, reference: "2026-11-10", expected: "2026-10" },
    { mode: "rubrique", reads: null, reference: "2026-09-30", expected: "2026-09" },
    { mode: "pointage", reads: [], reference: "2026-11-10", expected: null },
    { mode: "rubrique", reads: [], reference: "2026-11-10", expected: null },
    { mode: "pointage", reads: ["2026-09", "2026-08"], reference: "2026-09-21", expected: "2026-08" },
    { mode: "pointage", reads: ["2026-09", "2026-09", "2026-13", "", "2026-08"], reference: "2026-11-10", expected: "2026-09" },
    { mode: "rubrique", reads: ["2026-09", "2026-08"], reference: null, expected: "2026-09" },
    { mode: "rubrique", reads: ["2026-13", ""], reference: undefined, expected: null },
  ] as const)("$mode / lus=$reads / référence=$reference → $expected", ({ mode, reads, reference, expected }) => {
    expect(explorationDefaultMonth(mode, Object.freeze(presence.slice()), reads === null ? null : Object.freeze([...reads]), reference)).toBe(expected);
  });
});

describe("Exploration mensuelle — unions et périmètre documentaire", () => {
  it("compte les contrats et personnes par union, conserve homonymes, orphelin et observations multisites", () => {
    const m = model();
    expect(m.total).toMatchObject({ contracts: 5, persons: 3, withoutPerson: 1, observations: 6 });
    expect(new Set(m.rows.map((r) => r.id)).size).toBe(6);
    expect(m.rows.find((r) => r.contractLabel === "C-5")).toMatchObject({ personKey: null, personName: null, notes: expect.arrayContaining(["Contrat sans collaborateur rattaché"]) });
    expect(m.notices).toContain("Équipes, natures de contrat et quotités à la date de lecture (2026-10-21), sans historique d'affectation PayFit");
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(JSON.stringify(m)).not.toContain("lecture-fictive"); // DTO réduit : pas d'enregistrement source ou de build.
  });

  it("garde la catégorie inconnue distincte d'un vrai libellé métier identique", () => {
    const m = model();
    const sameLabels = m.teams.filter((c) => c.label === "Non renseigné");
    expect(sameLabels).toHaveLength(2);
    expect(new Set(sameLabels.map((c) => c.key)).size).toBe(2);
    const unknown = sameLabels.find((c) => c.value === null)!;
    const filtered = buildExploration(reference(), MONTH, { ...opts, team: unknown.key });
    expect(filtered.total).toMatchObject({ contracts: 2, persons: 1, withoutPerson: 1 });
    expect(filtered.rows.map((r) => r.contractLabel).sort()).toEqual(["C-4", "C-5"]);
    expect(filtered.teams).toEqual(m.teams); // Options avant les filtres de recherche et catégories.
  });

  it("réutilise nature mensuelle et établissements filtrés, conserve les natures hors effectif", () => {
    const d = reference();
    d.build.source = "dsn";
    d.months.forEach((m) => { m.presenceBasis = "declared"; });
    d.contracts[0].nature = "02"; // Attribut actuel différent de l'observation historique du mois.
    const m = buildExploration(d, MONTH, { natures: ["01"], establishments: ["ETAB-B"] });
    expect(m.total).toMatchObject({ contracts: 1, persons: 1, observations: 1 });
    expect(m.rows[0].nature.value).toBe("01");
    const all = buildExploration(reference(), MONTH, { natures: ["01"] });
    expect(all.total.contracts).toBe(5);
    expect(all.rows.filter((r) => !r.inScope).map((r) => r.contractLabel)).toEqual(["C-2", "C-4"]);
    expect(all.rows.filter((r) => !r.inScope).every((r) => r.state.value === "out_of_scope")).toBe(true);
  });

  it("PayFit : nature de la fiche à la lecture lorsque la ligne de temps ne porte pas d'historique", () => {
    const d = reference();
    d.months.forEach((m) => { m.nature = null; });
    const m = buildExploration(d, MONTH, opts);
    expect(m.natures.map((n) => n.value).sort()).toEqual(["01", "02"]);
    expect(m.rows.find((r) => r.contractLabel === "C-2")?.nature.value).toBe("02");
    expect(m.notices.some((n) => n.includes("natures de contrat") && n.includes("2026-10-21"))).toBe(true);
  });

  it("applique recherche accentuée et catégories au même jeu de lignes", () => {
    const m = buildExploration(reference(), MONTH, { ...opts, q: "equipe a", nature: "02" });
    expect(m.total).toMatchObject({ contracts: 1, persons: 1, observations: 1 });
    expect(m.rows.map((r) => r.contractLabel)).toEqual(["C-2"]);
    const empty = buildExploration(reference(), MONTH, { ...opts, q: "introuvable-fictif" });
    expect(empty.total).toMatchObject({ contracts: 0, persons: 0, observations: 0 });
    expect(empty.gate).toBeNull();
  });
});

describe("Pivot et arbre — constituants communs, marges non additives", () => {
  it("recompte personnes et contrats sur chaque marge plutôt que sommer les cellules", () => {
    const m = model();
    const p = explorationPivot(m, "team", "nature");
    const team = m.teams.find((c) => c.value === "Équipe A")!;
    const cells = p.cells.filter((c) => c.rowKey === team.key);
    expect(cells.map((c) => c.persons)).toEqual([1, 1]);
    expect(cells.reduce((n, c) => n + c.persons, 0)).toBe(2);
    expect(p.rowTotals.find((r) => r.key === team.key)).toMatchObject({ persons: 1, contracts: 2, observations: 3 });
    expect(p.total).toEqual(m.total);
    expect(p.cells.find((c) => c.observations === 0)).toMatchObject({ contracts: 0, persons: 0, withoutPerson: 0, rowIds: [] });
    // P-A appartient à deux natures : total de personnes 3, somme des marges de nature 4.
    expect(p.columnTotals.reduce((n, c) => n + c.persons, 0)).toBe(4);
    expect(p.total.persons).toBe(3);
  });

  it("inverse les axes sans changer les constituants ; le même axe reste un croisement diagonal", () => {
    const m = model();
    const a = explorationPivot(m, "team", "nature");
    const b = explorationPivot(m, "nature", "team");
    for (const cell of a.cells) expect(b.cells.find((c) => c.rowKey === cell.columnKey && c.columnKey === cell.rowKey)?.rowIds).toEqual(cell.rowIds);
    expect(b.total).toEqual(a.total);
    const diagonal = explorationPivot(m, "team", "team");
    expect(diagonal.cells.filter((c) => c.rowKey !== c.columnKey).every((c) => c.observations === 0)).toBe(true);
  });

  it("arbre documentaire : chaque observation appartient à une feuille, union de contrats au parent", () => {
    const m = model();
    const tree = explorationTree(m);
    const leaves = (node: ExplorationTreeNode): ExplorationTreeNode[] => node.children.length ? node.children.flatMap(leaves) : [node];
    expect(tree.axis).toBeNull();
    expect(tree.count).toEqual(m.total);
    expect(leaves(tree).flatMap((n) => n.rowIds).sort()).toEqual(m.rows.map((r) => r.id).sort());
    expect(tree.children.find((n) => n.category?.value === "Équipe A")?.count).toMatchObject({ contracts: 2, persons: 1, observations: 3 });
    expect(explorationTree(m, ["team", "team", "nature"])).toEqual(tree);
  });
});

describe("Sources, périodes et temps observés", () => {
  it("ferme un mois manquant, invalide, courant non terminé ou postérieur, sans recycler les lignes", () => {
    for (const month of ["2026-08", "2026-10", "2026-11", "2026-13", "", "2026-09-01"]) {
      const m = buildExploration(reference(), month, opts);
      expect(m.month).toBe(month);
      expect(m.gate).not.toBeNull();
      expect(m.coverageKind).toBe("nd");
      expect(m.rows).toEqual([]);
      expect(m.total).toMatchObject({ contracts: 0, persons: 0, observations: 0 });
      expect(explorationPivot(m, "team", "nature").cells).toEqual([]);
    }
  });

  it("la fin du mois exact à la référence est disponible ; couverture bloquée/incomplète prime", () => {
    const d = reference();
    d.build.referenceDate = "2026-09-30";
    expect(buildExploration(d, MONTH, opts).gate).toBeNull();
    for (const status of ["blocked", "incomplete", "missing"] as const) {
      d.coverage[0].presenceStatus = status;
      d.coverage[0].presenceReason = "Couverture fictive insuffisante";
      expect(buildExploration(d, MONTH, opts)).toMatchObject({ coverageKind: "nd", rows: [], gate: { reason: "Couverture fictive insuffisante" } });
    }
  });

  it("conserve la borne basse et la raison sans imputer des contrats manquants", () => {
    const d = reference();
    d.coverage[0].presenceStatus = "lower_bound";
    d.coverage[0].presenceReason = "Contrats archivés absents de la lecture fictive";
    const m = buildExploration(d, MONTH, opts);
    expect(m).toMatchObject({ coverageKind: "lower_bound", gate: null, total: { contracts: 5 } });
    expect(m.notices).toContain("Contrats archivés absents de la lecture fictive");
  });

  it("n'invente ni équipe ni ETP de lecture pour une DSN, et garde la quotité PayFit datée", () => {
    const d = reference();
    const payfit = buildExploration(d, MONTH, opts).rows[0];
    expect(payfit.fteAtRead).toMatchObject({ value: 1, reason: null, trace: { source: "payfit", date: "2026-10-21", period: null, collection: "contracts" } });
    d.build.source = "dsn";
    d.persons.forEach((p) => { p.teamName = null; });
    d.months.forEach((m) => { m.workedTime = null; m.fieldsNd.workedTime = { code: "not-in-source", reason: "Non porté par la DSN" }; m.timeUnit = "10"; });
    const m = buildExploration(d, MONTH, opts);
    expect(m.rows.every((r) => r.team.value === null)).toBe(true);
    expect(m.rows[0]).toMatchObject({ workedTime: { value: null, reason: "Non porté par la DSN" }, fteAtRead: { value: null }, timeUnitLabel: "h" });
    expect(explorationTimeGap(m.rows[0]).value).toBeNull();
  });

  it("distingue zéro, manque, unités, temps négatif et calcul exact travaillé moins payé", () => {
    const d = reference();
    d.months[0].paidTime = 0;
    d.months[0].workedTime = 0;
    d.months[1].paidTime = null;
    d.months[1].fieldsNd.paidTime = { code: "not-provided", reason: "Temps payé fictif absent" };
    d.months[2].workedTime = -10;
    d.months[3].paidTime = 0.1;
    d.months[3].workedTime = 0.3;
    const m = buildExploration(d, MONTH, opts);
    const zero = m.rows.find((r) => r.contractLabel === "C-1" && r.establishment.value === "ETAB-A")!;
    const absent = m.rows.find((r) => r.contractLabel === "C-1" && r.establishment.value === "ETAB-B")!;
    const negative = m.rows.find((r) => r.contractLabel === "C-2")!;
    const decimalRow = m.rows.find((r) => r.contractLabel === "C-3")!;
    expect(zero.paidTime).toMatchObject({ value: 0, reason: null });
    expect(explorationTimeGap(zero).value).toBe(0);
    expect(absent.paidTime).toMatchObject({ value: null, reason: "Temps payé fictif absent" });
    expect(explorationTimeGap(absent).value).toBeNull();
    expect(negative.workedTime.value).toBe(-10);
    expect(negative.notes).toContain("Temps négatif dans la source");
    expect(explorationTimeGap(negative).value).toBe(-160);
    expect(explorationTimeGap(decimalRow).value).toBe(0.2);
    const changed = structuredClone(decimalRow);
    changed.timeUnit = null;
    expect(explorationTimeGap(changed).value).toBeNull();
    changed.timeUnit = "forfait";
    expect(explorationTimeGap(changed).value).toBeNull();
  });

  it("un écart refuse traces absentes ou périodes/sources distinctes et résultats hors limite", () => {
    const row = model().rows[0];
    const noTrace = structuredClone(row);
    noTrace.workedTime.trace = null;
    expect(explorationTimeGap(noTrace).value).toBeNull();
    for (const field of ["period", "date", "source", "collection"] as const) {
      const changed = structuredClone(row);
      Object.assign(changed.workedTime.trace!, { [field]: field === "source" ? "dsn" : "autre" });
      expect(explorationTimeGap(changed).value).toBeNull();
    }
    const large = structuredClone(row);
    large.paidTime.value = -Number.MAX_SAFE_INTEGER;
    large.workedTime.value = Number.MAX_SAFE_INTEGER;
    expect(explorationTimeGap(large)).toMatchObject({ value: null, reason: "Écart hors limite numérique" });
    const imprecise = structuredClone(row);
    imprecise.paidTime.value = 0.123456789012345;
    imprecise.workedTime.value = 1000000000000000;
    expect(explorationTimeGap(imprecise).value).toBeNull();
  });
});
