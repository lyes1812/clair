import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEffectifs } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { ecartServiceGuard } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { syntheseOf, type SyntheseReady } from "@/app/e/[slug]/studio-rh/masse-salariale/synthese-data";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { nd, reelVersion, val, type ServiceFilter } from "@/lib/budget/versions";
import { confidentialiteReason, linkFromReferential, type ConfidentialiteSetting, type MaskStatus } from "@/lib/confidentialite";
import { stockColumn } from "@/lib/confidentialite/columns";
import { croiseeLink } from "@/lib/croisee/confidentialite";
import type { EtpMonth, JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { buildContractServiceMap } from "@/lib/payroll/service-map";
import { serviceGuardOnWindows, serviceMonthMask, serviceStockGroups, serviceStockMask } from "@/lib/payroll/service-rows";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { loadEffetsInput } from "@/lib/viz/croisee-budget";
import { serviceSizes } from "@/lib/viz/croisee-effectifs";
import { loadSyntheseInput } from "@/lib/viz/croisee-synthese";
import { dsnBytes, type DsnDeclarationSpec } from "./helpers/edge-cases";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnBuild } from "./helpers/rh";

// ETP de fin de mois d'un service sous le filtre Service (lot 12, constat bloquant de la relecture « cohérence ») : la même cellule,
// l'ETP de fin de mois d'un service pour un mois réel, reçoit le même statut sur tous les écrans qui la publient. KPI RH › Effectifs
// mensuels (ETP × service) et la croisée 02 la masquent par la colonne des STOCKS du mois (stockColumn, valeur d'ordre : l'effectif) ;
// sous le filtre Service, la Synthèse de la Masse salariale (ETP, N-1, coût par ETP, export), l'Écart budgétaire et l'Analyse des écarts
// (ligne ETP des versions réelles), les croisées 01 (coût par ETP-mois) et 08 (ETP des versions) la publient : leur garde unique
// (serviceGuard, serviceGuardOnWindows) lit désormais la colonne de masse ET la colonne des stocks de chaque mois. Cas écrit à la main
// sur des données entièrement fictives (DSN fictive, journal fictif).

// --- Doubles : seuil de l'espace, contexte de paie, catégories, scénarios ---------------------------------------------------------
const mocks = vi.hoisted(() => ({ conf: { value: { kind: "absent" } as unknown }, pay: { value: null as unknown } }));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => mocks.pay.value }));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));
vi.mock("@/lib/budget/store", async (orig) => ({ ...(await orig<typeof import("@/lib/budget/store")>()), getScenario: async () => null, listScenarios: async () => [], listBudgets: async () => [] }));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R5 = confidentialiteReason(5);
const M = "2026-03";

// --- Référentiel fictif : une DSN de mars 2026, 13 salariés (K-1 … K-13), un contrat chacun, nature 01 (CDI), début 2026-01-01.
// Quotité (référence 151,67 h) : K-3 … K-7 121,34 h, soit 121,34 / 151,67 = 0,80003 → 0,8000 ETP ; les autres 151,67 h → 1,0000 ETP.
const B_QUOTA = new Set([3, 4, 5, 6, 7]);
const spec: DsnDeclarationSpec = {
  month: M,
  people: Array.from({ length: 13 }, (_, k) => {
    const i = k + 1;
    return { nir: `29901751${String(200 + i).padStart(5, "0")}`, employeeNumber: `E-${i}`, contracts: [{ number: `K-${i}`, start: "2026-01-01", quota: B_QUOTA.has(i) ? "121.34" : "151.67", gross: "1000.00" }] };
  }),
};
const data = dsnBuild([{ bytes: dsnBytes(spec), filename: "2026-03-fictive.dsn" }]);
const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES), openMonths: [] };
const linkMS = linkFromReferential(data); // Masse salariale et KPI RH (clé de personne)
const linkCX = croiseeLink(data); // croisée et Écart budgétaire (jetons de personne)

// --- Journal fictif de mars 2026 (une ligne de salaire 641100 par contrat, code analytique de l'axe Service) -------------------------
// A : K-1, K-2 (2 personnes), 2 × 2 000,00 € = 4 000,00 € ; ETP fin de mars 2 × 1,0000 = 2,0000.
// B : K-3 … K-7 (5 personnes), 5 × 6 000,00 € = 30 000,00 € ; ETP 5 × 0,8000 = 4,0000.
// C : K-8 … K-13 (6 personnes), 6 × 2 500,00 € = 15 000,00 € ; ETP 6 × 1,0000 = 6,0000.
// Total de l'entreprise : 49 000,00 € ; 13 inscrits ; 12,0000 ETP.
const SVC: Record<string, { ids: number[]; cents: number }> = { A: { ids: [1, 2], cents: 200_000 }, B: { ids: [3, 4, 5, 6, 7], cents: 600_000 }, C: { ids: [8, 9, 10, 11, 12, 13], cents: 250_000 } };
let n = 0;
const lines: LedgerLine[] = Object.entries(SVC).flatMap(([svc, g]) =>
  g.ids.map((i): LedgerLine => ({ key: `${M}#${String(n++).padStart(4, "0")}`, month: M, accountId: "641100", accountName: "Salaires", debitCents: g.cents, creditCents: 0, contractId: `K-${i}`, analytic: [{ type: "Service", code: svc, value: svc }] })),
);
const journal: JournalInput = { lines, months: [M], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };

// Contexte de paie (doublé, base absente) : ETP par service comme src/lib/payroll/context.ts (contributions de etpMonthEnd dont le
// contrat porte, ce mois-là, des lignes du service : buildContractServiceMap).
const serviceMap = buildContractServiceMap(journal.lines, journal.grid, "Service");
const etp = (months: string[], service?: { value: string | null }): EtpMonth[] =>
  months.map((month) => {
    const e = etpMonthEnd(kpi, month);
    if (e.kind !== "exact") return { month, etp4: null, reason: e.kind === "nd" ? e.nd.reason : "ETP en borne basse" };
    if (!service) return { month, etp4: e.etp4, reason: null };
    return { month, etp4: e.contributions.filter((c) => (serviceMap.get(`${month}|${c.externalId}`) ?? null) === service.value).reduce((s, c) => s + c.etp4, 0), reason: null };
  });
const pay = {
  kpi: { collab: { workspace: { id: "w1" }, source: { chosen: "dsn", reason: "Source appliquée." }, state: { kind: "ready" } }, settings: { invalid: [] }, input: kpi },
  source: "payfit",
  grid: { grid: DEFAULT_PREFIXES, origin: "default", updatedAt: null },
  read: { syncId: "s1", startedAt: new Date("2026-04-03T10:00:00Z"), months: [M] },
  unavailable: null,
  input: journal,
  etp,
  axes: ["Service"],
  service: { axis: "Service", origin: "single-axis", updatedAt: null },
  dsn: new Map(),
  etpQualifiers: [],
  compta: async () => ({ source: null, reason: "aucune source comptable retenue", lines: [], months: [], nd: {}, error: false }),
  axisMissing: false,
};

// Contexte de la Masse salariale croisée (chapitres 01 et 08), période mars 2026, N-1 mars 2025, filtre Service.
const absent = { kind: "absent" };
const croisee = (service: string, seuil: number): CroiseeContext =>
  ({
    slug: "demo",
    workspace: { id: "w1" },
    canEdit: false,
    period: { year: 2026, from: "03", to: "03", years: [2026], last: "03", months: [M], notices: [] },
    periodNd: null,
    prevMonths: ["2025-03"],
    labels: { period: "mars 2026", prev: "mars 2025" },
    openMonths: [],
    service: { axis: "Service", value: service, label: service, options: [], reason: null },
    budget: { selected: null, explicit: false, options: [], reason: "aucun budget saisi pour 2026" },
    scenario: { selected: null, explicit: false, options: [], reason: null },
    settings: { seuilsEffectif: absent, margeAlerte: absent, confidentialite: set(seuil), horizonEcheances: absent },
    affichage: "tout",
    state: { service },
    href: () => "/e/demo/studio-rh/masse-salariale/croisee",
    load: { payroll: async () => pay, compta: async () => pay.compta(), scenario: async () => ({ kind: "nd", reason: "aucun scénario" }), persons: async () => linkCX },
  }) as unknown as CroiseeContext;

// Écart budgétaire et Analyse des écarts (même garde, ecartServiceGuard) : version « Réel PayFit 2026 », période mars, filtre Service.
const ecart = (service: string) => {
  const filter: ServiceFilter = { value: service };
  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = etp([m], f);
    return e.etp4 === null ? nd(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const version = reelVersion("reel:2026", "Réel PayFit 2026", "2026", journal, kpi, filter, etpService);
  return { version, loaded: { ctx: { input: journal, kpi: { input: kpi } }, versions: [version], sources: [{ kind: "reel", journal, filter }], months: () => [M], filter } as never };
};

const synthese = (service: string, seuil: number): SyntheseReady => {
  const s = syntheseOf(pay as never, { service, annee: "2026", de: "03", a: "03" }, set(seuil));
  if (s.kind !== "ready") throw new Error(s.kind);
  return s;
};

beforeEach(() => {
  mocks.conf.value = { kind: "absent" };
  mocks.pay.value = pay;
});

describe("référentiel et journal fictifs : ETP de fin de mars par contrat et par service", () => {
  it("13 contrats reliés à 13 personnes ; ETP 2,0000 (A), 4,0000 (B), 6,0000 (C), total 12,0000", () => {
    expect(new Set(Array.from({ length: 13 }, (_, k) => linkMS.get(`K-${k + 1}`))).size).toBe(13);
    const e = etpMonthEnd(kpi, M);
    if (e.kind !== "exact") throw new Error(e.kind);
    expect(e.etp4).toBe(120_000);
    expect(Object.fromEntries(e.contributions.map((c) => [c.externalId, c.etp4]))).toEqual(Object.fromEntries(Array.from({ length: 13 }, (_, k) => [`K-${k + 1}`, B_QUOTA.has(k + 1) ? 8_000 : 10_000])));
    expect(["A", "B", "C"].map((v) => etp([M], { value: v })[0].etp4)).toEqual([20_000, 40_000, 60_000]);
  });
});

// --- Les deux colonnes de mars 2026, seuil 5 ------------------------------------------------------------------------------------
// Colonne de MASSE (serviceMonthMask ; valeur d'ordre : la masse ; total de l'entreprise publié) : A 4 000,00 € (2 pers.), B 30 000,00 €
// (5), C 15 000,00 € (6). A masqué (2 < 5) ; l'ensemble masqué compte 2 personnes : la plus petite valeur affichée, C (15 000,00 €), est
// masquée à son tour (2 + 6 = 8 ≥ 5) ; B affiché.
// Colonne des STOCKS (serviceStockMask ; valeur d'ordre : l'effectif ; effectif et ETP masqués ensemble) : A 2 inscrits, B 5, C 6. A
// masqué ; le plus petit effectif affiché, B (5), est masqué à son tour (2 + 5 = 7 ≥ 5) ; C affiché.
// Sans la colonne des stocks, la Synthèse filtrée sur B publiait 4,0000 ETP ; avec les Effectifs mensuels (C 6,0000 et total 12,0000),
// A = 12,0000 − 4,0000 − 6,0000 = 2,0000 ETP, soit l'ETP de 2 personnes.
describe("colonnes de mars 2026 au seuil 5 : masse et stocks", () => {
  it("colonne de masse : A masqué, B affiché, C secondaire", () => {
    const col = serviceMonthMask(journal, M, linkMS, 5);
    expect(["A", "B", "C"].map((v) => col.get(v))).toEqual(["masked", "shown", "secondary"]);
  });

  it("colonne des stocks : groupes des contributions de l'ETP rangées par le service du journal ; A masqué, B secondaire, C affiché", () => {
    const groups = serviceStockGroups({ kpi, journal }, M, linkMS);
    expect(groups && Object.fromEntries(Object.entries(groups).map(([g, x]) => [g, [x.persons.length, x.unlinked, x.contracts]]))).toEqual({ A: [2, 0, 2], B: [5, 0, 5], C: [6, 0, 6] });
    const col = serviceStockMask({ kpi, journal }, M, linkMS, 5)!;
    expect(["A", "B", "C"].map((v) => col.get(v))).toEqual(["masked", "secondary", "shown"]);
  });

  it("croisée 02 (serviceSizes, jetons de personne) : mêmes groupes, mêmes statuts", () => {
    const e = etpMonthEnd(kpi, M);
    if (e.kind !== "exact") throw new Error(e.kind);
    const sizes = serviceSizes(e.contributions.map((c) => ({ id: c.externalId, person: linkCX.get(c.externalId) ?? null })), (id) => serviceMap.get(`${M}|${id}`) ?? null);
    expect(stockColumn(sizes, 5)).toEqual(serviceStockMask({ kpi, journal }, M, linkMS, 5));
  });

  it("garde : la colonne de masse seule laisse passer B ; avec la colonne des stocks, B est n.d. ; un mois non dénombré (mars 2025) ne compte pas", () => {
    expect(serviceGuardOnWindows(journal, [[M]], "B", linkCX, set(5))).toBeNull();
    expect(serviceGuardOnWindows(journal, [[M]], "B", linkCX, set(5), { kpi, months: [M, "2025-03"] })).toEqual({ cause: "seuil", reason: R5 });
    expect(serviceGuardOnWindows(journal, [[M]], "C", linkCX, set(5), { kpi, months: [M] })).toEqual({ cause: "seuil", reason: R5 }); // colonne de masse
    expect(serviceGuardOnWindows(journal, [[M]], "B", linkCX, set(5), { kpi, months: ["2025-03"] })).toBeNull();
    expect(serviceGuardOnWindows(journal, [[M]], "B", linkCX, set(5), { kpi: null, months: [M] })).toBeNull(); // sans référentiel : aucun ETP publié
    expect(serviceGuardOnWindows(journal, [[M]], "B", linkCX, { kind: "absent" }, { kpi, months: [M] })?.cause).toBe("parametre");
  });
});

// --- Test croisé : l'ETP de B en mars 2026 a le même statut sur tous les écrans --------------------------------------------------
// Seuil 5 : n.d. partout (raison du seuil). Seuil 2 : chaque service compte au moins 2 personnes, rien n'est masqué ; l'ETP de B (4,0000)
// est publié partout, avec le même coût par ETP-mois : 30 000,00 € ÷ 4,0000 ETP-mois = 7 500,00 €.
describe("test croisé : Synthèse filtrée, Écart, Analyse, croisées 01 et 08 et Effectifs mensuels donnent le même statut à l'ETP de B", () => {
  it("seuil 5 : Effectifs mensuels (ETP × service) A n.d., B n.d., C 6,0000 ; Synthèse, Écart, croisées 01 et 08 filtrées sur B : n.d.", async () => {
    mocks.conf.value = set(5);
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "etp", axe: "service", version: "reel", annee: "2026" });
    if (e.grid.kind !== "value" || !e.mask) throw new Error("grille attendue");
    expect(e.grid.groups).toEqual(["A", "B", "C"]);
    expect(e.mask.months.get(M)).toEqual(["masked", "secondary", "shown"] satisfies MaskStatus[]);
    expect(["A", "B", "C"].map((g) => e.grid.kind === "value" && e.grid.cell(g, M))).toEqual([{ kind: "nd", reason: R5 }, { kind: "nd", reason: R5 }, { kind: "value", v: 60_000 }]);
    expect(e.grid.total(M)).toEqual({ kind: "value", v: 120_000 });
    // Statut des Effectifs mensuels = colonne des stocks de la garde.
    const col = serviceStockMask({ kpi, journal }, M, linkMS, 5)!;
    expect(e.mask.months.get(M)).toEqual(["A", "B", "C"].map((g) => col.get(g)));

    // Synthèse de la Masse salariale (écran et export : syntheseOf) filtrée sur B.
    const s = synthese("B", 5);
    expect(s.guard).toEqual({ cause: "seuil", reason: R5 });
    expect(s.etpCur).toEqual([{ month: M, etp4: null, reason: R5 }]);
    expect(s.cost).toEqual({ kind: "nd", nd: { code: "month-nd", reason: R5 } });
    // Le tableau Services (sans filtre) publie la masse de B : sa colonne de masse l'affiche.
    expect(s.services.find((r) => r.value === "B")?.cur.kind).toBe("value");

    // Écart budgétaire et Analyse des écarts (ecartServiceGuard) : la version porte l'ETP de B, la garde le rend n.d.
    const ec = ecart("B");
    expect(ec.version.months.get(M)?.etp4).toEqual({ kind: "value", v: 40_000 });
    expect(ecartServiceGuard(ec.loaded, set(5))).toEqual({ cause: "seuil", reason: R5 });

    // Croisée 01 (coût par ETP-mois du service) : bloc de la paie n.d.
    const c01 = await loadSyntheseInput(croisee("B", 5));
    if (c01.kind !== "value") throw new Error("entrée attendue");
    expect(c01.pay).toMatchObject({ kind: "nd", reason: R5 });
    // Croisée 08 (ETP des versions réelles) : garde du service.
    const c08 = await loadEffetsInput(croisee("B", 5));
    if (c08.kind !== "value") throw new Error("entrée attendue");
    expect(c08.serviceGuard).toEqual({ cause: "seuil", reason: R5 });
  });

  it("seuil 5 : C (masqué par la colonne de masse) et A (masqué dans les deux) sont n.d. sur tous les écrans filtrés", async () => {
    for (const svc of ["A", "C"]) {
      expect(synthese(svc, 5).guard, svc).toEqual({ cause: "seuil", reason: R5 });
      expect(ecartServiceGuard(ecart(svc).loaded, set(5)), svc).toEqual({ cause: "seuil", reason: R5 });
      const c01 = await loadSyntheseInput(croisee(svc, 5));
      expect(c01.kind === "value" && c01.pay.kind, svc).toBe("nd");
      const c08 = await loadEffetsInput(croisee(svc, 5));
      expect(c08.kind === "value" && c08.serviceGuard, svc).toEqual({ cause: "seuil", reason: R5 });
    }
  });

  it("seuil 2 : rien n'est masqué ; B publie 4,0000 ETP partout et le même coût par ETP-mois (7 500,00 €)", async () => {
    mocks.conf.value = set(2);
    const e = await loadEffectifs("demo", "w1", kpi, { mesure: "etp", axe: "service", version: "reel", annee: "2026" });
    if (e.grid.kind !== "value" || !e.mask) throw new Error("grille attendue");
    expect(e.mask.months.get(M)).toEqual(["shown", "shown", "shown"]);
    expect(e.grid.cell("B", M)).toEqual({ kind: "value", v: 40_000 });

    const s = synthese("B", 2);
    expect(s.guard).toBeNull();
    expect(s.etpCur).toEqual([{ month: M, etp4: 40_000, reason: null }]);
    // 30 000,00 € = 3 000 000 centimes ; 3 000 000 × 10 000 / 40 000 = 750 000 centimes = 7 500,00 € par ETP-mois.
    expect(s.cost).toEqual({ kind: "value", costCents: { num: 3_000_000 * 10_000, den: 40_000 }, etpMonths4: 40_000 });

    expect(ecartServiceGuard(ecart("B").loaded, set(2))).toBeNull();

    const c01 = await loadSyntheseInput(croisee("B", 2));
    if (c01.kind !== "value" || c01.pay.kind !== "value") throw new Error("journal attendu");
    expect(c01.pay.cost).toEqual(s.cost);

    const c08 = await loadEffetsInput(croisee("B", 2));
    if (c08.kind !== "value") throw new Error("entrée attendue");
    expect(c08.serviceGuard).toBeNull();
    expect(c08.etp.cur).toEqual({ kind: "value", num: 40_000, den: 10_000 }); // 1 mois : 4,0000 ETP
  });
});
