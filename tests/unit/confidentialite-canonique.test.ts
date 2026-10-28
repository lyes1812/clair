import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEffectifs } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { loadCategoryMonths } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { DEFAULT_CATEGORY_NATURES, type ContractCategories } from "@/lib/budget/categories";
import { hireKey } from "@/lib/budget/engine";
import { monthlyGrid, type Grid } from "@/lib/budget/monthly";
import { confidentialiteReason, isHidden, linkFromReferential, type ConfidentialiteSetting, type MaskStatus } from "@/lib/confidentialite";
import { canonicalCompare, maskColumn, stockColumn, stockGroups, windowStatus } from "@/lib/confidentialite/columns";
import { projectedCell, projectedGroupCell } from "@/lib/confidentialite/groups";
import { croiseeLink } from "@/lib/croisee/confidentialite";
import { monthEnd } from "@/lib/dates";
import { monthPayroll, withService, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { maskServiceRows, maskServiceWindows, serviceGuardOnWindows, serviceMonthMask, serviceRows } from "@/lib/payroll/service-rows";
import { headcountAt } from "@/lib/rh/headcount";
import { countedOpts, monthWindow } from "@/lib/rh/kpi/period";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { axisGroup, maskedAxis, type GridsIn } from "@/lib/viz/croisee-effectifs";
import { serviceRowsIn } from "@/lib/viz/croisee-masse";
import { maskCascade } from "@/lib/viz/ecart";
import { gridMask, type GridIn } from "@/lib/viz/kpi";
import { dsnBytes, type DsnDeclarationSpec } from "./helpers/edge-cases";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnBuild } from "./helpers/rh";

// Statut CANONIQUE d'une cellule publiée (lot 12, relecture des fuites entre écrans) : la même cellule reçoit le même statut quel que
// soit l'écran qui la publie, la fenêtre choisie et l'ordre d'affichage ; sinon une cellule masquée ici se lit là et se reconstitue
// par différence. Cas écrits à la main repris des relecteurs, sur des données entièrement fictives (DSN fictive, journal fictif).

// --- Doubles : seuil de l'espace, journal de paie, catégories (table par défaut, corrections par contrat), scénarios ---------------
const mocks = vi.hoisted(() => ({
  conf: { value: { kind: "absent" } as unknown },
  journal: { value: null as unknown },
  overrides: { value: {} as Record<string, string> },
}));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => ({ input: mocks.journal.value, etp: (months: string[]) => months.map((month) => ({ month, etp4: null, reason: "ETP par service non lu (test)" })) }),
}));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => mocks.overrides.value,
}));
vi.mock("@/lib/budget/store", async (orig) => ({ ...(await orig<typeof import("@/lib/budget/store")>()), getScenario: async () => null, listScenarios: async () => [], listBudgets: async () => [] }));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R = (n: number) => confidentialiteReason(n);

// --- Référentiel fictif : une DSN de juin 2026, 18 salariés (K-1 … K-18), un contrat chacun, nature 01 (CDI, compté), début 2026-01-01.
// Quotité (référence 151,67 h) : K-1 1,00 ; K-2 1,00, K-3 et K-4 0,75 (113,75 h) ; K-5 … K-8 0,50 (75,84 h) ; K-9 … K-18 1,00.
const QUOTA: Record<number, string> = { 3: "113.75", 4: "113.75", 5: "75.84", 6: "75.84", 7: "75.84", 8: "75.84" };
const spec: DsnDeclarationSpec = {
  month: "2026-06",
  people: Array.from({ length: 18 }, (_, k) => {
    const i = k + 1;
    return { nir: `29901751${String(100 + i).padStart(5, "0")}`, employeeNumber: `E-${i}`, contracts: [{ number: `K-${i}`, start: "2026-01-01", quota: QUOTA[i] ?? "151.67", gross: "1000.00" }] };
  }),
};
const data = dsnBuild([{ bytes: dsnBytes(spec), filename: "2026-06-fictive.dsn" }]);
const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES), openMonths: [] };
const linkMS = linkFromReferential(data); // Masse salariale (synthese-data) et KPI RH
const linkCX = croiseeLink(data); // croisée (jetons de personne)

// --- Journal fictif ----------------------------------------------------------------------------------------------------------
let n = 0;
const line = (month: string, debit: number, credit: number, contractId: string, svc: string): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`,
  month,
  accountId: "641100",
  accountName: "Salaires",
  debitCents: debit,
  creditCents: credit,
  contractId,
  analytic: [{ type: "Service", code: svc, value: svc }],
});
const journalOf = (lines: LedgerLine[], months: string[]): JournalInput => ({ lines, months, openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" });
const K = (i: number) => `K-${i}`;
const MONTHS6 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

beforeEach(() => {
  mocks.conf.value = { kind: "absent" };
  mocks.journal.value = null;
  mocks.overrides.value = {};
});

describe("référentiel fictif : chaque contrat du journal est relié à une personne distincte", () => {
  it("18 contrats, 18 personnes ; présents fin juin 2026", () => {
    expect(new Set([...Array(18)].map((_, k) => linkMS.get(K(k + 1)))).size).toBe(18);
    const h = headcountAt(data, monthEnd("2026-06"), countedOpts(kpi));
    expect(h.kind).toBe("exact");
    if (h.kind === "exact") expect(h.contractKeys).toHaveLength(18);
  });
});

// --- (a) Masse d'un service par mois : Masse salariale (période choisie) et KPI RH › Effectifs mensuels (année) ------------------
// Seuil 5. S1 : janvier K-1 seul (P1), 100,00 € ; février → juin K-1 … K-5 (5 personnes), 500,00 € par mois (avril 400,00 €).
// S2 : K-6 … K-15 (10 personnes), 1 000,00 € par mois. Statut canonique, colonne de chaque mois (total de l'entreprise publié) :
// janvier : S1 (1 < 5) masqué ; S2 masqué à son tour (ensemble 11 personnes) ; février → juin : S1 (5) et S2 (10) affichés.
// Toute fenêtre qui contient janvier (période janvier → mars, cumul de l'année) est n.d. pour S1 et S2 ; janvier de S1 ne se lit nulle
// part : seule la somme S1 + S2 de janvier (total du mois, 1 100,00 €) est publiée. Avant le lot 12 révisé, la Masse salariale sur
// janvier → mars masquait février (relation « mois → période ») et l'affichait sur l'année : janvier = 1 100 − 500 − 500 = 100 €.
describe("(a) masse par service × mois : mêmes statuts sur la Masse salariale (janvier → mars) et KPI RH › Effectifs mensuels (année)", () => {
  const S1v: Record<string, number> = { "2026-01": 10000, "2026-02": 50000, "2026-03": 50000, "2026-04": 40000, "2026-05": 50000, "2026-06": 50000 };
  const lines: LedgerLine[] = [];
  for (const m of MONTHS6) {
    const s1 = m === "2026-01" ? [1] : [1, 2, 3, 4, 5];
    for (const i of s1) lines.push(line(m, S1v[m] / s1.length, 0, K(i), "S1"));
    for (let i = 6; i <= 15; i++) lines.push(line(m, 10000, 0, K(i), "S2"));
  }
  const journal = journalOf(lines, MONTHS6);
  const expected: Record<string, [MaskStatus, MaskStatus]> = {
    "2026-01": ["masked", "secondary"],
    ...Object.fromEntries(MONTHS6.slice(1).map((m) => [m, ["shown", "shown"]])),
  };

  it("colonne canonique de chaque mois (serviceMonthMask) : janvier S1 masqué, S2 secondaire ; les autres mois affichés", () => {
    for (const m of MONTHS6) {
      const col = serviceMonthMask(journal, m, linkMS, 5);
      expect([col.get("S1"), col.get("S2")], m).toEqual(expected[m]);
    }
  });

  it("Masse salariale › Services (janvier → mars), croisée 05 et toute autre fenêtre : les mois portent les statuts canoniques ; la période qui contient janvier est n.d.", () => {
    for (const months of [["2026-01", "2026-02", "2026-03"], MONTHS6, ["2026-01"], ["2026-02", "2026-03"]]) {
      const rows = maskServiceRows(serviceRows(journal, months, []), linkMS, set(5));
      for (const svc of ["S1", "S2"]) {
        const r = rows.find((x) => x.value === svc)!;
        const i = svc === "S1" ? 0 : 1;
        expect(r.cur.months.map((x) => (x.kind === "value" ? "shown" : x.nd.reason)), `${svc} ${months.join(",")}`).toEqual(months.map((m) => (expected[m][i] === "shown" ? "shown" : R(5))));
        // Fenêtre : n.d. (raison du seuil) dès qu'un de ses mois est masqué, sinon la somme de ses mois publiés.
        if (months.includes("2026-01")) expect(r.cur).toMatchObject({ kind: "nd", nd: { reason: R(5) } });
        else expect(r.cur.kind).toBe("value");
      }
      // Croisée 05 (lien de la croisée, jetons de personne) : mêmes cellules.
      const cx = serviceRowsIn(serviceRows(journal, months, []), linkCX, set(5));
      expect(cx.map((x) => [x.value, x.cur.kind])).toEqual(rows.map((x) => [x.value, x.cur.kind]));
    }
    expect(serviceGuardOnWindows(journal, [["2026-02", "2026-03"]], "S1", linkCX, set(5))).toBeNull();
    expect(serviceGuardOnWindows(journal, [["2026-01", "2026-02", "2026-03"]], "S1", linkCX, set(5))).toEqual({ cause: "seuil", reason: R(5) });
  });

  it("KPI RH › Effectifs mensuels (masse × service, 2026) : mêmes statuts mois par mois, cumuls n.d. ; janvier ne se reconstitue pas", async () => {
    mocks.conf.value = set(5);
    mocks.journal.value = journal;
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "masse", axe: "service", version: "reel", annee: "2026" });
    if (e.grid.kind !== "value" || e.raw.kind !== "value" || !e.mask) throw new Error("grille attendue");
    expect(e.raw.groups).toEqual(["S1", "S2"]);
    for (const m of MONTHS6) {
      expect(e.mask.months.get(m), m).toEqual(expected[m]);
      // Valeurs des cellules : celles du moteur de paie (monthPayroll du journal restreint au service), à l'euro près.
      for (const s of ["S1", "S2"]) {
        const mp = monthPayroll(withService(journal, s), m);
        expect(e.raw.cell(s, m)).toEqual({ kind: "value", v: mp.kind === "value" ? mp.masse : NaN });
      }
    }
    expect(e.mask.share).toEqual(["secondary", "secondary"]);
    // Cellules publiées par l'un ou l'autre écran : aucune ne donne janvier de S1.
    const shown = (s: string, m: string) => e.grid.kind === "value" && e.grid.cell(s, m).kind === "value";
    expect(shown("S1", "2026-01") || shown("S2", "2026-01")).toBe(false);
    expect(MONTHS6.slice(1).every((m) => shown("S1", m) && shown("S2", m))).toBe(true);
  });

  it("l'ordre dans lequel un écran liste les services ne change aucun statut", () => {
    const win = (s: string) => ({ input: withService(journal, s), windows: [serviceRows(journal, MONTHS6, []).find((r) => r.value === s)!.cur] });
    const ab = maskServiceWindows([win("S1"), win("S2")], linkMS, 5);
    const ba = maskServiceWindows([win("S2"), win("S1")], linkMS, 5);
    expect(ab[0]).toEqual(ba[1]);
    expect(ab[1]).toEqual(ba[0]);
  });
});

// --- (b) Stocks de fin de mois par catégorie : KPI RH › Effectifs mensuels (ETP et inscrits), Suivi, croisée 02 ------------------
// Seuil 3, fin juin 2026 (catégories corrigées contrat par contrat) : M = CDD, K-1 (1 personne, 1,00 ETP) ; X = Apprenti, K-2 … K-4
// (3 personnes, 2,50 ETP) ; Y = Stagiaire, K-5 … K-8 (4 personnes, 2,00 ETP) ; Z = CDI, K-9 … K-18 (10 personnes, 10,00 ETP). Total
// publié 18 inscrits, 15,50 ETP. Passe partagée (stockColumn), valeur d'ordre = l'effectif : CDD (1) masqué ; Apprenti (3, plus petit
// effectif qui apporte des personnes) masqué à son tour (ensemble 4 ≥ 3) ; Stagiaire et CDI affichés, effectif et ETP ensemble.
// Avant : les Effectifs mensuels en ETP ordonnaient par l'ETP et masquaient Stagiaire (2,00) au lieu d'Apprenti (2,50) ; avec le Suivi
// qui affichait Stagiaire, CDD = 15,50 − 2,00 − 10,00 − 2,50 = 1,00 ETP.
describe("(b) ETP et inscrits de fin de mois par catégorie : mêmes statuts dans les trois écrans", () => {
  const CAT: ContractCategories = { [K(1)]: "cdd", [K(2)]: "apprenti", [K(3)]: "apprenti", [K(4)]: "apprenti", [K(5)]: "stagiaire", [K(6)]: "stagiaire", [K(7)]: "stagiaire", [K(8)]: "stagiaire" };
  const HIDDEN = { Apprenti: true, CDD: true, CDI: false, Stagiaire: false };
  const ETP = { Apprenti: 25000, CDD: 10000, CDI: 100000, Stagiaire: 20000 };

  it("KPI RH › Effectifs mensuels : mesures ETP et inscrits, axe catégorie, juin 2026", async () => {
    mocks.conf.value = set(3);
    mocks.overrides.value = CAT;
    for (const mesure of ["etp", "inscrit"]) {
      const e = await loadEffectifs("demo", "w1", kpi, { mesure, axe: "categorie", version: "reel", annee: "2026" });
      if (e.grid.kind !== "value" || e.raw.kind !== "value" || !e.mask) throw new Error("grille attendue");
      const st = e.mask.months.get("2026-06")!;
      expect(Object.fromEntries(e.raw.groups.map((g, i) => [g, isHidden(st[i])])), mesure).toEqual(HIDDEN);
      if (mesure === "etp") expect(Object.fromEntries(e.raw.groups.map((g) => [g, (e.raw as Extract<Grid, { kind: "value" }>).cell(g, "2026-06")]))).toEqual(Object.fromEntries(Object.entries(ETP).map(([g, v]) => [g, { kind: "value", v }])));
    }
  });

  it("Suivi › « Effectif et ETP par catégorie » : mêmes catégories n.d. (effectif et ETP ensemble)", async () => {
    mocks.overrides.value = CAT;
    const c = await loadCategoryMonths(kpi, monthWindow("2026-06"), "w1", set(3));
    const june = c.months[0];
    if (june.kind !== "value") throw new Error("mois attendu");
    const label: Record<string, string> = { cdi: "CDI", cdd: "CDD", apprenti: "Apprenti", stagiaire: "Stagiaire" };
    expect(Object.fromEntries(c.keys.map((k) => [label[k], june.byCategory[k]?.kind === "nd"]))).toEqual(HIDDEN);
    expect(june.byCategory.stagiaire).toEqual({ kind: "value", headcount: 4, etp4: 20000 });
    expect(june.byCategory.cdd).toEqual({ kind: "nd", reason: R(3) });
    expect(june.total).toEqual({ headcount: 18, etp4: 155000 });
  });

  it("croisée 02 « Où sont les effectifs » (grilles et groupes formés comme loadEffectifsInput) : mêmes cellules n.d., inscrits et ETP", () => {
    const real = { kpi, journal: null, natures: DEFAULT_CATEGORY_NATURES, overrides: CAT };
    const grid = (measure: "inscrit" | "etp", year: string) => monthlyGrid({ measure, axis: "categorie", year, real, scenario: null });
    const byKey = new Map(data.contracts.map((c) => [c.contractKey, c]));
    const h = headcountAt(data, monthEnd("2026-06"), countedOpts(kpi));
    if (h.kind !== "exact") throw new Error("effectif exact attendu");
    const sizes = stockGroups(h.contractKeys.map((k) => byKey.get(k)!).map((c) => ({ group: axisGroup(c, "categorie", DEFAULT_CATEGORY_NATURES, CAT), contract: c.contractKey, person: linkCX.get(c.externalId) ?? null })));
    const g: GridsIn = { axis: "categorie", inscrit: { cur: grid("inscrit", "2026"), prev: grid("inscrit", "2025") }, etp: { cur: grid("etp", "2026"), prev: grid("etp", "2025") }, sizes: { cur: sizes, prev: null } };
    const ax = maskedAxis(g, ["Apprenti", "CDD", "CDI", "Stagiaire"], "2026-06", "2025-06", 3);
    const nd = (c: unknown) => typeof c === "object" && c !== null && "nd" in c;
    expect(Object.fromEntries(ax.rows.map((r) => [r.group, nd(r.cells[0])]))).toEqual(HIDDEN);
    expect(Object.fromEntries(ax.rows.map((r) => [r.group, nd(r.cells[3])]))).toEqual(HIDDEN);
    expect(ax.rows.find((r) => r.group === "Stagiaire")!.cells[3]).toBe(20000);
    expect(ax.foot[3]).toBe(155000);
  });

  it("passe partagée (stockColumn) : l'effectif ordonne, jamais l'ETP ; l'ordre des groupes reçus ne change rien", () => {
    const G = (n: number, from: number) => ({ persons: Array.from({ length: n }, (_, i) => `p${from + i}`), unlinked: 0, contracts: n });
    const groups = { CDD: G(1, 1), Apprenti: G(3, 2), Stagiaire: G(4, 5), CDI: G(10, 9) };
    const reversed = Object.fromEntries(Object.entries(groups).reverse());
    const st = stockColumn(groups, 3);
    expect(Object.fromEntries(st)).toEqual({ Apprenti: "secondary", CDD: "masked", CDI: "shown", Stagiaire: "shown" });
    expect(Object.fromEntries(stockColumn(reversed, 3))).toEqual(Object.fromEntries(st));
  });
});

// --- (c) Masse négative d'un service : valeur absolue partout (seuil 3, janvier 2026) ------------------------------------------
// S1 : K-1 (1 personne) 1 500,00 € ; S2 : K-2 … K-4 (3 personnes) 3 × 150,00 € et un rappel négatif de −1 000,00 € sur K-2 = −550,00 € ;
// S3 : K-5 … K-7 (3 personnes) 3 × 150,00 € = 450,00 € ; S4 : K-8 … K-11 (4 personnes) 4 × 3 000,00 €. S1 masqué ; secondaire : la
// plus petite masse en valeur absolue qui apporte des personnes, S3 (450 < 550). Avant, les Effectifs mensuels ordonnaient en valeur
// signée et masquaient S2 (−550 < 450) : S1 = total − S2 (Masse salariale) − S3 (Effectifs mensuels) − S4.
describe("(c) masse négative : même statut par Services et par KPI RH › Effectifs mensuels", () => {
  const lines: LedgerLine[] = [
    line("2026-01", 150000, 0, K(1), "S1"),
    ...[2, 3, 4].map((i) => line("2026-01", 15000, 0, K(i), "S2")),
    line("2026-01", 0, 100000, K(2), "S2"),
    ...[5, 6, 7].map((i) => line("2026-01", 15000, 0, K(i), "S3")),
    ...[8, 9, 10, 11].map((i) => line("2026-01", 300000, 0, K(i), "S4")),
  ];
  const journal = journalOf(lines, ["2026-01"]);
  const expected = { S1: "masked", S2: "shown", S3: "secondary", S4: "shown" };
  it("Masse salariale › Services et croisée 05", () => {
    const rows = maskServiceRows(serviceRows(journal, ["2026-01"], []), linkMS, set(3));
    expect(rows.find((r) => r.value === "S2")!.cur).toMatchObject({ kind: "value", masse: -55000 });
    const ms = maskServiceWindows(serviceRows(journal, ["2026-01"], []).map((r) => ({ input: r.input, windows: [r.cur] })), linkMS, 3);
    expect(Object.fromEntries(serviceRows(journal, ["2026-01"], []).map((r, i) => [r.value, ms[i][0].months[0]]))).toEqual(expected);
    expect(Object.fromEntries(rows.map((r) => [r.value, r.cur.kind]))).toEqual({ S1: "nd", S2: "value", S3: "nd", S4: "value" });
  });
  it("KPI RH › Effectifs mensuels (masse × service)", async () => {
    mocks.conf.value = set(3);
    mocks.journal.value = journal;
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "masse", axe: "service", version: "reel", annee: "2026" });
    if (e.raw.kind !== "value" || !e.mask) throw new Error("grille attendue");
    expect(Object.fromEntries(e.raw.groups.map((g, i) => [g, e.mask!.months.get("2026-01")![i]]))).toEqual(expected);
    expect(e.raw.cell("S2", "2026-01")).toEqual({ kind: "value", v: -55000 });
  });
  it("cellule d'un flux de gridMask (mois projeté) : valeur absolue, comme groupCell", () => {
    const g: GridIn = { months: ["2026-09"], groups: ["S1", "S2", "S3", "S4"], cell: (s) => ({ kind: "value", v: { S1: 150000, S2: -55000, S3: 45000, S4: 1200000 }[s]! }), total: () => ({ kind: "value", v: 1340000 }) };
    const who = { S1: [1], S2: [2, 3, 4], S3: [5, 6, 7], S4: [8, 9, 10, 11] } as Record<string, number[]>;
    const mask = gridMask(g, (s) => ({ persons: who[s].map((i) => `p${i}`), unlinked: 0 }), 3, false);
    expect(mask.months.get("2026-09")).toEqual(["masked", "shown", "secondary", "shown"]);
  });
});

// --- (d) Embauches prévisionnelles dans le cas « impossible » : toute la relation est n.d. --------------------------------------
describe("(d) embauches prévues seules : affichées, jamais protectrices, masquées avec toute la relation quand elle ne peut pas être protégée", () => {
  it("une seule fonction de cellule (projectedGroupCell) : taille 0, sans membre, jamais exempte", () => {
    expect(projectedCell([hireKey("h1")], linkCX, 5, -3300)).toEqual({ size: 0, value: 3300, members: [] });
    expect(projectedGroupCell({ persons: [], unlinked: 0, hires: 2 }, 5, 20000)).toEqual({ size: 0, value: 20000, members: [] });
  });
  it("Analyse des écarts (cascade, seuil 5) : entrées nouvelles = une embauche (+0,33), sorties = une seule personne réelle (−0,50) ⇒ tous les paliers n.d.", () => {
    // Avant : [shown, secondary, masked, secondary, secondary] ; l'écart total publié moins les entrées affichées (+0,33) redonnait −0,50,
    // la contribution du seul sortant.
    const steps = [
      { id: "entrees-new" as const, label: "Entrées nouvelles", etp4: 3300, people: [{ key: hireKey("h1"), etp4: 3300 }] },
      { id: "entrees-report" as const, label: "Effet report", etp4: 0, people: [] },
      { id: "sorties" as const, label: "Sorties", etp4: -5000, people: [{ key: "dsn:K-1", etp4: -5000 }] },
      { id: "sorties-deport" as const, label: "Effet déport", etp4: 0, people: [] },
      { id: "etp-change" as const, label: "Changement d'ETP", etp4: 0, people: [] },
    ];
    const link = new Map([["dsn:K-1", "personne-1"]]);
    const m = maskCascade({ steps, byMonth: [steps] }, link, 5); // période d'un mois : son seul mois est elle-même
    expect(m.status).toEqual(["secondary", "secondary", "masked", "secondary", "secondary"]);
    expect(m.reasons).toEqual(Array(5).fill(R(5)));
  });
  // Croisée 06 : « Déjà comptabilisés » et « Prévus » sont des totaux de l'entreprise publiés ailleurs (tuile « Coûts identifiés »,
  // Hypothèses › Atterrissage) ; ils ne sont plus masqués (décision par défaut du lot 12) : voir croisee-budget.test.ts.
});

// --- Règles communes de la colonne canonique ------------------------------------------------------------------------------------
describe("colonne canonique : ordre des groupes, groupes vides, fenêtres", () => {
  it("ordre : libellés en ordre des points de code, les groupes « reste » en dernier ; à valeur égale, le premier dans cet ordre est retenu", () => {
    expect(["Non ventilé", "b", "Statut n.d.", "B", "a", "Non classé", "Hors salarié"].sort(canonicalCompare)).toEqual(["B", "a", "b", "Hors salarié", "Non classé", "Non ventilé", "Statut n.d."]);
    // A (1 personne) masqué ; B et C apportent chacune 3 personnes pour la même valeur : B, premier dans l'ordre canonique, est retenu
    // quel que soit l'ordre des entrées.
    const cell = (n: number, from: number) => ({ size: n, value: 100, members: Array.from({ length: n }, (_, i) => `p${from + i}`) });
    const entries = [
      { key: "C", label: "C", cell: cell(3, 10) },
      { key: "A", label: "A", cell: cell(1, 1) },
      { key: "B", label: "B", cell: cell(3, 20) },
    ];
    const one = maskColumn(entries, 3, true);
    expect(Object.fromEntries(one)).toEqual({ A: "masked", B: "secondary", C: "shown" });
    expect(Object.fromEntries(maskColumn([...entries].reverse(), 3, true))).toEqual(Object.fromEntries(one));
  });
  it("un groupe vide (taille 0, valeur 0) reste hors de la relation : affiché à 0 même quand toute la colonne est masquée", () => {
    const st = maskColumn([{ key: "A", label: "A", cell: { size: 1, value: 5, members: ["p1"] } }, { key: "B", label: "B", cell: { size: 0, value: 0, members: [] } }], 3, true);
    expect(Object.fromEntries(st)).toEqual({ A: "masked", B: "shown" });
  });
  it("fenêtre déduite de ses mois : sa propre raison si sa valeur est n.d., sinon seuil dès qu'un mois est masqué, non vérifiable si seuls des mois non vérifiables", () => {
    expect(windowStatus(["shown", "masked"], true)).toBe("nd");
    expect(windowStatus(["shown", "secondary"])).toBe("secondary");
    expect(windowStatus(["unverifiable", "masked"])).toBe("secondary");
    expect(windowStatus(["unverifiable", "shown"])).toBe("unverifiable");
    expect(windowStatus(["shown", "shown"])).toBe("shown");
  });
});
