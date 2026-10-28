import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { absenceDaysShown, absenteeismShown, etpProratedShown, etpShown, theoreticalShown } from "@/app/e/[slug]/studio-rh/kpi/components";
import { categoriesSheet, suiviColumns, suiviSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { coverageShown, kpiSuiviOf } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { syntheseOf } from "@/app/e/[slug]/studio-rh/masse-salariale/synthese-data";
import { monthlySheet } from "@/app/e/[slug]/studio-rh/masse-salariale/export/sheets";
import { BasesView } from "@/app/e/[slug]/studio-rh/hypotheses/BasesView";
import { CMP_NONE, ComparisonView } from "@/app/e/[slug]/studio-rh/hypotheses/ComparisonView";
import { EnveloppesView } from "@/app/e/[slug]/studio-rh/hypotheses/EnveloppesView";
import { GlobalesView } from "@/app/e/[slug]/studio-rh/hypotheses/GlobalesView";
import { GridTools } from "@/app/e/[slug]/studio-rh/hypotheses/GridTools";
import { loadComparison, projectionRows } from "@/app/e/[slug]/studio-rh/hypotheses/resultat-data";
import { constantsSheet, envelopesSheet, projectionSheet, ratesSheet } from "@/app/e/[slug]/studio-rh/hypotheses/export/sheets";
import { constantsOf, envelopesOf, rateMap, rateScopes } from "@/app/e/[slug]/studio-rh/hypotheses/grids-data";
import { project } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { formatMonth } from "@/lib/dates";
import { XLSX_MIME } from "@/lib/export/response";
import { buildWorkbook, EMPTY_CELL_NOTE, type ExportCell } from "@/lib/export/xlsx";
import type { ConfidentialiteSetting } from "@/lib/confidentialite";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import type { HeadcountResult } from "@/lib/rh/headcount";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import type { KpiRow } from "@/lib/rh/kpi/types";
import { fmtEtp4, fmtHalfDays } from "@/lib/rh/kpi/format";
import { rollingWindow } from "@/lib/rh/kpi/period";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { fmtInt, showCount, showHeadcount, type Shown } from "@/lib/rh/view";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild } from "./helpers/rh";

// Exports Excel des écrans chiffrés (KPI RH, Masse salariale, Hypothèses budgétaires). Données entièrement fictives (fixtures DSN de
// test, journal et scénario écrits à la main) ; les cas de référence sont calculés à la main dans les commentaires.

// --- Doubles : accès à l'espace, contextes chargés, lectures de sources, scénarios ---------------------------------------------
const mocks = vi.hoisted(() => ({
  role: { value: "editor" as "reader" | "editor" | "admin" },
  kpiCtx: { value: null as unknown },
  payCtx: { value: null as unknown },
  scenario: { value: null as unknown },
  budgets: { value: [] as unknown[] },
  getScenario: vi.fn(),
  // Seuil de confidentialité de l'espace (Masse salariale) : 1 par défaut dans ces tests (aucun groupe dénombré masqué).
  conf: { value: { kind: "set", value: 1, updatedAt: null, updatedBy: null } as unknown },
}));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace fictif", slug, role: mocks.role.value } }),
}));
vi.mock("@/lib/rh/kpi-context", () => ({ loadKpiContext: async () => mocks.kpiCtx.value }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => mocks.payCtx.value }));
vi.mock("@/lib/connectors/sync", () => ({
  lastSync: async (_w: string, p: string) => (p === "payfit" || p === "dsn" ? { status: "applied", startedAt: new Date("2026-01-15T09:00:00Z"), finishedAt: new Date("2026-01-15T09:12:00Z") } : null),
  activeSync: async (_w: string, p: string) => (p === "payfit" || p === "dsn" ? { decidedAt: new Date("2026-01-15T09:30:00Z") } : null),
  SYNC_STATUS_LABELS: { applied: "Appliquée (active)" },
}));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));
vi.mock("@/lib/budget/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/store")>()),
  getScenario: (...args: unknown[]) => mocks.getScenario(...args),
  listScenarios: async () => [],
  listBudgets: async () => mocks.budgets.value,
}));

const load = async (res: Response) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
  return wb;
};
const noteOf = (c: ExcelJS.Cell): string | null => (c.note ? (typeof c.note === "string" ? c.note : c.note.texts?.map((t) => t.text).join("") ?? "") : null);
const isNd = (c: ExportCell): c is { nd: string } => typeof c === "object" && c !== null && "nd" in c;
const ndText = (s: Shown) => s.text.replace(/^n\.d\. — /, "");
// Ligne de données d'une feuille (en-tête en ligne 5 : titre, espace, filtres, note) : valeurs de la colonne 1 à n.
const rowValues = (ws: ExcelJS.Worksheet, r: number, n: number) => Array.from({ length: n }, (_, i) => ws.getCell(r, i + 1).value);
const ROUTES = {
  kpi: () => import("@/app/e/[slug]/studio-rh/kpi/export/route"),
  "masse-salariale": () => import("@/app/e/[slug]/studio-rh/masse-salariale/export/route"),
  "masse-salariale/ecart": () => import("@/app/e/[slug]/studio-rh/masse-salariale/ecart/export/route"),
  hypotheses: () => import("@/app/e/[slug]/studio-rh/hypotheses/export/route"),
};
const call = async (path: keyof typeof ROUTES, query: string) => {
  const { GET } = await ROUTES[path]();
  return GET(new NextRequest(`http://localhost/e/demo/studio-rh/${path}/export?${query}`), { params: Promise.resolve({ slug: "demo" }) });
};

// --- KPI RH -------------------------------------------------------------------------------------------------------------------
// Fixture DSN de test (référentiel fictif) : 12 mois glissants d'octobre 2025 à septembre 2026. Valeurs de référence (vérifiées à la
// main dans les tests du moteur) : effectif fin janvier 2026 = 6 personnes ; ETP fin septembre 2026 = 6,10 (61 000 dix-millièmes) ;
// jours théoriques de décembre 2025 = 434 demi-journées = 217 jours ; absentéisme : n.d. (arrêts non extraits de la DSN).
const dsn = dsnFixtureBuild();
const kpiCtx = {
  collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "editor" }, establishments: [], natures: { codes: ["01", "02"], origin: "default" }, payfitHistory: null, state: null },
  settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
  input: { ...kpiInput(dsn, DSN_ABSENCES), openMonths: [] },
  readTypes: [],
} as unknown as KpiContext;
// Seuil de confidentialité de 1 personne pour les lectures pures du Suivi : aucun groupe dénombré masqué, aucune garde (masquage et
// garde vérifiés dans kpi-confidentialite.test.ts et kpi-categories.test.ts).
const SEUIL_1: ConfidentialiteSetting = { kind: "set", value: 1, updatedAt: null, updatedBy: null };

describe("KPI RH › Suivi : la feuille « Mois par mois » reprend les lignes et les n.d. de l'écran", () => {
  const s = kpiSuiviOf(kpiCtx, {}, SEUIL_1);
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  const sheet = suiviSheet({ dash: s.dash, data: s.data, rawLimit: null, vue: "suivi" });
  const cols = suiviColumns("suivi");
  // Cellules de l'écran (mêmes fonctions que kpi/page.tsx), colonne par colonne.
  const screen = s.dash.rows.map((r) => ({
    coverage: coverageShown(s.data, r.month, s.input.scope.establishments, null),
    headcount: showHeadcount(r.headcount, "persons"),
    etp: etpShown(r.etp),
    "etp-prorated": etpProratedShown(r.etpProrated),
    entries: showCount(r.movements.entries),
    exits: showCount(r.movements.exits),
    theoretical: theoreticalShown(r.theoretical),
    "absence-days": absenceDaysShown(r.absenteeism),
    absenteeism: absenteeismShown(r.absenteeism),
    "etp-n1": etpShown(r.previous.etp),
    "absenteeism-n1": absenteeismShown(r.previous.absenteeism),
  }));

  it("mêmes mois, dans le même ordre, puis les lignes « Période » (moyennes, puis totaux et taux)", () => {
    expect(s.dash.rows.map((r) => r.month)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(sheet.rows.map((r) => r[0])).toEqual([...s.dash.rows.map((r) => r.month), "Période — moyennes", "Période — totaux et taux"]);
    expect(sheet.columns.map((c) => c.key)).toEqual(["mois", ...cols, "observations"]);
  });

  it("lignes « Période » : moyennes au centième (format ETP), totaux au format de leur colonne (cas de référence écrit à la main)", () => {
    // Fixture : effectif fin de mois 7 chaque mois sauf janvier 2026 (6) → 83 ÷ 12 = 6,9166… personnes ; ETP 5,6 × 3, 5,1 puis
    // 6,1 × 8 → 70,7 ÷ 12 = 5,8916… (707 000 dix-millièmes ÷ 120 000) ; une entrée (février 2026) et une sortie (décembre 2025) ;
    // jours théoriques : 217 + 210 + 217 + 186 + 182 + 217 + 210 + 217 + 210 + 217 + 217 + 210 = 2 510 jours.
    const avg = sheet.rows.at(-2)!;
    const tot = sheet.rows.at(-1)!;
    const at = (row: ExportCell[], col: string) => row[cols.indexOf(col as never) + 1];
    expect(at(avg, "headcount")).toEqual({ exact: 83 / 12 });
    expect(at(avg, "etp")).toEqual({ exact: 707_000 / 120_000 });
    expect([at(avg, "entries"), at(avg, "exits"), at(avg, "theoretical")]).toEqual(["", "", ""]);
    expect([at(tot, "entries"), at(tot, "exits")]).toEqual([1, 1]); // entiers : « 1 », jamais « 1,00 »
    expect(at(tot, "theoretical")).toEqual({ exact: 2510 });
    expect([at(tot, "headcount"), at(tot, "etp"), at(tot, "etp-prorated")]).toEqual(["", "", ""]);
    expect(isNd(at(tot, "absenteeism"))).toBe(true);
    // Seule la ligne des moyennes prend le format au centième dans les colonnes d'effectif.
    expect(sheet.rowKinds).toEqual([...Array(12).fill(undefined), "etp", undefined]);
    expect(String(avg.at(-1))).toBe(`Moyennes des fins de mois (${s.dash.window.label})`);
    expect(String(tot.at(-1))).toBe(`Totaux des mois (${s.dash.window.label}) ; absentéisme : taux de la période`);
    // Turnover : moyenne d'effectif puis totaux ; Absentéisme : une seule ligne (aucune moyenne affichée).
    expect(suiviSheet({ dash: s.dash, data: s.data, rawLimit: null, vue: "turnover" }).rows.slice(12).map((r) => r[0])).toEqual(["Période — moyennes", "Période — totaux"]);
    const abs = suiviSheet({ dash: s.dash, data: s.data, rawLimit: null, vue: "absenteisme" });
    expect(abs.rows.slice(12).map((r) => r[0])).toEqual(["Période — totaux et taux"]);
    expect(abs.rowKinds?.every((k) => k === undefined)).toBe(true);
  });

  it("réserves que l'écran met en infobulle (déclarés après leur fin, mouvements neutralisés, borne basse) : reprises dans Observations", () => {
    // Lignes fictives écrites à la main à partir des deux premiers mois de la fixture.
    const [r0, r1] = s.dash.rows;
    const hc = r0.headcount as Exclude<HeadcountResult, { kind: "nd" }>;
    const rows: KpiRow[] = [
      { ...r0, headcount: { ...hc, kind: "exact", declaredAfterEnd: 2 }, movements: { ...r0.movements, entries: { kind: "exact", value: 1, qualifiers: ["1 mouvement(s) de contrats continus neutralisé(s)"] } } },
      { ...r1, headcount: { ...hc, kind: "lower_bound", declaredAfterEnd: 1 }, movements: { ...r1.movements, entries: { kind: "lower_bound", value: 2, qualifiers: ["borne basse (PayFit)"] }, exits: { kind: "lower_bound", value: 0, qualifiers: [] } } },
    ];
    // Infobulles de l'écran (mêmes fonctions que kpi/page.tsx).
    expect(showHeadcount(rows[0].headcount, "persons").foot).toBe("2 déclaré(s) après leur fin, non compté(s)");
    expect(showCount(rows[0].movements.entries).foot).toBe("1 mouvement(s) de contrats continus neutralisé(s)");
    expect(showHeadcount(rows[1].headcount, "persons").foot).toBe("borne basse (voir la couverture du mois) · 1 déclaré(s) après leur fin, non compté(s)");
    const sh = suiviSheet({ dash: { ...s.dash, rows }, data: s.data, rawLimit: null, vue: "suivi" });
    expect(sh.rows[0].at(-1)).toBe("Effectif fin de mois (personnes) : 2 déclaré(s) après leur fin, non compté(s) ; Entrées : 1 mouvement(s) de contrats continus neutralisé(s)");
    expect(sh.rows[1].at(-1)).toBe("Effectif fin de mois (personnes) : borne basse (au moins) · 1 déclaré(s) après leur fin, non compté(s) ; Entrées : borne basse (PayFit) ; Sorties : borne basse (au moins)");
    // Les valeurs restent celles de l'écran (7 personnes, 1 et 2 entrées, 0 sortie) : la réserve ne change pas le chiffre.
    expect([sh.rows[0][2], sh.rows[0][5], sh.rows[1][2], sh.rows[1][5], sh.rows[1][6]]).toEqual([7, 1, 7, 2, 0]);
  });

  it("chaque cellule : n.d. de l'écran → n.d. avec la même raison (jamais 0) ; valeur de l'écran → vrai nombre ; borne basse → observation", () => {
    let nd = 0;
    screen.forEach((cells, i) => {
      cols.forEach((c, j) => {
        const shown = cells[c as keyof typeof cells];
        const cell = sheet.rows[i][j + 1];
        if (shown.kind === "nd") {
          nd += 1;
          expect(isNd(cell), `${s.dash.rows[i].month} ${c}`).toBe(true);
          expect((cell as { nd: string }).nd).toBe(ndText(shown));
        } else {
          expect(isNd(cell), `${s.dash.rows[i].month} ${c}`).toBe(false);
          expect(cell === "" ? "vide" : "valeur").toBe("valeur");
        }
        if (shown.kind === "lower") expect(String(sheet.rows[i].at(-1))).toContain("borne basse");
        // Nombres entiers : le texte de l'écran se relit depuis la cellule.
        if (shown.kind === "value" && (c === "headcount" || c === "entries" || c === "exits")) expect(fmtInt(cell as number)).toBe(shown.text);
        if (shown.kind === "value" && (c === "etp" || c === "etp-n1")) expect(fmtEtp4(cell as number)).toBe(shown.text);
        if (shown.kind === "value" && c === "theoretical") expect(fmtHalfDays((cell as { exact: number }).exact * 2)).toBe(shown.text);
      });
    });
    expect(nd).toBeGreaterThan(0); // l'absentéisme DSN est n.d. : le cas est bien couvert
  });

  it("cas de référence : effectif fin janvier 2026 = 6, ETP fin septembre 2026 = 61 000 dix-millièmes, décembre 2025 = 217 jours théoriques", () => {
    const at = (month: string, col: string) => sheet.rows[s.dash.rows.findIndex((r) => r.month === month)][cols.indexOf(col as never) + 1];
    expect(at("2026-01", "headcount")).toBe(6);
    expect(at("2026-09", "etp")).toBe(61_000);
    expect(at("2025-12", "theoretical")).toEqual({ exact: 217 }); // 434 demi-journées ÷ 2
    expect(isNd(at("2026-01", "absenteeism"))).toBe(true);
  });

  it("Turnover : seules les colonnes de l'écran (couverture, effectif, entrées, sorties)", () => {
    expect(suiviColumns("turnover")).toEqual(["coverage", "headcount", "entries", "exits"]);
    expect(suiviSheet({ dash: s.dash, data: s.data, rawLimit: null, vue: "turnover" }).columns.map((c) => c.header)).toEqual(["Mois", "Couverture", "Effectif fin de mois (personnes)", "Entrées", "Sorties", "Observations"]);
  });

  it("par catégorie : mois n.d. → n.d. dans chaque colonne ; catégorie absente du mois → cellule vide (sans objet), jamais 0 ; cellule masquée → n.d. avec sa raison, total conservé", () => {
    // Les mois reçus sont ceux de l'écran (loadCategoryMonths) : cellules déjà masquées par le seuil, total calculé avant masquage.
    const sh = categoriesSheet(
      [
        { kind: "value", month: "2026-01", lowerBound: false, byCategory: { cdi: { kind: "value", headcount: 3, etp4: 25_000 }, cdd: { kind: "value", headcount: 1, etp4: null } }, total: { headcount: 4, etp4: null } },
        { kind: "nd", month: "2026-02", reason: "raison fictive" },
        { kind: "value", month: "2026-03", lowerBound: false, byCategory: { cdi: { kind: "nd", reason: "non affiché (seuil de confidentialité : 2 personnes)" }, cdd: { kind: "nd", reason: "non affiché (seuil de confidentialité : 2 personnes)" } }, total: { headcount: 4, etp4: 35_000 } },
      ],
      ["cdi", "cdd", "stagiaire"],
      { cdi: "CDI", cdd: "CDD", stagiaire: "Stagiaire" },
    );
    // Total janvier : 3 + 1 = 4 contrats ; ETP total n.d. (un contrat CDD sans ETP de fin de mois). La raison ne présume pas de la
    // cause (quotité absente, contrat non déclaré…) : l'écran n'écrit que « ETP n.d. », la cause est dans le détail de l'ETP.
    const cat = "ETP fin de mois n.d. pour au moins un contrat de la catégorie (raison : détail de l'ETP fin de mois)";
    const total = "ETP fin de mois n.d. pour au moins un contrat du mois (raison : détail de l'ETP fin de mois)";
    expect(sh.rows[0]).toEqual(["2026-01", 3, 25_000, 1, { nd: cat }, "", "", 4, { nd: total }, ""]);
    expect(sh.rows[1].slice(1, -1).every((c) => isNd(c))).toBe(true);
    const masked = { nd: "non affiché (seuil de confidentialité : 2 personnes)" };
    expect(sh.rows[2]).toEqual(["2026-03", masked, masked, masked, masked, "", "", 4, 35_000, ""]);
    expect(sh.note).toBe("Fin de mois ; catégorie sans contrat ce mois-là : cellule vide.");
  });

  it("par catégorie avec un filtre Établissement ou Nature : la note reprend la mention du périmètre de l'écran (les filtres s'appliquent)", () => {
    const scope = "Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.";
    const sh = categoriesSheet([{ kind: "value", month: "2026-01", lowerBound: false, byCategory: { cdd: { kind: "value", headcount: 1, etp4: 5_000 } }, total: { headcount: 1, etp4: 5_000 } }], ["cdd"], { cdd: "CDD" }, { scope });
    expect(sh.note).toBe(`Fin de mois ; catégorie sans contrat ce mois-là : cellule vide. ${scope}`);
    expect(sh.note).not.toContain("ne s'appliquent pas"); // la note contraire du lot 11 a disparu
    expect(sh.rows).toEqual([["2026-01", 1, 5_000, 1, 5_000, ""]]);
    expect(categoriesSheet([], [], {}, { scope: null }).note).toBe("Fin de mois ; catégorie sans contrat ce mois-là : cellule vide.");
  });
});

describe("route d'export de KPI RH (Excel)", () => {
  beforeEach(() => {
    mocks.kpiCtx.value = kpiCtx;
    mocks.role.value = "reader"; // aucune donnée nominative : un lecteur exporte comme il lit l'écran
  });

  it("Suivi : classeur Excel, onglets de données puis Filtres, Sources et Définitions ; vrais nombres et n.d. avec raison", async () => {
    const res = await call("kpi", "format=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(XLSX_MIME);
    expect(res.headers.get("content-disposition")).toContain('filename="kpi-rh-suivi.xlsx"');
    const wb = await load(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Mois par mois", "Par catégorie", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Mois par mois")!;
    expect(ws.getCell("A5").value).toBe("Mois");
    expect(ws.getCell("A6").value).toBe("2025-10");
    expect(ws.getCell("A18").value).toBe("Période — moyennes");
    expect(ws.getCell("A19").value).toBe("Période — totaux et taux");
    // Effectif moyen 83 ÷ 12 au centième (« 6,92 ») ; entrées et sorties de la période en entiers (« 1 »), comme l'écran.
    expect([ws.getCell("C18").value, ws.getCell("C18").numFmt]).toEqual([83 / 12, "#,##0.00"]);
    expect([ws.getCell("F19").value, ws.getCell("F19").numFmt, ws.getCell("G19").value, ws.getCell("G19").numFmt]).toEqual([1, "#,##0", 1, "#,##0"]);
    expect([ws.getCell("H19").value, ws.getCell("H19").numFmt]).toEqual([2510, "#,##0.00"]);
    // Janvier 2026 (ligne 9) : effectif 6 ; septembre 2026 (ligne 17) : ETP 6,1 (61 000 ÷ 10 000), format au centième.
    expect(ws.getCell("C9").value).toBe(6);
    expect(ws.getCell("D17").value).toBe(6.1);
    expect(ws.getCell("D17").numFmt).toBe("#,##0.00");
    // Absentéisme (colonne J) : n.d., raison en commentaire, jamais 0.
    expect(ws.getCell("J9").value).toBe("n.d.");
    expect(noteOf(ws.getCell("J9"))).toBe(ndText(absenteeismShown(kpiDashboard(kpiCtx.input!, rollingWindow("2026-09")).rows[3].absenteeism)));
    const filtres = wb.getWorksheet("Filtres")!;
    expect([filtres.getCell("A5").value, filtres.getCell("B5").value]).toEqual(["Entrée", "Suivi des effectifs"]);
    expect(filtres.getCell("A6").value).toBe("Période");
    expect(String(filtres.getCell("B6").value)).toContain("12 mois glissants");
    expect(wb.getWorksheet("Sources")!.getCell("A5").value).toBe("Fichiers DSN");
    // Toutes les définitions citées existent au glossaire (aucune ignorée) ; l'entrée « Seuil de confidentialité » est jointe (lot 12).
    expect(wb.getWorksheet("Définitions")!.rowCount).toBe(4 + 11);
  });

  it("paramètres de l'adresse repris (vue, mode) ; format inconnu refusé ; entrée sans tableau : 404", async () => {
    const t = await load(await call("kpi", "vue=turnover&format=xlsx"));
    expect(rowValues(t.getWorksheet("Mois par mois")!, 5, 6)).toEqual(["Mois", "Couverture", "Effectif fin de mois (personnes)", "Entrées", "Sorties", "Observations"]);
    const civil = await load(await call("kpi", "mode=civil&annee=2025&format=xlsx"));
    expect(civil.getWorksheet("Mois par mois")!.getCell("A6").value).toBe("2025-01");
    expect((await call("kpi", "format=csv")).status).toBe(400);
    expect((await call("kpi", "vue=pyramide&format=xlsx")).status).toBe(404);
  });

  it("Effectifs mensuels : une ligne par groupe de l'axe puis le total, une colonne par mois ; total fin septembre 2026 = 6,10 ETP", async () => {
    mocks.payCtx.value = payCtx;
    const res = await call("kpi", "vue=effectifs&mesure=etp&axe=categorie&annee=2026&format=xlsx");
    expect(res.status).toBe(200);
    const wb = await load(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Répartition mensuelle", "Répartition", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Répartition mensuelle")!;
    expect(rowValues(ws, 5, 2)).toEqual(["Groupe", "janv. 2026"]);
    expect(ws.getCell(5, 10).value).toBe("sept. 2026");
    const labels: string[] = [];
    for (let r = 6; ws.getCell(r, 1).value; r++) labels.push(String(ws.getCell(r, 1).value));
    expect(labels.at(-1)).toBe("Total");
    // ETP fin septembre 2026 du référentiel fictif : 61 000 dix-millièmes, comme la tuile « ETP contractuel fin de mois ».
    expect(ws.getCell(5 + labels.length, 10).value).toBe(6.1);
    // Mois non lus (après septembre 2026) : n.d. avec raison, jamais 0.
    expect(ws.getCell(5 + labels.length, 11).value).toBe("n.d.");
    expect(noteOf(ws.getCell(5 + labels.length, 11))).toBeTruthy();
    const filtres = wb.getWorksheet("Filtres")!;
    expect([filtres.getCell("A5").value, filtres.getCell("B5").value, filtres.getCell("B6").value, filtres.getCell("B7").value]).toEqual(["Rubrique", "ETP", "Catégorie", "Réel PayFit"]);
  });

  it("Par catégorie : avec une nature retenue, le tableau suit le filtre comme la tuile ETP fin de mois ; la note le dit (cas écrit à la main)", async () => {
    // Fixture DSN, fenêtre janvier → décembre 2025 (fin=2025-12). Décembre 2025, toute l'entreprise : 7 contrats, 5,60 ETP, dont le
    // CDD 003 (nature 02, quotité 50 %, jusqu'au 31/12/2025) : CDI 6 · 5,10 ETP + CDD 1 · 0,50 ETP. Filtre Nature = CDD : CDD 1 · 0,50
    // chaque mois de 2025 et CDI sans colonne ; filtre Nature = CDI : 6 · 5,10 en décembre, CDD sans colonne. Lignes 6 à 17 : janvier à décembre.
    mocks.kpiCtx.value = { ...kpiCtx, collab: { ...kpiCtx.collab, establishments: [{ id: "00000000000011", label: "SIRET fictif" }] } };
    const wbOf = async (q: string) => load(await call("kpi", `fin=2025-12&${q}format=xlsx`));
    const all = (await wbOf("")).getWorksheet("Par catégorie")!;
    expect(rowValues(all, 5, 7)).toEqual(["Mois", "CDI — effectif", "CDI — ETP", "CDD — effectif", "CDD — ETP", "Total — effectif", "Total — ETP"]);
    expect(rowValues(all, 17, 7)).toEqual(["2025-12", 6, 5.1, 1, 0.5, 7, 5.6]);
    // Note de la feuille (A4) : le classeur y ajoute sa phrase commune sur les cellules vides (EMPTY_CELL_NOTE).
    expect(String(all.getCell("A4").value)).toBe(`Fin de mois ; catégorie sans contrat ce mois-là : cellule vide. ${EMPTY_CELL_NOTE}`);
    const cddWb = await wbOf("nature=02&");
    const cdd = cddWb.getWorksheet("Par catégorie")!;
    expect(rowValues(cdd, 5, 5)).toEqual(["Mois", "CDD — effectif", "CDD — ETP", "Total — effectif", "Total — ETP"]);
    for (let r = 6; r <= 17; r++) expect(rowValues(cdd, r, 5).slice(1), String(r)).toEqual([1, 0.5, 1, 0.5]);
    expect(String(cdd.getCell("A4").value)).toContain("Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
    // Même classeur : le total par catégorie de chaque mois égale la colonne « ETP fin de mois » (filtrée) de « Mois par mois ».
    const monthly = cddWb.getWorksheet("Mois par mois")!;
    expect(monthly.getCell("D5").value).toBe("ETP fin de mois");
    for (let r = 6; r <= 17; r++) expect(cdd.getCell(r, 5).value, String(r)).toBe(monthly.getCell(r, 4).value);
    // Tuile « ETP contractuel fin de mois » filtrée (même entrée que la page) : 0,50 ETP = 5 000 dix-millièmes.
    const page = kpiSuiviOf(mocks.kpiCtx.value as KpiContext, { fin: "2025-12", nature: "02" }, SEUIL_1);
    expect(page.kind === "ready" && page.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 5000 });
    const cdi = (await wbOf("nature=01&")).getWorksheet("Par catégorie")!;
    expect(rowValues(cdi, 17, 5)).toEqual(["2025-12", 6, 5.1, 6, 5.1]);
    expect(String(cdi.getCell("A4").value)).toContain("hors de ce périmètre, sans colonne : CDD.");
    // Établissement unique retenu : mêmes chiffres que toute l'entreprise ; la mention nomme l'établissement, aucune catégorie cachée.
    const etab = (await wbOf("etab=00000000000011&")).getWorksheet("Par catégorie")!;
    expect(rowValues(etab, 17, 7)).toEqual(rowValues(all, 17, 7));
    expect(String(etab.getCell("A4").value)).toBe(`Fin de mois ; catégorie sans contrat ce mois-là : cellule vide. Filtres appliqués : établissement SIRET fictif. Mêmes contrats que les indicateurs. ${EMPTY_CELL_NOTE}`);
  });

  it("paramètre répété dans l'adresse : la première valeur est retenue, comme la page", async () => {
    const wb = await load(await call("kpi", "mode=civil&annee=2024&annee=2025&format=xlsx"));
    expect(wb.getWorksheet("Mois par mois")!.getCell("A6").value).toBe("2024-01");
    const page = kpiSuiviOf(kpiCtx, { mode: "civil", annee: ["2024", "2025"] }, SEUIL_1);
    expect(page.kind === "ready" && page.w.months[0]).toBe("2024-01");
  });

  it("paramètres des KPI illisibles : refus explicite (422), aucun chiffre remplacé", async () => {
    mocks.kpiCtx.value = { ...kpiCtx, settings: { ...kpiCtx.settings, invalid: ["dayBasis"] } };
    const res = await call("kpi", "format=xlsx");
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/^n\.d\. — paramètres des KPI illisibles/);
  });
});

// --- Masse salariale › Synthèse ----------------------------------------------------------------------------------------------
// Journal fictif : janvier et février 2026 identiques — service A : salaires 3 000,00 €, primes 500,00 €, cotisations 1 500,00 €
// (contrat C1) ; service B : salaires 2 000,00 €, cotisations 1 000,00 € (contrat C2). Brut du mois 5 500,00 €, cotisations
// 2 500,00 €, masse chargée 8 000,00 €. Janvier 2025 : A 2 500 + 1 250, B 1 500 + 750 → masse 6 000,00 € ; février 2025 absent (n.d.).
// ETP fin de mois : 2 chaque mois. Coût par ETP de janvier 2026 = 8 000,00 € ÷ 2 = 4 000,00 € ; janvier 2025 : 3 000,00 €.
let n = 0;
const line = (month: string, accountId: string, debit: number, contractId: string, svc: string): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`, month, accountId, accountName: accountId, debitCents: debit, creditCents: null, contractId, analytic: [{ type: "Service", code: svc, value: svc }],
});
const lines: LedgerLine[] = [];
for (const m of ["2026-01", "2026-02"]) lines.push(line(m, "641100", 300000, "C1", "A"), line(m, "641300", 50000, "C1", "A"), line(m, "645100", 150000, "C1", "A"), line(m, "641100", 200000, "C2", "B"), line(m, "645100", 100000, "C2", "B"));
lines.push(line("2025-01", "641100", 250000, "C1", "A"), line("2025-01", "645100", 125000, "C1", "A"), line("2025-01", "641100", 150000, "C2", "B"), line("2025-01", "645100", 75000, "C2", "B"));
const journal: JournalInput = { lines, months: ["2025-01", "2025-02", "2026-01", "2026-02"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
const payCtx = {
  // Référentiel fictif : C1 et C2 sont les contrats de deux personnes distinctes (le seuil de confidentialité compte des personnes).
  // Ce double de KpiInput est partiel (data.contracts seulement) : il ne sert qu'au lien contrat → personne de la Masse salariale et de
  // l'Écart budgétaire sous un filtre de service ; les tests des Hypothèses ont leur propre contexte (hypCtx, référentiel absent).
  kpi: { collab: { workspace: { id: "w1" } }, input: { data: { build: { source: "payfit" }, contracts: [{ contractKey: "payfit:C1", externalId: "C1", personKey: "P1" }, { contractKey: "payfit:C2", externalId: "C2", personKey: "P2" }] } } },
  source: "payfit",
  grid: { grid: DEFAULT_PREFIXES, origin: "default", updatedAt: null },
  read: { syncId: "s1", startedAt: new Date("2026-03-03T10:00:00Z"), months: journal.months },
  unavailable: null,
  input: journal,
  etp: (months: string[]) => months.map((m) => ({ month: m, etp4: 20000, reason: null })),
  axes: ["Service"],
  service: { axis: "Service", origin: "single-axis", updatedAt: null },
  dsn: new Map(),
  etpQualifiers: [],
  compta: async () => ({ source: null, reason: "aucune", lines: [], months: [], nd: {}, error: false }),
  axisMissing: false,
};

describe("Masse salariale › Synthèse : export Excel", () => {
  beforeEach(() => {
    mocks.payCtx.value = payCtx;
    mocks.role.value = "reader";
    mocks.conf.value = { kind: "set", value: 1, updatedAt: null, updatedBy: null };
  });

  it("« Mois par mois » : mêmes lignes que l'écran (mois de la période, puis « Période ») ; montants en euros, n.d. jamais 0", async () => {
    const s = syntheseOf(payCtx as never, { annee: "2026", de: "01", a: "02" });
    if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
    const sheet = monthlySheet({ ...s, dsn: new Map() });
    expect(sheet.rows.length).toBe(s.cur.months.length + 1);
    // Écran : lignes data-month du tableau mensuel.
    const { default: Page } = await import("@/app/e/[slug]/studio-rh/masse-salariale/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ annee: "2026", de: "01", a: "02" }) }));
    const table = html.slice(html.indexOf('data-testid="ms-monthly-table"'), html.indexOf("</table>", html.indexOf('data-testid="ms-monthly-table"')));
    expect([...table.matchAll(/<tr data-month="(\d{4}-\d{2})"/g)].map((m) => m[1])).toEqual(s.cur.months.map((r) => r.month));
    // Bouton d'export : à côté de l'Affichage, mêmes paramètres que l'écran.
    expect(html).toContain('href="/e/demo/studio-rh/masse-salariale/export?annee=2026&amp;de=01&amp;a=02&amp;format=xlsx" data-testid="ms-export-xlsx"');
    expect(html.indexOf('data-testid="ms-affichage"')).toBeLessThan(html.indexOf('data-testid="ms-export"'));
  });

  it("cas de référence écrit à la main (janvier 2026, février 2026, période) et tableaux par service", async () => {
    const res = await call("masse-salariale", "annee=2026&de=01&a=02&format=xlsx");
    expect(res.status).toBe(200);
    const wb = await load(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Mois par mois", "Services", "Services par mois", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Mois par mois")!;
    expect(rowValues(ws, 5, 12)).toEqual(["Mois", "Masse chargée", "Masse N-1", "Écart", "Brut", "dont primes", "Cotisations", "ETP fin de mois", "ETP N-1", "Coût / ETP", "Coût / ETP N-1", "Observations"]);
    // Janvier : 8 000 € ; N-1 6 000 € ; écart +2 000 € ; brut 5 500 € dont primes 500 € ; cotisations 2 500 € ; ETP 2 et 2 ; coût par ETP 4 000 € et 3 000 €.
    expect(rowValues(ws, 6, 11)).toEqual(["Janvier 2026", 8000, 6000, 2000, 5500, 500, 2500, 2, 2, 4000, 3000]);
    // Février : N-1 absent du journal → n.d. (jamais 0), écart et coût N-1 n.d. aussi.
    for (const c of ["C7", "D7", "K7"]) {
      expect(ws.getCell(c).value).toBe("n.d.");
      expect(noteOf(ws.getCell(c))).toBeTruthy();
    }
    expect(ws.getCell("B7").value).toBe(8000);
    // Période : masse 16 000 € ; N-1 n.d. ; ETP-mois 2 + 2 = 4 ; coût par ETP-mois 16 000 ÷ 4 = 4 000 €.
    expect(ws.getCell("A8").value).toBe("Période");
    expect([ws.getCell("B8").value, ws.getCell("C8").value, ws.getCell("H8").value, ws.getCell("J8").value]).toEqual([16000, "n.d.", 4, 4000]);
    // Services (tout le journal) : A = 2 × (3 000 + 500 + 1 500) = 10 000 € (62,5 %), B = 2 × 3 000 = 6 000 € (37,5 %) ; coût par
    // personne-mois A = 10 000 ÷ 2 = 5 000 €, B = 6 000 ÷ 2 = 3 000 €, total 16 000 ÷ 4 = 4 000 €.
    const sv = wb.getWorksheet("Services")!;
    expect([sv.getCell("A6").value, sv.getCell("B6").value, sv.getCell("F6").value, sv.getCell("G6").value, sv.getCell("J6").value]).toEqual(["A", 10000, 0.625, 6000, 5000]);
    expect([sv.getCell("A7").value, sv.getCell("B7").value, sv.getCell("F7").value, sv.getCell("J7").value]).toEqual(["B", 6000, 0.375, 3000]);
    expect([sv.getCell("A8").value, sv.getCell("B8").value, sv.getCell("F8").value ?? null, sv.getCell("J8").value]).toEqual(["Total", 16000, null, 4000]);
    expect(sv.getCell("C6").value).toBe("n.d."); // N-1 du service A : février 2025 n.d.
    const sm = wb.getWorksheet("Services par mois")!;
    expect(rowValues(sm, 6, 4)).toEqual(["A", 5000, 5000, 10000]);
    expect(String(wb.getWorksheet("Filtres")!.getCell("B5").value)).toBe("janvier → février 2026");
  });

  it("seuil de confidentialité 2 : A et B (une personne chacun) n.d. dans « Services » et « Services par mois » avec la raison, total conservé ; sous le filtre Service, « Mois par mois » n.d. ; seuil absent : raison du paramètre", async () => {
    mocks.conf.value = { kind: "set", value: 2, updatedAt: null, updatedBy: null };
    const wb = await load(await call("masse-salariale", "annee=2026&de=01&a=02&format=xlsx"));
    const sv = wb.getWorksheet("Services")!;
    const reason = "non affiché (seuil de confidentialité : 2 personnes)";
    for (const c of ["B6", "D6", "F6", "J6", "B7", "F7"]) {
      expect(sv.getCell(c).value, c).toBe("n.d.");
      expect(noteOf(sv.getCell(c)), c).toContain(reason);
    }
    // N-1 du service A : déjà n.d. (février 2025 hors du journal) : sa propre raison, jamais remplacée.
    expect(sv.getCell("C6").value).toBe("n.d.");
    expect(noteOf(sv.getCell("C6"))).toContain("2025-02");
    expect([sv.getCell("A8").value, sv.getCell("B8").value, sv.getCell("J8").value]).toEqual(["Total", 16000, 4000]);
    const sm = wb.getWorksheet("Services par mois")!;
    expect(rowValues(sm, 6, 4)).toEqual(["A", "n.d.", "n.d.", "n.d."]);
    expect(rowValues(sm, 8, 4)).toEqual(["Total", 8000, 8000, 16000]);
    // Onglet Filtres : la ligne « Confidentialité » dit le seuil appliqué ; sous le filtre, « Service retenu » dit le n.d. et sa raison.
    const filterOf = (w: ExcelJS.Workbook, label: string) => {
      const ws = w.getWorksheet("Filtres")!;
      for (let r = 1; r <= 20; r++) if (ws.getCell(r, 1).value === label) return String(ws.getCell(r, 2).value);
      return null;
    };
    expect(filterOf(wb, "Confidentialité")).toBe("seuil de 2 personnes distinctes");
    expect(filterOf(wb, "Service retenu")).toBeNull();
    // Filtre Service A : tout le tableau mensuel du service est n.d. (même raison que l'écran), le classeur est produit.
    const f = await load(await call("masse-salariale", "annee=2026&de=01&a=02&service=A&format=xlsx"));
    const ws = f.getWorksheet("Mois par mois")!;
    expect(ws.getCell("B6").value).toBe("n.d.");
    expect(noteOf(ws.getCell("B6"))).toBe(reason); // raison nue du moteur, la même qu'à l'écran et dans toute cellule masquée
    expect([ws.getCell("H6").value, ws.getCell("J6").value, ws.getCell("B8").value]).toEqual(["n.d.", "n.d.", "n.d."]);
    expect(filterOf(f, "Service retenu")).toBe(`n.d. — ${reason}`); // la mention du service retenu est le libellé de la ligne
    // Seuil non défini : lignes par service n.d. avec la raison du paramètre, total conservé.
    mocks.conf.value = { kind: "absent" };
    const nd = await load(await call("masse-salariale", "annee=2026&de=01&a=02&format=xlsx"));
    expect(noteOf(nd.getWorksheet("Services")!.getCell("B6"))).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(nd.getWorksheet("Services")!.getCell("B8").value).toBe(16000);
    expect(filterOf(nd, "Confidentialité")).toBe("seuil non défini (Paramètres)");
  });

  it("source DSN : export refusé avec sa raison ; autre onglet que la Synthèse : 404", async () => {
    mocks.payCtx.value = { ...payCtx, source: "dsn" };
    expect((await call("masse-salariale", "format=xlsx")).status).toBe(422);
    mocks.payCtx.value = payCtx;
    expect((await call("masse-salariale", "vue=fixe-variable&format=xlsx")).status).toBe(404);
  });
});

// --- Écart budgétaire : garde du filtre Service (même garde que la Synthèse de la Masse salariale et l'Analyse des écarts) ------
// Journal fictif ci-dessus : service A = C1 (une personne), service B = C2 (une personne) ; réel 2025 et réel 2026, janvier.
describe("Écart budgétaire : exports et écran sous le filtre Service (seuil de confidentialité)", () => {
  const query = (extra = "") => `v1=reel:2025&v2=reel:2026&de=01&a=01&service=A${extra}`;
  const filterOf = (w: ExcelJS.Workbook, label: string) => {
    const ws = w.getWorksheet("Filtres")!;
    for (let r = 1; r <= 20; r++) if (ws.getCell(r, 1).value === label) return String(ws.getCell(r, 2).value);
    return null;
  };
  beforeEach(() => {
    mocks.payCtx.value = payCtx;
    mocks.role.value = "reader";
    mocks.budgets.value = [];
    mocks.conf.value = { kind: "set", value: 1, updatedAt: null, updatedBy: null };
  });

  it("seuil 1 : service A affiché ; CSV et classeur portent la masse du service (janvier 2025 : 3 750,00 € ; janvier 2026 : 5 000,00 €)", async () => {
    // A, janvier 2026 : 3 000 + 500 + 1 500 = 5 000,00 € ; janvier 2025 : 2 500 + 1 250 = 3 750,00 € ; écart +1 250,00 €.
    const csv = await call("masse-salariale/ecart", query());
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain('"Masse salariale chargée";"3750,00";"5000,00";"1250,00";"33,33"');
    const wb = await load(await call("masse-salariale/ecart", query("&format=xlsx")));
    const ws = wb.getWorksheet("Écart budgétaire")!;
    const masse = Array.from({ length: 15 }, (_, i) => i + 6).find((r) => ws.getCell(r, 1).value === "Masse salariale chargée")!;
    expect([ws.getCell(masse, 3).value, ws.getCell(masse, 4).value, ws.getCell(masse, 5).value]).toEqual([3750, 5000, 1250]);
    expect(filterOf(wb, "Service retenu")).toBeNull();
  });

  it("seuil 2 : A (une personne) masqué ⇒ chaque cellule du CSV et du classeur est n.d. avec la raison du seuil ; onglet Filtres « Service retenu » ; sans filtre, rien n'est masqué", async () => {
    mocks.conf.value = { kind: "set", value: 2, updatedAt: null, updatedBy: null };
    const reason = "non affiché (seuil de confidentialité : 2 personnes)";
    const body = await (await call("masse-salariale/ecart", query("&vue=detail"))).text();
    expect(body).toContain(`"Masse salariale chargée";"n.d. (${reason})";"n.d. (${reason})";"n.d. (${reason})";""`);
    expect(body).not.toMatch(/"\d+,\d\d"/); // aucun montant ni écart
    const wb = await load(await call("masse-salariale/ecart", query("&format=xlsx")));
    const ws = wb.getWorksheet("Écart budgétaire")!;
    for (let r = 6; r <= 12; r++) {
      for (const c of [3, 4, 5, 6]) {
        expect(ws.getCell(r, c).value, `ligne ${r}, colonne ${c}`).toBe("n.d.");
        expect(noteOf(ws.getCell(r, c)), `ligne ${r}, colonne ${c}`).toBe(reason);
      }
    }
    expect(filterOf(wb, "Service retenu")).toBe(`n.d. — ${reason}`);
    expect(filterOf(wb, "Périmètre")).toBe("service A");
    // Écran : tableau et graphique remplacés par le bloc n.d. qui nomme le service, lien « Retirer le filtre Service » ; exports toujours proposés.
    const { default: Page } = await import("@/app/e/[slug]/studio-rh/masse-salariale/ecart/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ v1: "reel:2025", v2: "reel:2026", de: "01", a: "01", service: "A" }) }));
    expect(html).toContain('data-testid="ecart-service-guard"');
    expect(html).toContain(`n.d. — service A retenu par le filtre : ${reason}`);
    expect(html).not.toContain('data-testid="ecart-table"');
    expect(html).not.toContain('data-testid="ecart-graph"');
    expect(html).not.toContain('data-testid="ecart-guard-param"');
    expect(html).toContain("Retirer le filtre Service");
    expect(html).toContain('data-testid="ecart-export"');
    expect(html).not.toContain("data-money-cents");
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
    // Service B (une personne aussi) : masqué ; les deux services forment ensemble 2 personnes ≥ 2.
    expect(await (await call("masse-salariale/ecart", "v1=reel:2025&v2=reel:2026&de=01&a=01&service=B")).text()).toContain(`n.d. (${reason})`);
  });

  it("seuil absent : n.d. « non défini (Paramètres) » dans les fichiers, lien vers Paramètres › Confidentialité à l'écran", async () => {
    mocks.conf.value = { kind: "absent" };
    const reason = "seuil de confidentialité non défini (Paramètres)";
    expect(await (await call("masse-salariale/ecart", query())).text()).toContain(`"n.d. (${reason})"`);
    const wb = await load(await call("masse-salariale/ecart", query("&format=xlsx")));
    expect(noteOf(wb.getWorksheet("Écart budgétaire")!.getCell(6, 3))).toBe(reason);
    const { default: Page } = await import("@/app/e/[slug]/studio-rh/masse-salariale/ecart/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ v1: "reel:2025", v2: "reel:2026", de: "01", a: "01", service: "A" }) }));
    expect(html).toContain('data-testid="ecart-guard-param"');
    expect(html).toContain('href="/e/demo/parametres#confidentialite"');
  });
});

// --- Hypothèses budgétaires ----------------------------------------------------------------------------------------------------
// Base fictive figée sur septembre 2026 : contrat A (service TECH) salaire 3 000,00 €, charges 1 320 ÷ 3 300 = 40 % → coût mensuel
// 3 000 + 1 200 = 4 200,00 € ; contrat B (service SALES) salaire 2 000,00 €, charges 900 ÷ 2 000 = 45 % → 2 900,00 €. Réel janvier à
// septembre : brut 5 000,00 €, charges 2 000,00 €, coût 7 000,00 €, 2 personnes, 2 ETP. Projection d'octobre à décembre sans
// hypothèse : 4 200 + 2 900 = 7 100,00 € par mois.
const sc = { id: "11111111-1111-1111-1111-111111111111", name: "Scénario fictif", kind: "revise", status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-12", conventions: { prorata: "calendaire" }, createdAt: new Date("2026-10-01T08:00:00Z"), frozenAt: null } as unknown as ScenarioRow;
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: `Contrat fictif ${key}`, service: null, serviceNd: null, startDate: "2025-01-06", endDate: null, counted: true, etp4: 10000, etpNd: null, category: "cdi", executive: false, base: null, baseNd: null, ...over,
});
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05",
  contracts: [contract("A", { service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } }), contract("B", { service: "SALES", base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } })],
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 2, etp4: 20000, etpNd: null })),
  refMasse: 700000, refBaseCost: 710000, etpNote: null,
};
// Hypothèses des grilles (les tests de projection et de comparaison n'en prennent aucune) : taux global de 2,50 % en novembre 2026,
// une enveloppe de 1 000,00 € chargés en décembre 2026, une constante en % (5,25) et une en euros (1 500,00 €) en octobre 2026.
const gridHyps: Hypothesis[] = [
  { id: "h1", kind: "augmentation", label: "Taux fictif", from: "2026-11", rateBps: 250, scope: { kind: "global" } },
  { id: "h2", kind: "enveloppe", label: "Enveloppe fictive", axis: "service", target: "Atelier", monthly: { "2026-12": 100000 }, chargesBps: null },
  { id: "h3", kind: "constante", label: "Taux de référence fictif", unit: "pct", values: { "2026-10": 525 }, source: "Source fictive" },
  { id: "h4", kind: "constante", label: "Plafond fictif", unit: "eur", values: { "2026-10": 150000 }, source: "Source fictive" },
];
const months = ["2026-10", "2026-11", "2026-12"];
// Contexte de paie des Hypothèses : référentiel Collaborateurs absent (kpi.input null), jamais un KpiInput partiel.
const hypCtx = { ...payCtx, kpi: { collab: { workspace: { id: "w1" } }, input: null } };

describe("Hypothèses budgétaires : feuilles de la projection et des grilles", () => {
  it("Projection « Mois par mois » : mêmes lignes que l'écran (réel janvier à septembre, projeté octobre à décembre)", () => {
    const proj = project(base, "2026-10", "2026-12", [], { prorata: "calendaire" });
    const rows = projectionRows(base, proj, sc);
    const sheet = projectionSheet(rows);
    expect(rows.map((r) => r.layer)).toEqual([...Array(9).fill("reel"), "projete", "projete", "projete"]);
    expect(sheet.rows.map((r) => r[0])).toEqual(rows.map((r) => formatMonth(r.month)));
    expect(sheet.rows[0].slice(0, 7)).toEqual(["Janvier 2026", "Réel", 500000, 200000, 700000, 2, 20000]);
    expect(sheet.rows[9].slice(0, 7)).toEqual(["Octobre 2026", "Projeté", 500000, 210000, 710000, 2, 20000]); // 4 200 + 2 900 = 7 100 €
  });

  it("grilles : taux en points de base (2,50 % → 250), enveloppe en centimes, constantes dans l'unité saisie ; vide = aucune hypothèse", () => {
    const { scopes } = rateScopes(base, gridHyps);
    expect(scopes.map((s) => s.key)).toEqual(["global", "service:SALES", "service:TECH", "statut:dirigeant", "statut:autres"]);
    const rates = ratesSheet(scopes, rateMap(gridHyps), months);
    expect(rates.rows[0]).toEqual(["Toute l'entreprise (hors embauches et entrées après la base)", "", 250, "", ""]);
    const env = envelopesSheet(envelopesOf(gridHyps, "service"), "service", months);
    expect(env.rows).toEqual([["Atelier", "Coût chargé", "", "non", "", "", 100000, ""]]);
    const cst = constantsSheet(constantsOf(gridHyps), months);
    expect(cst.rows[0]).toEqual(["Taux de référence fictif", "taux en %", "Source fictive", { exact: 5.25 }, "", "", ""]);
    expect(cst.rows[1]).toEqual(["Plafond fictif", "montant en euros", "Source fictive", 150000, "", "", ""]);
    expect(cst.rowKinds).toEqual(["etp", "eur"]);
  });

  it("classeur des constantes : 5,25 (taux) et 1 500,00 € (montant) en vrais nombres", async () => {
    const buf = await buildWorkbook({ title: "T", workspaceName: "Espace fictif", generatedAt: "2026-01-15T09:12:00.000Z", filters: [], sheets: [constantsSheet(constantsOf(gridHyps), months)], sources: [], definitions: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Constantes")!;
    expect([ws.getCell("D5").value, ws.getCell("D6").value]).toEqual([5.25, 1500]);
    expect([ws.getCell("D5").numFmt, ws.getCell("D6").numFmt]).toEqual(["#,##0.00", '#,##0.00 "€"']);
  });
});

describe("Hypothèses budgétaires : CSV des grilles conservé, Excel ajouté avant lui", () => {
  const csvButton = (html: string) => html.slice(html.lastIndexOf("<button", html.indexOf('data-testid="grid-csv"')), html.indexOf("</button>", html.indexOf('data-testid="grid-csv"')) + 9);
  it("GridTools : sans adresse Excel, menu inchangé (CSV seul) ; avec, Excel d'abord et bouton CSV identique", () => {
    const before = renderToStaticMarkup(h(GridTools, { filename: "x.csv" }));
    const after = renderToStaticMarkup(h(GridTools, { filename: "x.csv", xlsxHref: "/e/demo/studio-rh/hypotheses/export?scenario=s&vue=bases&format=xlsx" }));
    expect(before).not.toContain("grid-xlsx");
    expect(csvButton(after)).toBe(csvButton(before));
    expect(csvButton(before)).toContain("CSV (.csv)");
    expect(after.indexOf('data-testid="grid-xlsx"')).toBeLessThan(after.indexOf('data-testid="grid-csv"'));
    expect(after).toContain('href="/e/demo/studio-rh/hypotheses/export?scenario=s&amp;vue=bases&amp;format=xlsx"');
  });
  it("vues : lien Excel vers la route, attributs CSV des cellules inchangés ; Bases individuelles sans lien Excel si la page ne l'autorise pas", () => {
    const fullBase = { ...base };
    const env = renderToStaticMarkup(h(EnveloppesView, { slug: "demo", scenario: sc, base: fullBase, hypotheses: gridHyps, axis: "service", canEdit: false }));
    expect(env).toContain(`vue=env-service&amp;format=xlsx" data-testid="grid-xlsx"`);
    expect(env).toContain('data-csv="2026-12"');
    expect(env).toContain('data-csv="1000"'); // 100 000 centimes, écrits « 1000 » dans le CSV comme avant
    const glob = renderToStaticMarkup(h(GlobalesView, { slug: "demo", scenario: sc, base: fullBase, hypotheses: gridHyps, canEdit: false }));
    expect(glob).toContain("vue=globales&amp;grille=taux&amp;format=xlsx");
    expect(glob).toContain("vue=globales&amp;grille=constantes&amp;format=xlsx");
    expect(renderToStaticMarkup(h(BasesView, { slug: "demo", scenario: sc, base: fullBase, hypotheses: [], canEdit: false }))).not.toContain("grid-xlsx");
    expect(renderToStaticMarkup(h(BasesView, { slug: "demo", scenario: sc, base: fullBase, hypotheses: [], canEdit: false, xlsx: true }))).toContain("vue=bases&amp;format=xlsx");
  });
});

describe("route d'export des Hypothèses budgétaires", () => {
  beforeEach(() => {
    mocks.payCtx.value = hypCtx;
    mocks.role.value = "editor";
    mocks.getScenario.mockReset().mockResolvedValue({ scenario: sc, base, baseHash: "h", hypotheses: gridHyps });
    mocks.budgets.value = [];
  });

  it("Bases individuelles (nominatif) : lecteur refusé (403) sans lire le scénario ; éditeur : une ligne par contrat", async () => {
    mocks.role.value = "reader";
    const denied = await call("hypotheses", `scenario=${sc.id}&vue=bases&format=xlsx`);
    expect(denied.status).toBe(403);
    expect(mocks.getScenario).not.toHaveBeenCalled();
    mocks.role.value = "editor";
    // Correction de base du contrat B : salaire 2 100,00 €, charges 45 % (4 500 points de base).
    mocks.getScenario.mockResolvedValue({ scenario: sc, base, baseHash: "h", hypotheses: [...gridHyps, { id: "h5", kind: "base", label: "Correction fictive", contractKey: "B", salaryCents: 210000, chargesBps: 4500 }] });
    const ws = (await load(await call("hypotheses", `scenario=${sc.id}&vue=bases&format=xlsx`))).getWorksheet("Bases individuelles")!;
    // Contrat A : salaire 3 000 € ; taux 1 320 ÷ 3 300 = 0,4 ; coût mensuel 4 200 € ; aucune correction (cellules vides).
    expect([ws.getCell("A6").value, ws.getCell("G6").value, ws.getCell("H6").value, ws.getCell("I6").value, ws.getCell("J6").value ?? null, ws.getCell("L6").value]).toEqual(["Contrat fictif A", 3000, 0.4, 4200, null, "figée"]);
    // Contrat B : base 2 000 € à 45 % → 2 900 € ; correction en vrais nombres (2 100 €, 0,45), état sans montant écrit en texte.
    expect([ws.getCell("I7").value, ws.getCell("J7").value, ws.getCell("K7").value, ws.getCell("L7").value]).toEqual([2900, 2100, 0.45, "corrigée"]);
    expect(ws.getCell("A8").value ?? null).toBeNull(); // deux contrats, rien d'autre
  });

  it("lecteur : grilles non nominatives et résultat exportables ; Projection : 7 100 € en octobre 2026", async () => {
    mocks.role.value = "reader";
    mocks.getScenario.mockResolvedValue({ scenario: sc, base, baseHash: "h", hypotheses: [] });
    const wb = await load(await call("hypotheses", `scenario=${sc.id}&vue=resultat&sous=projection&format=xlsx`));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Mois par mois", "Par nature", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Mois par mois")!;
    expect(rowValues(ws, 15, 7)).toEqual(["Octobre 2026", "Projeté", 5000, 2100, 7100, 2, 2]);
    expect(wb.getWorksheet("Sources")!.getCell("A5").value).toBe("PayFit (base figée du scénario)");
    const env = await call("hypotheses", `scenario=${sc.id}&vue=env-service&format=xlsx`);
    expect(env.status).toBe(200);
  });

  it("Comparaison face à un budget saisi : écart mensuel et annuel écrits à la main ; pont d'écart n.d. (budget sans ETP), jamais 0", async () => {
    // Budget fictif : 6 500,00 € par mois sur 2026 → 78 000,00 €. Scénario : 9 × 7 000 + 3 × 7 100 = 84 300,00 €. Écart annuel 6 300,00 € ;
    // janvier 7 000 − 6 500 = 500,00 €.
    mocks.getScenario.mockResolvedValue({ scenario: sc, base, baseHash: "h", hypotheses: [] });
    mocks.budgets.value = [{ id: "b0000000-0000-0000-0000-000000000000", name: "Budget fictif", year: "2026", amounts: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 650000])) }];
    const wb = await load(await call("hypotheses", `scenario=${sc.id}&vue=resultat&sous=comparaison&annee=2026&cmp=budget:b0000000-0000-0000-0000-000000000000&format=xlsx`));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Mois par mois", "Écarts", "Pont d'écart", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Mois par mois")!;
    expect(rowValues(ws, 6, 6)).toEqual(["Janvier 2026", 7000, "réel", 6500, "budget", 500]);
    expect(rowValues(ws, 18, 6).filter((v) => v !== null && v !== "")).toEqual(["Année 2026", 84300, 78000, 6300]);
    const pont = wb.getWorksheet("Pont d'écart")!;
    for (const c of ["B6", "C6", "D6", "E6"]) expect(pont.getCell(c).value).toBe("n.d.");
  });

  it("lecture d'une autre année (cmp = budget 2026 sur l'année 2027) : l'écran et le classeur n'ont aucune lecture comparée", async () => {
    // Scénario fictif prolongé jusqu'en mars 2027 (années 2026 et 2027) ; budgets fictifs 2026 et 2027. Sur 2027, le budget 2026
    // n'est pas une option : aucune lecture n'est retenue.
    const sc2 = { ...sc, lastMonth: "2027-03" } as ScenarioRow;
    const b26 = { id: "b2600000-0000-0000-0000-000000000000", name: "Budget fictif 2026", year: "2026", amounts: { "2026-01": 650000 } };
    const b27 = { id: "b2700000-0000-0000-0000-000000000000", name: "Budget fictif 2027", year: "2027", amounts: { "2027-01": 700000 } };
    mocks.getScenario.mockResolvedValue({ scenario: sc2, base, baseHash: "h", hypotheses: [] });
    mocks.budgets.value = [b26, b27];
    const proj = project(base, sc2.firstMonth, sc2.lastMonth, [], sc2.conventions);
    const sp = { scenario: sc2.id, vue: "resultat", sous: "comparaison", annee: "2027", cmp: `budget:${b26.id}` };
    const c = await loadComparison("demo", "w1", sc2, base, proj, sp);
    expect([c.year, c.selected, c.compared]).toEqual(["2027", [], []]);
    // Écran : aucune tuile d'écart, aucun pont, tableau à deux colonnes (Mois, scénario).
    const html = renderToStaticMarkup(h(ComparisonView, { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: sc2.id, years: c.years, year: c.year, principal: c.principal, compared: c.compared, options: c.options, selected: c.selected, refMonth: base.refMonth }));
    expect(html).not.toContain('data-testid="cmp-ecarts"');
    expect(html).not.toContain('data-testid="cmp-bridge"');
    const thead = html.slice(html.indexOf('data-testid="cmp-table"'), html.indexOf("</thead>", html.indexOf('data-testid="cmp-table"')));
    expect(thead.match(/<th[ >]/g)).toHaveLength(2);
    // Lien Excel et liens d'affichage : la valeur sentinelle garde « aucune lecture » dans l'adresse.
    const href = /href="([^"]+)" data-testid="cmp-export-xlsx"/.exec(html)![1].replaceAll("&amp;", "&");
    expect(href).toBe(`/e/demo/studio-rh/hypotheses/export?scenario=${sc2.id}&vue=resultat&sous=comparaison&annee=2027&cmp=${CMP_NONE}&format=xlsx`);
    expect(html).toContain(`annee=2027&amp;cmp=${CMP_NONE}&amp;affichage=graphique`);
    // Classeur : même état que l'écran, sans feuille d'écarts ni de pont.
    const wb = await load(await call("hypotheses", href.split("?")[1]));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Mois par mois", "Filtres", "Sources", "Définitions"]);
    expect(rowValues(wb.getWorksheet("Mois par mois")!, 5, 5).filter((v) => v !== null)).toEqual(["Mois", "Scénario fictif", "Origine — Scénario fictif", "Observations"]);
    const filtres = wb.getWorksheet("Filtres")!;
    const row = Array.from({ length: 10 }, (_, i) => i + 5).find((r) => filtres.getCell(r, 1).value === "Lectures comparées")!;
    expect(filtres.getCell(row, 2).value).toBe("aucune");
    // Sans la valeur sentinelle (adresse sans « cmp »), les lectures par défaut de 2027 reviendraient : réel, N-1, budget 2027.
    expect((await loadComparison("demo", "w1", sc2, base, proj, { ...sp, cmp: undefined })).selected).toEqual(["reel", "n1", `budget:${b27.id}`]);
  });

  it("scénario inconnu : 404 ; entrée sans tableau : 404 ; format inconnu : 400", async () => {
    mocks.getScenario.mockResolvedValue(null);
    expect((await call("hypotheses", "scenario=inconnu&vue=bases&format=xlsx")).status).toBe(404);
    mocks.getScenario.mockResolvedValue({ scenario: sc, base, baseHash: "h", hypotheses: [] });
    expect((await call("hypotheses", `scenario=${sc.id}&vue=postes&format=xlsx`)).status).toBe(404);
    expect((await call("hypotheses", `scenario=${sc.id}&vue=bases&format=csv`)).status).toBe(400);
  });
});
