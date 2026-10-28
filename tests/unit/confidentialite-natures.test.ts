import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEffectifs, type EffectifsData } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { flowGuard } from "@/app/e/[slug]/studio-rh/kpi/flow-guard";
import { kpiSuiviOf, scopeGuard } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { monthRange } from "@/lib/connectors/months";
import { confidentialiteReason, isHidden, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { countedMovements, flowColumn, flowCounts } from "@/lib/confidentialite/flows";
import { headcountItems, movementItems, movementValue, splitLabel } from "@/lib/confidentialite/splits";
import { monthEnd } from "@/lib/dates";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { countedOpts } from "@/lib/rh/kpi/period";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { countByNature, natureCells, type JournalEventIn } from "@/lib/viz/croisee-effectifs";
import type { DsnDeclarationSpec, DsnPerson } from "./helpers/edge-cases";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnBuild, edgeFiles } from "./helpers/rh";

// Répartitions par NATURE de contrat et par ÉTABLISSEMENT (lot 12) : une même cellule a le même statut sur les trois écrans qui la
// publient — KPI RH › Effectifs mensuels (axes « Contrat (nature) » et « Établissement »), la croisée 02 (journal des mouvements,
// « dont <nature> ») et KPI RH sous un filtre Nature ou Établissement (garde des flux, garde des effectifs). Mêmes groupes (splits.ts),
// mêmes libellés, même colonne canonique (ordre des libellés, groupe vide hors de la relation, valeur d'ordre : le nombre de mouvements
// ou l'effectif). Données entièrement fictives (DSN fictives) ; cas de référence calculés à la main dans les commentaires. Seuil 5.

// --- Doubles : seuil de l'espace, journal de paie absent, catégories par défaut, aucun scénario ----------------------------------------
const mocks = vi.hoisted(() => ({ conf: { value: { kind: "absent" } as unknown } }));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => ({ input: null, etp: (months: string[]) => months.map((month) => ({ month, etp4: null, reason: "ETP par service non lu (test)" })) }),
}));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));
vi.mock("@/lib/budget/store", async (orig) => ({ ...(await orig<typeof import("@/lib/budget/store")>()), getScenario: async () => null, listScenarios: async () => [], listBudgets: async () => [] }));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R5 = confidentialiteReason(5); // « non affiché (seuil de confidentialité : 5 personnes) »
beforeEach(() => {
  mocks.conf.value = set(5);
});

// --- Référentiels fictifs ------------------------------------------------------------------------------------------------------------
// Un salarié fictif : un contrat K-<i>, nature et établissement (NIC) donnés, début donné ; NIR fictif (clé invalide). nature peut
// dépendre du mois de la déclaration (transformation d'un contrat).
type Worker = { i: number; start: string; nic: string; nature: (month: string) => string };
const W = (i: number, nature: string, start = "2025-01-01", nic = "00011"): Worker => ({ i, start, nic, nature: () => nature });
const person = (w: Worker, month: string): DsnPerson => ({ nir: `2990175${100000 + w.i}`, employeeNumber: `E${w.i}`, contracts: [{ number: `K-${w.i}`, start: w.start, nature: w.nature(month), gross: "1000.00" }] });
// Une déclaration par mois et par établissement, du premier au dernier mois (tous complets).
function build(workers: Worker[], from: string, to: string) {
  const nics = [...new Set(workers.map((w) => w.nic))].sort();
  const specs: DsnDeclarationSpec[] = monthRange(from, to).flatMap((month) => nics.map((nic) => ({ month, nic, people: workers.filter((w) => w.nic === nic && w.start <= `${month}-31`).map((w) => person(w, month)) })));
  return dsnBuild(edgeFiles(specs));
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const ctxOf = (input: KpiInput, establishments: string[], codes: string[]) =>
  ({
    collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" }, establishments: establishments.map((id) => ({ id, label: `Établissement fictif ${id.slice(-2)}` })), natures: { codes, origin: "default" }, payfitHistory: null, state: null },
    settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
    input,
    readTypes: [],
  }) as unknown as KpiContext;
const ready = (ctx: KpiContext, sp: Record<string, string>) => {
  const s = kpiSuiviOf(ctx, sp, set(5));
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  return s;
};
// Effectifs mensuels : groupe (libellé) → cellule masquée ? pour un mois de la grille.
const effHidden = (e: EffectifsData, m: string): Record<string, boolean> => {
  if (e.raw.kind !== "value" || !e.mask) throw new Error("grille attendue");
  const st = e.mask.months.get(m)!;
  return Object.fromEntries(e.raw.groups.map((g, i) => [g, isHidden(st[i])]));
};
const effValues = (e: EffectifsData, m: string): Record<string, number | null> => {
  const g = e.raw;
  if (g.kind !== "value") throw new Error("grille attendue");
  return Object.fromEntries(g.groups.map((x) => [x, ((c) => (c.kind === "value" ? c.v : null))(g.cell(x, m))]));
};
const CDI = "CDI (01)";
const CDD = "CDD (02)";
const N07 = "CDI intermittent (07)"; // nature fictive tenue ici pour les apprentis du cas de la relecture

// =====================================================================================================================================
// 1. FLUX par nature : KPI RH › Effectifs mensuels (entrées × nature), croisée 02 (« dont <nature> »), filtre Nature de KPI RH
// =====================================================================================================================================
//
// DSN fictives de juillet 2025 à juin 2026, un établissement. Natures comptées, dans l'ordre de la liste de l'espace : 07, 01, 02
// (volontairement différent de l'ordre canonique des libellés). Base : 5 personnes par nature depuis le 01/01/2025 (chaque nature compte
// au moins 5 personnes à chaque fin de mois : la garde des effectifs ne masque rien sous un filtre). Entrées (une personne chacune) :
//   avril 2026 : CDI 2 (K-6, K-7), CDD 1 (K-16), 07 6 (K-26 … K-31)            → total 9 ;
//   mai 2026   : CDI 5 (K-41 … K-45), CDD 1 (K-17), 07 5 (K-51 … K-55)          → total 11 ;
//   juin 2026  : CDI 2 (K-61, K-62), CDD 1 (K-18), aucune 07                     → total 3.
// Colonne canonique (seuil 5), libellés dans l'ordre des points de code : « CDD (02) » < « CDI (01) » < « CDI intermittent (07) ».
//   Avril : CDD (1) et CDI (2) masqués, 3 personnes < 5 ; la plus petite cellule affichée qui apporte des personnes, 07 (6), est
//           masquée à son tour (9 personnes ≥ 5) → les trois n.d.
//   Mai   : CDD (1) masqué ; CDI (5) et 07 (5) à égalité : le premier dans l'ordre canonique, CDI, est masqué à son tour (6 ≥ 5) ;
//           07 affiché (5). Avant : la croisée et la garde du filtre suivaient l'ordre de la liste (07 d'abord) et masquaient 07 en
//           affichant CDI = 5, alors que les Effectifs mensuels (déjà canoniques) affichaient 07 = 5 : CDD = 11 − 5 − 5 = 1 se lisait en
//           croisant les écrans.
//   Juin  : CDD (1) et CDI (2) masqués, 3 < 5 ; 07 (0 entrée) ne décrit personne, hors de la relation : impossible, toute la relation
//           (CDI, CDD) est n.d. ; 07 reste affiché à 0 sur les trois écrans (avant : masqué par la seule croisée).
const SPACE = ["07", "01", "02"];
const FLUX_WORKERS: Worker[] = [
  ...range(1, 5).map((i) => W(i, "01")),
  ...range(11, 15).map((i) => W(i, "02")),
  ...range(21, 25).map((i) => W(i, "07")),
  W(6, "01", "2026-04-01"),
  W(7, "01", "2026-04-15"),
  W(16, "02", "2026-04-10"),
  ...range(26, 31).map((i) => W(i, "07", `2026-04-${String(i - 24).padStart(2, "0")}`)),
  ...range(41, 45).map((i) => W(i, "01", `2026-05-${String(i - 39).padStart(2, "0")}`)),
  W(17, "02", "2026-05-12"),
  ...range(51, 55).map((i) => W(i, "07", `2026-05-${String(i - 37).padStart(2, "0")}`)),
  W(61, "01", "2026-06-01"),
  W(62, "01", "2026-06-02"),
  W(18, "02", "2026-06-03"),
];
const EXPECTED_FLUX: Record<string, Record<string, boolean>> = {
  "2026-04": { [CDD]: true, [CDI]: true, [N07]: true },
  "2026-05": { [CDD]: true, [CDI]: true, [N07]: false },
  "2026-06": { [CDD]: true, [CDI]: true, [N07]: false },
};

describe("flux par nature (avril → juin 2026, seuil 5) : mêmes groupes et mêmes statuts sur les Effectifs mensuels, la croisée 02 et le filtre Nature", () => {
  const data = build(FLUX_WORKERS, "2025-07", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: SPACE }), openMonths: [] };
  const ctx = ctxOf(kpi, [], SPACE);
  // Croisée 02 : mouvements comptés formés comme loadEffectifsInput (nature du mouvement, jetons de contrat et de personne).
  const tok = new Map<string, string>();
  const t = (key: string) => tok.get(key) ?? (tok.set(key, `t${tok.size}`), tok.get(key)!);
  const journal = (m: string): JournalEventIn[] =>
    countedMovements(monthMovements(kpi, m)).map((x) => ({ month: m, kind: x.row.event.kind, nature: movementValue(x.row.event, "nature"), endReason: x.row.event.endReason, contract: t(x.row.contract.contractKey), person: x.row.contract.personKey && t(x.row.contract.personKey) }));

  it("mêmes mouvements comptés dans les mêmes groupes : avril CDD 1, CDI 2, 07 6 personnes (grille, journal de la croisée, garde du filtre)", async () => {
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "entrees", axe: "contrat", version: "reel", annee: "2026" });
    expect(effValues(e, "2026-04")).toEqual({ [CDI]: 2, [CDD]: 1, [N07]: 6 });
    expect(effValues(e, "2026-05")).toEqual({ [CDI]: 5, [CDD]: 1, [N07]: 5 });
    expect(effValues(e, "2026-06")).toEqual({ [CDI]: 2, [CDD]: 1, [N07]: 0 });
    const persons = { [CDD]: 1, [CDI]: 2, [N07]: 6 };
    // Effectifs mensuels : personnes reliées distinctes de chaque cellule (aucun contrat non relié).
    expect(Object.fromEntries(Object.keys(persons).map((g) => [g, e.sizes(g, "2026-04")!.persons.length]))).toEqual(persons);
    expect(Object.keys(persons).every((g) => e.sizes(g, "2026-04")!.unlinked === 0)).toBe(true);
    // Croisée 02 : agrégation du journal par nature.
    const counts = countByNature(journal("2026-04"), "2026-04", "entry");
    expect(Object.fromEntries(Object.entries(counts).map(([n, c]) => [splitLabel("nature", n), c.persons.length]))).toEqual(persons);
    // Garde du filtre Nature : mouvements de l'entrée sans le filtre, rangés par splits.ts.
    const guard = flowCounts(movementItems(monthMovements(kpi, "2026-04"), "entry", "nature"));
    expect(Object.fromEntries(Object.entries(guard).map(([g, c]) => [g, c.persons.length]))).toEqual(persons);
  });

  it("Effectifs mensuels (entrées × nature, 2026) : avril les trois n.d. ; mai CDD et CDI n.d., 07 affiché ; juin CDD et CDI n.d., 07 à 0", async () => {
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "entrees", axe: "contrat", version: "reel", annee: "2026" });
    for (const m of Object.keys(EXPECTED_FLUX)) expect(effHidden(e, m), m).toEqual(EXPECTED_FLUX[m]);
    if (e.grid.kind !== "value") throw new Error("grille attendue");
    expect(e.grid.cell(CDI, "2026-05")).toEqual({ kind: "nd", reason: R5 });
    expect(e.grid.cell(N07, "2026-05")).toEqual({ kind: "value", v: 5 });
    expect(e.grid.cell(N07, "2026-06")).toEqual({ kind: "value", v: 0 });
  });

  it("croisée 02 (« dont <nature> », colonnes dans l'ordre de la liste de l'espace) : mêmes cellules n.d., mêmes valeurs affichées", () => {
    const view = (m: string) => {
      const mv = monthMovements(kpi, m);
      return natureCells(countByNature(journal(m), m, "entry"), SPACE, mv.entries, 5);
    };
    expect(view("2026-04")).toEqual([{ nd: R5 }, { nd: R5 }, { nd: R5 }]); // 07, CDI, CDD
    expect(view("2026-05")).toEqual([5, { nd: R5 }, { nd: R5 }]);
    expect(view("2026-06")).toEqual([0, { nd: R5 }, { nd: R5 }]);
    for (const m of Object.keys(EXPECTED_FLUX)) {
      const cells = view(m);
      expect(Object.fromEntries(SPACE.map((n, i) => [splitLabel("nature", n), typeof cells[i] === "object"])), m).toEqual(EXPECTED_FLUX[m]);
    }
  });

  it("KPI RH sous le filtre Nature (fin juin 2026) : l'entrée du mois du périmètre a le statut de sa cellule ; effectifs du périmètre affichés", () => {
    for (const m of Object.keys(EXPECTED_FLUX)) {
      const hidden = Object.fromEntries(
        SPACE.map((n) => {
          const s = ready(ctx, { nature: n, fin: "2026-06" });
          expect(s.guard, n).toBeNull();
          return [splitLabel("nature", n), s.flows?.months.get(m)?.entries !== undefined];
        }),
      );
      expect(hidden, m).toEqual(EXPECTED_FLUX[m]);
    }
    // Mai, filtre 07 : 5 entrées affichées (la cellule de la grille) ; filtre CDI : n.d. avec la raison du seuil (secondaire).
    const may = (n: string) => ready(ctx, { nature: n, fin: "2026-06" }).dash.rows.find((r) => r.month === "2026-05")!.movements.entries;
    expect(may("07")).toMatchObject({ kind: "exact", value: 5 });
    expect(may("01")).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
  });

  it("l'ordre de la liste des natures de l'espace ne change aucun statut (colonne canonique)", () => {
    for (const order of [["01", "02", "07"], ["02", "07", "01"]]) {
      const g = flowGuard({ base: kpi, scope: { nature: "07" }, months: ["2026-04", "2026-05", "2026-06"], establishments: [], natures: order, seuil: 5 });
      expect([...g!.months.keys()], order.join(",")).toEqual(["2026-04"]);
      const cells = natureCells(countByNature(journal("2026-05"), "2026-05", "entry"), order, monthMovements(kpi, "2026-05").entries, 5);
      expect(Object.fromEntries(order.map((n, i) => [n, typeof cells[i] === "object"]))).toEqual({ "01": true, "02": true, "07": false });
    }
    // flowColumn : même résultat quel que soit l'ordre d'insertion des groupes (mai : CDI et 07 à égalité, CDI retenu).
    const counts = flowCounts(movementItems(monthMovements(kpi, "2026-05"), "entry", "nature"));
    const reversed = Object.fromEntries(Object.entries(counts).reverse());
    expect(Object.fromEntries(flowColumn(counts, 5, true))).toEqual({ [CDD]: "masked", [CDI]: "secondary", [N07]: "shown" });
    expect(Object.fromEntries(flowColumn(reversed, 5, true))).toEqual(Object.fromEntries(flowColumn(counts, 5, true)));
  });
});

// =====================================================================================================================================
// 2. STOCKS par nature : KPI RH › Effectifs mensuels (inscrits et ETP × nature) et garde du filtre Nature (scopeGuard)
// =====================================================================================================================================
//
// DSN fictives de juillet 2025 à juin 2026, un établissement, trois natures (liste de l'espace : 07, 01, 02), tous présents depuis le
// 01/01/2025, quotité 151,67 h (1,00 ETP chacun) : CDD 2 personnes (K-11, K-12), CDI 6 (K-1 … K-6), 07 6 (K-21 … K-26). Chaque fin de
// mois : effectif publié 14, ETP 14,00. Colonne canonique des stocks (stockColumn, seuil 5, valeur d'ordre : l'effectif) : CDD (2)
// masqué ; CDI (6) et 07 (6) à égalité : CDI, premier dans l'ordre canonique, masqué à son tour (8 personnes ≥ 5) ; 07 affiché,
// effectif et ETP ensemble. Sous un filtre : CDD et CDI gardés (tout l'écran n.d., raison du seuil), 07 affiché. Avant : la garde
// suivait l'ordre de la liste (07 d'abord), gardait 07 et affichait CDI (6 inscrits), alors que les Effectifs mensuels affichaient
// 07 = 6 : CDD = 14 − 6 − 6 = 2 se lisait en croisant les écrans.
const STOCK_WORKERS: Worker[] = [...range(11, 12).map((i) => W(i, "02")), ...range(1, 6).map((i) => W(i, "01")), ...range(21, 26).map((i) => W(i, "07"))];
const EXPECTED_STOCK = { [CDD]: true, [CDI]: true, [N07]: false };

describe("stocks par nature (fin de mois, seuil 5) : mêmes groupes et mêmes statuts sur les Effectifs mensuels et sous le filtre Nature", () => {
  const data = build(STOCK_WORKERS, "2025-07", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: SPACE }), openMonths: [] };
  const ctx = ctxOf(kpi, [], SPACE);

  it("groupes de fin juin 2026 (splits.ts) : CDD 2, CDI 6, 07 6 personnes, chaque contrat une fois ; colonne : CDD masqué, CDI secondaire, 07 affiché", () => {
    const items = headcountItems(data, monthEnd("2026-06"), countedOpts(kpi), "nature")!;
    expect(items).toHaveLength(14);
    expect(new Set(items.map((x) => x.contract)).size).toBe(14);
    const by = (g: string) => new Set(items.filter((x) => x.group === g).map((x) => x.person)).size;
    expect({ [CDD]: by(CDD), [CDI]: by(CDI), [N07]: by(N07) }).toEqual({ [CDD]: 2, [CDI]: 6, [N07]: 6 });
  });

  it("Effectifs mensuels, inscrits et ETP × nature : chaque mois CDD et CDI n.d. (effectif et ETP ensemble), 07 affiché (6 ; 6,00 ETP)", async () => {
    for (const mesure of ["inscrit", "etp"]) {
      const e = await loadEffectifs("demo", "w1", kpi, { mesure, axe: "contrat", version: "reel", annee: "2026" });
      for (const m of monthRange("2026-01", "2026-06")) expect(effHidden(e, m), `${mesure} ${m}`).toEqual(EXPECTED_STOCK);
      if (e.grid.kind !== "value") throw new Error("grille attendue");
      expect(e.grid.cell(N07, "2026-06"), mesure).toEqual({ kind: "value", v: mesure === "etp" ? 60000 : 6 });
      expect(e.grid.cell(CDI, "2026-06"), mesure).toEqual({ kind: "nd", reason: R5 });
      expect(e.grid.total("2026-06"), mesure).toEqual({ kind: "value", v: mesure === "etp" ? 140000 : 14 });
    }
  });

  it("KPI RH, filtre Nature : CDD et CDI gardés (raison du seuil), 07 affiché ; l'ordre de la liste des natures ne change rien", () => {
    const guard = (n: string) => ready(ctx, { nature: n, fin: "2026-06" }).guard;
    expect(Object.fromEntries(SPACE.map((n) => [splitLabel("nature", n), guard(n) !== null]))).toEqual(EXPECTED_STOCK);
    expect(guard("01")).toEqual({ cause: "seuil", reason: R5 });
    for (const natures of [["01", "02", "07"], ["07", "01", "02"], ["02", "07", "01"]]) {
      const g = (n: string) => scopeGuard({ input: { ...kpi, scope: { nature: n } }, months: ["2026-06"], establishments: [], natures, confidentialite: set(5) });
      expect([g("02") !== null, g("01") !== null, g("07") !== null], natures.join(",")).toEqual([true, true, false]);
    }
  });
});

// =====================================================================================================================================
// 3. Établissements : flux (entrées) et stocks, Effectifs mensuels (axe Établissement) et filtre Établissement de KPI RH
// =====================================================================================================================================
//
// DSN fictives de juillet 2025 à juin 2026, trois établissements A (SIRET 000000000 00011), B (… 00022), C (… 00033), tous les contrats
// en CDI ; liste de l'espace : C, A, B. Base depuis le 01/01/2025 : A 6, B 2, C 6. Entrées : avril A 2, B 1, C 6 ; mai A 5, B 1, C 5.
// Ordre canonique des libellés (identifiants) : A < B < C. Seuil 5.
//   Fin mars (stock) : B (2) masqué ; A (6) et C (6) à égalité : A masqué à son tour (8 ≥ 5) ; C affiché.
//   Entrées d'avril : A (2) et B (1) masqués, 3 < 5 ; C (6) masqué à son tour → les trois n.d.
//   Entrées de mai : B (1) masqué ; A (5) et C (5) à égalité : A masqué à son tour (6 ≥ 5) ; C affiché.
// Avant : la garde suivait l'ordre de la liste (C d'abord) et masquait C en affichant A.
const A = "00000000000011";
const B = "00000000000022";
const C = "00000000000033";
const ETAB_WORKERS: Worker[] = [
  ...range(1, 6).map((i) => W(i, "01", "2025-01-01", "00011")),
  ...range(11, 12).map((i) => W(i, "01", "2025-01-01", "00022")),
  ...range(21, 26).map((i) => W(i, "01", "2025-01-01", "00033")),
  ...[7, 8].map((i) => W(i, "01", `2026-04-0${i - 6}`, "00011")),
  W(13, "01", "2026-04-03", "00022"),
  ...range(27, 32).map((i) => W(i, "01", `2026-04-${String(i - 23).padStart(2, "0")}`, "00033")),
  ...range(41, 45).map((i) => W(i, "01", `2026-05-0${i - 40}`, "00011")),
  W(14, "01", "2026-05-06", "00022"),
  ...range(51, 55).map((i) => W(i, "01", `2026-05-${String(i - 44).padStart(2, "0")}`, "00033")),
];

describe("établissements (seuil 5) : flux et stocks, mêmes statuts sur les Effectifs mensuels et sous le filtre Établissement", () => {
  const data = build(ETAB_WORKERS, "2025-07", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: ["01"] }), openMonths: [] };
  const LIST = [C, A, B];
  const expectedFlux = { "2026-04": { [A]: true, [B]: true, [C]: true }, "2026-05": { [A]: true, [B]: true, [C]: false } };

  it("entrées : Effectifs mensuels (entrées × établissement) et garde du filtre (flowGuard) donnent les mêmes cellules n.d.", async () => {
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "entrees", axe: "etablissement", version: "reel", annee: "2026" });
    expect(effValues(e, "2026-04")).toEqual({ [A]: 2, [B]: 1, [C]: 6 });
    expect(effValues(e, "2026-05")).toEqual({ [A]: 5, [B]: 1, [C]: 5 });
    for (const [m, exp] of Object.entries(expectedFlux)) {
      expect(effHidden(e, m), m).toEqual(exp);
      const filter = Object.fromEntries(LIST.map((x) => [x, flowGuard({ base: kpi, scope: { establishments: [x] }, months: [m], establishments: LIST, natures: ["01"], seuil: 5 })!.months.get(m)?.entries !== undefined]));
      expect(filter, m).toEqual(exp);
    }
  });

  it("stocks de fin mars 2026 : Effectifs mensuels (inscrits × établissement) et garde du filtre (scopeGuard) : A et B n.d., C affiché", async () => {
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "inscrit", axe: "etablissement", version: "reel", annee: "2026" });
    expect(effValues(e, "2026-03")).toEqual({ [A]: 6, [B]: 2, [C]: 6 });
    expect(effHidden(e, "2026-03")).toEqual({ [A]: true, [B]: true, [C]: false });
    const guard = (x: string) => scopeGuard({ input: { ...kpi, scope: { establishments: [x] } }, months: ["2026-03"], establishments: LIST, natures: ["01"], confidentialite: set(5) });
    expect(Object.fromEntries(LIST.map((x) => [x, guard(x) !== null]))).toEqual({ [A]: true, [B]: true, [C]: false });
    expect(guard(A)).toEqual({ cause: "seuil", reason: R5 });
  });
});

// =====================================================================================================================================
// 4. Groupes divergents : la grille des Effectifs mensuels (budget/monthly.ts) range par la nature ACTUELLE du contrat
// =====================================================================================================================================
//
// DSN fictives de janvier à juin 2026 : CDI K-1 … K-6 et CDD K-11 … K-16 depuis le 01/01/2025 ; K-30 entre le 01/02/2026, déclaré en
// CDD (02) en février et mars, puis en CDI (01) à partir d'avril (transformation du même contrat). Entrée de février : nature du
// mouvement CDD (celle que comptent KPI RH et la croisée) ; la grille la range en CDI (nature actuelle du contrat). Fin février et
// fin mars : K-30 est un CDD pour les filtres de KPI RH, un CDI pour la grille. Ces colonnes ne sont pas celles des autres écrans : elles
// ne sont pas dénombrées, chaque cellule non nulle ou vide est n.d. « non vérifiable » (jamais une répartition différente affichée).
// Janvier, avril → juin : mêmes groupes ; CDI 6 ou 7 et CDD 6 personnes, rien n'est masqué.
const TRANSFO: Worker[] = [...range(1, 6).map((i) => W(i, "01")), ...range(11, 16).map((i) => W(i, "02")), { i: 30, start: "2026-02-01", nic: "00011", nature: (m) => (m < "2026-04" ? "02" : "01") }];

describe("groupes divergents (DSN : nature transformée) : la colonne des Effectifs mensuels n'est pas dénombrée", () => {
  const data = build(TRANSFO, "2026-01", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: ["01", "02"] }), openMonths: [] };

  it("entrées de février : KPI RH et croisée comptent un CDD, la grille un CDI ; la colonne de février est non vérifiable", async () => {
    expect(Object.keys(flowCounts(movementItems(monthMovements(kpi, "2026-02"), "entry", "nature")))).toEqual([CDD]);
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "entrees", axe: "contrat", version: "reel", annee: "2026" });
    // Seule entrée de l'année : la grille n'a qu'un groupe, CDI (1) ; sans la règle, CDI = 1 se lirait face au filtre CDD (1) et CDI (0).
    expect(effValues(e, "2026-02")).toEqual({ [CDI]: 1 });
    if (e.grid.kind !== "value") throw new Error("grille attendue");
    expect(e.grid.cell(CDI, "2026-02")).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
  });

  it("inscrits fin février et fin mars : non vérifiables ; janvier, avril → juin : affichés (mêmes groupes que les filtres)", async () => {
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "inscrit", axe: "contrat", version: "reel", annee: "2026" });
    if (e.grid.kind !== "value") throw new Error("grille attendue");
    for (const m of ["2026-02", "2026-03"]) for (const g of [CDI, CDD]) expect(e.grid.cell(g, m), `${g} ${m}`).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
    for (const m of ["2026-01", "2026-04", "2026-05", "2026-06"]) expect(effHidden(e, m), m).toEqual({ [CDI]: false, [CDD]: false });
    expect(effValues(e, "2026-04")).toEqual({ [CDI]: 7, [CDD]: 6 });
    // Les filtres de KPI RH rangent K-30 en CDD fin mars (nature déclarée ce mois-là).
    const items = headcountItems(data, monthEnd("2026-03"), countedOpts(kpi), "nature")!;
    expect(items.filter((x) => x.group === CDD)).toHaveLength(7);
  });
});
