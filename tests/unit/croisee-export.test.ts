import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "@/components/ExportMenu";
import { CHAPTERS, chapterDef } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import {
  chapterExport,
  chapterWorkbook,
  CROISEE_EXPORTS,
  croiseeExportOptions,
  croiseeFilters,
  croiseeSources,
  CSV_BOM,
  csvCell,
  exportCell,
  exportOptions,
  exportTermIds,
  JOURNAL_USAGE,
  KEY_FIGURES_TITLE,
  keyFiguresTable,
  LOWER_BOUND,
  ND_SHEET,
  ND_WITHOUT_REASON,
  periodLead,
  screenRows,
  screenTables,
  SERVICES_EXPORT_LABEL,
  sheetName,
  sortedTables,
  sourceUses,
  tableCsv,
  tableSheet,
  tileNumber,
  unavailableRows,
  type ExportModel,
  type FilterCtx,
  type MenuCtx,
} from "@/lib/croisee/export";
import { journalReason } from "@/lib/croisee/format";
import { safeText } from "@/lib/export/safe-text";
import { buildWorkbook, EMPTY_CELL_NOTE } from "@/lib/export/xlsx";
import { glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { cellView, croiseeHref, parseQuery, type CroiseeCell, type CroiseeTable, type TileSpec } from "@/lib/viz/croisee";
import { absencesModel } from "@/lib/viz/croisee-absences";
import { budgetModel, effetsModel } from "@/lib/viz/croisee-budget";
import { effectifsModel } from "@/lib/viz/croisee-effectifs";
import { buildServices, fixeVariableModel, servicesModel, type ServicesInput, type WindowIn } from "@/lib/viz/croisee-masse";
import { paieComptaModel } from "@/lib/viz/croisee-paie";
import { syntheseModel } from "@/lib/viz/croisee-synthese";
import type { MonthIn } from "@/lib/viz/masse";

// Exports de la Masse salariale croisée. Données entièrement fictives, écrites à la main ; chaque valeur attendue est calculée à la
// main (commentaires). L'Excel et le CSV reprennent exactement les lignes et les cellules des tableaux de l'écran ; un n.d. reste
// « n.d. » avec sa raison, jamais 0 ; safeText protège le texte, jamais un nombre.

// --- Doubles : accès à l'espace, contexte de la page, chargeur du chapitre 05, lectures de sources ------------------------------------
const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  services: vi.fn(),
  lastSync: vi.fn(),
  activeSync: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace fictif", slug, role: "reader" } }),
}));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/context", async (orig) => ({
  ...(await orig<typeof import("@/app/e/[slug]/studio-rh/masse-salariale/croisee/context")>()),
  loadCroiseeContext: (...args: unknown[]) => mocks.ctx(...args),
}));
// Chapitre 05 : la fonction mémoïsée du chapitre, sur un chargeur simulé (même composition que dans croisee-masse.ts).
vi.mock("@/lib/viz/croisee-masse", async (orig) => {
  const m = await orig<typeof import("@/lib/viz/croisee-masse")>();
  const { memoByContext } = await import("@/lib/croisee/memo");
  return { ...m, servicesModel: memoByContext((ctx: object) => (mocks.services(ctx) as Promise<ServicesInput>).then(m.buildServices)) };
});
vi.mock("@/lib/connectors/sync", () => ({
  lastSync: (...args: unknown[]) => mocks.lastSync(...args),
  activeSync: (...args: unknown[]) => mocks.activeSync(...args),
  SYNC_STATUS_LABELS: { applied: "Appliquée (active)" },
}));

const { GET } = await import("@/app/e/[slug]/studio-rh/masse-salariale/croisee/export/route");

const load = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
};
const noteOf = (c: ExcelJS.Cell): string | null => (c.note ? (typeof c.note === "string" ? c.note : (c.note.texts?.map((t) => t.text).join("") ?? "")) : null);
// Lignes d'un tableau de feuille : celles qui suivent la ligne d'en-tête (repérée par le texte de sa première cellule).
function sheetRows(ws: ExcelJS.Worksheet, firstHeader: string, width: number): ExcelJS.Cell[][] {
  let head = 0;
  ws.eachRow((row, n) => {
    if (!head && row.getCell(1).value === firstHeader) head = n;
  });
  if (!head) throw new Error(`en-tête « ${firstHeader} » absente de « ${ws.name} »`);
  const out: ExcelJS.Cell[][] = [];
  for (let r = head + 1; r <= ws.rowCount; r++) out.push(Array.from({ length: width }, (_, i) => ws.getCell(r, i + 1)));
  return out;
}
// Corps CSV lu en octets (le BOM est conservé), lignes séparées par CRLF.
const csvLines = (body: string) => {
  expect(body.startsWith(CSV_BOM)).toBe(true);
  expect(body.endsWith("\r\n")).toBe(true);
  return body.slice(1, -2).split("\r\n");
};
const split = (line: string) => line.slice(1, -1).split('";"').map((s) => s.replace(/""/g, '"'));

// --- Modèle fictif d'un chapitre à blocs ------------------------------------------------------------------------------------------

const R1 = "févr. 2026 : mois hors de la lecture appliquée";
const R2 = "quotité absente du référentiel";
const ndShape = (id: string, title: string, reason: string): CroiseeTable => ({ id, title, columns: [{ key: "bloc", header: "Bloc", kind: "text" }, { key: "valeur", header: "Valeur", kind: "text" }], rows: [{ cells: [title, { nd: reason }] }] });

const MONTANTS: CroiseeTable = {
  id: "demo-montants",
  title: "Montants fictifs par équipe",
  columns: [
    { key: "equipe", header: "Équipe", kind: "text" },
    { key: "libelle", header: "Libellé", kind: "text" },
    { key: "n", header: "Coût N", kind: "eur", term: "masse" },
    { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: "evolution" },
    { key: "pct", header: "Écart (%)", kind: "pourcent", signed: true, costTrend: true },
    { key: "etp", header: "ETP fin de mois", kind: "etp" },
    { key: "nb", header: "Contrats", kind: "nombre" },
    { key: "pts", header: "Écart de taux", kind: "pourcent", signed: true, points: true },
    { key: "date", header: "Date", kind: "date" },
  ],
  rows: [
    { cells: ["Atelier", "Salaires", 123456, -2500, { exact: -0.0125 }, 12345, 3, 25, "2026-01-15"] },
    { cells: ["=Bureau", "+Prime", { nd: R1 }, { nd: R1 }, { nd: R1 }, { nd: R2 }, 0, "", ""] },
    { cells: ["Atelier 2", "-12", 0, 1500, { exact: 0.5 }, 10000, 12, -10, ""] },
    { cells: ["Équipe C", "@ref", -99, 0, "", 5, 1, 0, "2026-02-28"] },
  ],
  foot: { cells: ["Total", "", { nd: R1 }, { nd: R1 }, { nd: R1 }, { nd: R2 }, 16, "", ""] },
  notes: ["Mois non clos : mars 2026."],
  terms: ["masse", "evolution"],
};
const MENSUEL: CroiseeTable = {
  id: "demo-mensuel",
  title: "Montants par mois",
  columns: [
    { key: "mois", header: "Mois", kind: "text" },
    { key: "montant", header: "Montant", kind: "eur" },
  ],
  rows: [{ cells: ["Janvier 2026", 100000] }, { cells: ["Février 2026", { nd: R1 }] }],
};
const MODEL: ExportModel = {
  chapter: "fixe-variable",
  tiles: [{ id: "masse", label: "Masse fictive", term: "service", value: { text: "1 234,56 €", kind: "value", reason: null } }],
  tables: [MONTANTS, ndShape("demo-libelles", "Brut par libellé", "libellés de la période non lus"), MENSUEL, ndShape("demo-reglage", "Tableau caché", "réglage illisible")],
  charts: [{ id: "demo-mensuel-graphique", tableId: "demo-mensuel" }],
  limits: ["Indemnités de départ : non distinguées par le journal."],
  nd: null,
  terms: [T.rigidite],
  blocks: [
    { id: "montants", title: "Montants", tables: ["demo-montants"], charts: [], nd: [], notes: ["Montants en euros."] },
    { id: "mois", title: "Par mois", tables: [], charts: ["demo-mensuel-graphique"], nd: [] },
    { id: "libelles", title: "Brut par libellé", tables: [], charts: [], nd: [{ label: "Brut par libellé", reason: "libellés de la période non lus" }], prevu: [{ label: "Calendrier des primes", reason: "aucun réglage dans cette version" }] },
  ],
  prevu: [{ label: "Indemnités de départ", reason: "non distinguées par le journal" }],
};

// Lignes CSV attendues, calculées à la main : 123 456 centimes = 1234,56 ; −2 500 = −25,00 ; −0,0125 = −1,25 % ; 12 345 dix-millièmes
// d'ETP = 1,2345 → 1,23 ; 25 centièmes de point = 0,25 ; 0,5 = 50,00 % ; 5 dix-millièmes = 0,0005 → 0,00 (comme l'écran).
const MONTANTS_CSV = [
  '"Équipe";"Libellé";"Coût N";"Écart";"Écart (%)";"ETP fin de mois";"Contrats";"Écart de taux";"Date"',
  '"Atelier";"Salaires";"1234,56";"-25,00";"-1,25";"1,23";"3";"0,25";"15/01/2026"',
  `"'=Bureau";"'+Prime";"n.d. (${R1})";"n.d. (${R1})";"n.d. (${R1})";"n.d. (${R2})";"0";"";""`,
  '"Atelier 2";"-12";"0,00";"15,00";"50,00";"1,00";"12";"-0,10";""',
  `"Équipe C";"'@ref";"-0,99";"0,00";"";"0,00";"1";"0,00";"28/02/2026"`,
  `"Total";"";"n.d. (${R1})";"n.d. (${R1})";"n.d. (${R1})";"n.d. (${R2})";"16";"";""`,
];

describe("tableaux de l'écran", () => {
  it("un modèle à blocs : tableaux listés par un bloc et tableau exact d'un graphique ; la forme exportable d'un bloc n.d. n'en fait pas partie", () => {
    expect(screenTables(MODEL).map((t) => t.id)).toEqual(["demo-montants", "demo-mensuel"]);
  });
  it("un modèle sans blocs (Synthèse) : tous ses tableaux", () => {
    const { blocks: _b, ...flat } = MODEL;
    expect(screenTables(flat).map((t) => t.id)).toEqual(["demo-montants", "demo-libelles", "demo-mensuel", "demo-reglage"]);
  });
});

describe("CSV d'un tableau", () => {
  it("BOM, point-virgule, fin de ligne Windows ; en-têtes, lignes puis total ; cas de référence écrit à la main", () => {
    expect(csvLines(tableCsv(MONTANTS))).toEqual(MONTANTS_CSV);
  });
  it("identique à l'écran, cellule par cellule : même nombre arrondi de la même façon (sans espace, unité ni signe +), même n.d. et même raison", () => {
    const strip = (s: string) => s.replace(/[\s  €%+]|pts/g, "").replace(/−/g, "-");
    for (const r of [...MONTANTS.rows, MONTANTS.foot!]) {
      MONTANTS.columns.forEach((c, i) => {
        const v = cellView(r.cells[i], c, r);
        const out = csvCell(r.cells[i], c, r);
        if (v.nd !== null) expect(out).toBe(`n.d. (${v.nd})`);
        else if (v.na) expect(out).toBe("");
        else if (v.numeric) expect(out).toBe(strip(v.text));
        else expect(out).toBe(safeText(v.text));
      });
    }
  });
  it("safeText sur le texte seulement : =, +, @ et « - » non numérique préfixés ; un écart négatif (nombre) jamais", () => {
    const text = MONTANTS.columns[0];
    const eur = MONTANTS.columns[3];
    expect(csvCell("=SOMME(A1)", text)).toBe("'=SOMME(A1)");
    expect(csvCell("-Remise", text)).toBe("'-Remise");
    expect(csvCell("-12", text)).toBe("-12"); // nombre pur écrit en texte : reste tel quel
    expect(csvCell("\tTab", text)).toBe("'\tTab");
    expect(csvCell(-2500, eur)).toBe("-25,00");
    expect(csvCell({ exact: -0.0125 }, MONTANTS.columns[4])).toBe("-1,25");
  });
  it("un n.d. n'est jamais 0 ; une valeur que l'écran ne sait pas écrire est n.d. avec la même raison", () => {
    const eur = MONTANTS.columns[2];
    expect(csvCell({ nd: R1 }, eur)).toBe(`n.d. (${R1})`);
    expect(csvCell({ exact: Number.NaN }, eur)).toBe("n.d. (valeur non finie)");
    expect(cellView({ exact: Number.NaN }, eur).nd).toBe("valeur non finie");
    expect(csvCell({ exact: 1.5 }, MONTANTS.columns[0])).toBe("n.d. (valeur numérique dans une colonne de texte)");
    expect(csvCell(1.5, eur)).toBe("n.d. (valeur hors de l'unité de base)");
    expect(exportCell(1.5, eur)).toEqual({ nd: "valeur hors de l'unité de base" });
    expect(exportCell(undefined, eur)).toBe("");
    expect(exportCell(-2500, eur)).toBe(-2500);
  });
  it("unité propre à une ligne (tableaux à unités mêlées) : la ligne d'ETP s'écrit en ETP dans une colonne en euros", () => {
    const t: CroiseeTable = { id: "mix", title: "Mix", columns: [{ key: "l", header: "Ligne", kind: "text" }, { key: "v", header: "Valeur", kind: "eur" }], rows: [{ cells: ["Masse", 150000] }, { cells: ["ETP moyen", 25000], kind: "etp" }] };
    expect(csvLines(tableCsv(t))).toEqual(['"Ligne";"Valeur"', '"Masse";"1500,00"', '"ETP moyen";"2,50"']);
  });
});

describe("classeur Excel du chapitre", () => {
  const spec = () =>
    chapterWorkbook({
      title: "Masse salariale croisée — 04 Fixe & variable",
      workspaceName: "Espace fictif",
      generatedAt: "2026-10-26T09:30:00Z",
      model: MODEL,
      sort: null,
      filters: [{ label: "Période", value: "janvier → mars 2026" }],
      sources: [],
    });

  it("« Chiffres clés » (cartes), une feuille par tableau de l'écran, puis « Non disponibles », « Filtres », « Sources » et « Définitions »", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    expect(wb.worksheets.map((w) => w.name)).toEqual([KEY_FIGURES_TITLE, "Montants fictifs par équipe", "Montants par mois", ND_SHEET, "Filtres", "Sources", "Définitions"]);
  });

  it("mêmes lignes et mêmes cellules que l'écran : montants en vrais nombres, n.d. avec sa raison (jamais 0), texte protégé, écart négatif en nombre", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    const ws = wb.getWorksheet("Montants fictifs par équipe")!;
    const rows = sheetRows(ws, "Équipe", 9);
    expect(rows).toHaveLength(5); // quatre lignes et le total, rien d'autre
    const v = (r: number, c: number) => rows[r][c].value;
    // Atelier : 1 234,56 € ; écart −25 € ; −1,25 % ; 1,2345 ETP ; 3 contrats ; 0,25 point (0,0025) ; 15/01/2026.
    expect([v(0, 0), v(0, 1), v(0, 2), v(0, 3), v(0, 4), v(0, 5), v(0, 6), v(0, 7)]).toEqual(["Atelier", "Salaires", 1234.56, -25, -0.0125, 1.2345, 3, 0.0025]);
    expect((v(0, 8) as Date).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(typeof v(0, 3)).toBe("number");
    // =Bureau : texte préfixé ; n.d. avec raison en commentaire, jamais 0 ; un vrai zéro (0 contrat) reste 0 ; vide = sans objet.
    expect([v(1, 0), v(1, 1)]).toEqual(["'=Bureau", "'+Prime"]);
    for (const c of [2, 3, 4, 5]) {
      expect(v(1, c)).toBe("n.d.");
      expect(v(1, c)).not.toBe(0);
    }
    expect([noteOf(rows[1][2]), noteOf(rows[1][5])]).toEqual([R1, R2]);
    expect(v(1, 6)).toBe(0);
    expect([v(1, 7), v(1, 8)]).toEqual([null, null]);
    // Atelier 2 : « -12 » est un nombre pur écrit en texte, non préfixé ; 0 € ; +15 € ; 50 % ; 1 ETP ; −0,10 point.
    expect([v(2, 1), v(2, 2), v(2, 3), v(2, 4), v(2, 5), v(2, 6), v(2, 7)]).toEqual(["-12", 0, 15, 0.5, 1, 12, -0.001]);
    expect([v(3, 1), v(3, 2), v(3, 4)]).toEqual(["'@ref", -0.99, null]);
    // Total : n.d. sur les montants, 16 contrats.
    expect([v(4, 0), v(4, 2), v(4, 6)]).toEqual(["Total", "n.d.", 16]);
    // Note : lignes du tableau et de son bloc, mention des points, cellule vide.
    const texts: string[] = [];
    ws.eachRow((row) => texts.push(String(row.getCell(1).value ?? "")));
    expect(texts).toContain(`Mois non clos : mars 2026. Montants en euros. Écarts de taux en points : 0,25 point s'écrit 0,25 %. ${EMPTY_CELL_NOTE}`);
  });

  it("titre trop long pour un nom de feuille : coupé à la fin d'un mot (31 caractères au plus), titre complet dans la note", () => {
    expect(sheetName("Composantes du brut et de la masse chargée")).toBe("Composantes du brut et de la");
    expect(sheetName("Où sont les effectifs ? Par service, fin janv. 2026")).toBe("Où sont les effectifs Par");
    expect(sheetName("Montants par mois")).toBe("Montants par mois");
    const t: CroiseeTable = { ...MENSUEL, title: "Composantes du brut et de la masse chargée" };
    const sheet = tableSheet(t);
    expect(sheet.name).toBe("Composantes du brut et de la");
    expect(sheet.note).toBe("Tableau : Composantes du brut et de la masse chargée.");
  });

  it("le CSV et le classeur portent les mêmes lignes, dans le même ordre", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    const xl = sheetRows(wb.getWorksheet("Montants fictifs par équipe")!, "Équipe", 9).map((r) => r[0].value);
    expect(xl).toEqual(MONTANTS_CSV.slice(1).map((l) => split(l)[0]));
  });

  it("tableau exact d'un graphique : deux mois, février n.d. avec sa raison", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    const rows = sheetRows(wb.getWorksheet("Montants par mois")!, "Mois", 2);
    expect(rows.map((r) => [r[0].value, r[1].value])).toEqual([["Janvier 2026", 1000], ["Février 2026", "n.d."]]);
    expect(noteOf(rows[1][1])).toBe(R1);
  });

  it("« Non disponibles » : blocs n.d. et « Prévu » avec leur raison ; la raison d'un bloc caché n'est pas répétée, celle qui manque est ajoutée", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    const rows = sheetRows(wb.getWorksheet(ND_SHEET)!, "Bloc", 4).map((r) => r.map((c) => c.value));
    expect(rows).toEqual([
      ["Brut par libellé", "Brut par libellé", "Non disponible (n.d.)", "libellés de la période non lus"],
      ["Brut par libellé", "Calendrier des primes", "Prévu", "aucun réglage dans cette version"],
      ["Chapitre", "Indemnités de départ", "Prévu", "non distinguées par le journal"],
      ["Tableau caché", null, "Non disponible (n.d.)", "réglage illisible"],
    ]);
  });

  it("« Définitions » : entrées du glossaire des tableaux (en-têtes compris), des cartes et du chapitre, puis de la page", async () => {
    expect(exportTermIds(MODEL)).toEqual(["masse", "evolution", "service", T.rigidite, T.vueEnsemble, T.periodeFiltres, T.unites, T.nd, T.prevu, T.export]);
    const wb = await load(await buildWorkbook(spec().spec));
    const terms = sheetRows(wb.getWorksheet("Définitions")!, "Terme", 1).map((r) => r[0].value);
    expect(terms).toEqual(exportTermIds(MODEL).map((id) => glossaryEntry(id)!.term));
    expect(spec().unknownTerms).toEqual([]);
  });
});

// --- Tri par l'adresse (chapitre 05) -------------------------------------------------------------------------------------------------

const SORTABLE: CroiseeTable = {
  id: "services",
  title: "Coût par service",
  columns: [
    { key: "service", header: "Service", kind: "text", sortable: true },
    { key: "n", header: "Coût 2026", kind: "eur", sortable: true },
  ],
  rows: [{ cells: ["A", 300000] }, { cells: ["B", { nd: R1 }] }, { cells: ["C", 100000] }],
  foot: { cells: ["Total", { nd: R1 }] },
};

describe("tri de l'écran repris par l'export", () => {
  it("tri=services.n&sens=asc : C, A, puis le n.d. en dernier ; le total ne bouge pas ; sans tri : ordre du modèle", () => {
    const sorted = screenRows(SORTABLE, { tri: "services.n", sens: "asc" });
    expect(sorted.rows.map((r) => r.cells[0])).toEqual(["C", "A", "B"]);
    expect(csvLines(tableCsv(SORTABLE, sorted.rows)).map((l) => split(l)[0])).toEqual(["Service", "C", "A", "B", "Total"]);
    expect(screenRows(SORTABLE, null).rows.map((r) => r.cells[0])).toEqual(["A", "B", "C"]);
    expect(screenRows(SORTABLE, { tri: "autre.n", sens: "asc" }).sorted).toBeNull();
  });
  it("le tri est écrit dans la feuille « Filtres »", () => {
    const model: ExportModel = { chapter: "services", tiles: [], tables: [SORTABLE], charts: [], limits: [], nd: null, terms: [] };
    const st = sortedTables(model, { tri: "services.n", sens: "desc" });
    const f = croiseeFilters(filterCtx(), model, ["journal"], st);
    expect(f.find((x) => x.label === "Tri du tableau « Coût par service »")?.value).toBe("Coût 2026, ordre décroissant");
  });
});

// --- Filtres -------------------------------------------------------------------------------------------------------------------------

function filterCtx(o: Partial<FilterCtx> = {}): FilterCtx {
  return {
    chapter: chapterDef("synthese"),
    period: { year: 2026, from: "01", to: "03", years: [2026], last: "03", months: ["2026-01", "2026-02", "2026-03"], notices: [] },
    periodNd: null,
    labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
    service: { axis: "Service", value: undefined, label: "Tous les services", options: [], reason: null },
    budget: { selected: { id: "b1", name: "Budget fictif", year: "2026", updatedAt: new Date("2026-02-10T10:00:00Z") } as FilterCtx["budget"]["selected"], explicit: false, options: [], reason: null },
    scenario: { selected: null, explicit: false, options: [], reason: "aucun scénario ne couvre 2026" },
    openMonths: ["2026-03"],
    notices: ["paramètre ignoré : service=X (service absent du journal)"],
    ...o,
  };
}

describe("feuille « Filtres »", () => {
  it("chapitre, période, N-1, service et axe, budget et scénario retenus (n.d. avec raison), mois non clos, paramètres ignorés, limites", () => {
    expect(croiseeFilters(filterCtx(), { limits: ["Limite fictive."] }, ["rh", "journal", "budget", "scenario"])).toEqual([
      { label: "Chapitre", value: "01 · Synthèse" },
      { label: "Période", value: "janvier → mars 2026" },
      { label: "N-1", value: "janvier → mars 2025" },
      { label: "Service", value: "Tous les services (axe analytique « Service »)" },
      { label: "Budget saisi", value: "« Budget fictif » · modifié le 10/02/2026 · par défaut, le plus récent de l'année" },
      { label: "Scénario", value: "n.d. — aucun scénario ne couvre 2026" },
      { label: "Mois non clos (montants provisoires)", value: "mars 2026" },
      { label: "Paramètres ignorés", value: "paramètre ignoré : service=X (service absent du journal)" },
      { label: "Limite de la lecture", value: "Limite fictive." },
    ]);
  });
  it("budget et scénario seulement pour un chapitre qui les lit ; service sans axe : raison écrite", () => {
    const f = croiseeFilters(filterCtx({ service: { axis: null, value: undefined, label: "Tous les services", options: [], reason: "aucun code analytique dans le journal PayFit" }, openMonths: [], notices: [] }), { limits: [] }, ["rh"]);
    expect(f.map((x) => x.label)).toEqual(["Chapitre", "Période", "N-1", "Service"]);
    expect(f[3].value).toBe("Tous les services — ventilation par service n.d. : aucun code analytique dans le journal PayFit");
  });
});

// --- Registre des chapitres ---------------------------------------------------------------------------------------------------------

describe("registre : la fonction mémoïsée du chapitre, celle qu'appelle l'écran", () => {
  it("chaque chapitre vivant pointe sur la fonction <chapitre>Model de son fichier src/lib/viz/croisee-<chapitre>.ts (aucun second calcul)", () => {
    const models = {
      synthese: syntheseModel,
      effectifs: effectifsModel,
      absences: absencesModel,
      "fixe-variable": fixeVariableModel,
      services: servicesModel,
      budget: budgetModel,
      "paie-compta": paieComptaModel,
      effets: effetsModel,
    } as const;
    expect(CHAPTERS.filter((c) => c.statut === "vivant").map((c) => c.id)).toEqual(Object.keys(models));
    for (const [id, m] of Object.entries(models)) expect(CROISEE_EXPORTS[id as keyof typeof models]!.model, id).toBe(m);
    expect(CROISEE_EXPORTS.services!.sorted).toBe(true);
    expect(CROISEE_EXPORTS.services!.defaultSort).toEqual({ table: "services", key: "n", dir: "desc" });
    expect(CROISEE_EXPORTS["fixe-variable"]!.sorted).toBe(false);
  });

  it("deux appels sur le même contexte ne relancent pas le chargement : même promesse que l'écran, journal lu une fois", async () => {
    const payroll = vi.fn(async () => ({ input: null, unavailable: null, source: "dsn" }));
    const ctx = routeCtx({ chapitre: "fixe-variable" }, payroll);
    const a = CROISEE_EXPORTS["fixe-variable"]!.model(ctx);
    expect(fixeVariableModel(ctx)).toBe(a); // l'appel du composant du chapitre reçoit la même promesse
    expect((await a).nd?.reason).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
    expect(payroll).toHaveBeenCalledTimes(1);
    // Menu de la page puis chapitre : toujours un seul chargement ; le modèle n.d. ne laisse que « Exporter les services ».
    const payroll2 = vi.fn(async () => ({ input: null, unavailable: null, source: "dsn" }));
    const ctx2 = routeCtx({ chapitre: "fixe-variable" }, payroll2);
    expect((await croiseeExportOptions(ctx2)).map((o) => o.testid)).toEqual(["cx-export-services"]);
    await fixeVariableModel(ctx2);
    expect(payroll2).toHaveBeenCalledTimes(1);
    // Un autre contexte (une autre requête) recalcule.
    expect(fixeVariableModel(routeCtx({ chapitre: "fixe-variable" }, payroll))).not.toBe(a);
  });

  it("sources lues : filtre de service et journal lu ou non (Synthèse : comptabilité et DSN traitées de même ; Effets sans scénario)", async () => {
    const u = (id: keyof typeof CROISEE_EXPORTS, filtered: boolean, journal: boolean) => CROISEE_EXPORTS[id]!.uses({ filtered, journal });
    expect(u("synthese", false, true)).toEqual(["rh", "journal", "budget", "scenario", "compta", "dsn"]);
    expect(u("synthese", false, false)).toEqual(["rh", "journal", "budget", "scenario"]);
    expect(u("synthese", true, true)).toEqual(["journal"]);
    expect(u("effectifs", true, true)).toEqual(["rh", "journal"]);
    expect(u("absences", false, true)).toEqual(["rh"]);
    expect(u("absences", true, true)).toEqual([]);
    expect(u("fixe-variable", true, true)).toEqual(["journal"]);
    expect(u("services", true, true)).toEqual(["journal"]);
    expect(u("budget", false, true)).toEqual(["journal", "budget", "scenario"]);
    expect(u("budget", true, true)).toEqual(["journal"]);
    expect(u("paie-compta", false, true)).toEqual(["journal", "compta", "dsn"]);
    expect(u("paie-compta", true, true)).toEqual(["journal"]);
    expect(u("effets", false, true)).toEqual(["journal", "rh"]);
    // Dérivé du contexte : service retenu, journal non lu (raison de la page).
    const ctx = routeCtx({ chapitre: "synthese", service: "Atelier" }, async () => ({ input: null, unavailable: null, source: "dsn" }));
    expect(await sourceUses(ctx, CROISEE_EXPORTS.synthese!)).toEqual(["journal"]);
    expect(await sourceUses(routeCtx({ chapitre: "synthese" }, async () => ({ input: null, unavailable: null, source: "dsn" })), CROISEE_EXPORTS.synthese!)).toEqual(["rh", "journal", "budget", "scenario"]);
  });
  it("chapitre inconnu ou « Prévu » : refusé avec la raison ; absent : Synthèse", () => {
    expect(chapterExport("inconnu")).toEqual({ kind: "unknown", reason: "Chapitre inconnu : inconnu." });
    expect(chapterExport("restructuration")).toEqual({ kind: "prevu", id: "restructuration", reason: "Chapitre 09 · Restructuration : « Prévu », aucun tableau à exporter dans cette version." });
    expect(chapterExport("juridique").kind).toBe("prevu");
    expect(chapterExport(undefined)).toMatchObject({ kind: "ok", id: "synthese" });
    expect(chapterExport("services")).toMatchObject({ kind: "ok", id: "services" });
  });
});

// --- Menu « Exporter » --------------------------------------------------------------------------------------------------------------

const BASE = "/e/demo/studio-rh/masse-salariale/croisee";
const menuCtx = (axis: string | null, chapter: "fixe-variable" | "services" = "fixe-variable", period = true) =>
  ({
    base: BASE,
    chapter: chapterDef(chapter),
    period: period ? { year: 2026, from: "01", to: "03", months: ["2026-01", "2026-02", "2026-03"] } : null,
    state: { chapitre: chapter, annee: "2026", de: "01", a: "03", affichage: "tableau", tri: null, sens: null },
    service: { axis },
  }) as unknown as MenuCtx;
const SERVICES_OPTION = { label: SERVICES_EXPORT_LABEL, href: `${BASE}/export?chapitre=services&annee=2026&de=01&a=03&format=csv&tableau=services`, testid: "cx-export-services" };

describe("menu « Exporter »", () => {
  it("Excel du chapitre en premier, puis le CSV de chaque tableau de l'écran, puis « Exporter les services » ; l'affichage n'est pas repris", () => {
    expect(exportOptions(menuCtx("Service"), MODEL)).toEqual([
      { label: "Excel du chapitre (.xlsx)", href: `${BASE}/export?chapitre=fixe-variable&annee=2026&de=01&a=03&format=xlsx`, testid: "cx-export-xlsx" },
      { label: "CSV · Montants fictifs par équipe", href: `${BASE}/export?chapitre=fixe-variable&annee=2026&de=01&a=03&format=csv&tableau=demo-montants`, testid: "cx-export-csv-demo-montants" },
      { label: "CSV · Montants par mois", href: `${BASE}/export?chapitre=fixe-variable&annee=2026&de=01&a=03&format=csv&tableau=demo-mensuel`, testid: "cx-export-csv-demo-mensuel" },
      { label: SERVICES_EXPORT_LABEL, href: `${BASE}/export?chapitre=services&annee=2026&de=01&a=03&format=csv&tableau=services`, testid: "cx-export-services" },
    ]);
  });
  it("rendu du menu partagé ExportMenu : « Exporter », Excel avant les CSV, identifiants de test", () => {
    const html = renderToStaticMarkup(h(ExportMenu, { label: "Exporter", testid: "cx-exports", options: exportOptions(menuCtx("Service"), MODEL) })).replace(/&amp;/g, "&");
    expect(html).toContain('data-testid="cx-exports"');
    expect(html).toContain('<summary class="btn">Exporter');
    expect(html.indexOf('data-testid="cx-export-xlsx"')).toBeLessThan(html.indexOf('data-testid="cx-export-csv-demo-montants"'));
    expect(html).toContain(`href="${BASE}/export?chapitre=services&annee=2026&de=01&a=03&format=csv&tableau=services" data-testid="cx-export-services"`);
  });
  it("sans axe de service : pas d'« Exporter les services » ; chapitre non calculable : aucun menu", () => {
    expect(exportOptions(menuCtx(null), MODEL).map((o) => o.testid)).toEqual(["cx-export-xlsx", "cx-export-csv-demo-montants", "cx-export-csv-demo-mensuel"]);
    expect(exportOptions(menuCtx(null), { ...MODEL, nd: { reason: "journal de paie indisponible" } })).toEqual([]);
  });
  it("« Exporter les services » dès qu'un axe est retenu et qu'une période existe, même si le chapitre courant est n.d., vide ou en échec", () => {
    const nd: ExportModel = { ...MODEL, nd: { reason: "journal de paie indisponible" } };
    const empty: ExportModel = { ...MODEL, tiles: [], tables: [], charts: [], blocks: [] };
    const allNd: ExportModel = { ...MODEL, tables: [ndShape("demo-libelles", "Brut par libellé", "non filtrable par service")], charts: [], blocks: [{ id: "x", title: "Bloc", tables: [], nd: [{ reason: "non filtrable par service" }] }] };
    expect(exportOptions(menuCtx("Service"), nd)).toEqual([SERVICES_OPTION]);
    expect(exportOptions(menuCtx("Service"), null)).toEqual([SERVICES_OPTION]); // modèle en échec
    expect(exportOptions(menuCtx("Service"), empty)).toEqual([SERVICES_OPTION]);
    // Blocs tous n.d. mais cartes présentes : l'Excel du chapitre (cartes, raisons) reste proposé.
    expect(exportOptions(menuCtx("Service"), allNd).map((o) => o.testid)).toEqual(["cx-export-xlsx", "cx-export-services"]);
    // Sans période, ou au chapitre 05 lui-même (son tableau porte déjà l'option) : rien de plus.
    expect(exportOptions(menuCtx("Service", "fixe-variable", false), null)).toEqual([]);
    expect(exportOptions(menuCtx("Service", "services"), null)).toEqual([]);
  });
});

// --- Route d'export (chapitre 05 · Services, chargeur simulé) ------------------------------------------------------------------------

const R = (salaires: number, primes: number) => ({ salaires, primes, stages: 0, indemnites: 0 });
const month = (m: string, brut: number, primes: number, cotisations: number): MonthIn => ({ month: m, kind: "value", open: false, brut, cotisations, masse: brut + cotisations, byRubric: R(brut - primes, primes) });
const win = (m: string, brut: number, primes: number, cotisations: number, paid: number): WindowIn => ({ kind: "value", brut, cotisations, masse: brut + cotisations, byRubric: R(brut - primes, primes), months: [month(m, brut, primes, cotisations)], paidContractMonths: paid });
// Atelier : brut 2 000 € dont 200 € de primes, cotisations 1 000 € → masse 3 000 € ; N-1 2 500 € ; deux contrats-mois.
// =Bureau : brut 700 €, cotisations 300 € → masse 1 000 € ; N-1 1 500 € ; un contrat-mois. Total : 4 000 € face à 4 000 €.
const SERVICES: ServicesInput = {
  nd: null,
  data: {
    year: 2026,
    prevYear: 2025,
    labels: { period: "janvier 2026", prev: "janvier 2025" },
    axis: "Service",
    axisMissing: false,
    rows: [
      { value: "Atelier", cur: win("2026-01", 200000, 20000, 100000, 2), prev: win("2025-01", 180000, 0, 70000, 2), evo: { kind: "value", deltaCents: 50000, ratio: { num: 50000, den: 250000 } } },
      { value: "=Bureau", cur: win("2026-01", 70000, 0, 30000, 1), prev: win("2025-01", 100000, 0, 50000, 1), evo: { kind: "value", deltaCents: -50000, ratio: { num: -50000, den: 150000 } } },
    ],
    total: { cur: win("2026-01", 270000, 20000, 130000, 3), prev: win("2025-01", 280000, 0, 120000, 3), evo: { kind: "value", deltaCents: 0, ratio: { num: 0, den: 400000 } } },
    selected: null,
  },
};
// Coût / personne-mois : 3 000 € ÷ 2 = 1 500 € ; 1 000 € ÷ 1 = 1 000 € ; 4 000 € ÷ 3 = 1 333,33 €. Parts : 75 % et 25 %.
// Écarts : +500 € (+20 %) et −500 € (−33,33 %) ; total 0 € (0 %). Hors primes : 1 800 €, 700 €, 2 500 €.
// En-têtes de période de l'écran (D4) : « Coût janvier 2026 », « Coût N-1 (janvier 2025) ».
const SERVICES_CSV = [
  '"Service";"Coût janvier 2026";"Coût N-1 (janvier 2025)";"Écart";"Écart (%)";"Part du coût";"Hors primes";"Primes";"Cotisations";"Coût / personne-mois"',
  '"Atelier";"3000,00";"2500,00";"500,00";"20,00";"75,00";"1800,00";"200,00";"1000,00";"1500,00"',
  `"'=Bureau";"1000,00";"1500,00";"-500,00";"-33,33";"25,00";"700,00";"0,00";"300,00";"1000,00"`,
  '"Total";"4000,00";"4000,00";"0,00";"0,00";"";"2500,00";"200,00";"1300,00";"1333,33"',
];
// CSV « Exporter les services » : les mêmes lignes, plus le début (1er janvier) et la fin (31 janvier) de la période après « Service ».
const SERVICES_ROUTE_CSV = SERVICES_CSV.map((l, i) => {
  const [first, ...rest] = split(l);
  const lead = i === 0 ? ["Début de période", "Fin de période"] : ["01/01/2026", "31/01/2026"];
  return [first, ...lead, ...rest].map((c) => `"${c.replace(/"/g, '""')}"`).join(";");
});

type PayrollLoader = () => Promise<unknown>;
// Journal « lu » par défaut (input renseigné) : le chargeur du chapitre 05 est simulé, il ne lit pas cette entrée.
const JOURNAL_LU: PayrollLoader = async () => ({ source: "payfit", input: { lignes: "simulées" }, unavailable: null });

function routeCtx(sp: Record<string, string | string[]>, payroll: PayrollLoader = JOURNAL_LU): CroiseeContext {
  const q = parseQuery(sp);
  const state = { chapitre: q.chapitre, annee: "2026", de: "01", a: "01", tri: q.tri, sens: q.sens };
  return {
    slug: "demo",
    base: BASE,
    workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" },
    chapter: chapterDef(q.chapitre),
    query: q,
    notices: q.notices,
    period: { year: 2026, from: "01", to: "01", years: [2026], last: "01", months: ["2026-01"], notices: [] },
    periodNd: null,
    prevMonths: ["2025-01"],
    labels: { period: "janvier 2026", prev: "janvier 2025" },
    openMonths: [],
    service: { axis: "Service", value: q.service || undefined, label: q.service || "Tous les services", options: [], reason: null },
    budget: { selected: null, explicit: false, options: [], reason: "aucun budget saisi pour 2026" },
    scenario: { selected: null, explicit: false, options: [], reason: "aucun scénario ne couvre 2026" },
    settings: { confidentialite: { kind: "absent" }, seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } },
    canEdit: false,
    affichage: q.affichage,
    state,
    href: (patch = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: { payroll, compta: async () => ({ source: null, reason: "aucune source comptable retenue" }) },
  } as unknown as CroiseeContext;
}

const call = (q: string) => GET(new NextRequest(`http://localhost${BASE}/export?${q}`), { params: Promise.resolve({ slug: "demo" }) });

describe("route d'export de la Masse salariale croisée", () => {
  beforeEach(() => {
    mocks.ctx.mockReset().mockImplementation(async (_slug: string, _ws: unknown, sp: Record<string, string>) => routeCtx(sp));
    mocks.services.mockReset().mockResolvedValue(SERVICES);
    mocks.lastSync.mockReset().mockResolvedValue(null);
    mocks.activeSync.mockReset().mockResolvedValue(null);
  });

  it("CSV « Exporter les services » : en-têtes et cellules de l'écran, cas de référence écrit à la main ; texte protégé, écart négatif en nombre", async () => {
    const res = await call("chapitre=services&annee=2026&de=01&a=01&format=csv&tableau=services");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain('filename="masse-salariale-croisee-services-2026-01-01.csv"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(csvLines(bytes.toString("utf8"))).toEqual(SERVICES_ROUTE_CSV);
    // Même tableau que l'écran : le modèle construit par buildServices sur la même entrée ; le CSV y ajoute la période.
    const screen = buildServices(SERVICES).tables[0];
    expect(csvLines(tableCsv(screen))).toEqual(SERVICES_CSV);
    expect(csvLines(tableCsv(screen, screen.rows, periodLead({ months: ["2026-01"] })))).toEqual(SERVICES_ROUTE_CSV);
  });

  it("le tri de l'adresse est repris (coût croissant : =Bureau d'abord)", async () => {
    const res = await call("chapitre=services&format=csv&tableau=services&tri=services.n&sens=asc");
    const lines = csvLines(Buffer.from(await res.arrayBuffer()).toString("utf8"));
    expect(lines.map((l) => split(l)[0])).toEqual(["Service", "'=Bureau", "Atelier", "Total"]);
  });

  it("Excel du chapitre : feuille « Coût par service » (vrais nombres, écart négatif numérique, texte protégé), Filtres, Sources, Définitions", async () => {
    const res = await call("chapitre=services&annee=2026&de=01&a=01&format=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="masse-salariale-croisee-services-2026-01-01.xlsx"');
    const wb = await load(Buffer.from(await res.arrayBuffer()));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Coût par service", "Filtres", "Sources", "Définitions"]);
    const rows = sheetRows(wb.getWorksheet("Coût par service")!, "Service", 10).map((r) => r.map((c) => c.value));
    expect(rows[0]).toEqual(["Atelier", 3000, 2500, 500, 0.2, 0.75, 1800, 200, 1000, 1500]);
    expect(rows[1].slice(0, 4)).toEqual(["'=Bureau", 1000, 1500, -500]);
    expect(rows[1][4]).toBeCloseTo(-1 / 3, 12);
    expect(rows[2].slice(0, 6)).toEqual(["Total", 4000, 4000, 0, 0, null]);
    expect(rows[2][9]).toBeCloseTo(4000 / 3, 9);
    const filters = sheetRows(wb.getWorksheet("Filtres")!, "Paramètre", 2).map((r) => [r[0].value, r[1].value]);
    expect(filters).toEqual([
      ["Chapitre", "05 · Services"],
      ["Période", "janvier 2026"],
      ["N-1", "janvier 2025"],
      ["Service", "Tous les services (axe analytique « Service »)"],
      ["Tri du tableau « Coût par service »", "Coût janvier 2026, ordre décroissant (par défaut)"],
      ["Limite de la lecture", "Coût / personne-mois : contrats rémunérés chaque mois ; ce n'est pas un coût par ETP."],
    ]);
    const sources = sheetRows(wb.getWorksheet("Sources")!, "Source", 4).map((r) => [r[0].value, r[1].value, r[2].value, r[3].value]);
    expect(sources).toEqual([["PayFit", "journal comptable de paie (masse, brut, cotisations, services) · aucune lecture appliquée", "n.d.", "Jamais synchronisée"]]);
  });

  it("chapitre 05 avec un service retenu : « Filtres » dit que le service ne restreint pas le chapitre (tous les services, total compris)", async () => {
    const res = await call("chapitre=services&annee=2026&de=01&a=01&service=Atelier&format=xlsx");
    expect(res.status).toBe(200);
    const wb = await load(Buffer.from(await res.arrayBuffer()));
    const filters = new Map(sheetRows(wb.getWorksheet("Filtres")!, "Paramètre", 2).map((r) => [r[0].value, r[1].value]));
    expect(filters.get("Service")).toBe("Tous les services (le service « Atelier » retenu ne restreint pas ce chapitre)");
    const rows = sheetRows(wb.getWorksheet("Coût par service")!, "Service", 10).map((r) => r[0].value);
    expect(rows).toEqual(["Atelier", "'=Bureau", "Total"]);
  });

  it("paramètre répété : la première valeur, comme la page (parseQuery)", async () => {
    const res = await call("chapitre=services&chapitre=inconnu&format=csv&format=pdf&tableau=services&tableau=absent&tri=services.n&sens=asc&sens=desc");
    expect(res.status).toBe(200);
    expect(csvLines(Buffer.from(await res.arrayBuffer()).toString("utf8")).map((l) => split(l)[0])).toEqual(["Service", "'=Bureau", "Atelier", "Total"]);
  });

  it("chapitre « Prévu » ou inconnu : 404 avec la raison, sans aucune lecture ; format inconnu ou CSV sans tableau : 400", async () => {
    const prevu = await call("chapitre=restructuration&format=xlsx");
    expect(prevu.status).toBe(404);
    expect(await prevu.text()).toContain("« Prévu »");
    const unknown = await call("chapitre=inconnu");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("Chapitre inconnu : inconnu.");
    expect(mocks.ctx).not.toHaveBeenCalled();
    expect((await call("chapitre=services&format=pdf")).status).toBe(400);
    expect((await call("chapitre=services&format=csv")).status).toBe(400);
  });

  it("modèle mémoïsé par contexte : un second appel sur la même requête ne relance pas le chargeur", async () => {
    const ctx = routeCtx({ chapitre: "services" });
    const a = await CROISEE_EXPORTS.services!.model(ctx);
    expect(await CROISEE_EXPORTS.services!.model(ctx)).toBe(a);
    expect(mocks.services).toHaveBeenCalledTimes(1);
    expect(exportOptions(ctx, a).map((o) => o.testid)).toEqual(["cx-export-xlsx", "cx-export-services"]);
  });

  it("tableau absent du chapitre : 404 ; chapitre non calculable : 422 avec la raison, jamais un fichier de zéros", async () => {
    expect((await call("chapitre=services&format=csv&tableau=absent")).status).toBe(404);
    mocks.services.mockResolvedValue({ nd: { reason: "aucun axe de service retenu" }, data: null });
    const res = await call("chapitre=services&format=xlsx");
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("n.d. — aucun axe de service retenu");
  });
});

// --- Chiffres clés : les cartes en vrais nombres ------------------------------------------------------------------------------------

const NNBSP = "\u202f"; // espace fine insécable (séparateur de milliers fr-FR)
const NBSP = "\u00a0";
const TILES: TileSpec[] = [
  {
    id: "masse",
    label: "Masse salariale chargée",
    sub: "janvier → mars 2026",
    value: { text: `1${NNBSP}234,56${NBSP}€`, kind: "value", reason: null },
    cost: true,
    note: "Coût par ETP-mois : 411,52 €",
    variations: [
      { label: "N-1", text: `1${NNBSP}000,00${NBSP}€`, tone: "flat" },
      { label: "Évolution", text: `+234,56${NBSP}€ (+23,46${NBSP}%)`, tone: "bad" },
    ],
  },
  { id: "etp", label: "ETP moyen", value: { text: "≥ 12,50", kind: "lower", reason: null }, variations: [{ label: "Écart", text: null, reason: "N-1 : quotité absente du référentiel", tone: "flat" }] },
  { id: "budget", label: "Écart au budget", value: { text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" }, variations: [{ label: "Écart (%)", text: `+12,00${NBSP}% · défavorable`, tone: "bad" }, { label: "Taux", text: "−0,25 pts", tone: "flat" }] },
  { id: "conges", label: "Congés pris", value: { text: "3,5 j sur 20 j théoriques", kind: "value", reason: null }, variations: [{ label: "Évolution", text: `+500,00${NBSP}€ (% n.d. : N-1 nul)`, tone: "bad" }, { label: "Sans raison", text: null, tone: "flat" }] },
];

describe("« Chiffres clés » : cartes du chapitre", () => {
  it("relit un nombre affiché, sans le convertir autrement : cas de référence écrits à la main", () => {
    expect(tileNumber(`1${NNBSP}234,56${NBSP}€`)).toEqual({ cell: 123456, kind: "eur", unit: "€", lower: false }); // 1 234,56 € = 123 456 centimes
    expect(tileNumber("−25,00 €")).toEqual({ cell: -2500, kind: "eur", unit: "€", lower: false });
    expect(tileNumber("+12,34 %")).toEqual({ cell: 1234, kind: "pourcent", unit: "%", lower: false }); // 12,34 % = 1 234 points de base
    expect(tileNumber("12,3 %")).toEqual({ cell: 1230, kind: "pourcent", unit: "%", lower: false });
    expect(tileNumber("−0,25 pts")).toEqual({ cell: { exact: -0.25 }, kind: "etp", unit: "points", lower: false });
    expect(tileNumber("≥ 12,50")).toEqual({ cell: { exact: 12.5 }, kind: "etp", unit: "", lower: true });
    expect(tileNumber(`1${NNBSP}234`)).toEqual({ cell: 1234, kind: "nombre", unit: "", lower: false });
    expect(tileNumber("+2 personnes")).toEqual({ cell: 2, kind: "nombre", unit: "personnes", lower: false });
    expect(tileNumber("+0,50 ETP")).toEqual({ cell: { exact: 0.5 }, kind: "etp", unit: "ETP", lower: false });
    expect(tileNumber("3,5 j")).toEqual({ cell: { exact: 3.5 }, kind: "etp", unit: "jours", lower: false });
    expect(Object.is(tileNumber("−0,00 %")!.cell, 0)).toBe(true); // jamais −0
    for (const t of ["3,5 j sur 20 j théoriques", "janv. 2026", "", "n.d.", "12,345 %", "1,234 €", "12 mois"]) expect(tileNumber(t), t).toBeNull();
  });

  it("une ligne par valeur et par variation ; « A (B) » donne deux lignes ; « · » va en observation ; n.d. avec sa raison, jamais 0", () => {
    const t = keyFiguresTable(TILES)!;
    expect(t.title).toBe(KEY_FIGURES_TITLE);
    expect(t.rows.map((r) => [r.cells, r.kind ?? null])).toEqual([
      [["Masse salariale chargée", "Valeur", 123456, "€", "", "janvier → mars 2026", "Coût par ETP-mois : 411,52 €"], "eur"],
      [["Masse salariale chargée", "N-1", 100000, "€", "", "", ""], "eur"],
      [["Masse salariale chargée", "Évolution", 23456, "€", "", "", ""], "eur"], // +234,56 €
      [["Masse salariale chargée", "Évolution (%)", 2346, "%", "", "", ""], "pourcent"], // +23,46 %
      [["ETP moyen", "Valeur", { exact: 12.5 }, "", LOWER_BOUND, "", ""], "etp"],
      [["ETP moyen", "Écart", { nd: "N-1 : quotité absente du référentiel" }, "", "", "", ""], null],
      [["Écart au budget", "Valeur", { nd: "aucun budget saisi pour 2026" }, "", "", "", ""], null],
      [["Écart au budget", "Écart (%)", 1200, "%", "", "", "défavorable"], "pourcent"],
      [["Écart au budget", "Taux", { exact: -0.25 }, "points", "", "", ""], "etp"],
      [["Congés pris", "Valeur", "3,5 j sur 20 j théoriques", "", "", "", ""], null], // deux nombres : texte repris tel quel
      [["Congés pris", "Évolution", 50000, "€", "", "", "% n.d. : N-1 nul"], "eur"],
      [["Congés pris", "Sans raison", { nd: ND_WITHOUT_REASON }, "", "", "", ""], null],
    ]);
    expect(keyFiguresTable([])).toBeNull();
  });

  it("dans le classeur : première feuille, vrais nombres (euros, pourcentages, décimaux), n.d. en commentaire et en observation", async () => {
    const model: ExportModel = { chapter: "synthese", tiles: TILES, tables: [], charts: [], limits: [], nd: null, terms: [] };
    const { spec } = chapterWorkbook({ title: "Masse salariale croisée — 01 Synthèse", workspaceName: "Espace fictif", generatedAt: "2026-10-26T09:30:00Z", model, sort: null, filters: [], sources: [] });
    const wb = await load(await buildWorkbook(spec));
    expect(wb.worksheets[0].name).toBe(KEY_FIGURES_TITLE);
    const rows = sheetRows(wb.worksheets[0], "Carte", 7);
    expect(rows.map((r) => r[2].value)).toEqual([1234.56, 1000, 234.56, 0.2346, 12.5, "n.d.", "n.d.", 0.12, -0.25, "3,5 j sur 20 j théoriques", 500, "n.d."]);
    expect([rows[0][2].numFmt, rows[3][2].numFmt, rows[4][2].numFmt]).toEqual(['#,##0.00 "€"', "0.00%", "#,##0.00"]);
    expect(noteOf(rows[5][2])).toBe("N-1 : quotité absente du référentiel");
    expect(rows[5][6].value).toBe("Valeur : N-1 : quotité absente du référentiel");
    expect(rows[0][6].value).toBe("Coût par ETP-mois : 411,52 €");
    expect(rows[4][4].value).toBe(LOWER_BOUND);
  });
});

describe("« Non disponibles » : raisons des cartes (tileNd), sans doublon", () => {
  it("libellés et raison séparés ; une raison déjà donnée par un bloc n'est pas répétée ; « Prévu » du chapitre repris", () => {
    const model: ExportModel = {
      ...MODEL,
      blocks: [{ id: "cartes", title: "Cartes de synthèse", tables: [], nd: [{ label: "ETP moyen N-1", reason: "quotité absente du référentiel" }] }, ...MODEL.blocks!],
      tileNd: ["ETP moyen N-1 : quotité absente du référentiel", "Absentéisme, Turnover : seuil de confidentialité non défini (Paramètres)", "raison sans libellé"],
      prevu: [{ label: "Commentaire du mois", reason: "prévu en version 1.1" }],
    };
    expect(unavailableRows(model)).toEqual([
      ["Cartes de synthèse", "ETP moyen N-1", "Non disponible (n.d.)", "quotité absente du référentiel"],
      ["Brut par libellé", "Brut par libellé", "Non disponible (n.d.)", "libellés de la période non lus"],
      ["Brut par libellé", "Calendrier des primes", "Prévu", "aucun réglage dans cette version"],
      ["Chapitre", "Commentaire du mois", "Prévu", "prévu en version 1.1"],
      ["Cartes", "Absentéisme, Turnover", "Non disponible (n.d.)", "seuil de confidentialité non défini (Paramètres)"],
      ["Cartes", "", "Non disponible (n.d.)", "raison sans libellé"],
      ["Tableau caché", "", "Non disponible (n.d.)", "réglage illisible"],
    ]);
  });
});

describe("feuille « Sources » : journal de paie non lu", () => {
  beforeEach(() => {
    mocks.lastSync.mockReset().mockImplementation(async (_ws: string, p: string) => (p === "payfit" ? { status: "applied", startedAt: new Date("2026-10-01T07:55:00Z"), finishedAt: new Date("2026-10-01T08:00:00Z") } : null));
    mocks.activeSync.mockReset().mockImplementation(async (_ws: string, p: string) => (p === "payfit" ? { decidedAt: new Date("2026-10-01T08:05:00Z") } : null));
  });

  it("source RH = DSN : ligne n.d. avec la raison de la page, dernière lecture PayFit mais aucune « lecture appliquée »", async () => {
    const pay = { input: null, unavailable: null, source: "dsn" as const };
    const ctx = { workspace: { id: "w1" }, load: { payroll: async () => pay } } as unknown as CroiseeContext;
    expect(await croiseeSources(ctx, ["rh", "journal"])).toEqual([
      { label: "Fichiers DSN", detail: "référentiel Collaborateurs : contrats et quotités déclarés · aucune lecture appliquée", syncedAt: null, status: "Jamais synchronisée" },
      { label: "PayFit", detail: `${JOURNAL_USAGE} — n.d. : ${journalReason(pay)}`, syncedAt: "2026-10-01T08:00:00.000Z", status: "Appliquée (active)" },
    ]);
    expect(journalReason(pay)).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
  });

  it("journal lu : une seule ligne PayFit (référentiel et journal), avec la lecture appliquée", async () => {
    const ctx = { workspace: { id: "w1" }, load: { payroll: async () => ({ input: {}, unavailable: null, source: "payfit" }) } } as unknown as CroiseeContext;
    expect(await croiseeSources(ctx, ["rh", "journal"])).toEqual([
      { label: "PayFit", detail: `référentiel Collaborateurs : contrats, quotités et absences ; ${JOURNAL_USAGE} · lecture appliquée le 01/10/2026 10:05`, syncedAt: "2026-10-01T08:00:00.000Z", status: "Appliquée (active)" },
    ]);
  });
});

describe("feuille « Filtres » : service retenu et tri par défaut", () => {
  it("hors chapitre 05, le service retenu restreint les chiffres : il est écrit avec son axe", () => {
    const f = croiseeFilters(filterCtx({ chapter: chapterDef("fixe-variable"), service: { axis: "Service", value: "Atelier", label: "Atelier", options: [], reason: null } }), { limits: [] }, ["journal"]);
    expect(f.find((x) => x.label === "Service")?.value).toBe("Atelier (axe analytique « Service »)");
    const g = croiseeFilters(filterCtx({ chapter: chapterDef("services"), service: { axis: "Service", value: null, label: "Non ventilé", options: [], reason: null } }), { limits: [] }, ["journal"]);
    expect(g.find((x) => x.label === "Service")?.value).toBe("Tous les services (le service « Non ventilé » retenu ne restreint pas ce chapitre)");
  });
  it("sans tri dans l'adresse : le tri par défaut du chapitre est écrit, marqué « par défaut »", () => {
    const model: ExportModel = { chapter: "services", tiles: [], tables: [SORTABLE], charts: [], limits: [], nd: null, terms: [] };
    const st = sortedTables(model, { tri: null, sens: null }, { table: "services", key: "n", dir: "desc" });
    expect(croiseeFilters(filterCtx(), model, ["journal"], st).find((x) => x.label === "Tri du tableau « Coût par service »")?.value).toBe("Coût 2026, ordre décroissant (par défaut)");
    expect(sortedTables(model, { tri: "services.service", sens: "asc" }, { table: "services", key: "n", dir: "desc" }).map((x) => [x.key, x.dir, x.byDefault ?? false])).toEqual([["service", "asc", false]]);
  });
});

describe("cellules : la raison n.d. vient de l'écran (cellView)", () => {
  it("valeur non finie, numérique dans une colonne de texte, hors limites, hors de l'unité de base : même raison que l'écran", () => {
    const eur = MONTANTS.columns[2];
    const pct = MONTANTS.columns[4];
    const txt = MONTANTS.columns[0];
    for (const [cell, col] of [[{ exact: Number.NaN }, eur], [{ exact: 1.5 }, txt], [{ exact: 1e300 }, pct], [1.5, eur], [2 ** 60, eur]] as const) {
      const why = cellView(cell, col).nd;
      expect(why).not.toBeNull();
      expect(exportCell(cell, col)).toEqual({ nd: why });
      expect(csvCell(cell, col)).toBe(`n.d. (${why})`);
    }
  });
});

// Garde : aucune cellule du fichier fictif n'est un zéro substitué à un n.d.
it("un n.d. du modèle reste n.d. dans l'Excel et le CSV", () => {
  const isNd = (c: CroiseeCell | undefined) => typeof c === "object" && c !== null && "nd" in c;
  for (const r of [...MONTANTS.rows, MONTANTS.foot!]) {
    MONTANTS.columns.forEach((c, i) => {
      if (!isNd(r.cells[i])) return;
      expect(exportCell(r.cells[i], c, r)).toEqual(r.cells[i]);
      expect(csvCell(r.cells[i], c, r).startsWith("n.d. (")).toBe(true);
    });
  }
});
