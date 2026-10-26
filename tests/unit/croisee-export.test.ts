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
  croiseeFilters,
  CSV_BOM,
  csvCell,
  exportCell,
  exportOptions,
  exportTermIds,
  ND_SHEET,
  screenRows,
  screenTables,
  SERVICES_EXPORT_LABEL,
  sheetName,
  sortedTables,
  tableCsv,
  tableSheet,
  type ExportModel,
  type FilterCtx,
} from "@/lib/croisee/export";
import { safeText } from "@/lib/export/safe-text";
import { buildWorkbook, EMPTY_CELL_NOTE } from "@/lib/export/xlsx";
import { glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { cellView, croiseeHref, parseQuery, type CroiseeCell, type CroiseeTable } from "@/lib/viz/croisee";
import { buildAbsences, loadAbsencesInput } from "@/lib/viz/croisee-absences";
import { buildBudget, buildEffets, loadBudgetInput, loadEffetsInput } from "@/lib/viz/croisee-budget";
import { buildEffectifs, loadEffectifsInput } from "@/lib/viz/croisee-effectifs";
import { buildFixeVariable, buildServices, loadFixeVariableInput, loadServicesInput, type ServicesInput, type WindowIn } from "@/lib/viz/croisee-masse";
import { buildPaieCompta, loadPaieComptaInput } from "@/lib/viz/croisee-paie";
import { buildSynthese, loadSyntheseInput } from "@/lib/viz/croisee-synthese";
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
vi.mock("@/lib/viz/croisee-masse", async (orig) => ({
  ...(await orig<typeof import("@/lib/viz/croisee-masse")>()),
  loadServicesInput: (...args: unknown[]) => mocks.services(...args),
}));
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

  it("une feuille par tableau de l'écran, puis « Non disponibles », « Filtres », « Sources » et « Définitions »", async () => {
    const wb = await load(await buildWorkbook(spec().spec));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Montants fictifs par équipe", "Montants par mois", ND_SHEET, "Filtres", "Sources", "Définitions"]);
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

describe("registre : la même paire load…Input / build… que l'écran", () => {
  it("chaque chapitre vivant a son entrée, avec les fonctions exportées par son fichier src/lib/viz/croisee-<chapitre>.ts", () => {
    const pairs = {
      synthese: [loadSyntheseInput, buildSynthese],
      effectifs: [loadEffectifsInput, buildEffectifs],
      absences: [loadAbsencesInput, buildAbsences],
      "fixe-variable": [loadFixeVariableInput, buildFixeVariable],
      services: [loadServicesInput, buildServices],
      budget: [loadBudgetInput, buildBudget],
      "paie-compta": [loadPaieComptaInput, buildPaieCompta],
      effets: [loadEffetsInput, buildEffets],
    } as const;
    expect(CHAPTERS.filter((c) => c.statut === "vivant").map((c) => c.id)).toEqual(Object.keys(pairs));
    for (const [id, [l, b]] of Object.entries(pairs)) {
      const e = CROISEE_EXPORTS[id as keyof typeof pairs]!;
      expect(e.load, id).toBe(l);
      expect(e.build, id).toBe(b);
    }
    expect(CROISEE_EXPORTS.services!.sorted).toBe(true);
    expect(CROISEE_EXPORTS["fixe-variable"]!.sorted).toBe(false);
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
const menuCtx = (axis: string | null) => ({ base: BASE, state: { chapitre: "fixe-variable", annee: "2026", de: "01", a: "03", affichage: "tableau", tri: null, sens: null }, service: { axis } }) as unknown as Parameters<typeof exportOptions>[0];

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
    expect(exportOptions(menuCtx("Service"), { ...MODEL, nd: { reason: "journal de paie indisponible" } })).toEqual([]);
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
const SERVICES_CSV = [
  '"Service";"Coût 2026";"Coût 2025 (N-1)";"Écart";"Écart (%)";"Part du coût";"Hors primes";"Primes";"Cotisations";"Coût / personne-mois"',
  '"Atelier";"3000,00";"2500,00";"500,00";"20,00";"75,00";"1800,00";"200,00";"1000,00";"1500,00"',
  `"'=Bureau";"1000,00";"1500,00";"-500,00";"-33,33";"25,00";"700,00";"0,00";"300,00";"1000,00"`,
  '"Total";"4000,00";"4000,00";"0,00";"0,00";"";"2500,00";"200,00";"1300,00";"1333,33"',
];

function routeCtx(sp: Record<string, string>): CroiseeContext {
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
    service: { axis: "Service", value: undefined, label: "Tous les services", options: [], reason: null },
    budget: { selected: null, explicit: false, options: [], reason: "aucun budget saisi pour 2026" },
    scenario: { selected: null, explicit: false, options: [], reason: "aucun scénario ne couvre 2026" },
    affichage: q.affichage,
    state,
    href: (patch = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: { payroll: async () => ({ source: "payfit" }), compta: async () => ({ source: null, reason: "aucune source comptable retenue" }) },
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
    expect(csvLines(bytes.toString("utf8"))).toEqual(SERVICES_CSV);
    // Même tableau que l'écran : le modèle construit par buildServices sur la même entrée.
    const screen = buildServices(SERVICES).tables[0];
    expect(csvLines(tableCsv(screen))).toEqual(SERVICES_CSV);
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
      ["Limite de la lecture", "Coût / personne-mois : contrats rémunérés chaque mois ; ce n'est pas un coût par ETP."],
    ]);
    const sources = sheetRows(wb.getWorksheet("Sources")!, "Source", 4).map((r) => [r[0].value, r[1].value, r[2].value, r[3].value]);
    expect(sources).toEqual([["PayFit", "journal comptable de paie (masse, brut, cotisations, services) · aucune lecture appliquée", "n.d.", "Jamais synchronisée"]]);
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
