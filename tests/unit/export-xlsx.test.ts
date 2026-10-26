import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportButtons } from "@/components/ExportButtons";
import { budgetVersion, val } from "@/lib/budget/versions";
import { HORS_SALARIE } from "@/lib/budget/zoom";
import { contentDisposition, safeFileName, XLSX_MIME, xlsxResponse } from "@/lib/export/response";
import { safeText } from "@/lib/export/safe-text";
import { loadSourceInputs, sourceRows } from "@/lib/export/sources";
import { buildWorkbook, definitionsFor, EMPTY_CELL_NOTE, exactRatio, formatParis, NUM_FMT, percentCell, rationalCell, roundedRatio, type WorkbookSpec } from "@/lib/export/xlsx";
import { glossaryEntry } from "@/lib/glossary";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";

// Données entièrement fictives. Les cas de référence sont calculés à la main (voir les commentaires).

// --- Doubles : accès à l'espace, versions chargées, lectures de sources, détail par salarié ---------------------------------------
const mocks = vi.hoisted(() => ({
  role: { value: "editor" as "reader" | "editor" | "admin" },
  loaded: { value: null as unknown },
  zoomOf: vi.fn(),
  people: { value: new Map() as Map<string, unknown> },
  lastSync: vi.fn(),
  activeSync: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace fictif", slug, role: mocks.role.value } }),
}));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/ecart-data", () => ({ loadVersions: async () => mocks.loaded.value }));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/people-index", () => ({ peopleIndex: () => mocks.people.value }));
vi.mock("@/lib/budget/zoom", async (orig) => ({ ...(await orig<typeof import("@/lib/budget/zoom")>()), zoomOf: (...args: unknown[]) => mocks.zoomOf(...args) }));
// Le vrai « sync » n'est jamais chargé (il tirerait la base, donc DATABASE_URL) : le fichier se lance sans variable d'environnement.
// Les libellés de statut ci-dessous sont des valeurs de test.
vi.mock("@/lib/connectors/sync", () => ({
  lastSync: (...args: unknown[]) => mocks.lastSync(...args),
  activeSync: (...args: unknown[]) => mocks.activeSync(...args),
  SYNC_STATUS_LABELS: { preview: "Aperçu à valider", applied: "Appliquée (active)" },
}));

const load = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
};
// Commentaire de cellule lu en texte simple.
const noteOf = (c: ExcelJS.Cell): string | null => (c.note ? (typeof c.note === "string" ? c.note : c.note.texts?.map((t) => t.text).join("") ?? "") : null);
const iso = (c: ExcelJS.Cell) => (c.value as Date).toISOString();
// Affichage d'un nombre au format à deux décimales (« #,##0.00 » ou « 0.00% ») : arrondi unique, au plus proche, demi en s'éloignant de zéro.
const twoDecimals = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shownEtp = (v: unknown) => twoDecimals.format(v as number).replace("-", "−"); // l'écran écrit le vrai signe moins (U+2212)
const shownPct = (v: unknown) => `${twoDecimals.format((v as number) * 100).replace("-", "−")} %`;
// Pourcentage tel que l'écran l'écrit (espace insécable avant « % » ramenée à une espace simple).
const screenPct = (num: number, den: number) => fmtPercent({ num, den }).replace(/\u00a0/g, " ");
// Corps CSV lu en octets : Response.text() retire le BOM, que l'export doit conserver.
const csvOf = async (res: Response) => {
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), lines: bytes.subarray(3).toString("utf8").trimEnd().split("\n") };
};

const BASE: WorkbookSpec = {
  title: "Export fictif",
  workspaceName: "Espace fictif",
  generatedAt: "2026-01-15T09:12:00.000Z", // 10 h 12 à Paris (hiver : UTC+1)
  filters: [
    { label: "Période", value: "de janvier à mars" },
    { label: "Service", value: "tous les services" },
  ],
  sheets: [],
  sources: [],
  definitions: [],
};

describe("roundedRatio, rationalCell, percentCell : conversions exactes vers l'unité de base", () => {
  it("arrondit au plus proche, demi vers l'extérieur de zéro (cas écrits à la main)", () => {
    expect(roundedRatio(1, 2)).toBe(1); // 0,5 → 1
    expect(roundedRatio(-1, 2)).toBe(-1); // −0,5 → −1
    expect(roundedRatio(1, 3)).toBe(0); // 0,33 → 0
    expect(roundedRatio(2, 3)).toBe(1); // 0,67 → 1
    expect(roundedRatio(5, -10)).toBe(-1); // dénominateur négatif : −0,5 → −1
    expect(Object.is(roundedRatio(0, 7), 0)).toBe(true); // jamais −0
    expect(roundedRatio(1, 8, 10_000)).toBe(1250); // 1/8 = 12,5 % = 1 250 points de base
  });
  it("refuse un nombre non entier ou un dénominateur nul", () => {
    expect(() => roundedRatio(1.5, 2)).toThrow(RangeError);
    expect(() => roundedRatio(1, 0)).toThrow(RangeError);
  });
  it("exactRatio : num ÷ den en nombre double, sans arrondi ; jamais −0 ; refuse un dénominateur nul ou un nombre non entier", () => {
    expect(exactRatio(1, 8)).toBe(0.125);
    expect(exactRatio(-1, 8)).toBe(-0.125);
    expect(exactRatio(3, -4)).toBe(-0.75);
    expect(Object.is(exactRatio(0, 7), 0)).toBe(true);
    expect(Object.is(exactRatio(0, -7), 0)).toBe(true);
    expect(() => exactRatio(1, 0)).toThrow(RangeError);
    expect(() => exactRatio(1.5, 2)).toThrow(RangeError);
    expect(() => exactRatio(Number.MAX_SAFE_INTEGER + 2, 1)).toThrow(RangeError);
  });
  it("ETP : la cellule reçoit la fraction exacte somme ÷ (mois × 10 000), sans arrondi au dix-millième", () => {
    // 3 mois, somme 36 000 → 1,2 ETP exactement.
    expect(rationalCell({ kind: "value", num: 36_000, den: 30_000 }, "etp")).toEqual({ exact: 1.2 });
    // somme 10 001 sur 3 mois = 0,3333666… ETP (jamais 0,3334) ; en négatif, le même au signe près.
    const third = (rationalCell({ kind: "value", num: 10_001, den: 30_000 }, "etp") as { exact: number }).exact;
    expect(third).toBeGreaterThan(0.3333666);
    expect(third).toBeLessThan(0.3333667);
    expect(rationalCell({ kind: "value", num: -10_001, den: 30_000 }, "etp")).toEqual({ exact: -third });
    expect(rationalCell({ kind: "value", num: 0, den: 30_000 }, "etp")).toEqual({ exact: 0 }); // un vrai zéro ETP reste un zéro
  });
  it("cas de référence : 3 749 ÷ 30 000 = 0,12496666… ETP s'affiche 0,12, comme à l'écran (jamais 0,13)", () => {
    // 3 749 ÷ 30 000 = 0,1249666… : le dix-millième arrondi serait 0,1250, qu'un second arrondi au centième porterait à 0,13.
    const cell = rationalCell({ kind: "value", num: 3_749, den: 30_000 }, "etp") as { exact: number };
    expect(cell.exact).toBeGreaterThan(0.1249666);
    expect(cell.exact).toBeLessThan(0.1249667);
    expect(cell.exact).not.toBe(0.125);
    expect(shownEtp(cell.exact)).toBe("0,12");
    expect(shownEtp(cell.exact)).toBe(fmtFixed({ num: 3_749, den: 30_000 }, 2)); // l'écran
  });
  it("demi exact : 1 250 ÷ 10 000 = 0,125 ETP s'affiche 0,13 à l'écran et dans la cellule (demi en s'éloignant de zéro) ; −0,125 → −0,13", () => {
    const half = rationalCell({ kind: "value", num: 1_250, den: 10_000 }, "etp") as { exact: number };
    expect(half.exact).toBe(0.125); // représentable exactement en binaire : la cellule contient bien le demi
    expect(shownEtp(half.exact)).toBe("0,13");
    expect(shownEtp(half.exact)).toBe(fmtFixed({ num: 1_250, den: 10_000 }, 2));
    const negative = rationalCell({ kind: "value", num: -1_250, den: 10_000 }, "etp") as { exact: number };
    expect(negative.exact).toBe(-0.125);
    expect(shownEtp(negative.exact)).toBe("−0,13");
    expect(shownEtp(negative.exact)).toBe(fmtFixed({ num: -1_250, den: 10_000 }, 2));
  });
  it("montants et nombres : l'entier tel quel ; n.d. reste n.d. avec sa raison ; sans objet : cellule vide", () => {
    expect(rationalCell({ kind: "value", num: 123_456, den: 1 }, "eur")).toBe(123_456);
    expect(rationalCell({ kind: "value", num: 7, den: 1 }, "nombre")).toBe(7);
    expect(rationalCell({ kind: "nd", reason: "mois non lu" }, "eur")).toEqual({ nd: "mois non lu" });
    expect(rationalCell({ kind: "na" }, "eur")).toBe("");
  });
  it("pourcentage : fraction exacte num ÷ den, arrondie une seule fois à l'affichage ; départ nul et écart n.d. restent n.d.", () => {
    // 1 000 000 ÷ 3 000 000 = 33,333…  % : la cellule contient 0,3333… (pas 0,3333 arrondi) et s'affiche 33,33 %.
    const third = (percentCell({ kind: "value", pct: { num: 1_000_000, den: 3_000_000 } }) as { exact: number }).exact;
    expect(third).toBeGreaterThan(0.33333333);
    expect(third).toBeLessThan(0.33333334);
    expect(shownPct(third)).toBe("33,33 %");
    expect(shownPct(third)).toBe(screenPct(1_000_000, 3_000_000));
    // −1 ÷ 8 = −12,5 % exactement.
    expect(percentCell({ kind: "value", pct: { num: -1, den: 8 } })).toEqual({ exact: -0.125 });
    expect(shownPct(-0.125)).toBe("−12,50 %");
    // 1 ÷ 3 749 = 0,0266… % : s'affiche 0,03 % (une seule fois arrondi).
    const small = (percentCell({ kind: "value", pct: { num: 1, den: 3_749 } }) as { exact: number }).exact;
    expect(shownPct(small)).toBe("0,03 %");
    expect(shownPct(small)).toBe(screenPct(1, 3_749));
    expect(percentCell({ kind: "value", pct: null })).toEqual({ nd: "valeur de départ nulle" });
    expect(percentCell({ kind: "nd", reason: "raison X" })).toEqual({ nd: "raison X" });
    expect(percentCell({ kind: "na" })).toBe("");
  });
});

describe("safeText : texte jamais pris pour une formule", () => {
  it("préfixe d'une apostrophe un texte qui commence par =, +, @, tabulation, retour chariot ou - (cas écrits à la main)", () => {
    expect(safeText("=SOMME(A1:A9)")).toBe("'=SOMME(A1:A9)");
    expect(safeText("+1+1")).toBe("'+1+1");
    expect(safeText("@cmd")).toBe("'@cmd");
    expect(safeText("\tcellule")).toBe("'\tcellule");
    expect(safeText("\rcellule")).toBe("'\rcellule");
    expect(safeText("-cmd")).toBe("'-cmd");
    expect(safeText("- note")).toBe("'- note");
    expect(safeText("-")).toBe("'-");
    expect(safeText("-12,5 €")).toBe("'-12,5 €"); // un nombre suivi d'une unité n'est plus un nombre pur
    expect(safeText("-1+2")).toBe("'-1+2");
  });
  it("laisse tel quel un texte ordinaire et un nombre pur (entier ou décimal à virgule ou à point, signé)", () => {
    for (const ok of ["", "Alpha", "a=b", "x-y", "M-001", "123", "-5", "-5,25", "-5.25", "+7", "+0,5", "0,5", "1e5", "'déjà préfixé", "—", "−12,50"]) expect(safeText(ok), ok).toBe(ok);
    for (const notPure of ["-5,", "-,5", "-5,2,1", "-5.2.1", "- 5", "-5 "]) expect(safeText(notPure), notPure).toBe(`'${notPure}`);
  });
  it("est idempotent sur un texte déjà sûr", () => {
    expect(safeText(safeText("=1+1"))).toBe("'=1+1");
  });
});

describe("buildWorkbook : classeur relu avec exceljs", () => {
  const spec: WorkbookSpec = {
    ...BASE,
    sheets: [
      {
        name: "Écart",
        columns: [
          { header: "Rubrique", key: "rubrique", kind: "text" },
          { header: "Montant", key: "montant", kind: "eur" },
          { header: "ETP", key: "etp", kind: "etp" },
          { header: "Taux", key: "taux", kind: "pourcent" },
          { header: "Effectif", key: "effectif", kind: "nombre" },
          { header: "Entrée", key: "entree", kind: "date" },
          { header: "Observations", key: "observations", kind: "text" },
        ],
        rows: [
          ["Alpha", 123_456, 12_345, 534, 42, "2026-03-31", ""],
          ["Bêta", { nd: "journal non clôturé" }, 0, -250, 0, "", "à vérifier"],
          ["Gamma", -5, 3_333, 0, 7, { nd: "date inconnue" }, ""],
        ],
      },
    ],
    sources: [
      { label: "PayFit", detail: "journal de paie", syncedAt: "2026-01-15T09:12:00.000Z", status: "Appliquée (active)" },
      { label: "Pennylane", detail: "comptabilité", syncedAt: null, status: "Jamais synchronisée" },
    ],
    definitions: [
      { term: "ETP", definition: "Équivalent temps plein.", formula: "somme des quotités" },
      { term: "Écart", definition: "Version suivante moins version précédente." },
    ],
  };

  it("montant : 123 456 centimes valent 1234,56, en vrai nombre, avec le format « #,##0.00 » et le suffixe €", async () => {
    const ws = (await load(await buildWorkbook(spec))).getWorksheet("Écart")!;
    // Lignes de tête : titre, espace et date, filtres, note → l'en-tête est en ligne 5, les données dès la ligne 6.
    expect(ws.getCell("A1").value).toBe("Export fictif");
    expect(ws.getCell("A2").value).toBe("Espace fictif · exporté le 15/01/2026 10:12");
    expect(ws.getCell("A3").value).toBe("Période : de janvier à mars · Service : tous les services");
    expect(ws.getCell("A4").value).toBe("Cellule vide : sans objet.");
    expect(ws.getCell("B5").value).toBe("Montant");
    const montant = ws.getCell("B6");
    expect(montant.value).toBe(1234.56);
    expect(typeof montant.value).toBe("number");
    expect(montant.numFmt).toBe('#,##0.00 "€"');
    expect(montant.numFmt).toBe(NUM_FMT.eur);
    expect(ws.getCell("B8").value).toBe(-0.05); // −5 centimes
    // ETP : 12 345 dix-millièmes = 1,2345 stocké, affiché au centième ; pourcentage : 534 points de base = 5,34 %.
    expect(ws.getCell("C6").value).toBe(1.2345);
    expect(ws.getCell("C6").numFmt).toBe("#,##0.00");
    expect(ws.getCell("D6").value).toBe(0.0534);
    expect(ws.getCell("D6").numFmt).toBe("0.00%");
    expect(ws.getCell("D7").value).toBe(-0.025);
    expect(ws.getCell("E6").value).toBe(42);
    expect(ws.getCell("E6").numFmt).toBe("#,##0");
    expect(iso(ws.getCell("F6"))).toBe("2026-03-31T00:00:00.000Z");
    expect(ws.getCell("F6").numFmt).toBe("dd/mm/yyyy");
  });

  it("n.d. : le texte « n.d. », sa raison en commentaire et dans « Observations » ; jamais 0 ; un vrai zéro reste 0", async () => {
    const ws = (await load(await buildWorkbook(spec))).getWorksheet("Écart")!;
    const nd = ws.getCell("B7");
    expect(nd.value).toBe("n.d.");
    expect(nd.value).not.toBe(0);
    expect(noteOf(nd)).toBe("journal non clôturé");
    expect(ws.getCell("C7").value).toBe(0); // zéro ETP connu : une valeur, pas un n.d.
    expect(noteOf(ws.getCell("C7"))).toBeNull();
    expect(ws.getCell("G7").value).toBe("à vérifier ; Montant : journal non clôturé");
    expect(ws.getCell("F8").value).toBe("n.d."); // date n.d.
    expect(noteOf(ws.getCell("F8"))).toBe("date inconnue");
    expect(ws.getCell("G8").value).toBe("Entrée : date inconnue");
    expect(ws.getCell("G6").value ?? null).toBeNull(); // ligne sans n.d. : pas d'observation
    expect(ws.getCell("F7").value ?? null).toBeNull(); // cellule vide : sans objet, jamais un zéro
  });

  it("filtre automatique sur l'en-tête et les données, en-tête figée, première colonne figée sur un tableau large", async () => {
    const ws = (await load(await buildWorkbook(spec))).getWorksheet("Écart")!;
    expect(ws.autoFilter).toBe("A5:G8"); // 7 colonnes, en-tête en ligne 5, dernière donnée en ligne 8
    const view = ws.views[0] as { state: string; xSplit: number; ySplit: number; topLeftCell: string };
    expect(view.state).toBe("frozen");
    expect(view.ySplit).toBe(5);
    expect(view.xSplit).toBe(1);
    expect(view.topLeftCell).toBe("B6");
    expect(ws.getColumn(1).width).toBeGreaterThan(10);
    expect(ws.getColumn(2).width).toBe(18);
  });

  it("tableau étroit : en-tête figée, première colonne libre", async () => {
    const narrow: WorkbookSpec = { ...BASE, filters: [], sheets: [{ name: "Court", columns: [{ header: "A", key: "a", kind: "text" }, { header: "B", key: "b", kind: "eur" }], rows: [["x", 100]], note: "Une note." }] };
    const ws = (await load(await buildWorkbook(narrow))).getWorksheet("Court")!;
    // titre, espace, note → l'en-tête est en ligne 4 (pas de ligne de filtres) ; la phrase sur les cellules vides suit la note de l'appelant
    expect(ws.getCell("A3").value).toBe("Une note. Cellule vide : sans objet.");
    const view = ws.views[0] as { xSplit: number; ySplit: number };
    expect(view.ySplit).toBe(4);
    expect(view.xSplit).toBe(0);
    expect(ws.autoFilter).toBe("A4:B5");
  });

  it("feuilles Filtres, Sources et Définitions : lignes passées, n.d. et raison si jamais synchronisée", async () => {
    const wb = await load(await buildWorkbook(spec));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Écart", "Filtres", "Sources", "Définitions"]);

    // Feuilles fixes : titre, espace et date, note → l'en-tête est en ligne 4, les données dès la ligne 5.
    const filtres = wb.getWorksheet("Filtres")!;
    expect([filtres.getCell("A4").value, filtres.getCell("B4").value]).toEqual(["Paramètre", "Valeur"]);
    expect([filtres.getCell("A5").value, filtres.getCell("B5").value]).toEqual(["Période", "de janvier à mars"]);
    expect([filtres.getCell("A6").value, filtres.getCell("B6").value]).toEqual(["Service", "tous les services"]);

    const sources = wb.getWorksheet("Sources")!;
    expect(sources.getCell("A4").value).toBe("Source");
    expect(sources.getCell("A5").value).toBe("PayFit");
    expect(sources.getCell("B5").value).toBe("journal de paie");
    expect(iso(sources.getCell("C5"))).toBe("2026-01-15T10:12:00.000Z"); // heure de Paris lue telle quelle
    expect(sources.getCell("C5").numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(sources.getCell("D5").value).toBe("Appliquée (active)");
    expect(sources.getCell("A6").value).toBe("Pennylane");
    expect(sources.getCell("C6").value).toBe("n.d.");
    expect(noteOf(sources.getCell("C6"))).toBe("aucune synchronisation enregistrée");
    expect(sources.getCell("E6").value).toBe("Dernière synchronisation : aucune synchronisation enregistrée");
    expect(sources.getCell("D6").value).toBe("Jamais synchronisée");

    const defs = wb.getWorksheet("Définitions")!;
    expect([defs.getCell("A4").value, defs.getCell("B4").value, defs.getCell("C4").value]).toEqual(["Terme", "Définition", "Formule"]);
    expect([defs.getCell("A5").value, defs.getCell("B5").value, defs.getCell("C5").value]).toEqual(["ETP", "Équivalent temps plein.", "somme des quotités"]);
    expect(defs.getCell("A6").value).toBe("Écart");
    expect(defs.getCell("C6").value ?? null).toBeNull(); // pas de formule : cellule vide
  });

  it("la note de chaque feuille dit « Cellule vide : sans objet »", async () => {
    expect(EMPTY_CELL_NOTE).toBe("Cellule vide : sans objet.");
    const wb = await load(await buildWorkbook(spec));
    // Feuille de données : la note est la dernière ligne de tête (après titre, espace et filtres) ; feuilles fixes : après titre et espace.
    expect(wb.getWorksheet("Écart")!.getCell("A4").value).toBe(EMPTY_CELL_NOTE);
    for (const name of ["Filtres", "Sources", "Définitions"]) expect(wb.getWorksheet(name)!.getCell("A3").value).toBe(EMPTY_CELL_NOTE);
    // Sans filtre : « Aucun filtre appliqué. » précède la phrase ; la note d'une feuille de données est suivie de la même phrase.
    const bare = await load(await buildWorkbook({ ...BASE, filters: [], sheets: [{ name: "Court", columns: [{ header: "A", key: "a", kind: "text" }], rows: [["x"]], note: "Une note." }] }));
    expect(bare.getWorksheet("Filtres")!.getCell("A3").value).toBe(`Aucun filtre appliqué. ${EMPTY_CELL_NOTE}`);
    expect(bare.getWorksheet("Court")!.getCell("A3").value).toBe(`Une note. ${EMPTY_CELL_NOTE}`);
  });

  it("sans filtre : l'onglet Filtres le dit ; propriétés du classeur : créateur Clair, titre, date fournie", async () => {
    const wb = await load(await buildWorkbook({ ...BASE, filters: [] }));
    expect(wb.getWorksheet("Filtres")!.getCell("A3").value).toBe(`Aucun filtre appliqué. ${EMPTY_CELL_NOTE}`);
    expect(wb.creator).toBe("Clair");
    expect(wb.title).toBe("Export fictif");
    expect(wb.created.toISOString()).toBe("2026-01-15T09:12:00.000Z");
  });

  it("aucune formule : toutes les cellules sont des valeurs", async () => {
    const wb = await load(await buildWorkbook(spec));
    let cells = 0;
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
      cells++;
      expect(c.type).not.toBe(ExcelJS.ValueType.Formula);
      expect(c.formula).toBeUndefined();
    }));
    expect(cells).toBeGreaterThan(40);
  });

  it("unités mélangées : le format suit la ligne (rowKinds), pas la colonne ; le pourcentage garde le sien", async () => {
    const mixed: WorkbookSpec = {
      ...BASE,
      sheets: [
        {
          name: "Mixte",
          columns: [{ header: "Rubrique", key: "r", kind: "text" }, { header: "Valeur", key: "v", kind: "eur" }, { header: "Écart %", key: "p", kind: "pourcent" }],
          rowKinds: ["eur", "etp", "nombre"],
          rows: [["Masse", 1_000_000, 250], ["ETP", 12_345, 250], ["Effectif", 12, 250]],
        },
      ],
    };
    const ws = (await load(await buildWorkbook(mixed))).getWorksheet("Mixte")!;
    expect([ws.getCell("B6").value, ws.getCell("B6").numFmt]).toEqual([10_000, '#,##0.00 "€"']);
    expect([ws.getCell("B7").value, ws.getCell("B7").numFmt]).toEqual([1.2345, "#,##0.00"]);
    expect([ws.getCell("B8").value, ws.getCell("B8").numFmt]).toEqual([12, "#,##0"]);
    for (const r of [6, 7, 8]) expect([ws.getCell(`C${r}`).value, ws.getCell(`C${r}`).numFmt]).toEqual([0.025, "0.00%"]);
  });

  it("valeur exacte : écrite telle quelle (aucun arrondi de Clair), le format à deux décimales arrondit une seule fois ; refusée hors colonne numérique", async () => {
    // ETP 3 749 ÷ 30 000 = 0,1249666… (écran : 0,12) et 1 250 ÷ 10 000 = 0,125 (demi exact, écran : 0,13) ; taux 1 ÷ 3 = 33,33 %.
    const third = 1 / 3;
    const exact = (exactValue: number) => ({ exact: exactValue });
    const wb = await load(
      await buildWorkbook({
        ...BASE,
        sheets: [
          {
            name: "Exact",
            columns: [{ header: "Rubrique", key: "r", kind: "text" }, { header: "ETP", key: "e", kind: "etp" }, { header: "Taux", key: "t", kind: "pourcent" }, { header: "Montant", key: "m", kind: "eur" }],
            rows: [["Quotient", exact(3_749 / 30_000), exact(third), 12_345], ["Demi", exact(0.125), exact(-0.125), 0], ["Zéro", exact(0), exact(-0), -5]],
          },
        ],
      }),
    );
    const ws = wb.getWorksheet("Exact")!;
    const etp = ws.getCell("B6").value as number;
    expect(etp).toBeGreaterThan(0.1249666); // valeur exacte, pas 0,1250
    expect(etp).toBeLessThan(0.1249667);
    expect(ws.getCell("B6").numFmt).toBe("#,##0.00");
    expect(shownEtp(etp)).toBe("0,12");
    expect(ws.getCell("B7").value).toBe(0.125);
    expect(shownEtp(ws.getCell("B7").value)).toBe("0,13");
    expect(ws.getCell("C6").value).toBe(third);
    expect(ws.getCell("C6").numFmt).toBe("0.00%");
    expect(shownPct(ws.getCell("C6").value)).toBe("33,33 %");
    expect(ws.getCell("C7").value).toBe(-0.125);
    expect(ws.getCell("B8").value).toBe(0); // zéro exact : un vrai zéro
    expect(Object.is(ws.getCell("C8").value, 0)).toBe(true); // jamais −0
    expect(ws.getCell("D6").value).toBe(123.45); // un entier de centimes garde sa conversion exacte
    expect(typeof ws.getCell("B6").value).toBe("number");
    const exactIn = (kind: "text" | "date", v: number) => buildWorkbook({ ...BASE, sheets: [{ name: "T", columns: [{ header: "A", key: "a", kind }], rows: [[{ exact: v }]] }] });
    await expect(exactIn("text", 0.5)).rejects.toThrow(/colonne texte ou date/);
    await expect(exactIn("date", 0.5)).rejects.toThrow(/colonne texte ou date/);
    const eurIn = (v: number) => buildWorkbook({ ...BASE, sheets: [{ name: "T", columns: [{ header: "A", key: "a", kind: "eur" }], rows: [[{ exact: v }]] }] });
    await expect(eurIn(Number.NaN)).rejects.toThrow(/nombre fini/);
    await expect(eurIn(Number.POSITIVE_INFINITY)).rejects.toThrow(/nombre fini/);
  });

  it("texte : jamais pris pour une formule (apostrophe) ; un nombre, négatif compris, reste un nombre", async () => {
    const wb = await load(
      await buildWorkbook({
        ...BASE,
        workspaceName: "=Espace fictif",
        sheets: [
          {
            name: "Sûr",
            columns: [{ header: "Libellé", key: "l", kind: "text" }, { header: "=Version A", key: "v", kind: "eur" }, { header: "Écart", key: "e", kind: "eur" }, { header: "Pourcentage", key: "p", kind: "pourcent" }, { header: "Texte", key: "t", kind: "text" }],
            rows: [
              ["=SOMME(A1:A9)", 100, -250_000, { exact: -0.125 }, "-12,5"],
              ["+1+1", 0, -5, -1_250, "@cmd"],
              ["Normal", 0, 0, 0, "-abc"],
            ],
          },
        ],
        sources: [{ label: "=PayFit", detail: "-détail", syncedAt: null, status: "@statut" }],
        definitions: [{ term: "+terme", definition: "\tune définition", formula: "=formule" }],
      }),
    );
    const ws = wb.getWorksheet("Sûr")!;
    expect(ws.getCell("A2").value).toBe("'=Espace fictif · exporté le 15/01/2026 10:12"); // nom d'espace saisi par un utilisateur
    expect(ws.getCell("B5").value).toBe("'=Version A"); // en-tête texte
    expect(ws.getCell("A6").value).toBe("'=SOMME(A1:A9)");
    expect(ws.getCell("A7").value).toBe("'+1+1");
    expect(ws.getCell("A8").value).toBe("Normal"); // texte ordinaire : inchangé
    expect(ws.getCell("E6").value).toBe("-12,5"); // nombre pur en texte : inchangé
    expect(ws.getCell("E7").value).toBe("'@cmd");
    expect(ws.getCell("E8").value).toBe("'-abc");
    // Cellules numériques : jamais d'apostrophe ; un écart négatif reste un vrai nombre négatif.
    expect(ws.getCell("B6").value).toBe(1); // 100 centimes = 1 €
    expect(ws.getCell("C6").value).toBe(-2500); // −250 000 centimes
    expect(ws.getCell("C6").type).toBe(ExcelJS.ValueType.Number);
    expect(ws.getCell("C7").value).toBe(-0.05); // −5 centimes
    expect(ws.getCell("D6").value).toBe(-0.125); // valeur exacte négative
    expect(ws.getCell("D6").type).toBe(ExcelJS.ValueType.Number);
    expect(ws.getCell("D7").value).toBe(-0.125); // −1 250 points de base
    expect(ws.getCell("E6").type).toBe(ExcelJS.ValueType.String); // le texte « -12,5 » reste du texte, sans apostrophe
    // Feuilles fixes : libellés de sources et de définitions.
    const src = wb.getWorksheet("Sources")!;
    expect([src.getCell("A5").value, src.getCell("B5").value, src.getCell("D5").value]).toEqual(["'=PayFit", "'-détail", "'@statut"]);
    const defs = wb.getWorksheet("Définitions")!;
    expect([defs.getCell("A5").value, defs.getCell("B5").value, defs.getCell("C5").value]).toEqual(["'+terme", "'\tune définition", "'=formule"]);
  });

  it("noms de feuilles : assainis (≤ 31 caractères, sans caractère interdit) et dédupliqués sans tenir compte de la casse", async () => {
    const sheet = (name: string) => ({ name, columns: [{ header: "A", key: "a", kind: "text" as const }], rows: [["x"]] });
    const names = ["Écart", "Écart", "écart", "Filtres", "Marge/brute: [2026]*?", "'Apostrophe'", "A".repeat(40), "A".repeat(40), "", "History"];
    const wb = await load(await buildWorkbook({ ...BASE, sheets: names.map(sheet) }));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Écart",
      "Écart (2)", // deux feuilles de même nom
      "écart (3)", // la casse ne distingue pas deux noms
      "Filtres (2)", // le nom de la feuille fixe est réservé
      "Marge brute 2026",
      "Apostrophe",
      "A".repeat(31),
      "A".repeat(27) + " (2)", // tronqué pour que le suffixe tienne dans les 31 caractères
      "Feuille",
      "History (2)", // nom réservé par Excel
      "Filtres",
      "Sources",
      "Définitions",
    ]);
    for (const w of wb.worksheets) expect(w.name.length).toBeLessThanOrEqual(31);
  });

  it("refuse une ligne trop longue, une valeur non entière et une date de génération invalide (sans citer la valeur)", async () => {
    const col = [{ header: "A", key: "a", kind: "eur" as const }];
    await expect(buildWorkbook({ ...BASE, sheets: [{ name: "T", columns: col, rows: [[1, 2]] }] })).rejects.toThrow(/plus de cellules que de colonnes/);
    await expect(buildWorkbook({ ...BASE, sheets: [{ name: "T", columns: col, rows: [[12.5]] }] })).rejects.toThrow(/entier d'unité de base/);
    await expect(buildWorkbook({ ...BASE, generatedAt: "demain" })).rejects.toThrow(/generatedAt/);
  });

  it("formatParis : heure de Paris, été comme hiver ; une chaîne inconnue est rendue telle quelle", () => {
    expect(formatParis("2026-01-15T09:12:00.000Z")).toBe("15/01/2026 10:12"); // UTC+1
    expect(formatParis("2026-07-15T09:12:00.000Z")).toBe("15/07/2026 11:12"); // UTC+2
    expect(formatParis("hier")).toBe("hier");
  });
});

describe("definitionsFor : définitions du glossaire pour l'onglet Définitions", () => {
  it("lit l'index, ignore les doublons et signale les identifiants inconnus", () => {
    const { definitions, unknown } = definitionsFor(["ecart", "id-inconnu", "ecart", "lecture-nd"]);
    const ecart = glossaryEntry("ecart")!;
    expect(definitions).toHaveLength(2);
    expect(definitions[0]).toEqual({ term: ecart.term, definition: ecart.definition, formula: ecart.formula });
    expect(definitions[1].term).toBe(glossaryEntry("lecture-nd")!.term);
    expect(definitions[1].formula).toBeUndefined(); // pas de formule : la clé est absente
    expect(unknown).toEqual(["id-inconnu"]);
  });
});

describe("sources : onglet Sources", () => {
  it("sourceRows : lecture appliquée, jamais synchronisée, saisie dans Clair (cas écrits à la main)", () => {
    const rows = sourceRows([
      { label: "PayFit", usage: "journal de paie", last: { statusLabel: "Appliquée (active)", at: "2026-01-15T09:12:00.000Z" }, applied: { at: "2026-01-14T08:00:00.000Z" } },
      { label: "Pennylane", usage: "comptabilité", last: null, applied: null },
      { label: "Hypothèses", usage: "scénarios saisis", last: null, applied: null, neverStatus: "Saisie dans Clair" },
    ]);
    expect(rows).toEqual([
      { label: "PayFit", detail: "journal de paie · lecture appliquée le 14/01/2026 09:00", syncedAt: "2026-01-15T09:12:00.000Z", status: "Appliquée (active)" },
      { label: "Pennylane", detail: "comptabilité · aucune lecture appliquée", syncedAt: null, status: "Jamais synchronisée" },
      { label: "Hypothèses", detail: "scénarios saisis", syncedAt: null, status: "Saisie dans Clair" },
    ]);
  });

  it("loadSourceInputs : dernière lecture (lastSync) et lecture appliquée (activeSync), pour l'espace demandé", async () => {
    mocks.lastSync.mockReset().mockImplementation(async (_w: string, p: string) => (p === "payfit" ? { status: "preview", startedAt: new Date("2026-01-15T09:00:00Z"), finishedAt: new Date("2026-01-15T09:12:00Z") } : null));
    mocks.activeSync.mockReset().mockImplementation(async (_w: string, p: string) => (p === "payfit" ? { decidedAt: new Date("2026-01-10T08:00:00Z") } : null));
    const inputs = await loadSourceInputs("w1", [{ provider: "payfit", usage: "journal" }, { provider: "dsn", usage: "déclarations", label: "DSN déposées" }]);
    expect(mocks.lastSync).toHaveBeenCalledWith("w1", "payfit");
    expect(mocks.activeSync).toHaveBeenCalledWith("w1", "dsn");
    expect(inputs).toEqual([
      { label: "PayFit", usage: "journal", last: { statusLabel: "Aperçu à valider", at: "2026-01-15T09:12:00.000Z" }, applied: { at: "2026-01-10T08:00:00.000Z" } },
      { label: "DSN déposées", usage: "déclarations", last: null, applied: null },
    ]);
  });

  it("loadSourceInputs : un statut sans libellé connu est écrit tel quel ; sans fin de lecture, le début tient lieu de date", async () => {
    mocks.lastSync.mockReset().mockResolvedValue({ status: "statut-inconnu", startedAt: new Date("2026-01-15T09:00:00Z"), finishedAt: null });
    mocks.activeSync.mockReset().mockResolvedValue(null);
    const [row] = await loadSourceInputs("w1", [{ provider: "payfit", usage: "journal" }]);
    expect(row.last).toEqual({ statusLabel: "statut-inconnu", at: "2026-01-15T09:00:00.000Z" });
    expect(row.applied).toBeNull();
  });
});

describe("response : réponse HTTP d'un export Excel", () => {
  it("assainit le nom de fichier : ni chemin, ni guillemet, ni retour à la ligne", () => {
    // « ../../Écart "budgétaire"?<CR><LF>Set-Cookie: x=1.xlsx » : les séparateurs et caractères réservés deviennent des espaces,
    // l'extension d'origine est retirée, les points et espaces de tête disparaissent.
    expect(safeFileName('../../Écart "budgétaire"?\r\nSet-Cookie: x=1.xlsx')).toBe("Écart budgétaire Set-Cookie x=1.xlsx");
    expect(safeFileName("ecart-budgetaire")).toBe("ecart-budgetaire.xlsx");
    expect(safeFileName("..")).toBe("export.xlsx");
    expect(safeFileName("   ")).toBe("export.xlsx");
    expect(safeFileName("CON")).toBe("export-CON.xlsx");
    expect(safeFileName("x".repeat(150))).toBe(`${"x".repeat(100)}.xlsx`);
    for (const bad of ['a/b', "a\\b", 'a"b', "a\nb", "a:b", "a*b", "a<b>", "a|b"]) expect(safeFileName(bad)).not.toMatch(/[\\/:*?"<>|\r\n]/);
  });

  it("Content-Disposition : repli ASCII et nom complet en UTF-8, sur une seule ligne", () => {
    const value = contentDisposition('../../Écart "budgétaire"?\r\nSet-Cookie: x=1.xlsx');
    expect(value).toBe(`attachment; filename="Ecart-budgetaire-Set-Cookie-x-1.xlsx"; filename*=UTF-8''%C3%89cart%20budg%C3%A9taire%20Set-Cookie%20x%3D1.xlsx`);
    expect(value).not.toMatch(/[\r\n]/);
    expect(contentDisposition("l'été (2026)")).toBe(`attachment; filename="l-ete-2026.xlsx"; filename*=UTF-8''l%27%C3%A9t%C3%A9%20%282026%29.xlsx`);
  });

  it("xlsxResponse : type MIME, pièce jointe, jamais mis en cache, corps identique", async () => {
    const body = await buildWorkbook({ ...BASE, sheets: [] });
    const res = xlsxResponse(body, "../Export du jour");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(XLSX_MIME);
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Export-du-jour.xlsx"; filename*=UTF-8''Export%20du%20jour.xlsx`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-length")).toBe(String(body.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
    expect(body.subarray(0, 2).toString()).toBe("PK"); // archive OOXML
  });
});

describe("ExportButtons : Excel en premier, CSV conservé, mêmes paramètres que la page", () => {
  it("deux liens vers la même route : ?format=xlsx pour Excel, adresse inchangée pour le CSV", () => {
    const html = renderToStaticMarkup(h(ExportButtons, { href: "/e/demo/export", params: "v1=reel%3A2025&vue=detail&format=csv", label: "Exporter le tableau", xlsxTestId: "x-xlsx", csvTestId: "x-csv" }));
    const xlsx = html.indexOf('href="/e/demo/export?v1=reel%3A2025&amp;vue=detail&amp;format=xlsx"');
    const csv = html.indexOf('href="/e/demo/export?v1=reel%3A2025&amp;vue=detail"');
    expect(xlsx).toBeGreaterThan(-1);
    expect(csv).toBeGreaterThan(xlsx); // Excel d'abord
    expect(html).toContain('data-testid="x-xlsx"');
    expect(html).toContain('data-testid="x-csv"');
    expect(html).toContain("Excel (.xlsx)");
    expect(html).toContain(">CSV<");
    expect(html).toContain('aria-label="Exporter le tableau"');
    expect(html).toContain('class="btn"');
  });
  it("sans paramètre : lien Excel avec le seul format, lien CSV sans point d'interrogation", () => {
    const html = renderToStaticMarkup(h(ExportButtons, { href: "/e/demo/export" }));
    expect(html).toContain('href="/e/demo/export?format=xlsx"');
    expect(html).toContain('href="/e/demo/export"');
  });
});

// --- Route d'export de l'écart budgétaire (cas d'usage de bout en bout) ---------------------------------------------------------
describe("route d'export de l'écart : ?format=xlsx, CSV inchangé", () => {
  // Deux budgets saisis fictifs, période de janvier à février. Masse chargée (centimes) :
  //   version 1 : 1 000 000 + 2 000 000 = 3 000 000 (30 000,00 €) ; version 2 : 1 500 000 + 2 500 000 = 4 000 000 (40 000,00 €).
  //   écart = 1 000 000 (10 000,00 €) ; écart en % = 1 000 000 ÷ 3 000 000 = 33,33 % → 3 333 points de base.
  // Un budget saisi n'a ni ETP, ni effectif, ni brut, ni charges : ces lignes sont n.d.
  const A = budgetVersion("budget:a", "Budget fictif A", "2026", { "2026-01": 1_000_000, "2026-02": 2_000_000 });
  const B = budgetVersion("budget:b", "Budget fictif B", "2027", { "2027-01": 1_500_000, "2027-02": 2_500_000 });
  const URL_BASE = "http://localhost/e/demo/studio-rh/masse-salariale/ecart/export";
  const call = async (query: string) => {
    const { GET } = await import("@/app/e/[slug]/studio-rh/masse-salariale/ecart/export/route");
    return GET(new NextRequest(`${URL_BASE}?${query}`), { params: Promise.resolve({ slug: "demo" }) });
  };
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mocks.role.value = "editor";
    mocks.loaded.value = {
      ctx: { source: "payfit" },
      versions: [A, B],
      sources: [{ kind: "budget" }, { kind: "budget" }],
      months: (year: string) => [`${year}-01`, `${year}-02`],
      from: "01",
      to: "02",
      filter: null,
    };
    mocks.lastSync.mockReset().mockImplementation(async (_w: string, p: string) => (p === "payfit" ? { status: "applied", startedAt: new Date("2026-01-15T09:00:00Z"), finishedAt: new Date("2026-01-15T09:12:00Z") } : null));
    mocks.activeSync.mockReset().mockImplementation(async (_w: string, p: string) => (p === "payfit" ? { decidedAt: new Date("2026-01-15T09:30:00Z") } : null));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("Excel du tableau : montants en vrais nombres, ETP et effectifs n.d. avec raison, onglets Filtres, Sources et Définitions", async () => {
    const res = await call("format=xlsx&vue=synthese");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(XLSX_MIME);
    expect(res.headers.get("content-disposition")).toContain('filename="ecart-budgetaire.xlsx"');
    const wb = await load(Buffer.from(await res.arrayBuffer()));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Écart budgétaire", "Filtres", "Sources", "Définitions"]);
    const ws = wb.getWorksheet("Écart budgétaire")!;
    // Titre, espace, filtres, note → l'en-tête est en ligne 5 ; lignes : ETP 6, inscrits 7, entrées 8, sorties 9, masse 10, brut 11, charges 12.
    expect(ws.getCell("A1").value).toBe("Écart budgétaire");
    expect(ws.getRow(5).values).toEqual([undefined, "Rubrique", "Unité", "Budget fictif A", "Budget fictif B", "Écart 2−1", "Écart 2−1 %", "Observations"]);
    expect(ws.getCell("A10").value).toBe("Masse salariale chargée");
    expect(ws.getCell("B10").value).toBe("€");
    expect(ws.getCell("C10").value).toBe(30_000);
    expect(ws.getCell("D10").value).toBe(40_000);
    expect(ws.getCell("E10").value).toBe(10_000);
    expect(ws.getCell("F10").value).toBe(1_000_000 / 3_000_000); // fraction exacte 0,3333… (écran : 33,33 %), arrondie une seule fois par le format
    expect(shownPct(ws.getCell("F10").value)).toBe("33,33 %");
    expect(String(ws.getCell("A4").value)).toBe(`Montants en euros ; ETP et pourcentages affichés au centième, valeur exacte conservée dans la cellule. ${EMPTY_CELL_NOTE}`);
    expect([ws.getCell("C10").numFmt, ws.getCell("E10").numFmt, ws.getCell("F10").numFmt]).toEqual(['#,##0.00 "€"', '#,##0.00 "€"', "0.00%"]);
    expect(ws.getCell("G10").value ?? null).toBeNull();
    // ETP : n.d. (jamais 0), raison en commentaire et dans les observations ; la ligne garde le format ETP.
    expect(ws.getCell("B6").value).toBe("ETP");
    for (const c of ["C6", "D6", "E6", "F6"]) {
      expect(ws.getCell(c).value).toBe("n.d.");
      expect(noteOf(ws.getCell(c))).toContain("budget saisi sans ETP");
    }
    expect(String(ws.getCell("G6").value)).toContain("budget saisi sans ETP");
    expect(ws.getCell("C7").value).toBe("n.d."); // inscrits
    expect(ws.autoFilter).toBe("A5:G12");
    expect((ws.views[0] as { ySplit: number }).ySplit).toBe(5);

    const filtres = wb.getWorksheet("Filtres")!;
    const f = (r: number) => [filtres.getCell(`A${r}`).value, filtres.getCell(`B${r}`).value];
    expect(f(5)).toEqual(["Version 1", "Budget fictif A"]);
    expect(f(6)).toEqual(["Version 2", "Budget fictif B"]);
    expect(f(7)).toEqual(["Période", "de janvier à février (rangs de mois 01 à 02)"]);
    expect(f(8)).toEqual(["Périmètre", "tous les services"]);
    expect(f(9)).toEqual(["Niveau de détail", "Synthèse"]);

    const sources = wb.getWorksheet("Sources")!;
    expect(sources.getCell("A5").value).toBe("PayFit");
    expect(String(sources.getCell("B5").value)).toContain("lecture appliquée le 15/01/2026 10:30");
    expect(iso(sources.getCell("C5"))).toBe("2026-01-15T10:12:00.000Z");
    expect(sources.getCell("D5").value).toBe("Appliquée (active)");
    expect(sources.getCell("A6").value).toBe("Hypothèses budgétaires"); // une version saisie : la saisie dans Clair est une source
    expect(sources.getCell("D6").value).toBe("Saisie dans Clair");
    expect(sources.getCell("C6").value).toBe("n.d.");

    expect(wb.getWorksheet("Définitions")!.rowCount).toBe(4 + 11); // les onze définitions de l'écran existent toutes au glossaire
    expect(warn).not.toHaveBeenCalled();
  });

  it("Excel : ETP, effectifs, entrées et sorties dans la même colonne que les montants, chacun avec son format et son arrondi", async () => {
    // Mêmes budgets, avec des effectifs saisis à la main (janvier, février) :
    //   version 1 : ETP 10 000 et 12 000 dix-millièmes ; inscrits 10 et 11 ; entrées 1 et 2 ; sorties 0 et 0.
    //   version 2 : ETP 12 000 et 14 000 ; inscrits 12 et 15 ; entrées 0 et 1 ; sorties 0 et 0.
    // ETP = moyenne : (22 000 ÷ 2) = 11 000 → 1,10 ; (26 000 ÷ 2) = 13 000 → 1,30 ; écart 2 000 → 0,20 ; en % : 4 000 ÷ 22 000 = 18,1818… % → 1 818 points de base.
    // Inscrits en fin de période : 11 puis 15 ; écart 4 ; 4 ÷ 11 = 36,36 % → 3 636. Entrées (sommes) : 3 puis 1 ; écart −2 ; −2 ÷ 3 = −66,67 % → −6 667.
    // Sorties : 0 puis 0 ; écart 0 ; départ nul, donc pourcentage n.d. (jamais 0 %).
    const withPeople = (v: typeof A, etp: number[], head: number[], inn: number[]) => ({
      ...v,
      months: new Map([...v.months].map(([m, f], i) => [m, i < 2 ? { ...f, etp4: val(etp[i]), headcount: val(head[i]), entrees: val(inn[i]), sorties: val(0) } : f])),
    });
    const loaded = mocks.loaded.value as { versions: unknown[] };
    loaded.versions = [withPeople(A, [10_000, 12_000], [10, 11], [1, 2]), withPeople(B, [12_000, 14_000], [12, 15], [0, 1])];
    const ws = (await load(Buffer.from(await (await call("format=xlsx")).arrayBuffer()))).getWorksheet("Écart budgétaire")!;
    const row = (r: number) => [3, 4, 5, 6].map((c) => ws.getCell(r, c).value as number);
    // Fractions exactes, sans arrondi intermédiaire : 4 000 ÷ 22 000 = 0,181818… ; 4 ÷ 11 = 0,363636… ; −2 ÷ 3 = −0,666666…
    expect(row(6).slice(0, 3)).toEqual([1.1, 1.3, 0.2]); // ETP
    expect(row(6)[3]).toBeCloseTo(0.181818181818, 10);
    expect(shownPct(row(6)[3])).toBe("18,18 %");
    expect(row(7).slice(0, 3)).toEqual([11, 15, 4]); // inscrits
    expect(row(7)[3]).toBeCloseTo(0.363636363636, 10);
    expect(row(8).slice(0, 3)).toEqual([3, 1, -2]); // entrées
    expect(row(8)[3]).toBeCloseTo(-0.666666666667, 10);
    expect(shownPct(row(8)[3])).toBe("−66,67 %");
    expect(row(9).slice(0, 3)).toEqual([0, 0, 0]); // sorties : de vrais zéros
    expect(ws.getCell("F9").value).toBe("n.d."); // pourcentage sans départ : n.d., pas 0 %
    expect(noteOf(ws.getCell("F9"))).toBe("valeur de départ nulle");
    expect(String(ws.getCell("G9").value)).toBe("Écart 2−1 % : valeur de départ nulle");
    expect([6, 7, 8, 10].map((r) => ws.getCell(r, 3).numFmt)).toEqual(["#,##0.00", "#,##0", "#,##0", '#,##0.00 "€"']);
    expect([6, 7, 8].map((r) => ws.getCell(r, 6).numFmt)).toEqual(["0.00%", "0.00%", "0.00%"]);
    expect([6, 7, 8, 9, 10].map((r) => ws.getCell(r, 2).value)).toEqual(["ETP", "Nombre", "Nombre", "Nombre", "€"]);
    expect(ws.getCell("C10").value).toBe(30_000); // la masse reste exacte
  });

  it("ETP : cellule = fraction exacte, un seul arrondi à l'affichage (3 749 ÷ 30 000 → 0,12 ; demi exact 0,125 → 0,13), identique à l'écran et au CSV", async () => {
    // Trois mois (janvier à mars), ETP de fin de mois en dix-millièmes :
    //   version 1 : 1 249 + 1 250 + 1 250 = 3 749 → moyenne 3 749 ÷ 30 000 = 0,12496666… ETP (écran : 0,12 ; avec un arrondi intermédiaire au
    //   dix-millième on obtiendrait 0,1250 puis 0,13) ; version 2 : 1 250 × 3 = 3 750 → 3 750 ÷ 30 000 = 0,125 exactement (écran : 0,13).
    //   écart = 1 ÷ 30 000 = 0,0000333… (écran : 0,00) ; en % : 1 ÷ 3 749 = 0,0266…  % (écran : 0,03 %).
    const masse = (year: string) => Object.fromEntries(["01", "02", "03"].map((m) => [`${year}-${m}`, 1_000_000]));
    const withEtp = (v: typeof A, etp: number[]) => ({ ...v, months: new Map([...v.months].map(([m, f], i) => [m, i < 3 ? { ...f, etp4: val(etp[i]) } : f])) });
    const loaded = mocks.loaded.value as { versions: unknown[]; months: (year: string) => string[]; to: string };
    loaded.versions = [withEtp(budgetVersion("budget:a", "Budget fictif A", "2026", masse("2026")), [1_249, 1_250, 1_250]), withEtp(budgetVersion("budget:b", "Budget fictif B", "2027", masse("2027")), [1_250, 1_250, 1_250])];
    loaded.months = (year) => [`${year}-01`, `${year}-02`, `${year}-03`];
    loaded.to = "03";
    const ws = (await load(Buffer.from(await (await call("format=xlsx")).arrayBuffer()))).getWorksheet("Écart budgétaire")!;
    expect(ws.getCell("B6").value).toBe("ETP");
    const [a, b, gap, pct] = [3, 4, 5, 6].map((c) => ws.getCell(6, c).value as number);
    // Valeurs de référence écrites à la main : 3 749 ÷ 30 000 = 0,1249666… ; 3 750 ÷ 30 000 = 0,125 ; 1 ÷ 30 000 = 0,0000333… ; 1 ÷ 3 749 = 0,000266…
    expect(a).toBeGreaterThan(0.1249666);
    expect(a).toBeLessThan(0.1249667);
    expect(b).toBe(0.125);
    expect(gap).toBeGreaterThan(0.0000333);
    expect(gap).toBeLessThan(0.0000334);
    expect(pct).toBeGreaterThan(0.000266);
    expect(pct).toBeLessThan(0.000267);
    expect([3, 4, 5].map((c) => ws.getCell(6, c).numFmt)).toEqual(["#,##0.00", "#,##0.00", "#,##0.00"]);
    expect(ws.getCell(6, 6).numFmt).toBe("0.00%");
    // Ce que l'Excel affiche = ce que l'écran affiche = ce que le CSV écrit.
    expect([shownEtp(a), shownEtp(b), shownEtp(gap), shownPct(pct)]).toEqual(["0,12", "0,13", "0,00", "0,03 %"]);
    expect([shownEtp(a), shownEtp(b), shownEtp(gap), shownPct(pct)]).toEqual([fmtFixed({ num: 3_749, den: 30_000 }), fmtFixed({ num: 3_750, den: 30_000 }), fmtFixed({ num: 1, den: 30_000 }), screenPct(1, 3_749)]);
    const { lines } = await csvOf(await call("format=csv"));
    expect(lines.find((l) => l.startsWith('"ETP'))).toBe('"ETP (moyenne des ETP de fin de mois)";"0,12";"0,13";"0,00";"0,03"');
  });

  it("libellés saisis : jamais pris pour une formule, en Excel comme en CSV ; un écart négatif reste un nombre, sans apostrophe", async () => {
    // Version 1 « =Budget fictif B » (4 000 000 centimes), version 2 « -12,5 » (nombre pur : inchangé), 3 000 000 centimes :
    // écart = 3 000 000 − 4 000 000 = −1 000 000 (−10 000,00 €), en % : −1 000 000 ÷ 4 000 000 = −25 %.
    const first = budgetVersion("budget:b", "=Budget fictif B", "2027", { "2027-01": 1_500_000, "2027-02": 2_500_000 });
    const second = budgetVersion("budget:a", "-12,5", "2026", { "2026-01": 1_000_000, "2026-02": 2_000_000 });
    (mocks.loaded.value as { versions: unknown[] }).versions = [first, second];
    const book = await load(Buffer.from(await (await call("format=xlsx")).arrayBuffer()));
    const ws = book.getWorksheet("Écart budgétaire")!;
    expect(ws.getCell("C5").value).toBe("'=Budget fictif B"); // en-tête de colonne
    expect(ws.getCell("D5").value).toBe("-12,5"); // nombre pur : inchangé
    expect([ws.getCell("C10").value, ws.getCell("D10").value, ws.getCell("E10").value, ws.getCell("F10").value]).toEqual([40_000, 30_000, -10_000, -0.25]);
    expect(ws.getCell("E10").type).toBe(ExcelJS.ValueType.Number);
    expect(ws.getCell("F10").type).toBe(ExcelJS.ValueType.Number);
    expect(book.getWorksheet("Filtres")!.getCell("B5").value).toBe("'=Budget fictif B");
    const { lines } = await csvOf(await call("format=csv"));
    expect(lines[0]).toBe('"Rubrique";"\'=Budget fictif B";"-12,5";"Écart 2−1";"Écart 2−1 %"');
    expect(lines).toContain('"Masse salariale chargée";"40000,00";"30000,00";"-10000,00";"-25,00"'); // numériques : écart négatif intact
  });

  it("Excel du détail : niveau de détail demandé dans l'onglet Filtres", async () => {
    const wb = await load(Buffer.from(await (await call("format=xlsx&vue=detail")).arrayBuffer()));
    expect(wb.getWorksheet("Filtres")!.getCell("B9").value).toBe("Détail");
    expect(wb.getWorksheet("Écart budgétaire")!.rowCount).toBe(5 + 12); // 12 rubriques en détail
  });

  it("CSV inchangé : BOM, séparateur « ; », décimales à la virgule, écart en pourcentage", async () => {
    for (const query of ["vue=synthese", "format=csv&vue=synthese"]) {
      const res = await call(query);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="ecart-budgetaire.csv"');
      const { bom, lines } = await csvOf(res);
      expect(bom).toBe(true);
      expect(lines[0]).toBe('"Rubrique";"Budget fictif A";"Budget fictif B";"Écart 2−1";"Écart 2−1 %"');
      expect(lines).toContain('"Masse salariale chargée";"30000,00";"40000,00";"10000,00";"33,33"');
    }
  });

  it("format inconnu : refus explicite", async () => {
    const res = await call("format=pdf");
    expect(res.status).toBe(400);
  });

  describe("détail par salarié", () => {
    // Version 1 → version 2, en centimes : personne A 1 000 000 → 2 000 000 (+1 000 000) ; personne B 500 000 → absente (−500 000) ;
    // personne C absente → 500 000 (+500 000) ; hors salarié 200 000 → 200 000 (0). Somme des écarts : 1 000 000 = écart de la
    // rubrique (4 000 000 − 3 000 000) : rapproché.
    const info = (label: string, externalId: string, service: string | null, contract: string | null, start: string | null, end: string | null) => ({ label, externalId, service, contract, start, end });
    // Chaque appel de route lit le détail de la version 1 puis celui de la version 2.
    const primeZoom = () =>
      mocks.zoomOf
        .mockReset()
        .mockReturnValueOnce({ kind: "value", byKey: new Map([["c1", 1_000_000], ["c2", 500_000], [HORS_SALARIE, 200_000]]) })
        .mockReturnValueOnce({ kind: "value", byKey: new Map([["c1", 2_000_000], ["c3", 500_000], [HORS_SALARIE, 200_000]]) });
    beforeEach(() => {
      primeZoom();
      mocks.people.value = new Map([
        ["c1", info("Personne A", "M-001", "Service fictif", "CDI", "2024-02-01", null)],
        ["c2", info("Personne B", "M-002", null, null, "2023-05-15", "2026-02-28")],
        ["c3", info("Personne C", "M-003", null, "CDD", "2026-02-02", null)],
      ]);
    });

    it("Excel : une ligne par salarié, nom en première colonne figée, absent d'une version = cellule vide, service et contrat non renseignés = n.d. avec raison, rapprochement dans la note", async () => {
      const res = await call("format=xlsx&zoom=masse:1");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain('filename="ecart-detail-masse.xlsx"');
      const wb = await load(Buffer.from(await res.arrayBuffer()));
      const ws = wb.getWorksheet("Détail par salarié")!;
      // Lignes de tête : titre, espace, filtres, note → en-tête en ligne 5, données dès la ligne 6 (tri par nom).
      expect(ws.getRow(5).values).toEqual([undefined, "Nom", "Matricule", "Service", "Contrat", "Date d'embauche", "Date de sortie", "Budget fictif A", "Budget fictif B", "Écart"]);
      expect(ws.getCell("A6").value).toBe("Hors salarié");
      expect([ws.getCell("G6").value, ws.getCell("H6").value, ws.getCell("I6").value]).toEqual([2_000, 2_000, 0]); // écart nul : un vrai zéro
      // « Hors salarié » n'est pas une personne : service et contrat sans objet, cellules vides (pas de n.d.).
      expect([ws.getCell("C6").value ?? null, ws.getCell("D6").value ?? null]).toEqual([null, null]);
      expect(ws.getCell("A7").value).toBe("Personne A");
      expect(ws.getCell("B7").value).toBe("M-001");
      expect(iso(ws.getCell("E7"))).toBe("2024-02-01T00:00:00.000Z");
      expect(ws.getCell("F7").value ?? null).toBeNull();
      expect([ws.getCell("G7").value, ws.getCell("H7").value, ws.getCell("I7").value]).toEqual([10_000, 20_000, 10_000]);
      expect([ws.getCell("C7").value, ws.getCell("D7").value]).toEqual(["Service fictif", "CDI"]); // renseignés : écrits tels quels
      expect(ws.getCell("A8").value).toBe("Personne B");
      expect(ws.getCell("H8").value ?? null).toBeNull(); // absente de la version 2 : vide, pas 0
      expect([ws.getCell("G8").value, ws.getCell("I8").value]).toEqual([5_000, -5_000]);
      // Service et contrat non renseignés : « n.d. » (jamais vide ni 0) avec la raison en commentaire de cellule.
      for (const c of ["C8", "D8", "C9"]) {
        expect(ws.getCell(c).value).toBe("n.d.");
        expect(noteOf(ws.getCell(c))).toBe("non renseigné dans le référentiel Collaborateurs");
      }
      expect(ws.getCell("A9").value).toBe("Personne C");
      expect(ws.getCell("D9").value).toBe("CDD");
      expect(ws.getCell("G9").value ?? null).toBeNull();
      expect([ws.getCell("H9").value, ws.getCell("I9").value]).toEqual([5_000, 5_000]);
      expect(String(ws.getCell("A4").value).replace(/\s/g, " ")).toBe(`Somme des écarts : 10 000,00 € · rapproché de l'écart de la rubrique (10 000,00 €). ${EMPTY_CELL_NOTE}`);
      expect(ws.autoFilter).toBe("A5:I9");
      expect((ws.views[0] as { xSplit: number }).xSplit).toBe(1);
      expect(wb.getWorksheet("Filtres")!.getCell("A9").value).toBe("Rubrique");
      expect(warn).not.toHaveBeenCalled();
    });

    it("zoom : seule une rubrique propre est acceptée ; constructor, toString, __proto__… sont refusés en 404, Excel comme CSV", async () => {
      for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "inconnue"]) {
        for (const format of ["xlsx", "csv"]) expect((await call(`format=${format}&zoom=${bad}:1`)).status, `${bad} (${format})`).toBe(404);
      }
      expect((await call("format=xlsx&zoom=masse:2")).status).toBe(404); // une seule paire de versions : pas de détail pour la paire 2
      expect(mocks.zoomOf).not.toHaveBeenCalled(); // refusé avant tout calcul
      for (const rubric of ["masse", "brut", "remun", "primes", "indemnites", "charges"]) {
        mocks.zoomOf.mockReset().mockReturnValue({ kind: "value", byKey: new Map([["c1", 100]]) });
        const res = await call(`format=xlsx&zoom=${rubric}:1`);
        expect(res.status, rubric).toBe(200);
        expect(res.headers.get("content-disposition")).toContain(`filename="ecart-detail-${rubric}.xlsx"`);
      }
    });

    it("texte saisi (nom, matricule, service, contrat) : jamais pris pour une formule, en Excel comme en CSV ; nombre pur et écarts négatifs intacts", async () => {
      mocks.people.value = new Map([
        ["c1", info("=Personne A", "-M-001", "+Service", "@CDI", "2024-02-01", null)],
        ["c2", info("Personne B", "-123", "Service fictif", "CDI", "2023-05-15", "2026-02-28")],
        ["c3", info("Personne C", "M-003", "Service fictif", "CDD", "2026-02-02", null)],
      ]);
      const ws = (await load(Buffer.from(await (await call("format=xlsx&zoom=masse:1")).arrayBuffer()))).getWorksheet("Détail par salarié")!;
      primeZoom(); // deuxième appel de route : le CSV lit de nouveau les deux versions
      const rowOf = (name: string) => {
        let found = -1;
        ws.eachRow((row, n) => {
          if (row.getCell(1).value === name) found = n;
        });
        return found;
      };
      const a = rowOf("'=Personne A");
      expect(a).toBeGreaterThan(5);
      expect([ws.getCell(a, 2).value, ws.getCell(a, 3).value, ws.getCell(a, 4).value]).toEqual(["'-M-001", "'+Service", "'@CDI"]);
      expect([ws.getCell(a, 7).value, ws.getCell(a, 8).value, ws.getCell(a, 9).value]).toEqual([10_000, 20_000, 10_000]); // numériques : jamais préfixés
      const b = rowOf("Personne B");
      expect(ws.getCell(b, 2).value).toBe("-123"); // nombre pur négatif : inchangé
      expect(ws.getCell(b, 9).value).toBe(-5_000); // écart négatif : un nombre
      expect(ws.getCell(b, 9).type).toBe(ExcelJS.ValueType.Number);
      const { lines } = await csvOf(await call("zoom=masse:1"));
      expect(lines).toContain('"10000,00";"10000,00";"20000,00";"\'-M-001";"\'=Personne A";"\'+Service";"\'@CDI";"2024-02-01";""');
      expect(lines).toContain('"-5000,00";"5000,00";"";"-123";"Personne B";"Service fictif";"CDI";"2023-05-15";"2026-02-28"'); // écart négatif et nombre pur : intacts
    });

    it("le CSV du détail garde son format ; le détail nominatif reste refusé à un lecteur, en Excel comme en CSV", async () => {
      const { bom, lines } = await csvOf(await call("zoom=masse:1"));
      expect(bom).toBe(true);
      expect(lines[0]).toBe('"Écart (€)";"Budget fictif A";"Budget fictif B";"Matricule";"Nom";"Service";"Contrat";"Date d\'embauche";"Date de sortie"');
      expect(lines[2]).toBe('"10000,00";"10000,00";"20000,00";"M-001";"Personne A";"Service fictif";"CDI";"2024-02-01";""');
      expect(lines[3]).toBe('"-5000,00";"5000,00";"";"M-002";"Personne B";"";"";"2023-05-15";"2026-02-28"'); // CSV inchangé : service et contrat vides, écart négatif non préfixé
      mocks.role.value = "reader";
      expect((await call("format=xlsx&zoom=masse:1")).status).toBe(403);
      expect((await call("zoom=masse:1")).status).toBe(403);
    });
  });
});
