import { describe, expect, it } from "vitest";
import {
  absenceTypeRows,
  buildContractServiceMap,
  formatList,
  orderOf,
  parseArgs,
  parseMonthRange,
  planKpiSettings,
  previousFromHistory,
  probeKpis,
  probeServiceEtp,
  renderAbsenceTypes,
  renderPlan,
  renderProbe,
  resolveOldValue,
  syncCounterLines,
  type KpiAdminKey,
  type SettingOrigin,
} from "@/lib/admin/workspace-ops";
import { DEFAULT_CATEGORY_NATURES } from "@/lib/budget/categories";
import { monthRange } from "@/lib/connectors/months";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { DSN_ABSENCES, fixtureAbsences, kpiInput, TYPES_3 } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";

// Script d'administration d'un espace : fonctions pures, cas écrits à la main, valeurs fictives.

describe("lecture des arguments", () => {
  it("absence-types : commande et slug", () => {
    expect(parseArgs(["absence-types", "espace-test"])).toEqual({ ok: true, command: "absence-types", slug: "espace-test" });
  });
  it("kpi-settings : liste triée et dédoublonnée ; formes « --nom valeur » et « --nom=valeur » ; options avant le slug", () => {
    const expected = { ok: true, command: "kpi-settings", slug: "espace-test", excludeNone: true, absenceTypes: ["test_a", "test_b"], dryRun: false };
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types", "test_b,test_a,test_b"])).toEqual(expected);
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types=test_a,test_b"])).toEqual(expected);
    expect(parseArgs(["kpi-settings", "--dry-run", "--exclude-none", "espace-test", "--absence-types", "test_a"])).toEqual({ ...expected, absenceTypes: ["test_a"], dryRun: true });
  });
  it("kpi-settings : refus sans --exclude-none, sans liste, liste vide, segment vide, code avec espace", () => {
    expect(parseArgs(["kpi-settings", "espace-test", "--absence-types", "test_a"])).toMatchObject({ ok: false, error: expect.stringContaining("--exclude-none") });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none"])).toMatchObject({ ok: false, error: expect.stringContaining("--absence-types") });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types", ""])).toMatchObject({ ok: false });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types", "test_a,,test_b"])).toMatchObject({ ok: false, error: expect.stringContaining("virgule") });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types", "test a"])).toMatchObject({ ok: false, error: expect.stringContaining("sans espace") });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types"])).toMatchObject({ ok: false, error: expect.stringContaining("attend une valeur") });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none", "--absence-types", "--dry-run"])).toMatchObject({ ok: false, error: expect.stringContaining("attend une valeur") });
  });
  it("pennylane-sync : plage de mois, --apply facultatif ; plage vide ou mois invalide refusés", () => {
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2025-11", "--to", "2026-02", "--apply"])).toEqual({
      ok: true, command: "pennylane-sync", slug: "espace-test", from: "2025-11", to: "2026-02", months: ["2025-11", "2025-12", "2026-01", "2026-02"], apply: true,
    });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01", "--to", "2026-01"])).toMatchObject({ ok: true, months: ["2026-01"], apply: false });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-03", "--to", "2026-01"])).toMatchObject({ ok: false, error: expect.stringContaining("vide") });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-13", "--to", "2026-14"])).toMatchObject({ ok: false, error: expect.stringContaining("--from") });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01"])).toMatchObject({ ok: false, error: expect.stringContaining("--to") });
  });
  it("probe : mois triés et dédoublonnés, fenêtre du premier au dernier mois, anciens réglages facultatifs", () => {
    expect(parseArgs(["probe", "espace-test", "--months", "2026-03,2026-01,2026-03"])).toEqual({
      ok: true, command: "probe", slug: "espace-test", months: ["2026-01", "2026-03"], window: ["2026-01", "2026-02", "2026-03"], oldExclusions: null, oldAbsenceTypes: null,
    });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--old-exclusions", "20,10", "--old-absence-types", "test_a"])).toMatchObject({
      ok: true, window: ["2026-01"], oldExclusions: ["10", "20"], oldAbsenceTypes: ["test_a"],
    });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-1"])).toMatchObject({ ok: false });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--old-exclusions", "1"])).toMatchObject({ ok: false, error: expect.stringContaining("deux chiffres") });
  });
  it("refus : commande absente ou inconnue, slug absent ou en trop, option inconnue ou étrangère à la commande", () => {
    expect(parseArgs([])).toMatchObject({ ok: false, error: "Commande manquante." });
    expect(parseArgs(["supprimer", "espace-test"])).toMatchObject({ ok: false, error: expect.stringContaining("Commande inconnue") });
    expect(parseArgs(["absence-types"])).toMatchObject({ ok: false, error: expect.stringContaining("Slug") });
    expect(parseArgs(["absence-types", "a", "b"])).toMatchObject({ ok: false, error: expect.stringContaining("en trop") });
    expect(parseArgs(["absence-types", "espace-test", "--apply"])).toMatchObject({ ok: false, error: expect.stringContaining("Option inconnue") });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--apply"])).toMatchObject({ ok: false });
    expect(parseArgs(["kpi-settings", "espace-test", "--exclude-none=oui", "--absence-types", "a"])).toMatchObject({ ok: false, error: expect.stringContaining("n'attend pas de valeur") });
    expect(parseArgs(["kpi-settings", "espace-test", "--dry-run", "--dry-run", "--exclude-none", "--absence-types", "a"])).toMatchObject({ ok: false, error: expect.stringContaining("répétée") });
    expect(parseArgs(["absence-types", "../etc"])).toMatchObject({ ok: false, error: expect.stringContaining("invalide") });
  });
});

describe("plage de mois", () => {
  it("inclusive, à cheval sur deux années ; début après fin ou mois invalide refusés", () => {
    expect(parseMonthRange("2025-11", "2026-02")).toEqual({ ok: true, value: ["2025-11", "2025-12", "2026-01", "2026-02"] });
    expect(parseMonthRange("2026-05", "2026-05")).toEqual({ ok: true, value: ["2026-05"] });
    expect(parseMonthRange("2026-05", "2026-04")).toMatchObject({ ok: false });
    expect(parseMonthRange("2026-00", "2026-04")).toMatchObject({ ok: false });
  });
});

describe("plan des réglages KPI (avant / après)", () => {
  const origins = (over: Record<string, SettingOrigin> = {}): Record<string, SettingOrigin> => ({ excludedExitNatures: "setting", absenceTypes: "default", dayBasis: "default", ...over });
  const present = ["test_accident", "test_paid_leave", "test_rtt", "test_sickness"];
  const current: Record<KpiAdminKey, string[]> = { excludedExitNatures: ["20", "10"], absenceTypes: ["test_sickness"] };

  it("exclusions retirées et types remplacés : deux clés à écrire, avant / après rendus en clair", () => {
    const plan = planKpiSettings({ current, origins: origins(), present, absenceTypes: ["test_sickness", "test_accident"] });
    expect(plan).toEqual({
      ok: true,
      changedKeys: ["excludedExitNatures", "absenceTypes"],
      rows: [
        { key: "excludedExitNatures", label: "Natures de sortie exclues du turnover", before: ["10", "20"], after: [], origin: "setting", changed: true },
        { key: "absenceTypes", label: "Types d'absence retenus pour l'absentéisme", before: ["test_sickness"], after: ["test_accident", "test_sickness"], origin: "default", changed: true },
      ],
    });
    if (!plan.ok) return;
    expect(renderPlan(plan, (k) => KPI_KEYS[k])).toEqual([
      "Natures de sortie exclues du turnover (rh.kpi.turnover.excludedExitNatures)",
      "  avant : 10, 20 (enregistré)",
      "  après : aucune",
      "  à écrire",
      "Types d'absence retenus pour l'absentéisme (rh.kpi.absence.types)",
      "  avant : test_sickness (valeur par défaut)",
      "  après : test_accident, test_sickness",
      "  à écrire",
    ]);
  });
  it("valeurs déjà conformes : aucune clé à écrire", () => {
    const plan = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_accident", "test_sickness"] }, origins: origins({ excludedExitNatures: "default", absenceTypes: "setting" }), present, absenceTypes: ["test_sickness", "test_accident"] });
    expect(plan).toMatchObject({ ok: true, changedKeys: [] });
    if (plan.ok) expect(renderPlan(plan, (k) => KPI_KEYS[k]).filter((l) => l.includes("rien à écrire"))).toHaveLength(2);
  });
  it("un code absent de la lecture : refus avec la liste triée des codes inconnus, rien d'écrit", () => {
    const plan = planKpiSettings({ current, origins: origins(), present, absenceTypes: ["test_zz", "test_accident", "test_inconnu"] });
    expect(plan).toMatchObject({ ok: false, unknownCodes: ["test_inconnu", "test_zz"], blockedKeys: [] });
    expect(!plan.ok && plan.error).toContain("test_inconnu, test_zz");
  });
  it("lecture sans aucun type d'absence : tous les codes demandés sont inconnus", () => {
    expect(planKpiSettings({ current, origins: origins(), present: [], absenceTypes: ["test_sickness"] })).toMatchObject({ ok: false, unknownCodes: ["test_sickness"] });
  });
  it("un autre réglage illisible : refus (setKpiSettings le réécrirait à sa valeur par défaut) ; un des deux réglages concernés illisible : à réécrire", () => {
    expect(planKpiSettings({ current, origins: origins({ dayBasis: "invalid" }), present, absenceTypes: ["test_sickness"] })).toMatchObject({ ok: false, blockedKeys: ["dayBasis"] });
    const own = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_sickness"] }, origins: origins({ excludedExitNatures: "default", absenceTypes: "invalid" }), present, absenceTypes: ["test_sickness"] });
    expect(own).toMatchObject({ ok: true, changedKeys: ["absenceTypes"] });
    if (own.ok) expect(renderPlan(own, (k) => KPI_KEYS[k])[5]).toBe("  avant : illisible (réécrit par la commande)");
  });
  it("formatList : « aucune » pour une liste vide", () => {
    expect(formatList([])).toBe("aucune");
    expect(formatList(["a", "b"])).toBe("a, b");
  });
});

describe("types d'absence de la lecture active", () => {
  it("union triée des types lus et des types retenus absents de la lecture ; code non retenable signalé", () => {
    const rows = absenceTypeRows([{ type: "test_sickness", count: 3 }, { type: "test_paid_leave", count: 5 }, { type: "type avec espace", count: 1 }], ["test_sickness", "test_old"]);
    expect(rows).toEqual([
      { type: "test_old", count: 0, chosen: true, inRead: false, retainable: true },
      { type: "test_paid_leave", count: 5, chosen: false, inRead: true, retainable: true },
      { type: "test_sickness", count: 3, chosen: true, inRead: true, retainable: true },
      { type: "type avec espace", count: 1, chosen: false, inRead: true, retainable: false },
    ]);
    expect(renderAbsenceTypes(rows)).toEqual([
      "  test_old : absent de la lecture · retenu : oui",
      "  test_paid_leave : 5 absence(s) · retenu : non",
      "  test_sickness : 3 absence(s) · retenu : oui",
      "  type avec espace : 1 absence(s) · retenu : non · non retenable (espace ou plus de 128 caractères)",
    ]);
    expect(renderAbsenceTypes([])).toEqual(["Aucun type d'absence dans la lecture active."]);
  });
});

describe("compteurs de synchronisation", () => {
  it("nombres seulement, collections triées", () => {
    expect(syncCounterLines({ ledger_lines: { total: 10, added: 2, changed: 1, removed: 0 }, accounts: { total: 4, added: 0, changed: 0, removed: 1 } })).toEqual([
      "  accounts : 4 au total, 0 ajouté(s), 0 modifié(s), 1 supprimé(s)",
      "  ledger_lines : 10 au total, 2 ajouté(s), 1 modifié(s), 0 supprimé(s)",
    ]);
    expect(syncCounterLines(undefined)).toEqual(["  aucun compteur par collection"]);
  });
});

describe("ordre de deux taux exacts", () => {
  const exact = (num: number, den: number) => ({ kind: "exact", ratio: { num, den } });
  it("4/27 > 2/27 ; 1/3 = 2/6 ; 1/3 < 1/2", () => {
    expect(orderOf(exact(4, 27), exact(2, 27))).toBe("gt");
    expect(orderOf(exact(1, 3), exact(2, 6))).toBe("eq");
    expect(orderOf(exact(1, 3), exact(1, 2))).toBe("lt");
  });
  it("produits croisés au-delà des entiers sûrs (BigInt) : 9007199254740991/9007199254740992 < 1", () => {
    expect(orderOf(exact(9007199254740991, 9007199254740992), exact(1, 1))).toBe("lt");
  });
  it("une valeur en borne basse, n.d. ou sans taux : non comparable", () => {
    expect(orderOf({ kind: "lower_bound", ratio: { num: 1, den: 2 } }, exact(1, 2))).toBe("nc");
    expect(orderOf(exact(1, 2), { kind: "nd" })).toBe("nc");
  });
});

describe("ancien réglage retrouvé dans le journal d'audit", () => {
  const parse = (v: unknown) => (Array.isArray(v) ? (v as string[]) : null);
  it("valeur la plus récente qui diffère de la valeur actuelle ; valeurs illisibles ignorées", () => {
    expect(previousFromHistory([[], ["10"], ["10", "20"]], [], parse)).toEqual(["10"]);
    expect(previousFromHistory([["10"], [], ["20", "10"]], ["10"], parse)).toEqual([]);
    expect(previousFromHistory(["illisible", ["20", "10"]], [], parse)).toEqual(["10", "20"]);
  });
  it("aucune valeur différente : introuvable ; l'option explicite l'emporte", () => {
    expect(previousFromHistory([[], []], [], parse)).toBeNull();
    expect(previousFromHistory([], [], parse)).toBeNull();
    expect(resolveOldValue(["10"], [["20"]], [], parse)).toEqual({ value: ["10"], source: "option" });
    expect(resolveOldValue(null, [[], ["20"]], [], parse)).toEqual({ value: ["20"], source: "journal" });
    expect(resolveOldValue(null, [[]], [], parse)).toEqual({ value: null, source: "introuvable" });
  });
});

const L = (key: string, month: string, accountId: string, contractId: string | null, service: string | null): LedgerLine => ({
  key, month, accountId, accountName: null, debitCents: 100, creditCents: null, contractId, analytic: service ? [{ type: "SERVICE", code: service, value: service }] : [],
});

describe("service d'un contrat par mois (table utilisée pour l'ETP par service)", () => {
  it("le brut l'emporte sur les cotisations, les contreparties et les lignes sans contrat sont ignorées, un autre mois est une autre clé", () => {
    const map = buildContractServiceMap(
      [
        L("1", "2026-05", "645", "C1", "SALES"), // cotisations (rang 1)
        L("2", "2026-05", "641100", "C1", "TECH"), // brut (rang 2) : l'emporte
        L("3", "2026-05", "421", "C1", "AUTRE"), // contrepartie : ignorée
        L("4", "2026-05", "645", "C2", null), // rang 1, sans service : non ventilé
        L("5", "2026-05", "421", "C3", "TECH"), // contrepartie seule : absent de la table
        L("6", "2026-05", "641100", null, "TECH"), // sans contrat : ignorée
        L("7", "2026-06", "641100", "C1", "SALES"),
      ],
      DEFAULT_PREFIXES,
      "SERVICE",
    );
    expect(Object.fromEntries(map)).toEqual({ "2026-05|C1": "TECH", "2026-05|C2": null, "2026-06|C1": "SALES" });
    expect(map.has("2026-05|C3")).toBe(false);
  });
});

describe("diagnostic structurel des KPI (jamais une valeur)", async () => {
  it("DSN : turnover actuel (4/27, aucune exclusion) comparé à l'ancien (exclusion 02 : 2/27) ⇒ supérieur ; absentéisme n.d. « not-extracted » des deux côtés ⇒ non comparable", () => {
    const input = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
    const p = probeKpis(input, ["2026-09"], monthRange("2025-01", "2025-12"), { excludedExitNatures: ["02"], absenceTypes: ["test_sickness"] });
    expect(p.window).toEqual({ from: "2025-01", to: "2025-12", months: 12 });
    expect(p.etpEnd).toEqual([{ month: "2026-09", cell: { kind: "exact", code: null } }]);
    expect(p.turnover).toEqual({ current: { kind: "exact", code: null }, old: { kind: "exact", code: null }, order: "gt" });
    expect(p.absenteeism).toEqual({ current: { kind: "nd", code: "not-extracted" }, old: { kind: "nd", code: "not-extracted" }, order: "nc" });
  });
  it("PayFit : ETP fin de mois exact / borne basse / n.d. avant la couverture / n.d. après la référence ; absentéisme maladie seule (0/420) < tous types (60/420) ; ancien turnover non calculé sans ancien réglage", async () => {
    const input = kpiInput(await payfitFixtureBuild(), await fixtureAbsences(), { absenceTypes: ["test_sickness"] });
    const p = probeKpis(input, ["2024-09", "2025-09", "2026-09", "2026-10"], ["2025-11"], { excludedExitNatures: null, absenceTypes: TYPES_3 });
    expect(p.etpEnd.map((e) => e.cell)).toEqual([
      { kind: "nd", code: "before-coverage" },
      { kind: "lower_bound", code: null },
      { kind: "exact", code: null },
      { kind: "nd", code: "after-reference" },
    ]);
    expect(p.absenteeism).toEqual({ current: { kind: "exact", code: null }, old: { kind: "exact", code: null }, order: "lt" });
    expect(p.turnover.old).toBeNull();
    expect(p.turnover.order).toBeNull();
  });
});

describe("diagnostic de l'ETP par service (même chemin que l'écran Effectifs mensuels)", async () => {
  const kpi = kpiInput(await payfitFixtureBuild(), DSN_ABSENCES);
  const ext = (suffix: string) => kpi.data.contracts.find((c) => c.externalId.endsWith(suffix))!.externalId;
  // Septembre 2026 : sept contrats comptés, ETP 1 / 0,8 / 1 / 1 / 1 / 0,8 / 0,5 = 6,1 (références du KPI RH).
  // TECH : 001 + 002 + 008 = 1 + 0,8 + 0,5 = 2,3 ; SALES : 004 + 005 + 006 + 007 = 1 + 1 + 1 + 0,8 = 3,8 ; somme 6,1.
  const assign: [string, string][] = [["001", "TECH"], ["002", "TECH"], ["004", "SALES"], ["005", "SALES"], ["006", "SALES"], ["007", "SALES"], ["008", "TECH"]];
  const sept = (skip: string[] = []) => assign.filter(([s]) => !skip.includes(s)).map(([s, svc], i) => L(`s${i}`, "2026-09", "641100", ext(s), svc));
  const other = [L("b1", "2025-09", "641100", ext("001"), "TECH"), L("c1", "2024-09", "641100", ext("001"), "TECH")];
  const journalOf = (lines: LedgerLine[], serviceAxis: string | null = "SERVICE"): JournalInput => ({ months: ["2024-09", "2025-09", "2026-09"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis, lines });
  const run = (lines: LedgerLine[], months: string[]) =>
    probeServiceEtp({ kpi, journal: journalOf(lines), contractService: buildContractServiceMap(lines, DEFAULT_PREFIXES, "SERVICE"), natures: DEFAULT_CATEGORY_NATURES, overrides: {}, months });

  it("exact avec somme des services = ETP fin de mois (2,3 + 3,8 = 6,1) ; mois sans ligne de paie n.d. ; ETP n.d. ou en borne basse : code de l'ETP", () => {
    const r = run([...sept(), ...other], ["2024-09", "2025-09", "2026-08", "2026-09"]);
    expect(r).toEqual([
      { month: "2024-09", cell: { kind: "nd", code: "before-coverage" }, sumEqualsTotal: null },
      { month: "2025-09", cell: { kind: "nd", code: "etp-lower-bound" }, sumEqualsTotal: null },
      { month: "2026-08", cell: { kind: "nd", code: "no-ledger-lines" }, sumEqualsTotal: null },
      { month: "2026-09", cell: { kind: "exact", code: null }, sumEqualsTotal: true },
    ]);
  });
  it("contrat 008 sans ligne de paie en septembre : il tombe hors des services (2,3 − 0,5 + 3,8 = 5,6 ≠ 6,1) ⇒ somme différente", () => {
    const r = run([...sept(["008"]), ...other], ["2026-09"]);
    expect(r).toEqual([{ month: "2026-09", cell: { kind: "exact", code: null }, sumEqualsTotal: false }]);
  });
  it("sans journal ou sans axe de service choisi : n.d. avec un code, tous mois", () => {
    const months = ["2026-08", "2026-09"];
    const base = { kpi, contractService: null, natures: DEFAULT_CATEGORY_NATURES, overrides: {}, months };
    expect(probeServiceEtp({ ...base, journal: null }).map((x) => x.cell)).toEqual([{ kind: "nd", code: "journal-unavailable" }, { kind: "nd", code: "journal-unavailable" }]);
    expect(probeServiceEtp({ ...base, journal: journalOf([], null) }).map((x) => x.cell)).toEqual([{ kind: "nd", code: "service-axis-unset" }, { kind: "nd", code: "service-axis-unset" }]);
  });
  it("sortie rendue : aucun chiffre hors mois et nombre de mois de la fenêtre (ni montant, ni effectif, ni taux)", () => {
    const months = ["2025-09", "2026-09"];
    const lines = [...sept(), ...other];
    const service = run(lines, months);
    const p = probeKpis(kpi, months, ["2025-11"], { excludedExitNatures: ["02"], absenceTypes: TYPES_3 });
    const text = renderProbe({ months, service, kpi: p }).join("\n");
    expect(text).toContain("Mois 2026-09");
    expect(text).toContain("somme des services égale à l'ETP fin de mois : oui");
    expect(text.replace(/\d{4}-\d{2}/g, "").replace(/\(\d+ mois\)/g, "")).not.toMatch(/\d/);
    for (const x of [...p.etpEnd, ...service]) expect(Object.keys(x.cell).sort()).toEqual(["code", "kind"]);
  });
});
