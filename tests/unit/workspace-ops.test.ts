import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  absenceTypeRows,
  buildContractServiceMap,
  confidentialiteStateText,
  coverageRefusal,
  formatList,
  lostCoverage,
  NO_ADMIN_MESSAGE,
  orderOf,
  parseArgs,
  parseCodeList,
  parseMonthRange,
  parisMonth,
  parseSeuilOption,
  planConfidentialite,
  planKpiSettings,
  previousFromHistory,
  probeKpis,
  probeServiceEtp,
  rebuildDecision,
  rebuildOutcome,
  removalRefusal,
  removedCollections,
  renderAbsenceTypes,
  renderConfidentialitePlan,
  renderEspaces,
  renderOldSettings,
  renderPlan,
  renderProbe,
  renderWritten,
  resolveOldValue,
  RH_CURRENT_ANNOUNCE,
  RH_NO_ADMIN_REFUSAL,
  RH_NO_READ_REFUSAL,
  RH_REBUILD_ANNOUNCE,
  RH_REBUILD_REFUSAL,
  RH_REBUILT_DONE,
  RH_UP_TO_DATE_DONE,
  SEUIL_OPTION_ERROR,
  SYNC_FUTURE_MESSAGE,
  SYNC_MAX_MONTHS,
  syncCounterLines,
  syncMaxMonthsMessage,
  USAGE,
  waitBudget,
  type KpiAdminKey,
  type SettingOrigin,
} from "@/lib/admin/workspace-ops";
import { DEFAULT_CATEGORY_NATURES } from "@/lib/budget/categories";
import { monthRange } from "@/lib/connectors/months";
import { STALE_AFTER_MS } from "@/lib/connectors/sync";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { buildContractServiceMap as sharedServiceMap } from "@/lib/payroll/service-map";
import { KPI_KEYS, KPI_PARSERS } from "@/lib/rh-kpi-settings";
import { absence, DSN_ABSENCES, fixtureAbsences, kpiInput, readAbsences, TYPES_3 } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild, payfitFixtureBuild } from "./helpers/rh";

// Script d'administration d'un espace : fonctions pures, cas écrits à la main, valeurs fictives. Aucune base n'est lue ni
// écrite, mais workspace-ops.ts importe les calculs de l'écran (budget/monthly, réglages KPI) donc le client de base :
// une DATABASE_URL quelconque (factice) doit être définie à l'import, aucune connexion n'est ouverte (comme budget-monthly.test.ts).

// Horloge fixée : le 24/10/2026 à 12 h (Paris), mois courant 2026-10. Les plages de mois de --from / --to en dépendent.
const NOW = new Date("2026-10-24T10:00:00Z");

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
  it("pennylane-sync : plage de mois, --apply et --allow-removals facultatifs ; plage vide ou mois invalide refusés", () => {
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2025-11", "--to", "2026-02", "--apply"], NOW)).toEqual({
      ok: true, command: "pennylane-sync", slug: "espace-test", from: "2025-11", to: "2026-02", months: ["2025-11", "2025-12", "2026-01", "2026-02"], apply: true, allowRemovals: false,
    });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01", "--to", "2026-01"], NOW)).toMatchObject({ ok: true, months: ["2026-01"], apply: false, allowRemovals: false });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01", "--to", "2026-01", "--apply", "--allow-removals"], NOW)).toMatchObject({ ok: true, apply: true, allowRemovals: true });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-03", "--to", "2026-01"], NOW)).toMatchObject({ ok: false, error: expect.stringContaining("vide") });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-13", "--to", "2026-14"], NOW)).toMatchObject({ ok: false, error: expect.stringContaining("--from") });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01"], NOW)).toMatchObject({ ok: false, error: expect.stringContaining("--to") });
  });
  it("pennylane-sync : mêmes garde-fous que l'écran Données (mois de fin futur, plus de 24 mois) ; --allow-removals seul refusé", () => {
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01", "--to", "2062-01"], NOW)).toEqual({ ok: false, error: SYNC_FUTURE_MESSAGE });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2024-10", "--to", "2026-10"], NOW)).toEqual({ ok: false, error: "24 mois au plus par lecture." });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2024-11", "--to", "2026-10"], NOW)).toMatchObject({ ok: true });
    expect(parseArgs(["pennylane-sync", "espace-test", "--from", "2026-01", "--to", "2026-02", "--allow-removals"], NOW)).toMatchObject({ ok: false, error: expect.stringContaining("--apply") });
  });
  it("probe : mois triés et dédoublonnés, fenêtre du premier au dernier mois, anciens réglages facultatifs, --no-rebuild facultatif", () => {
    expect(parseArgs(["probe", "espace-test", "--months", "2026-03,2026-01,2026-03"])).toEqual({
      ok: true, command: "probe", slug: "espace-test", months: ["2026-01", "2026-03"], window: ["2026-01", "2026-02", "2026-03"], oldExclusions: null, oldAbsenceTypes: null, noRebuild: false,
    });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--old-exclusions", "20,10", "--old-absence-types", "test_a"])).toMatchObject({
      ok: true, window: ["2026-01"], oldExclusions: ["10", "20"], oldAbsenceTypes: ["test_a"], noRebuild: false,
    });
    expect(parseArgs(["probe", "espace-test", "--no-rebuild", "--months", "2026-01"])).toMatchObject({ ok: true, noRebuild: true });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--no-rebuild=oui"])).toMatchObject({ ok: false, error: expect.stringContaining("n'attend pas de valeur") });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-1"])).toMatchObject({ ok: false });
    expect(parseArgs(["probe", "espace-test", "--months", "2026-01", "--old-exclusions", "1"])).toMatchObject({ ok: false, error: expect.stringContaining("deux chiffres") });
  });
  it("confidentialite : --seuil entier ≥ 1 obligatoire, --dry-run facultatif ; valeurs non entières, nulles ou négatives refusées", () => {
    expect(parseArgs(["confidentialite", "espace-test", "--seuil", "5"])).toEqual({ ok: true, command: "confidentialite", slug: "espace-test", seuil: 5, dryRun: false });
    expect(parseArgs(["confidentialite", "--dry-run", "espace-test", "--seuil=1"])).toEqual({ ok: true, command: "confidentialite", slug: "espace-test", seuil: 1, dryRun: true });
    expect(parseArgs(["confidentialite", "espace-test"])).toMatchObject({ ok: false, error: expect.stringContaining("--seuil est obligatoire") });
    for (const bad of ["0", "-1", "2,5", "2.5", "cinq", "1e3", " ", "99999999999999999999"]) expect(parseArgs(["confidentialite", "espace-test", "--seuil", bad]), bad).toEqual({ ok: false, error: SEUIL_OPTION_ERROR });
    expect(parseArgs(["confidentialite", "espace-test", "--seuil"])).toMatchObject({ ok: false, error: expect.stringContaining("attend une valeur") });
    expect(parseArgs(["confidentialite", "espace-test", "--seuil", "5", "--apply"])).toMatchObject({ ok: false, error: expect.stringContaining("Option inconnue") });
    // L'option est lue comme le réglage enregistré (parseConfidentialite) : chiffres seulement, espaces autour tolérés.
    expect(parseSeuilOption(" 5 ")).toBe(5);
    expect(parseSeuilOption("05")).toBe(5);
    for (const bad of ["", "0", "-3", "3,0", "3.0", "+3", "trois"]) expect(parseSeuilOption(bad), bad).toBeNull();
  });
  it("espaces : aucun slug (la commande les liste tous) ; un slug ou une option sont refusés", () => {
    expect(parseArgs(["espaces"])).toEqual({ ok: true, command: "espaces" });
    expect(parseArgs(["espaces", "espace-test"])).toMatchObject({ ok: false, error: expect.stringContaining("ne prend pas de slug") });
    expect(parseArgs(["espaces", "--dry-run"])).toMatchObject({ ok: false, error: expect.stringContaining("Option inconnue") });
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
    expect(parseArgs(["absence-types", "espace-test", "--no-rebuild"])).toMatchObject({ ok: false, error: expect.stringContaining("Option inconnue") });
  });
  it("codes validés par les analyseurs des réglages enregistrés (KPI_PARSERS), pas par une copie des règles", () => {
    const candidates = ["10", "1", "123", "ab", "a b", "test_ok", "x".repeat(128), "x".repeat(129)];
    for (const c of candidates) {
      expect(parseCodeList(c, "--x", "nature").ok, `nature ${c.slice(0, 8)}`).toBe(KPI_PARSERS.excludedExitNatures([c]) !== null);
      expect(parseCodeList(c, "--x", "absence").ok, `absence ${c.slice(0, 8)}`).toBe(KPI_PARSERS.absenceTypes([c]) !== null);
    }
    // Références écrites à la main : « 10 » et « test_ok » acceptés, « 1 », « 123 » et « a b » refusés.
    expect(parseCodeList("20,10,20", "--x", "nature")).toEqual({ ok: true, value: ["10", "20"] });
    expect(parseCodeList("1", "--x", "nature").ok).toBe(false);
    expect(parseCodeList("123", "--x", "nature").ok).toBe(false);
    expect(parseCodeList("test_ok", "--x", "absence")).toEqual({ ok: true, value: ["test_ok"] });
    expect(parseCodeList("a b", "--x", "absence").ok).toBe(false);
  });
  it("USAGE annonce la reconstruction du référentiel par probe, --no-rebuild, --allow-removals et l'enregistrement explicite", () => {
    expect(USAGE).toContain("--no-rebuild");
    expect(USAGE).toContain("reconstruction");
    expect(USAGE).toContain("rh.rebuilt");
    expect(USAGE).toContain("sans administrateur");
    expect(USAGE).toContain("--allow-removals");
    expect(USAGE).toContain("enregistrée explicitement");
    expect(USAGE).toContain("--old-exclusions / --old-absence-types");
    expect(USAGE).toContain("24 mois au plus");
  });
  it("USAGE annonce confidentialite (clé, audit, ancienne clé jamais touchée) et espaces (slugs seulement)", () => {
    expect(USAGE).toContain("confidentialite <slug> --seuil N [--dry-run]");
    expect(USAGE).toContain("rh.confidentialite.seuil");
    expect(USAGE).toContain("rh.croisee.confidentialite");
    expect(USAGE).toContain("n'est jamais touchée");
    expect(USAGE).toContain("espaces");
    expect(USAGE).toContain("aucun nom");
  });
});

describe("seuil de confidentialité : plan avant / après et liste des espaces (valeurs de réglage fictives)", () => {
  const AT = new Date("2026-10-20T08:00:00Z");
  const set = (value: number, source: "seuil" | "croisee") => ({ setting: { kind: "set" as const, value, updatedAt: AT, updatedBy: "u1" }, source });
  const absent = { setting: { kind: "absent" as const }, source: null };
  it("état en clair : non défini, N personnes (clé), reprise de l'ancienne clé, illisible ; singulier à 1", () => {
    expect(confidentialiteStateText(absent)).toBe("non défini");
    expect(confidentialiteStateText(set(5, "seuil"))).toBe("5 personnes (clé rh.confidentialite.seuil)");
    expect(confidentialiteStateText(set(1, "seuil"))).toBe("1 personne (clé rh.confidentialite.seuil)");
    expect(confidentialiteStateText(set(3, "croisee"))).toBe("3 personnes (ancienne clé rh.croisee.confidentialite, reprise tant que rh.confidentialite.seuil est absente)");
    expect(confidentialiteStateText({ setting: { kind: "invalid", raw: "5" }, source: "seuil" })).toBe("illisible (clé rh.confidentialite.seuil)");
    expect(confidentialiteStateText({ setting: { kind: "invalid", raw: 0 }, source: "croisee" })).toBe("illisible (ancienne clé rh.croisee.confidentialite, reprise tant que rh.confidentialite.seuil est absente)");
  });
  it("plan : à écrire sauf si la nouvelle clé porte déjà la valeur ; la même valeur reprise de l'ancienne clé est écrite ; illisible réécrit", () => {
    expect(planConfidentialite(absent, 5)).toEqual({ before: "non défini", after: "5 personnes (clé rh.confidentialite.seuil)", changed: true });
    expect(planConfidentialite(set(5, "seuil"), 5)).toMatchObject({ changed: false });
    expect(planConfidentialite(set(4, "seuil"), 5)).toMatchObject({ before: "4 personnes (clé rh.confidentialite.seuil)", changed: true });
    expect(planConfidentialite(set(5, "croisee"), 5)).toMatchObject({ changed: true });
    expect(planConfidentialite({ setting: { kind: "invalid", raw: "5" }, source: "seuil" }, 5)).toMatchObject({ before: "illisible (clé rh.confidentialite.seuil)", changed: true });
    expect(renderConfidentialitePlan(planConfidentialite(set(5, "croisee"), 5))).toEqual([
      "Seuil de confidentialité (rh.confidentialite.seuil)",
      "  avant : 5 personnes (ancienne clé rh.croisee.confidentialite, reprise tant que rh.confidentialite.seuil est absente)",
      "  après : 5 personnes (clé rh.confidentialite.seuil)",
      "  à écrire",
    ]);
    expect(renderConfidentialitePlan(planConfidentialite(set(5, "seuil"), 5))[3]).toBe("  inchangé, rien à écrire");
  });
  it("espaces : slugs seulement, triés, avec l'état du seuil ; aucun espace", () => {
    expect(renderEspaces([{ slug: "espace-b", read: set(5, "seuil") }, { slug: "espace-a", read: absent }, { slug: "espace-c", read: set(2, "croisee") }])).toEqual([
      "Espaces : 3 (slugs seulement, aucun nom). Seuil de confidentialité :",
      "  espace-a : non défini",
      "  espace-b : 5 personnes (clé rh.confidentialite.seuil)",
      "  espace-c : 2 personnes (ancienne clé rh.croisee.confidentialite, reprise tant que rh.confidentialite.seuil est absente)",
    ]);
    expect(renderEspaces([])).toEqual(["Aucun espace."]);
  });
});

describe("plage de mois", () => {
  it("inclusive, à cheval sur deux années ; début après fin ou mois invalide refusés", () => {
    expect(parseMonthRange("2025-11", "2026-02", NOW)).toEqual({ ok: true, value: ["2025-11", "2025-12", "2026-01", "2026-02"] });
    expect(parseMonthRange("2026-05", "2026-05", NOW)).toEqual({ ok: true, value: ["2026-05"] });
    expect(parseMonthRange("2026-05", "2026-04", NOW)).toMatchObject({ ok: false });
    expect(parseMonthRange("2026-00", "2026-04", NOW)).toMatchObject({ ok: false });
  });
  it("24 mois acceptés (novembre 2024 → octobre 2026 : 2 + 12 + 10), 25 mois refusés", () => {
    const ok = parseMonthRange("2024-11", "2026-10", NOW);
    expect(ok.ok && ok.value.length).toBe(24);
    expect(ok.ok && [ok.value[0], ok.value[23]]).toEqual(["2024-11", "2026-10"]);
    expect(parseMonthRange("2024-10", "2026-10", NOW)).toEqual({ ok: false, error: "24 mois au plus par lecture." });
  });
  it("mois de fin futur refusé, même pour une faute de frappe à des centaines de mois ; le mois courant est accepté", () => {
    expect(parseMonthRange("2026-10", "2026-11", NOW)).toEqual({ ok: false, error: "Le mois de fin ne peut pas être dans le futur." });
    expect(parseMonthRange("2026-01", "2062-01", NOW)).toEqual({ ok: false, error: SYNC_FUTURE_MESSAGE });
    expect(parseMonthRange("2026-10", "2026-10", NOW)).toEqual({ ok: true, value: ["2026-10"] });
    expect(parseMonthRange("2026-12", "2026-11", NOW)).toMatchObject({ ok: false, error: expect.stringContaining("vide") }); // l'ordre des contrôles est celui de l'écran
  });
  it("mois courant au calendrier de Paris : le 1er octobre à 1 h 30 (Paris) est déjà octobre ; le 31 octobre à 23 h 30 (Paris) est déjà novembre", () => {
    const nuitSeptembre = new Date("2026-09-30T23:30:00Z"); // 1er octobre, 1 h 30 à Paris (UTC+2)
    expect(parisMonth(nuitSeptembre)).toBe("2026-10");
    expect(parseMonthRange("2026-10", "2026-10", nuitSeptembre)).toEqual({ ok: true, value: ["2026-10"] });
    expect(parseMonthRange("2026-10", "2026-11", new Date("2026-10-31T22:30:00Z"))).toMatchObject({ ok: false }); // 31 octobre, 23 h 30 à Paris
    expect(parseMonthRange("2026-10", "2026-11", new Date("2026-10-31T23:30:00Z"))).toEqual({ ok: true, value: ["2026-10", "2026-11"] }); // 1er novembre, 0 h 30 à Paris (UTC+1)
  });
  it("mêmes valeurs et mêmes messages que l'écran Données (launchSync dans donnees/actions.ts, fichier « use server » non importable)", () => {
    const screen = readFileSync(resolve(process.cwd(), "src/app/e/[slug]/donnees/actions.ts"), "utf8");
    expect(Number(/const MAX_MONTHS = (\d+);/.exec(screen)?.[1])).toBe(SYNC_MAX_MONTHS);
    expect(SYNC_MAX_MONTHS).toBe(24);
    expect(screen).toContain("${MAX_MONTHS} mois au plus par lecture.");
    expect(syncMaxMonthsMessage()).toBe("24 mois au plus par lecture.");
    expect(screen).toContain(`"${SYNC_FUTURE_MESSAGE}"`);
    expect(screen).toContain('timeZone: "Europe/Paris"');
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
        { key: "excludedExitNatures", label: "Natures de sortie exclues du turnover", before: ["10", "20"], after: [], origin: "setting", changed: true, explicit: false },
        { key: "absenceTypes", label: "Motifs d'absence retenus pour l'absentéisme", before: ["test_sickness"], after: ["test_accident", "test_sickness"], origin: "default", changed: true, explicit: false },
      ],
    });
    if (!plan.ok) return;
    expect(renderPlan(plan, (k) => KPI_KEYS[k])).toEqual([
      "Natures de sortie exclues du turnover (rh.kpi.turnover.excludedExitNatures)",
      "  avant : 10, 20 (enregistré)",
      "  après : aucune",
      "  à écrire",
      "Motifs d'absence retenus pour l'absentéisme (rh.kpi.absence.types)",
      "  avant : test_sickness (valeur par défaut)",
      "  après : test_accident, test_sickness",
      "  à écrire",
    ]);
  });
  it("valeurs déjà conformes ET déjà enregistrées : aucune clé à écrire", () => {
    const plan = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_accident", "test_sickness"] }, origins: origins({ excludedExitNatures: "setting", absenceTypes: "setting" }), present, absenceTypes: ["test_sickness", "test_accident"] });
    expect(plan).toMatchObject({ ok: true, changedKeys: [] });
    if (plan.ok) expect(renderPlan(plan, (k) => KPI_KEYS[k]).filter((l) => l.includes("rien à écrire"))).toHaveLength(2);
  });
  it("aucune exclusion par défaut, clé non enregistrée : la liste vide est ENREGISTRÉE explicitement (décision, pas seulement un défaut)", () => {
    const plan = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_accident", "test_sickness"] }, origins: origins({ excludedExitNatures: "default", absenceTypes: "setting" }), present, absenceTypes: ["test_sickness", "test_accident"] });
    expect(plan).toEqual({
      ok: true,
      changedKeys: ["excludedExitNatures"],
      rows: [
        { key: "excludedExitNatures", label: "Natures de sortie exclues du turnover", before: [], after: [], origin: "default", changed: true, explicit: true },
        { key: "absenceTypes", label: "Motifs d'absence retenus pour l'absentéisme", before: ["test_accident", "test_sickness"], after: ["test_accident", "test_sickness"], origin: "setting", changed: false, explicit: false },
      ],
    });
    if (!plan.ok) return;
    const lines = renderPlan(plan, (k) => KPI_KEYS[k]);
    expect(lines.slice(0, 3)).toEqual(["Natures de sortie exclues du turnover (rh.kpi.turnover.excludedExitNatures)", "  avant : aucune (valeur par défaut)", "  après : aucune"]);
    expect(lines[3]).toContain("à enregistrer explicitement");
    expect(lines[7]).toBe("  inchangé, rien à écrire");
    const written = renderWritten(plan, (k) => KPI_KEYS[k]);
    expect(written[0]).toBe("Écrit : rh.kpi.turnover.excludedExitNatures (un événement d'audit par clé). Aucun autre réglage touché.");
    expect(written[1]).toContain("Natures de sortie exclues du turnover : aucune, enregistrée explicitement");
    expect(written).toHaveLength(2);
  });
  it("décision explicite limitée aux exclusions : motifs d'absence égaux au défaut non enregistrés ou exclusions déjà enregistrées vides ne sont pas réécrits ; illisible : réécrit sans être « explicite »", () => {
    const sameAsDefault = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_sickness"] }, origins: origins({ excludedExitNatures: "setting", absenceTypes: "default" }), present, absenceTypes: ["test_sickness"] });
    expect(sameAsDefault).toMatchObject({ ok: true, changedKeys: [] });
    const invalid = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_sickness"] }, origins: origins({ excludedExitNatures: "invalid", absenceTypes: "setting" }), present, absenceTypes: ["test_sickness"] });
    expect(invalid).toMatchObject({ ok: true, changedKeys: ["excludedExitNatures"] });
    if (invalid.ok) expect(invalid.rows[0]).toMatchObject({ changed: true, explicit: false });
  });
  it("renderWritten sans décision explicite : une seule ligne", () => {
    const plan = planKpiSettings({ current, origins: origins(), present, absenceTypes: ["test_sickness", "test_accident"] });
    if (!plan.ok) throw new Error("plan refusé");
    expect(renderWritten(plan, (k) => KPI_KEYS[k])).toEqual(["Écrit : rh.kpi.turnover.excludedExitNatures, rh.kpi.absence.types (un événement d'audit par clé). Aucun autre réglage touché."]);
  });
  it("un code absent de la lecture : refus avec la liste triée des codes inconnus, rien d'écrit", () => {
    const plan = planKpiSettings({ current, origins: origins(), present, absenceTypes: ["test_zz", "test_accident", "test_inconnu"] });
    expect(plan).toMatchObject({ ok: false, unknownCodes: ["test_inconnu", "test_zz"], blockedKeys: [] });
    expect(!plan.ok && plan.error).toContain("test_inconnu, test_zz");
  });
  it("lecture sans aucun motif d'absence : tous les codes demandés sont inconnus", () => {
    expect(planKpiSettings({ current, origins: origins(), present: [], absenceTypes: ["test_sickness"] })).toMatchObject({ ok: false, unknownCodes: ["test_sickness"] });
  });
  it("un autre réglage illisible : refus (setKpiSettings le réécrirait à sa valeur par défaut) ; un des deux réglages concernés illisible : à réécrire", () => {
    expect(planKpiSettings({ current, origins: origins({ dayBasis: "invalid" }), present, absenceTypes: ["test_sickness"] })).toMatchObject({ ok: false, blockedKeys: ["dayBasis"] });
    const own = planKpiSettings({ current: { excludedExitNatures: [], absenceTypes: ["test_sickness"] }, origins: origins({ excludedExitNatures: "setting", absenceTypes: "invalid" }), present, absenceTypes: ["test_sickness"] });
    expect(own).toMatchObject({ ok: true, changedKeys: ["absenceTypes"] });
    if (own.ok) expect(renderPlan(own, (k) => KPI_KEYS[k])[5]).toBe("  avant : illisible (réécrit par la commande)");
  });
  it("formatList : « aucune » pour une liste vide", () => {
    expect(formatList([])).toBe("aucune");
    expect(formatList(["a", "b"])).toBe("a, b");
  });
});

describe("motifs d'absence de la lecture active (jamais un compteur)", () => {
  it("union triée des types lus et des types retenus absents de la lecture ; code non retenable signalé ; « présent » / « retenu » seulement", () => {
    // Les compteurs 3, 5 et 1 (lecture) sont ignorés : un effectif faible par code révélerait une situation individuelle.
    const rows = absenceTypeRows([{ type: "test_sickness", count: 3 }, { type: "test_paid_leave", count: 5 }, { type: "type avec espace", count: 1 }], ["test_sickness", "test_old"]);
    expect(rows).toEqual([
      { type: "test_old", chosen: true, inRead: false, retainable: true },
      { type: "test_paid_leave", chosen: false, inRead: true, retainable: true },
      { type: "test_sickness", chosen: true, inRead: true, retainable: true },
      { type: "type avec espace", chosen: false, inRead: true, retainable: false },
    ]);
    const lines = renderAbsenceTypes(rows);
    expect(lines).toEqual([
      "  test_old : absent de la lecture · retenu : oui",
      "  test_paid_leave : présent · retenu : non",
      "  test_sickness : présent · retenu : oui",
      "  type avec espace : présent · retenu : non · non retenable (espace ou plus de 128 caractères)",
    ]);
    // Aucun chiffre : le seul « 128 » est la limite de longueur d'un code, dans la remarque d'un code non retenable.
    expect(lines.filter((l) => !l.includes("non retenable")).join("\n")).not.toMatch(/\d/);
    expect(lines[3].replace("128", "")).not.toMatch(/\d/);
    expect(renderAbsenceTypes([])).toEqual(["Aucun motif d'absence dans la lecture active."]);
  });
  it("lecture sans compteur : mêmes lignes", () => {
    expect(absenceTypeRows([{ type: "test_a" }], [])).toEqual([{ type: "test_a", chosen: false, inRead: true, retainable: true }]);
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

describe("garde-fous de --apply (suppressions, couverture des mois)", () => {
  it("suppressions : collections au compteur « supprimé(s) » non nul, triées, nombres seulement ; aucune suppression : liste vide", () => {
    const diff = {
      ledger_lines: { total: 10, added: 2, changed: 1, removed: 0 },
      accounts: { total: 4, added: 0, changed: 0, removed: 1 },
      "Nom avec espace": { total: 3, added: 0, changed: 0, removed: 3 },
    };
    expect(removedCollections(diff)).toEqual([{ collection: "accounts", removed: 1 }, { collection: "collection", removed: 3 }]);
    expect(removedCollections({ accounts: { total: 4, added: 1, changed: 1, removed: 0 } })).toEqual([]);
    expect(removedCollections(undefined)).toEqual([]);
    expect(removalRefusal(removedCollections(diff))).toBe(
      "--apply refusé : 4 enregistrement(s) supprimé(s) par rapport à la lecture appliquée (accounts : 1, collection : 3). L'aperçu reste en attente, à examiner dans Données ; --allow-removals l'applique malgré tout.",
    );
  });
  // Lecture appliquée du 15/03/2026 sur janvier à mars : janvier et février sont terminés (couverts), mars ne l'est pas (n.d.).
  const read = { months: ["2026-01", "2026-02", "2026-03"], readAt: new Date("2026-03-15T10:00:00Z") };
  it("couverture : seuls les mois COUVERTS de la lecture appliquée comptent (mars, n.d. à la lecture, peut sortir de la plage)", () => {
    expect(lostCoverage(read, ["2026-02", "2026-03", "2026-04"])).toEqual(["2026-01"]);
    expect(lostCoverage(read, ["2026-01", "2026-02"])).toEqual([]);
    expect(lostCoverage(read, ["2026-04"])).toEqual(["2026-01", "2026-02"]);
    expect(lostCoverage(read, ["2025-12", "2026-01", "2026-02", "2026-03"])).toEqual([]);
  });
  it("couverture : aucune lecture Pennylane appliquée, rien à perdre", () => {
    expect(lostCoverage(null, ["2026-01"])).toEqual([]);
  });
  it("couverture : date de lecture au calendrier de Paris (31/03 à 22 h 30 UTC = 1er avril à Paris : mars est déjà terminé donc couvert)", () => {
    const night = { months: ["2026-01", "2026-02", "2026-03"], readAt: new Date("2026-03-31T22:30:00Z") };
    expect(lostCoverage(night, ["2026-01", "2026-02"])).toEqual(["2026-03"]);
  });
  it("message de refus de couverture", () => {
    expect(coverageRefusal(["2026-01", "2026-02"])).toBe(
      "--apply refusé : la plage demandée ne couvre pas 2 mois couvert(s) par la lecture Pennylane appliquée (2026-01, 2026-02) ; ils disparaîtraient de la couverture comptable. Étendre la plage, ou --allow-removals pour l'accepter.",
    );
  });
});

describe("délai d'attente d'une lecture", () => {
  it("une minute en deçà du délai d'expiration : 15 minutes ⇒ 14 minutes (840 000 ms)", () => {
    expect(waitBudget(15 * 60 * 1000)).toEqual({ maxWaitMs: 840_000, waitMinutes: 14, staleMinutes: 15 });
  });
  it("dérivé de STALE_AFTER_MS (sync.ts), jamais recalé à la main", () => {
    expect(waitBudget(STALE_AFTER_MS).maxWaitMs).toBe(STALE_AFTER_MS - 60_000);
    expect(waitBudget(STALE_AFTER_MS).maxWaitMs).toBeLessThan(STALE_AFTER_MS);
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

describe("anciens réglages : sortie de la sonde", () => {
  it("retrouvés (option, journal) : une seule ligne, valeurs et provenance", () => {
    expect(renderOldSettings({ value: ["10"], source: "journal" }, { value: [], source: "option" })).toEqual([
      "Anciens réglages : exclusions de sortie = 10 (journal d'audit) ; motifs d'absence = aucun (option de la commande).",
    ]);
  });
  it("introuvables : la sortie dit qu'une valeur par défaut n'est jamais journalisée et quelle option fournir", () => {
    const both = renderOldSettings({ value: null, source: "introuvable" }, { value: null, source: "introuvable" });
    expect(both).toEqual([
      "Anciens réglages : exclusions de sortie inconnues (introuvable dans le journal d'audit) ; motifs d'absence inconnus (introuvable dans le journal d'audit).",
      "  Exclusions de sortie introuvables : une valeur par défaut n'est jamais journalisée ; les fournir par --old-exclusions.",
      "  Motifs d'absence introuvables : une valeur par défaut n'est jamais journalisée ; les fournir par --old-absence-types.",
    ]);
    const onlyTypes = renderOldSettings({ value: ["10"], source: "option" }, { value: null, source: "introuvable" });
    expect(onlyTypes).toHaveLength(2);
    expect(onlyTypes[1]).toContain("--old-absence-types");
    expect(onlyTypes.join("\n")).not.toContain("--old-exclusions");
  });
});

describe("référentiel Collaborateurs de la sonde : reconstruction annoncée, refusable", () => {
  it("référentiel à jour : utilisé sans rien écrire, quelles que soient les options (même sans administrateur)", () => {
    expect(rebuildDecision({ current: true, noRebuild: false, hasAdmin: true })).toEqual({ action: "use-current" });
    expect(rebuildDecision({ current: true, noRebuild: true, hasAdmin: false })).toEqual({ action: "use-current" });
  });
  it("périmé ou absent avec --no-rebuild : refus « référentiel périmé ou absent : ouvrir l'écran Collaborateurs », avant même le contrôle de l'administrateur", () => {
    expect(RH_REBUILD_REFUSAL).toBe("référentiel périmé ou absent : ouvrir l'écran Collaborateurs");
    expect(rebuildDecision({ current: false, noRebuild: true, hasAdmin: true })).toEqual({ action: "refuse", reason: RH_REBUILD_REFUSAL });
    expect(rebuildDecision({ current: false, noRebuild: true, hasAdmin: false })).toEqual({ action: "refuse", reason: RH_REBUILD_REFUSAL });
  });
  it("périmé ou absent sans administrateur : écriture refusée comme les autres commandes ; avec administrateur : reconstruction", () => {
    expect(rebuildDecision({ current: false, noRebuild: false, hasAdmin: false })).toEqual({ action: "refuse", reason: RH_NO_ADMIN_REFUSAL });
    expect(RH_NO_ADMIN_REFUSAL).toContain("aucun administrateur");
    expect(NO_ADMIN_MESSAGE).toBe("Aucun administrateur dans cet espace : écriture refusée.");
    expect(rebuildDecision({ current: false, noRebuild: false, hasAdmin: true })).toEqual({ action: "rebuild" });
  });
  it("annonces de la sortie : écriture dans les tables rh_* et événement rh.rebuilt ; à jour : non reconstruit ; fin de reconstruction", () => {
    expect(RH_REBUILD_ANNOUNCE).toContain("rh_*");
    expect(RH_REBUILD_ANNOUNCE).toContain("rh.rebuilt");
    expect(RH_REBUILD_ANNOUNCE).toContain("écriture");
    expect(RH_CURRENT_ANNOUNCE).toContain("non reconstruit");
    expect(RH_REBUILT_DONE).toContain("écriture effectuée");
    expect(RH_UP_TO_DATE_DONE).toContain("aucune écriture");
  });
  it("aucune lecture RH appliquée : refus direct, sans annonce de reconstruction, avant --no-rebuild et le contrôle de l'administrateur", () => {
    expect(RH_NO_READ_REFUSAL).toBe("aucune lecture appliquée : rien à reconstruire, aucune écriture");
    for (const noRebuild of [false, true]) {
      for (const hasAdmin of [false, true]) expect(rebuildDecision({ current: false, noRebuild, hasAdmin, noRead: true }), `${noRebuild} ${hasAdmin}`).toEqual({ action: "refuse", reason: RH_NO_READ_REFUSAL });
    }
    // Sans l'option, décision inchangée.
    expect(rebuildDecision({ current: false, noRebuild: false, hasAdmin: true, noRead: false })).toEqual({ action: "rebuild" });
  });
  it("sortie après reconstruction : « none » traité avant le choix du message d'écriture ; même build qu'avant = aucune écriture ; indisponible refusé", () => {
    // Lecture disparue entre la sonde et la reconstruction : ni « reconstruit », ni « déjà à jour » ; refus sans écriture.
    expect(rebuildOutcome("b1", { kind: "none" })).toEqual({ done: null, refusal: RH_NO_READ_REFUSAL });
    expect(rebuildOutcome(null, { kind: "none" })).toEqual({ done: null, refusal: RH_NO_READ_REFUSAL });
    // Le build rendu est celui sondé (b1) : aucune écriture. Un autre (b2), ou aucun build courant avant : écriture effectuée.
    expect(rebuildOutcome("b1", { kind: "ready", build: { id: "b1" } })).toEqual({ done: RH_UP_TO_DATE_DONE, refusal: null, build: { id: "b1" } });
    expect(rebuildOutcome("b1", { kind: "ready", build: { id: "b2" } })).toEqual({ done: RH_REBUILT_DONE, refusal: null, build: { id: "b2" } });
    expect(rebuildOutcome(null, { kind: "ready", build: { id: "b2" } })).toEqual({ done: RH_REBUILT_DONE, refusal: null, build: { id: "b2" } });
    expect(rebuildOutcome(null, { kind: "unavailable", build: { id: "b3" } })).toEqual({ done: RH_REBUILT_DONE, refusal: "référentiel Collaborateurs indisponible (unavailable)" });
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
  it("une seule règle : le script réexporte la fonction du module partagé avec l'écran Masse salariale (payroll/service-map.ts), même résultat", () => {
    expect(buildContractServiceMap).toBe(sharedServiceMap);
    const lines = [L("1", "2026-05", "645", "C1", "SALES"), L("2", "2026-05", "641100", "C1", "TECH")];
    expect(Object.fromEntries(sharedServiceMap(lines, DEFAULT_PREFIXES, "SERVICE"))).toEqual({ "2026-05|C1": "TECH" });
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
    // DSN : arrêts non extraits ⇒ aucune ligne de motif, taux tous motifs n.d. avec le même code (rh-kpi-motifs.test.ts).
    expect(p.motifs).toEqual({ lines: [], all: { kind: "nd", code: "not-extracted" } });
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
  it("PayFit : ETP proratisé par mois, genre et code n.d. seulement : n.d. avant la couverture, borne basse avant la limite de conservation (21/10/2025), exact en février 2026 (28/5), n.d. après la référence", async () => {
    // Références de rh-kpi-etp-prorata.test.ts (lecture fictive du 21/10/2026) : 2024-09 hors couverture ; 2025-09 en borne basse ; 2026-02 exact ; 2026-10 après la référence.
    const input = kpiInput(await payfitFixtureBuild(), await fixtureAbsences(), { absenceTypes: ["test_sickness"] });
    const p = probeKpis(input, ["2024-09", "2025-09", "2026-02", "2026-10"], ["2025-11"], { excludedExitNatures: null, absenceTypes: null });
    expect(p.etpProrated).toEqual([
      { month: "2024-09", cell: { kind: "nd", code: "before-coverage" } },
      { month: "2025-09", cell: { kind: "lower_bound", code: null } },
      { month: "2026-02", cell: { kind: "exact", code: null } },
      { month: "2026-10", cell: { kind: "nd", code: "after-reference" } },
    ]);
    // Le stock de fin de mois est inchangé et sorti à part, mois par mois.
    expect(p.etpEnd.map((e) => e.month)).toEqual(p.etpProrated.map((e) => e.month));
    expect(p.etpEnd[2].cell).toEqual({ kind: "exact", code: null });
  });
});

// Absentéisme par motif, avril 2026 (références de rh-kpi-motifs.test.ts) : deux motifs de la lecture, test_paid_leave 18/120 et
// test_sickness 10/120, tous motifs 22/120 ; les valeurs ne sortent jamais de la sonde, seuls le nombre de lignes et les genres.
describe("diagnostic de l'absentéisme par motif (nombre de lignes, genre par ligne, jamais une valeur)", async () => {
  const data = await payfitEdgeBuild({
    collaborators: [{ id: "P-1" }, { id: "P-2" }],
    contracts: [
      { contractId: "C-1", collaboratorId: "P-1", startDate: "2025-01-01", endDate: null },
      { contractId: "C-2", collaboratorId: "P-2", startDate: "2025-01-01", endDate: null },
    ],
  });
  const day = (id: string, contract: string, from: string, to: string, type: string) => absence(id, contract, from, "beginning-of-day", to, "end-of-day", { type });
  const rows = [
    day("a1", "C-1", "2026-04-06", "2026-04-10", "test_sickness"),
    day("a2", "C-1", "2026-04-08", "2026-04-14", "test_paid_leave"),
    day("a3", "C-2", "2026-04-20", "2026-04-21", "test_paid_leave"),
    day("a4", "C-1", "2026-03-02", "2026-03-03", "test_sickness"),
  ];
  const probeOf = (absences = readAbsences(rows)) => probeKpis(kpiInput(data, absences, { absenceTypes: ["test_sickness"] }), ["2026-04"], ["2026-04"], { excludedExitNatures: null, absenceTypes: null });

  it("deux lignes exactes et un taux tous motifs exact", () => {
    expect(probeOf().motifs).toEqual({ lines: [{ kind: "exact", code: null }, { kind: "exact", code: null }], all: { kind: "exact", code: null } });
  });
  it("motif incertain (début sans moment) : sa ligne et le taux tous motifs sont en borne basse, les autres lignes restent exactes", () => {
    const a5 = absence("a5", "C-2", "2026-04-27", null, "2026-04-28", "end-of-day", { type: "test_other" });
    // Ordre des motifs : test_other, test_paid_leave, test_sickness.
    expect(probeOf(readAbsences([...rows, a5])).motifs).toEqual({
      lines: [{ kind: "lower_bound", code: null }, { kind: "exact", code: null }, { kind: "exact", code: null }],
      all: { kind: "lower_bound", code: null },
    });
  });
  it("mois non lu par la lecture d'absences : chaque ligne et le taux tous motifs n.d. avec leur code, jamais zéro", () => {
    const p = probeOf(readAbsences(rows, ["2026-03"]));
    expect(p.motifs).toEqual({ lines: [{ kind: "nd", code: "month-nd" }, { kind: "nd", code: "month-nd" }], all: { kind: "nd", code: "month-nd" } });
  });
  it("lecture sans aucune absence : aucune ligne, taux tous motifs n.d. « no-absence-motif »", () => {
    expect(probeOf(readAbsences([])).motifs).toEqual({ lines: [], all: { kind: "nd", code: "no-absence-motif" } });
  });
  it("aucune valeur dans les cellules : seulement « kind » et « code »", () => {
    const m = probeOf().motifs;
    for (const c of [...m.lines, m.all]) expect(Object.keys(c).sort()).toEqual(["code", "kind"]);
  });
  it("sortie rendue : nombre de lignes, genre par ligne (sans le code du motif), taux tous motifs ; aucun autre chiffre", () => {
    const p = probeOf();
    const text = renderProbe({ months: ["2026-04"], service: [{ month: "2026-04", cell: { kind: "nd", code: "journal-unavailable" }, sumEqualsTotal: null }], kpi: p }).join("\n");
    expect(text).toContain("Absentéisme par motif (fenêtre 2026-04 → 2026-04)");
    expect(text).toContain("  Lignes de motif : 2");
    expect(text).toContain("  ligne 1 : exact");
    expect(text).toContain("  ligne 2 : exact");
    expect(text).toContain("  Taux tous motifs : exact");
    expect(text).toContain("  ETP proratisé : ");
    expect(text).not.toContain("test_sickness");
    expect(text).not.toContain("test_paid_leave");
    const stripped = text.replace(/\d{4}-\d{2}/g, "").replace(/\(\d+ mois\)/g, "").replace(/Lignes de motif : \d+/, "").replace(/ligne \d+ :/g, "");
    expect(stripped).not.toMatch(/\d/);
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
    expect(text).toContain("  ETP proratisé : ");
    expect(text).toContain("  Lignes de motif : 0"); // absences non extraites (entrée DSN) : aucune ligne
    expect(text).toContain("  Taux tous motifs : nd (code not-extracted)");
    const stripped = text.replace(/\d{4}-\d{2}/g, "").replace(/\(\d+ mois\)/g, "").replace(/Lignes de motif : \d+/, "");
    expect(stripped).not.toMatch(/\d/);
    for (const x of [...p.etpEnd, ...p.etpProrated, ...service]) expect(Object.keys(x.cell).sort()).toEqual(["code", "kind"]);
  });
});
