import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AnalysePage from "@/app/e/[slug]/studio-rh/masse-salariale/analyse/page";
import { ecartServiceGuard, type Loaded } from "@/app/e/[slug]/studio-rh/masse-salariale/ecart-data";
import { cascadePersons, etpCascade, STEP_LABELS, type Cascade, type CascadeStep, type StepId } from "@/lib/budget/cascade";
import { nd, val, type Cell, type MonthFacts, type Version } from "@/lib/budget/versions";
import type { ZoomSource } from "@/lib/budget/zoom";
import { confidentialiteReason, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { confidentialiteOf, croiseeLink } from "@/lib/croisee/confidentialite";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import type { RhBuildData } from "@/lib/rh/referential/types";
import { cascadeView, etpWaterfallOf, guardNd, maskCascade } from "@/lib/viz/ecart";
import { linkOnlyKpi } from "./helpers/link-only-kpi";

// Analyse des écarts et seuil de confidentialité (règle de toute l'application, en PERSONNES DISTINCTES du référentiel) : cas écrits
// à la main. Les paliers de la cascade d'ETP suivent la règle avec masquage secondaire (l'écart total est publié) ; une embauche
// prévue d'un scénario ne décrit personne de réel : un palier porté seulement par des embauches prévues est exempt (affiché), un
// palier qui les mêle à des contrats réels se juge sur ses contrats réels. Sous un filtre de service, la garde est la garde unique de
// l'application (ecartServiceGuard : lignes par service du journal masquées par le moteur, masquage secondaire compris) : la cascade,
// les contributions de masse et le pont du service sont n.d. dès que sa ligne l'est ; sans seuil, les paliers sont n.d. « non
// défini » avec le lien vers les Paramètres. Le contexte (base) est remplacé par un double ; la garde partagée n'est pas doublée.
const state = vi.hoisted(() => ({ loaded: null as unknown, conf: { kind: "absent" } as unknown, role: "reader" }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Démo", slug, role: state.role } }) }));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/ecart-data", async (orig) => ({ ...(await orig<typeof import("@/app/e/[slug]/studio-rh/masse-salariale/ecart-data")>()), loadVersions: async () => state.loaded }));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => state.conf }));

// --- Référentiel fictif : contrats C1 à C7 (clé de référentiel « payfit:Cn », identifiant externe « Cn »), personnes P1 à P7.
const contract = (n: number, personKey: string | null = `P${n}`) => ({ contractKey: `payfit:C${n}`, externalId: `C${n}`, personKey, startDate: "2024-01-01", endDate: null, nature: "01" }) as unknown as RhBuildData["contracts"][number];
const DATA = { persons: [], contracts: [1, 2, 3, 4, 5, 6, 7].map((n) => contract(n)) } as unknown as RhBuildData;
const LINK = croiseeLink(DATA);
const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const ABSENT: ConfidentialiteSetting = { kind: "absent" };
const R = (n: number) => confidentialiteReason(n);

// --- Deux versions réelles, trois mois chacune (rangs 10 à 12). Composition (clé de référentiel → ETP en dix-millièmes) :
// A (2025) : C1 à C5 à 1,00 chaque mois. B (2026) : C2 parti ; C5 à 0,50 en novembre et décembre ; C6 entré en novembre à 1,00 ;
// C7 entré en décembre à 0,50. Masse : A 10 000,00 € par mois (rémunération 7 000, charges 3 000) ; B 11 000,00 € (7 700 + 3 300).
const NA: Cell = { kind: "na" };
const facts = (month: string, masse: number, people: Record<string, number>): MonthFacts => ({
  month, layer: "reel", source: "test",
  etp4: val(Object.values(people).reduce((s, x) => s + x, 0)), headcount: val(Object.keys(people).length), entrees: val(0), sorties: val(0),
  masse: val(masse), brut: val(masse * 0.7), remun: val(masse * 0.7), primes: val(0), indemnites: val(0), autres: NA, charges: val(masse * 0.3), nonventile: NA, free: {},
  people: { kind: "value", map: people },
});
const k = (n: number) => `payfit:C${n}`;
const full = { [k(1)]: 10000, [k(2)]: 10000, [k(3)]: 10000, [k(4)]: 10000, [k(5)]: 10000 };
const A: Version = { key: "reel:2025", label: "Réel PayFit 2025", kind: "reel", year: "2025", months: new Map([["2025-10", facts("2025-10", 1_000_000, full)], ["2025-11", facts("2025-11", 1_000_000, full)], ["2025-12", facts("2025-12", 1_000_000, full)]]) };
const bOf = (seventh: string): Version => ({
  key: "reel:2026", label: "Réel PayFit 2026", kind: "reel", year: "2026",
  months: new Map([
    ["2026-10", facts("2026-10", 1_100_000, { [k(1)]: 10000, [k(3)]: 10000, [k(4)]: 10000, [k(5)]: 10000 })],
    ["2026-11", facts("2026-11", 1_100_000, { [k(1)]: 10000, [k(3)]: 10000, [k(4)]: 10000, [k(5)]: 5000, [k(6)]: 10000 })],
    ["2026-12", facts("2026-12", 1_100_000, { [k(1)]: 10000, [k(3)]: 10000, [k(4)]: 10000, [k(5)]: 5000, [k(6)]: 10000, [seventh]: 5000 })],
  ]),
});
const B = bOf(k(7));
const MA = ["2025-10", "2025-11", "2025-12"];
const MB = ["2026-10", "2026-11", "2026-12"];
const CASCADE = etpCascade(A, B, MA, MB);
// Scénario « Remplacement » : octobre réel figé (C1 à C5 à 1,00), novembre et décembre projetés avec la même composition plus UNE
// embauche prévue « embauche:h1 » à 0,50 (clé du moteur de projection, reliée à personne). Masse : 10 500,00 € par mois projeté.
const proj = (month: string, masse: number, people: Record<string, number>): MonthFacts => ({ ...facts(month, masse, people), layer: "projete", source: "projeté — scénario" });
const hireOf = (people: Record<string, number>): Version => ({
  key: "scenario:s1:2026", label: "Scénario « Remplacement » (Révisé, brouillon) 2026", kind: "scenario", year: "2026",
  months: new Map([["2026-10", facts("2026-10", 1_000_000, people)], ["2026-11", proj("2026-11", 1_050_000, { ...people, "embauche:h1": 5000 })], ["2026-12", proj("2026-12", 1_050_000, { ...people, "embauche:h1": 5000 })]]),
});
const H = hireOf(full); // une seule embauche prévue, rien d'autre ne bouge
const { [k(2)]: _c2, ...sansC2 } = full;
const H2 = hireOf(sansC2); // la même embauche, et C2 sorti
const value = (c: Cascade): Extract<Cascade, { kind: "value" }> => {
  if (c.kind !== "value") throw new Error(c.reason);
  return c;
};

// --- Journal de paie fictif (filtre de service) : TECH = C1 et C2, VENTE = C3, C4, C5 ; chaque mois des deux périodes.
let n = 0;
const line = (month: string, accountId: string, debit: number, contractId: string | null, svc: string | null): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`, month, accountId, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: svc ? [{ type: "Service", code: svc, value: svc }] : [],
});
const paid = (month: string, c: string, svc: string, salary: number): LedgerLine[] => [line(month, "641100", salary, c, svc), line(month, "645100", salary / 2, c, svc)];
const JOURNAL: JournalInput = {
  lines: [...MA, ...MB].flatMap((m) => [...paid(m, "C1", "TECH", 200000), ...paid(m, "C2", "TECH", 200000), ...["C3", "C4", "C5"].flatMap((c) => paid(m, c, "VENTE", 200000))]),
  months: [...MA, ...MB], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service",
};
const reel = (filter: { value: string | null } | null): ZoomSource => ({ kind: "reel", journal: JOURNAL, filter });

describe("cascade de référence (calcul à la main)", () => {
  it("ETP moyen 5,00 → 4,50 : entrées nouvelles +0,83, sorties −1,00, changement d'ETP −0,33 ; résiduel nul", () => {
    const c = value(CASCADE);
    // A : 5 × 30 000 ÷ 3 = 50 000 ; B : (30 000 × 3 + 20 000 + 20 000 + 5 000) ÷ 3 = 45 000. Entrées : (20 000 + 5 000) ÷ 3 = 8 333,33 ;
    // sorties : −30 000 ÷ 3 ; changement de C5 : (20 000 × 3 − 30 000 × 3) ÷ 9 = −3 333,33. Paliers cumulés arrondis : 58 333, 48 333, 45 000.
    expect([c.start, c.end, c.residual]).toEqual([50000, 45000, 0]);
    expect(c.steps.map((s) => [s.id, s.etp4])).toEqual([["entrees-new", 8333], ["entrees-report", 0], ["sorties", -10000], ["sorties-deport", 0], ["etp-change", -3333]]);
  });
  it("personnes de chaque palier : clés de référentiel reliées par le lien (deux clés d'un même contrat mènent à la même personne)", () => {
    const g = cascadePersons(value(CASCADE), LINK);
    expect(g.map((x) => [x.persons.length, x.unlinked, x.hires])).toEqual([[2, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0]]);
    expect(g[0].persons).toEqual([LINK.get("C6"), LINK.get("C7")].sort()); // identifiant externe et clé de référentiel : même jeton
    expect(LINK.get("payfit:C6")).toBe(LINK.get("C6"));
    // Une embauche prévue d'un scénario ne décrit personne de réel : comptée à part (hires), ni reliée ni non reliée.
    const h = cascadePersons(value(etpCascade(A, bOf("embauche:h1"), MA, MB)), LINK);
    expect(h[0]).toEqual({ persons: [LINK.get("C6")], unlinked: 0, hires: 1 });
    // Un contrat réel que le lien ne relie pas reste non relié.
    expect(cascadePersons(value(CASCADE), new Map())[2]).toEqual({ persons: [], unlinked: 1, hires: 0 });
  });
  it("scénario à une seule embauche prévue (0,50 sur deux mois) : ETP moyen 5,00 → 5,33, entrées nouvelles +0,33 portées par la seule embauche, autres paliers vides", () => {
    // A : 5 × 30 000 ÷ 3 = 50 000 ; H : (150 000 + 10 000) ÷ 3 = 53 333,33 → 53 333. Entrées : 10 000 ÷ 3 = 3 333,33 ; palier cumulé 53 333.
    const c = value(etpCascade(A, H, MA, MB));
    expect([c.start, c.end, c.residual]).toEqual([50000, 53333, 0]);
    expect(c.steps.map((s) => [s.id, s.etp4])).toEqual([["entrees-new", 3333], ["entrees-report", 0], ["sorties", 0], ["sorties-deport", 0], ["etp-change", 0]]);
    expect(cascadePersons(c, LINK)).toEqual([{ persons: [], unlinked: 0, hires: 1 }, ...Array(4).fill({ persons: [], unlinked: 0, hires: 0 })]);
  });
});

// La cascade seule, sans ses mois (byMonth vide) : une seule relation, masquage principal et secondaire du moteur. La règle « union »
// avec les cascades de chaque mois est testée plus bas et dans cascade-union.test.ts.
const alone = (c: { steps: CascadeStep[] }) => ({ steps: c.steps, byMonth: [] as CascadeStep[][] });

describe("paliers d'une cascade seule (maskCascade sans ses mois) : masquage principal et secondaire, écart total publié", () => {
  const c = alone(value(CASCADE));
  it("seuil 3 : entrées nouvelles (2 personnes), sorties (1) et changement d'ETP (1) masqués ; ensemble 4 personnes ≥ 3 : rien d'autre ; cascade non tracée", () => {
    const m = maskCascade(c, LINK, 3);
    expect(m.status).toEqual(["masked", "shown", "masked", "shown", "masked"]);
    expect(m.reasons).toEqual([R(3), null, R(3), null, R(3)]);
    expect(m.chart).toBe(R(3));
  });
  it("seuil 2 : entrées nouvelles (2 personnes) affichées ; sorties et changement d'ETP masqués, ensemble 2 personnes ≥ 2", () => {
    const m = maskCascade(c, LINK, 2);
    expect(m.status).toEqual(["shown", "shown", "masked", "shown", "masked"]);
  });
  it("seuil 1 : rien n'est masqué, la cascade est tracée", () => {
    const m = maskCascade(c, LINK, 1);
    expect(m.status).toEqual(Array(5).fill("shown"));
    expect(m.reasons).toEqual(Array(5).fill(null));
    expect(m.chart).toBeNull();
  });
  it("seuil 5 : les trois paliers masqués ne comptent que 4 personnes et aucun autre palier n'en apporte : toute la cascade est n.d. (masquage secondaire), même raison partout", () => {
    const m = maskCascade(c, LINK, 5);
    expect(m.status).toEqual(["masked", "secondary", "masked", "secondary", "masked"]);
    expect(new Set(m.reasons)).toEqual(new Set([R(5)]));
  });
  it("cas de référence : une seule embauche prévue ⇒ palier « Entrées nouvelles » exempt, affiché aux seuils 1 et 5 ; sorties 0,00 sans personne affiché quand rien n'est masqué ; cascade tracée", () => {
    const c = value(etpCascade(A, H, MA, MB));
    for (const seuil of [1, 5]) {
      const m = maskCascade(c, LINK, seuil);
      expect(m.status, `seuil ${seuil}`).toEqual(Array(5).fill("shown"));
      expect(m.reasons).toEqual(Array(5).fill(null));
      expect(m.chart).toBeNull();
    }
    // Seuil 1 : rien n'est masqué ; aucun palier non dénombré (l'embauche n'est pas un contrat non relié).
    expect(maskCascade(c, LINK, 1).reasons).not.toContain(SEUIL_NON_VERIFIABLE);
  });
  it("embauche prévue mêlée à un contrat réel (C6) dans « entrées nouvelles » : le palier se juge sur C6 seul (1 personne) ; seuil 3 : les trois paliers masqués réunissent P6, P2 et P5 ; seuil 4 : impossible, toute la cascade est n.d.", () => {
    const h = alone(value(etpCascade(A, bOf("embauche:h1"), MA, MB)));
    const m2 = maskCascade(h, LINK, 2);
    expect(m2.status).toEqual(["masked", "shown", "masked", "shown", "masked"]);
    expect(m2.reasons).toEqual([R(2), null, R(2), null, R(2)]);
    expect(m2.chart).toBe(R(2));
    expect(maskCascade(h, LINK, 3).status).toEqual(["masked", "shown", "masked", "shown", "masked"]);
    expect(maskCascade(h, LINK, 4).status).toEqual(["masked", "secondary", "masked", "secondary", "masked"]);
  });
  it("embauche seule et sortie d'une personne (seuil 2) : la sortie est masquée et rien ne peut la protéger (ensemble impossible) : toute la cascade est n.d., le palier de l'embauche compris", () => {
    // A : 50 000 ; H2 : (120 000 + 10 000) ÷ 3 = 43 333,33 → 43 333. Entrées +3 333 (embauche), sorties −10 000 (C2), résiduel nul.
    const c = value(etpCascade(A, H2, MA, MB));
    expect([c.start, c.end, c.residual]).toEqual([50000, 43333, 0]);
    expect(c.steps.map((s) => s.etp4)).toEqual([3333, 0, -10000, 0, 0]);
    const m = maskCascade(c, LINK, 2);
    // L'embauche prévue (taille 0, projectedGroupCell) n'apporte personne et n'est plus exempte : l'écart total étant publié, la
    // laisser affichée redonnerait la somme des paliers masqués (écart total − 0,3333 = −1,0000, la seule sortie de C2). Toute la
    // relation est donc n.d. (cas « impossible » du moteur, règle 3 du lot 12). Avant : [shown, secondary, masked, secondary, secondary].
    expect(m.status).toEqual(["secondary", "secondary", "masked", "secondary", "secondary"]);
    expect(m.reasons).toEqual([R(2), R(2), R(2), R(2), R(2)]);
    expect(m.chart).toBe(R(2));
  });
  it("une personne présente dans deux paliers masqués n'y compte qu'une fois", () => {
    // Paliers construits à la main : effet report {P1, P2} et changement d'ETP {P1, P2} masqués (seuil 3) ne décrivent que 2 personnes ;
    // l'effet déport {P3, P4, P5, P6} (4 personnes) est masqué à son tour ; additionner les tailles (2 + 2 = 4 ≥ 3) l'aurait laissé affiché.
    const step = (id: StepId, etp4: number, keys: string[]) => ({ id, label: STEP_LABELS[id], etp4, people: keys.map((key) => ({ key, etp4 })) });
    const steps = [step("entrees-new", 0, []), step("entrees-report", 2000, ["C1", "C2"]), step("sorties", 0, []), step("sorties-deport", -4000, ["C3", "C4", "C5", "C6"]), step("etp-change", 1500, ["C1", "C2"])];
    expect(maskCascade(alone({ steps }), LINK, 3).status).toEqual(["shown", "masked", "shown", "secondary", "masked"]);
  });
});

describe("cascade telle que l'écran la présente (cascadeView)", () => {
  const c = value(CASCADE);
  it("seuil défini : paliers masqués avec leur raison (règle « union » avec les mois), départ, arrivée et résiduel conservés, cascade non tracée", () => {
    // Cascades de chaque mois (byMonth), calculées à la main : octobre, C2 seul sorti (−1,00), rien d'autre ne bouge (C1, C3, C4, C5 à
    // 1,00 les deux années : contributions nulles) ; novembre, entrées {C6} +1,00, sorties {C2} −1,00, changement {C5} −0,50 ;
    // décembre, entrées {C6, C7} +1,50, sorties {C2} −1,00, changement {C5} −0,50.
    expect(c.byMonth.map((steps) => steps.map((s) => s.etp4))).toEqual([[0, 0, -10000, 0, 0], [10000, 0, -10000, 0, -5000], [15000, 0, -10000, 0, -5000]]);
    // Seuil 3 : la période seule masque entrées (2 personnes), sorties (1) et changement (1) ; octobre ne peut pas protéger la sortie
    // de C2 (aucun autre palier ne décrit quelqu'un) : ses cinq paliers sont n.d. ; l'effet report et l'effet déport de la période,
    // nuls, sont donc n.d. eux aussi (masqués dans un de ses mois). Raison : celle du seuil, partout.
    const v = cascadeView(c, confidentialiteOf(set(3)), LINK, null);
    if (v.kind !== "value") throw new Error(v.reason);
    expect([v.start, v.end, v.residual, v.param]).toEqual([50000, 45000, 0, false]);
    expect(v.steps.map((s) => [s.id, s.nd === null ? s.etp4 : "n.d."])).toEqual([["entrees-new", "n.d."], ["entrees-report", "n.d."], ["sorties", "n.d."], ["sorties-deport", "n.d."], ["etp-change", "n.d."]]);
    expect(new Set(v.steps.map((s) => s.nd))).toEqual(new Set([R(3)]));
    expect(etpWaterfallOf(v)).toEqual({ kind: "nd", reason: R(3) });
    const one = cascadeView(c, confidentialiteOf(set(1)), LINK, null);
    expect(etpWaterfallOf(one)).toMatchObject({ kind: "value", unit: "etp", start: 50000, end: 45000 });
  });
  it("seuil non défini : chaque palier est n.d. « non défini » (lien vers les Paramètres), les totaux restent, la cascade n'est pas tracée", () => {
    const v = cascadeView(c, confidentialiteOf(ABSENT), LINK, null);
    if (v.kind !== "value") throw new Error(v.reason);
    expect(v.param).toBe(true);
    expect(v.steps.map((s) => s.nd)).toEqual(Array(5).fill(SEUIL_NON_DEFINI));
    expect([v.start, v.end]).toEqual([50000, 45000]);
    expect(etpWaterfallOf(v)).toEqual({ kind: "nd", reason: SEUIL_NON_DEFINI });
  });
  it("cascade n.d. pour sa propre raison : transmise telle quelle ; service gardé : tout le bloc est n.d. avec la raison du service, même si la cascade a sa propre raison", () => {
    const own: Cascade = { kind: "nd", reason: "périodes de longueur différente ou vides" };
    expect(cascadeView(own, confidentialiteOf(set(3)), LINK, null)).toEqual({ kind: "nd", reason: "périodes de longueur différente ou vides", param: false });
    expect(cascadeView(c, confidentialiteOf(set(3)), LINK, { reason: R(3), param: false })).toEqual({ kind: "nd", reason: R(3), param: false });
    expect(cascadeView(own, confidentialiteOf(set(3)), LINK, { reason: R(3), param: false })).toEqual({ kind: "nd", reason: R(3), param: false });
    expect(etpWaterfallOf(cascadeView(c, confidentialiteOf(set(3)), LINK, { reason: R(3), param: false }))).toEqual({ kind: "nd", reason: R(3) });
  });
  it("scénario à une seule embauche prévue, seuil 5 : paliers affichés, cascade tracée (5,00 → 5,33)", () => {
    const v = cascadeView(value(etpCascade(A, H, MA, MB)), confidentialiteOf(set(5)), LINK, null);
    if (v.kind !== "value") throw new Error(v.reason);
    expect(v.steps.map((s) => s.nd)).toEqual(Array(5).fill(null));
    expect(etpWaterfallOf(v)).toEqual({ kind: "value", unit: "etp", start: 50000, end: 53333, steps: [["Entrées nouvelles", 3333], ["Entrées : effet report", 0], ["Sorties", 0], ["Sorties : effet déport", 0], ["Changement d'ETP", 0]].map(([label, value]) => ({ label, value })) });
  });
});

// --- Chargement doublé de la page : versions, sources et journal fictif (ctx.input : la garde partagée lit le journal entier).
const loadedOf = (filter: { value: string | null } | null, versions: [Version, Version] = [A, B]): Loaded =>
  ({
    ctx: { unavailable: null, input: JOURNAL, kpi: { input: linkOnlyKpi(DATA) } }, // lien seul : aucun ETP de fin de mois dénombré (garde de masse)
    options: [{ value: "reel:2025", label: "Réel PayFit 2025" }, { value: versions[1].key, label: versions[1].label }],
    selected: ["reel:2025", versions[1].key], versions, shorts: ["Réel 2025", versions[1].kind === "reel" ? "Réel 2026" : "Remplacement 2026"], sources: [reel(filter), reel(filter)], scenarios: new Map(),
    from: "10", to: "12", months: (y: string) => [`${y}-10`, `${y}-11`, `${y}-12`], services: ["TECH", "VENTE"], hasNv: false, filter, notices: [],
  }) as unknown as Loaded;

describe("service retenu par le filtre : la garde unique de l'application (ecartServiceGuard), lue par la page (guardNd)", () => {
  it("seuil 3 : TECH (2 personnes) masqué, et VENTE (3 personnes) masqué à son tour, le tableau Services n'ayant que deux lignes (masquage secondaire) ; seuil 2 : les deux affichés ; sans seuil : paramètre ; sans filtre : rien", () => {
    expect(ecartServiceGuard(loadedOf({ value: "TECH" }), set(3))).toEqual({ cause: "seuil", reason: R(3) });
    expect(ecartServiceGuard(loadedOf({ value: "VENTE" }), set(3))).toEqual({ cause: "seuil", reason: R(3) });
    expect(ecartServiceGuard(loadedOf({ value: "TECH" }), set(2))).toBeNull();
    expect(ecartServiceGuard(loadedOf({ value: "VENTE" }), set(2))).toBeNull();
    expect(ecartServiceGuard(loadedOf({ value: "TECH" }), ABSENT)).toEqual({ cause: "parametre", reason: SEUIL_NON_DEFINI });
    expect(ecartServiceGuard(loadedOf(null), set(3))).toBeNull();
  });
  it("guardNd : la raison du moteur, nue ; param vrai seulement pour le paramètre absent ou illisible ; null transmis", () => {
    expect(guardNd({ cause: "seuil", reason: R(3) })).toEqual({ reason: R(3), param: false });
    expect(guardNd({ cause: "seuil", reason: SEUIL_NON_VERIFIABLE })).toEqual({ reason: SEUIL_NON_VERIFIABLE, param: false });
    expect(guardNd({ cause: "parametre", reason: SEUIL_NON_DEFINI })).toEqual({ reason: SEUIL_NON_DEFINI, param: true });
    expect(guardNd(null)).toBeNull();
  });
});

// --- La page rendue (serveur), avec les mêmes versions.
const render = async (conf: ConfidentialiteSetting, filter: { value: string | null } | null = null, role = "reader", sp: Record<string, string> = {}, versions: [Version, Version] = [A, B]) => {
  state.loaded = loadedOf(filter, versions);
  state.conf = conf;
  state.role = role;
  return renderToStaticMarkup(await AnalysePage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(sp) }));
};
const cell = (html: string, testid: string, step: string) => new RegExp(`data-testid="${testid}"[\\s\\S]*?data-step="${step}"[\\s\\S]*?data-col="valeur"[^>]*>([\\s\\S]*?)</td>`).exec(html)?.[1] ?? null;
const text = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("page Analyse des écarts : seuil, filtre de service, ligne « Confidentialité »", () => {
  it("seuil 3, tous les services : paliers sous le seuil n.d. (valeur et poids), totaux affichés, raison écrite sous le tableau, graphique d'ETP n.d., pont et masse de l'entreprise affichés", async () => {
    const html = await render(set(3));
    expect(html).toContain('data-testid="analyse-confidentialite"');
    expect(text(html)).toContain("Confidentialité : seuil de 3 personnes");
    expect(text(cell(html, "analyse-etp-table", "start")!)).toBe("5,00");
    expect(text(cell(html, "analyse-etp-table", "end")!)).toBe("4,50");
    expect(text(cell(html, "analyse-etp-table", "total")!)).toBe("−0,50");
    expect(text(cell(html, "analyse-etp-table", "residual")!)).toBe("0,00");
    // Effet report nul de la période : n.d. aussi, car octobre (C2 seul sorti) ne peut pas être protégé (règle « union » des mois).
    expect(cell(html, "analyse-etp-table", "entrees-report")).toContain(`<abbr class="nd" title="${R(3)}">n.d.</abbr>`);
    expect(cell(html, "analyse-etp-table", "entrees-new")).toContain(`<abbr class="nd" title="${R(3)}">n.d.</abbr>`);
    expect(cell(html, "analyse-etp-table", "sorties")).toContain(">n.d.</abbr>");
    expect(cell(html, "analyse-etp-table", "etp-change")).toContain(">n.d.</abbr>");
    // Poids d'un palier masqué : n.d. (sinon le palier se lirait par poids × écart total).
    const row = /data-step="sorties"[\s\S]*?<\/tr>/.exec(html)![0];
    expect(row.match(/>n\.d\.<\/abbr>/g)).toHaveLength(2);
    expect(/data-label="Poids des écarts"[^>]*>([\s\S]*?)<\/td>/.exec(row)![1]).not.toContain("%");
    // La raison est écrite sous le tableau, pas seulement au survol.
    expect(text(html)).toContain(`Paliers n.d. (5) : Entrées nouvelles, Entrées : effet report, Sorties, Sorties : effet déport, Changement d'ETP — ${R(3)}`);
    // Graphique : la rubrique ETP est n.d. avec la raison ; la masse de l'entreprise se trace ; le pont est affiché (total, jamais masqué).
    expect(html).toContain('data-testid="analyse-graph-nd"');
    expect(html).toContain(`n.d. — ${R(3)}`);
    expect(html).not.toContain('data-testid="wf-etp"');
    expect(html).toContain('data-testid="pont-volume"');
    expect(html).toContain('data-testid="wf-pont"');
    expect(html).toContain('data-testid="analyse-masse-table"');
    expect(html).not.toContain('data-testid="analyse-pont-nd"');
    expect(html).not.toContain("analyse-graph-param"); // seuil défini : rien à définir
    // Aucune clé de personne ni jeton dans la page (lecteur).
    expect(html).not.toContain("P1");
    expect(html).not.toContain("personne-");
    expect(html).not.toContain('data-testid="analyse-etp-who"');
  });
  it("seuil 1 : rien n'est masqué, la cascade d'ETP est tracée, pas de ligne de paliers n.d.", async () => {
    const html = await render(set(1));
    expect(text(cell(html, "analyse-etp-table", "entrees-new")!)).toBe("+0,83");
    expect(text(cell(html, "analyse-etp-table", "sorties")!)).toBe("−1,00");
    expect(text(cell(html, "analyse-etp-table", "etp-change")!)).toBe("−0,33");
    expect(html).toContain('data-testid="wf-etp"');
    expect(html).not.toContain("analyse-etp-nd-list");
    expect(text(html)).toContain("Confidentialité : seuil de 1 personne");
  });
  it("cas de référence : scénario à une seule embauche prévue, seuils 1 et 5 : « Entrées nouvelles » +0,33 affiché (exempt), « Sorties » 0,00 affiché, cascade tracée, aucun palier n.d.", async () => {
    for (const seuil of [1, 5]) {
      const html = await render(set(seuil), null, "reader", {}, [A, H]);
      expect(text(cell(html, "analyse-etp-table", "start")!), `seuil ${seuil}`).toBe("5,00");
      expect(text(cell(html, "analyse-etp-table", "entrees-new")!)).toBe("+0,33");
      expect(text(cell(html, "analyse-etp-table", "sorties")!)).toBe("0,00");
      expect(text(cell(html, "analyse-etp-table", "residual")!)).toBe("0,00");
      expect(text(cell(html, "analyse-etp-table", "end")!)).toBe("5,33");
      expect(html).toContain('data-testid="wf-etp"');
      expect(html).not.toContain("analyse-etp-nd-list");
      // Aucune cellule n.d. dans la cascade (les pourcentages des rubriques de masse à 0 → 0 restent n.d. par division, hors cascade).
      const etpTable = /data-testid="analyse-etp-table"[\s\S]*?<\/table>/.exec(html)![0];
      expect(etpTable).not.toContain(">n.d.</abbr>");
      expect(html).not.toContain(SEUIL_NON_VERIFIABLE);
    }
    expect(text(await render(set(5), null, "reader", {}, [A, H]))).toContain("Confidentialité : seuil de 5 personnes");
  });
  it("seuil non défini : paliers n.d. « non défini » avec le lien vers Paramètres › Confidentialité, totaux et pont de l'entreprise affichés", async () => {
    const html = await render(ABSENT);
    expect(text(html)).toContain("Confidentialité : seuil non défini (Paramètres)");
    expect(html).toContain('href="/e/demo/parametres#confidentialite"');
    expect(cell(html, "analyse-etp-table", "entrees-new")).toContain(`<abbr class="nd" title="${SEUIL_NON_DEFINI}">n.d.</abbr>`);
    expect(cell(html, "analyse-etp-table", "entrees-report")).toContain(">n.d.</abbr>"); // sans seuil, aucun palier n'est affiché, même nul
    expect(text(cell(html, "analyse-etp-table", "start")!)).toBe("5,00");
    expect(text(cell(html, "analyse-etp-table", "total")!)).toBe("−0,50");
    const list = /<p class="nd" data-testid="analyse-etp-nd-list">[\s\S]*?<\/p>/.exec(html)![0];
    expect(text(list)).toBe("Paliers n.d. (5) : Entrées nouvelles, Entrées : effet report, Sorties, Sorties : effet déport, Changement d'ETP — seuil de confidentialité non défini (Paramètres)");
    expect(list).toContain('<a href="/e/demo/parametres#confidentialite">Paramètres</a>');
    expect(html).toContain('data-testid="analyse-graph-param"><a href="/e/demo/parametres#confidentialite">Définir le seuil de confidentialité (Paramètres)</a></p>');
    expect(html).toContain('data-testid="pont-volume"');
    expect(html).toContain('data-testid="analyse-masse-table"');
  });
  it("filtre de service TECH (2 personnes), seuil 3 : cascade, contributions de masse et pont du service n.d. ; le titre du bloc nomme le service, la raison est celle du moteur, nue ; seuil 2 : affichés", async () => {
    const html = await render(set(3), { value: "TECH" });
    const title = `service TECH retenu par le filtre : ${R(3)}`;
    expect(html).toContain(`data-testid="analyse-graph-nd"><p class="nd">n.d. — ${title}</p>`); // graphique : le service et la raison, sans lien
    expect(html).not.toContain("analyse-graph-param");
    for (const t of ["analyse-etp-nd", "analyse-masse-nd", "analyse-pont-nd"]) expect(html).toContain(`data-testid="${t}">n.d. — ${title}</p>`);
    for (const t of ["analyse-etp-table", "analyse-masse-table", "pont-volume", "wf-pont", "wf-etp", "wf-masse"]) expect(html).not.toContain(`data-testid="${t}"`);
    expect(html).not.toContain(`${R(3)} — service`); // la mention du service n'entre pas dans la raison
    const ok = await render(set(2), { value: "TECH" });
    expect(ok).toContain('data-testid="analyse-etp-table"');
    expect(ok).toContain('data-testid="pont-volume"');
    expect(ok).not.toContain("retenu par le filtre");
    expect(ok).not.toContain("analyse-graph-param");
  });
  it("filtre VENTE (3 personnes), seuil 3 : n.d. aussi, comme la Synthèse de la Masse salariale (VENTE est masqué pour protéger TECH : sinon le filtre révélerait par différence ce que le tableau cache)", async () => {
    const html = await render(set(3), { value: "VENTE" });
    expect(html).toContain(`data-testid="analyse-etp-nd">n.d. — service VENTE retenu par le filtre : ${R(3)}</p>`);
    expect(html).toContain(`data-testid="analyse-pont-nd">n.d. — service VENTE retenu par le filtre : ${R(3)}</p>`);
    expect(html).not.toContain('data-testid="analyse-masse-table"');
    expect((await render(set(2), { value: "VENTE" }))).toContain('data-testid="analyse-masse-table"');
  });
  it("filtre de service sans seuil : tout le service est n.d. « non défini » avec le lien, le titre du bloc nomme le service", async () => {
    const html = await render(ABSENT, { value: "VENTE" });
    expect(html).toContain('data-testid="analyse-etp-nd">n.d. — service VENTE retenu par le filtre : seuil de confidentialité non défini (<a href="/e/demo/parametres#confidentialite">Paramètres</a>)</p>');
    expect(html).toContain('data-testid="analyse-pont-nd">n.d. — service VENTE retenu par le filtre : seuil de confidentialité non défini (<a href="/e/demo/parametres#confidentialite">Paramètres</a>)</p>');
    expect(html).toContain('data-testid="analyse-graph-nd"><p class="nd">n.d. — service VENTE retenu par le filtre : seuil de confidentialité non défini (Paramètres)</p>');
    expect(html).toContain('data-testid="analyse-graph-param">');
    expect(html).not.toContain('data-testid="analyse-masse-table"');
  });
  it("éditeur : le détail nominatif par palier reste réservé par rôle, inchangé, même quand le palier est n.d. pour les lecteurs", async () => {
    const html = await render(set(3), null, "admin");
    expect(html).toContain('data-testid="analyse-etp-who"');
    expect(html).toMatch(/<strong>Sorties<\/strong> : [^<]*−1,00/);
    expect(cell(html, "analyse-etp-table", "sorties")).toContain(">n.d.</abbr>");
  });
  it("affichage « tableau » : pas de graphique ; « graphique » : pas de tableau, la cascade n.d. garde sa raison dans la zone du graphique", async () => {
    const tableau = await render(set(3), null, "reader", { affichage: "tableau" });
    expect(tableau).not.toContain('data-testid="analyse-graph"');
    expect(tableau).toContain('data-testid="analyse-etp-table"');
    const graphique = await render(set(3), null, "reader", { affichage: "graphique" });
    expect(graphique).toContain('data-testid="analyse-graph-nd"');
    expect(graphique).not.toContain('data-testid="analyse-etp-table"');
  });
});
