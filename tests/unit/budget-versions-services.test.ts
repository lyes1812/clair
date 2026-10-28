import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEffectifs } from "@/app/e/[slug]/studio-rh/kpi/effectifs-data";
import { maskProjectedServices } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { project } from "@/lib/budget/engine";
import { flowsOf } from "@/lib/budget/flows";
import { projectedMasseByService } from "@/lib/budget/monthly";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import type { ConfidentialiteSetting, MaskStatus } from "@/lib/confidentialite";
import { croiseeLink } from "@/lib/croisee/confidentialite";

// Mois projetés d'un scénario : le statut d'une cellule masse × service (et effectif × service) est le même sur KPI RH › Effectifs
// mensuels et sur l'Écart budgétaire / l'Analyse des écarts (garde du filtre Service, maskProjectedServices). Revue du lot 12 :
// (1) la colonne de masse de l'Écart suit l'ordre canonique des libellés (maskColumn), jamais l'ordre d'insertion des contributions ;
// (2) les deux écrans rangent la masse sous le service porté par la contribution (projectedMasseByService : le moteur de projection fait
// foi), jamais sous le service de la base figée, qu'un changement d'affectation rend différent. Cas écrits à la main, données fictives :
// scénario 2027 entièrement projeté (mois de référence décembre 2026), salaires sans charges (taux observé 0 %) : coût du mois = salaire ;
// chaque contrat est relié à une personne distincte par un référentiel fictif ; seuil 5.

// --- Doubles : seuil de l'espace, journal absent (aucun mois réel lu en 2027), catégories par défaut, un scénario ---------------------
const mocks = vi.hoisted(() => ({
  conf: { value: { kind: "absent" } as unknown },
  full: { value: null as unknown },
}));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => mocks.conf.value }));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => ({ input: null, etp: (months: string[]) => months.map((month) => ({ month, etp4: null, reason: "ETP par service non lu (test)" })) }),
}));
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));
vi.mock("@/lib/budget/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/store")>()),
  getScenario: async () => mocks.full.value,
  listScenarios: async () => (mocks.full.value ? [{ scenario: (mocks.full.value as { scenario: unknown }).scenario, refMonth: "2026-12" }] : []),
  listBudgets: async () => [],
}));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const conv = { prorata: "calendaire" as const };
const contract = (key: string, service: string | null, salary: number): BaseContract => ({
  contractKey: key, externalId: key, label: key, service, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, nature: "01", category: "cdi",
  base: { salaryCents: salary, refBrutCents: salary, refCotisationsCents: 0 }, baseNd: null,
});
const staff = (prefix: string, service: string | null, n: number, salary: number): BaseContract[] => Array.from({ length: n }, (_, i) => contract(`${prefix}-${i + 1}`, service, salary));

beforeEach(() => {
  mocks.conf.value = { kind: "absent" };
  mocks.full.value = null;
});

// Un scénario fictif : la même projection pour les deux écrans. Écart : statut de chaque service dans les colonnes du mois (masse,
// effectif, entrées) ; KPI RH : grille et statuts de loadEffectifs (masse ou inscrits × service, année 2027).
function scenarioOf(contracts: BaseContract[], hyps: Hypothesis[] = []) {
  const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-12", syncId: "s", readAt: "2027-01-05", contracts, refMasse: 0, refBaseCost: 0, etpNote: null, actuals: [] };
  const proj = project(base, "2027-01", "2027-12", hyps, conv);
  if (proj.kind !== "value") throw new Error(`projection refusée : ${proj.errors.join(" ; ")}`);
  const data = { build: { source: "payfit" }, contracts: contracts.map((c) => ({ contractKey: c.contractKey, externalId: c.externalId, personKey: `P-${c.contractKey}` })) };
  const kpi = { data } as never;
  const pmOf = (month: string) => {
    const pm = proj.months.find((x) => x.month === month);
    if (!pm || pm.kind !== "value") throw new Error("mois projeté n.d.");
    return pm;
  };
  const ecart = (month: string, seuil: number): Record<string, MaskStatus[]> => {
    const flow = flowsOf(base, proj).find((f) => f.month === month);
    return Object.fromEntries([...maskProjectedServices(pmOf(month), flow, croiseeLink(data as never), seuil)].map(([k, st]) => [k ?? "Non ventilé", st]));
  };
  const kpiRh = async (mesure: "masse" | "inscrit", seuil: number) => {
    mocks.conf.value = set(seuil);
    mocks.full.value = {
      scenario: { id: "s27", name: "Révisé 2027", kind: "revise", status: "brouillon", firstMonth: "2027-01", lastMonth: "2027-12", conventions: conv },
      base, baseHash: "h", hypotheses: hyps,
    };
    const e = await loadEffectifs("demo", "w1", kpi, { mesure, axe: "service", version: "scenario:s27", annee: "2027" });
    if (e.raw.kind !== "value" || !e.mask) throw new Error("grille attendue");
    const raw = e.raw;
    const mask = e.mask;
    // Statut et valeur de chaque groupe un mois donné, par libellé.
    const status = (month: string): Record<string, MaskStatus> => Object.fromEntries(raw.groups.map((g, i) => [g, mask.months.get(month)![i]]));
    const value = (month: string): Record<string, number | null> => Object.fromEntries(raw.groups.map((g) => {
      const c = raw.cell(g, month);
      return [g, c.kind === "value" ? c.v : null];
    }));
    return { groups: raw.groups, status, value };
  };
  return { pmOf, ecart, kpiRh };
}

// --- (1) Ordre canonique de la colonne de masse (et d'effectif) d'un mois projeté --------------------------------------------------
// Contrats saisis dans cet ordre : NV-1 … NV-5 (non ventilés, 2 000 € chacun : 10 000 €), S3-1 … S3-5 (10 000 €), S2-1 … S2-5
// (10 000 €), S1-1 (1 000 €). Total publié sans filtre : 31 000 €, 16 inscrits. Seuil 5, janvier 2027 :
// - masse : S1 (1 personne) masqué ; il faut masquer une autre cellule : S2, S3 et « Non ventilé » sont à égalité (10 000 €, 5
//   personnes) ; l'ordre canonique (libellés, « Non ventilé » en dernier) désigne S2 (secondaire) ; ensemble 6 personnes ≥ 5 : S3 et
//   « Non ventilé » affichés. Dans l'ordre d'insertion, « Non ventilé » aurait été masqué à la place de S2 : sous le filtre S2, l'Écart
//   aurait publié 10 000 € pendant que KPI RH les masquait, et l'inverse pour « Non ventilé ».
// - effectif : mêmes égalités (5, 5, 5) ⇒ S1 masqué, S2 secondaire ; entrées : aucune (rien à masquer).
describe("(1) mois projetés : colonne de masse de l'Écart dans l'ordre canonique, mêmes statuts que KPI RH › Effectifs mensuels", () => {
  const contracts = [...staff("NV", null, 5, 200000), ...staff("S3", "S3", 5, 200000), ...staff("S2", "S2", 5, 200000), ...staff("S1", "S1", 1, 100000)];

  it("Écart budgétaire (maskProjectedServices) : S1 masqué, S2 secondaire, S3 et « Non ventilé » affichés, dans les colonnes masse et effectif", () => {
    const s = scenarioOf(contracts);
    expect(s.ecart("2027-01", 5)).toEqual({
      "Non ventilé": ["shown", "shown", "shown"],
      S3: ["shown", "shown", "shown"],
      S2: ["secondary", "secondary", "shown"],
      S1: ["masked", "masked", "shown"],
    });
  });

  it("KPI RH › Effectifs mensuels (masse et inscrits × service, 2027) : mêmes statuts, quel que soit l'ordre de la grille", async () => {
    const s = scenarioOf(contracts);
    const masse = await s.kpiRh("masse", 5);
    // La grille liste « Non ventilé » en tête (ordre alphabétique de l'écran) : le statut n'en dépend pas.
    expect(masse.groups).toEqual(["Non ventilé", "S1", "S2", "S3"]);
    expect(masse.value("2027-01")).toEqual({ "Non ventilé": 1000000, S1: 100000, S2: 1000000, S3: 1000000 });
    expect(masse.status("2027-01")).toEqual({ "Non ventilé": "shown", S1: "masked", S2: "secondary", S3: "shown" });
    const inscrits = await s.kpiRh("inscrit", 5);
    expect(inscrits.value("2027-01")).toEqual({ "Non ventilé": 5, S1: 1, S2: 5, S3: 5 });
    expect(inscrits.status("2027-01")).toEqual({ "Non ventilé": "shown", S1: "masked", S2: "secondary", S3: "shown" });
    // Écart = KPI RH, colonne par colonne.
    const ec = s.ecart("2027-01", 5);
    for (const g of masse.groups) {
      expect(ec[g][0], `masse ${g}`).toBe(masse.status("2027-01")[g]);
      expect(ec[g][1], `effectif ${g}`).toBe(inscrits.status("2027-01")[g]);
    }
  });
});

// --- (2) Changement d'affectation : la masse suit le service porté par la contribution sur les deux écrans ----------------------------
// Contrats : A-1 … A-5 (S1, 2 000 € chacun), B-1 … B-5 (S2, 3 000 €), C-1 … C-7 (S3, 2 000 €). Hypothèse « changement » : A-5 passe
// dans S2 à compter de février 2027 (le moteur lui attribue ses coûts suivants).
// - Janvier : S1 = 10 000 € (5 personnes), S2 = 15 000 € (5), S3 = 14 000 € (7) : rien de masqué.
// - Février, par le service de la contribution : S1 = A-1 … A-4 = 8 000 € (4 personnes) ; S2 = 15 000 + 2 000 = 17 000 € (6) ;
//   S3 = 14 000 € (7). Masse, seuil 5 : S1 masqué ; la plus petite cellule affichée est S3 (14 000 < 17 000) : secondaire ; ensemble
//   4 + 7 = 11 ≥ 5. Effectif (A-5 présent fin février dans S2) : S1 = 4 masqué ; S2 = 6 < S3 = 7 : S2 secondaire.
// Avant : KPI RH rangeait la masse de février par le service de la base figée (S1 = 10 000 € pour 5 personnes, S2 = 15 000 €, tout
// affiché) pendant que l'Écart publiait S2 = 17 000 € sous son filtre : la même cellule « S2, février » avait deux groupes, et
// S1 = 10 000 − (17 000 − 15 000) = 8 000 € se reconstituait pour 4 personnes.
describe("(2) changement d'affectation : masse par service de la contribution, la même sur KPI RH et l'Écart budgétaire", () => {
  const contracts = [...staff("A", "S1", 5, 200000), ...staff("B", "S2", 5, 300000), ...staff("C", "S3", 7, 200000)];
  const mutation: Hypothesis = { id: "c1", kind: "changement", label: "Mutation de A-5", contractKey: "A-5", from: "2027-02", service: "S2" };

  it("groupes partagés (projectedMasseByService) : février S1 = A-1 … A-4 (8 000 €), S2 = B-1 … B-5 et A-5 (17 000 €), S3 = C-1 … C-7 (14 000 €) ; contribution sans contrat : non ventilée, sans personne", () => {
    const s = scenarioOf(contracts, [mutation]);
    const view = (month: string) => Object.fromEntries([...projectedMasseByService(s.pmOf(month))].map(([k, g]) => [k ?? "Non ventilé", { cost: g.cost, keys: [...g.keys].sort() }]));
    expect(view("2027-01")).toEqual({
      S1: { cost: 1000000, keys: ["A-1", "A-2", "A-3", "A-4", "A-5"] },
      S2: { cost: 1500000, keys: ["B-1", "B-2", "B-3", "B-4", "B-5"] },
      S3: { cost: 1400000, keys: ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "C-7"] },
    });
    expect(view("2027-02")).toEqual({
      S1: { cost: 800000, keys: ["A-1", "A-2", "A-3", "A-4"] },
      S2: { cost: 1700000, keys: ["A-5", "B-1", "B-2", "B-3", "B-4", "B-5"] },
      S3: { cost: 1400000, keys: ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "C-7"] },
    });
    // Prime collective de 500 € saisie en coût chargé, sans service ni contrat : 500 € non ventilés, aucune personne.
    const prime: Hypothesis = { id: "p1", kind: "ponctuel", label: "Prime collective", month: "2027-02", amount: { mode: "charge", costCents: 50000 }, service: null };
    const withPrime = scenarioOf(contracts, [mutation, prime]);
    expect(projectedMasseByService(withPrime.pmOf("2027-02")).get(null)).toEqual({ cost: 50000, keys: new Set() });
  });

  it("Écart budgétaire : janvier tout affiché ; février S1 masqué, S3 secondaire (masse), S2 secondaire (effectif)", () => {
    const s = scenarioOf(contracts, [mutation]);
    expect(s.ecart("2027-01", 5)).toEqual({ S1: ["shown", "shown", "shown"], S2: ["shown", "shown", "shown"], S3: ["shown", "shown", "shown"] });
    expect(s.ecart("2027-02", 5)).toEqual({ S1: ["masked", "masked", "shown"], S2: ["shown", "secondary", "shown"], S3: ["secondary", "shown", "shown"] });
  });

  it("KPI RH › Effectifs mensuels : février S1 = 8 000 €, S2 = 17 000 €, S3 = 14 000 € et les mêmes statuts que l'Écart (masse et inscrits)", async () => {
    const s = scenarioOf(contracts, [mutation]);
    const masse = await s.kpiRh("masse", 5);
    expect(masse.value("2027-01")).toEqual({ S1: 1000000, S2: 1500000, S3: 1400000 });
    expect(masse.value("2027-02")).toEqual({ S1: 800000, S2: 1700000, S3: 1400000 });
    expect(masse.status("2027-01")).toEqual({ S1: "shown", S2: "shown", S3: "shown" });
    expect(masse.status("2027-02")).toEqual({ S1: "masked", S2: "shown", S3: "secondary" });
    const inscrits = await s.kpiRh("inscrit", 5);
    expect(inscrits.value("2027-02")).toEqual({ S1: 4, S2: 6, S3: 7 });
    expect(inscrits.status("2027-02")).toEqual({ S1: "masked", S2: "secondary", S3: "shown" });
    for (const month of ["2027-01", "2027-02", "2027-12"]) {
      const ec = s.ecart(month, 5);
      for (const g of masse.groups) {
        expect(ec[g][0], `masse ${g} ${month}`).toBe(masse.status(month)[g]);
        expect(ec[g][1], `effectif ${g} ${month}`).toBe(inscrits.status(month)[g]);
      }
    }
  });
});
