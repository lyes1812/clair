import { describe, expect, it } from "vitest";
import { suiviSheet } from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { flowGuard } from "@/app/e/[slug]/studio-rh/kpi/flow-guard";
import { kpiSuiviOf, scopeGuard } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { monthRange } from "@/lib/connectors/months";
import { confidentialiteReason, type ConfidentialiteSetting, type MaskCell } from "@/lib/confidentialite";
import { countedMovements } from "@/lib/confidentialite/flows";
import { crossKey, crossMask, crossStockColumn } from "@/lib/confidentialite/splits";
import { monthEnd } from "@/lib/dates";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { countedOpts } from "@/lib/rh/kpi/period";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import type { DsnDeclarationSpec, DsnPerson } from "./helpers/edge-cases";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnBuild, edgeFiles } from "./helpers/rh";

// KPI RH, filtres Établissement et Nature (lot 12, relecture rv13) : (1) les deux filtres ensemble lisent le statut d'UNE passe du
// tableau établissement × nature du mois, dont les marges sont les cellules des filtres seuls ; (2) une valeur affichée sous un filtre
// qui n'est pas la cellule contrôlée (contrats continus neutralisés autrement) est n.d. Données entièrement fictives (DSN fictives, NIR
// à clé invalide, SIREN 000000000) ; cas de référence calculés à la main dans les commentaires.

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const R3 = confidentialiteReason(3); // « non affiché (seuil de confidentialité : 3 personnes) »
const R5 = confidentialiteReason(5);
const ctxOf = (input: KpiInput, establishments: string[], codes: string[]) =>
  ({
    collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "reader" }, establishments: establishments.map((id) => ({ id, label: `Établissement fictif ${id.slice(-2)}` })), natures: { codes, origin: "default" }, payfitHistory: null, state: null },
    settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
    input: { ...input, openMonths: [] },
    readTypes: [],
  }) as unknown as KpiContext;
const ready = (ctx: KpiContext, sp: Record<string, string>, conf: ConfidentialiteSetting) => {
  const s = kpiSuiviOf(ctx, sp, conf);
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  return s;
};
const cell = (persons: string[]): MaskCell => ({ size: persons.length, value: persons.length, members: persons });
const ps = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => `${prefix}${k + 1}`);
const N1 = "CDI (01)";
const N2 = "CDD (02)";

// =====================================================================================================================================
// 1. crossMask : une passe du moteur sur le tableau établissement × nature (cas écrits à la main, seuil 3)
// =====================================================================================================================================
describe("crossMask : tableau établissement × nature masqué en une passe, marges au statut des filtres seuls", () => {
  // Cas des relecteurs : A×CDD 1, A×CDI 3, B×CDD 3, B×CDI 3 personnes ; marges A 4, B 6, CDD 4, CDI 6, toutes affichées.
  // Relations (lignes puis colonnes, ordre canonique) : ligne A : A×CDD (1) masqué, 1 < 3 → A×CDI masqué à son tour (4 ≥ 3, deux
  // cellules) ; colonne CDD : A×CDD seul masqué → B×CDD à son tour ; colonne CDI : A×CDI seul (une cellule) → B×CDI à son tour ; ligne
  // B : B×CDD et B×CDI masqués (6), rien de plus. Les quatre croisements sont n.d. : A×CDD = A − (CDI − B×CDI) ne se calcule plus.
  it("cas des relecteurs : les quatre croisements n.d. (A×CDD principal, les trois autres secondaires)", () => {
    const cells = { [crossKey("A", N2)]: cell(["p1"]), [crossKey("A", N1)]: cell(ps("a", 3)), [crossKey("B", N2)]: cell(ps("b", 3)), [crossKey("B", N1)]: cell(ps("c", 3)) };
    const margins = { etablissement: new Map([["A", "shown"], ["B", "shown"]] as const), nature: new Map([[N1, "shown"], [N2, "shown"]] as const) };
    expect(Object.fromEntries(crossMask(cells, margins, 3))).toEqual({ [crossKey("A", N2)]: "masked", [crossKey("A", N1)]: "secondary", [crossKey("B", N2)]: "secondary", [crossKey("B", N1)]: "secondary" });
  });

  // Marge masquée par sa colonne (A, secondaire) : ce n'est pas un total publié, mais A×N1 + A×N2 la redonnerait. Trois établissements
  // A, B, C ; A×N1 3, A×N2 3, B×N1 3, B×N2 4, C×N1 5, C×N2 5 personnes ; marges B, C, N1, N2 affichées.
  // Passe 1 : aucune cellule sous le seuil ; ligne A (total masqué), toutes affichées → la plus petite, A×N1 (3, la première à égalité),
  // masquée. Passe 2 : colonne N1, A×N1 seul (une cellule) → B×N1 (3, la plus petite) masqué. Passe 3 : ligne B, B×N1 seul → B×N2 ;
  // colonne N2, B×N2 seul → A×N2 (3 < 5). Passe 4 : stable. C×N1 et C×N2 restent affichés.
  it("marge masquée : ses cellules ne restent pas toutes affichées ; la ligne C reste affichée", () => {
    const cells = {
      [crossKey("A", N1)]: cell(ps("a", 3)),
      [crossKey("A", N2)]: cell(ps("b", 3)),
      [crossKey("B", N1)]: cell(ps("c", 3)),
      [crossKey("B", N2)]: cell(ps("d", 4)),
      [crossKey("C", N1)]: cell(ps("e", 5)),
      [crossKey("C", N2)]: cell(ps("f", 5)),
    };
    const margins = { etablissement: new Map([["A", "secondary"], ["B", "shown"], ["C", "shown"]] as const), nature: new Map([[N1, "shown"], [N2, "shown"]] as const) };
    const st = crossMask(cells, margins, 3);
    expect([crossKey("A", N1), crossKey("A", N2), crossKey("B", N1), crossKey("B", N2), crossKey("C", N1), crossKey("C", N2)].map((k) => st.get(k))).toEqual(["secondary", "secondary", "secondary", "secondary", "shown", "shown"]);
  });

  // Ligne d'une seule cellule sous une marge affichée : A n'a que A×N1 (3), qui égale la marge A publiée par le filtre Établissement
  // seul. B×N1 1 (masqué), B×N2 4, C×N1 4, C×N2 5. A×N1 est exempt (publié par sa marge) : il ne protège pas B×N1 dans la colonne N1.
  // Ligne B : B×N1 seul (1 < 3) → B×N2 masqué. Colonne N1 (sans A×N1) : B×N1 seul → C×N1 (4) masqué. Colonne N2 : B×N2 seul → C×N2.
  // Ligne C : C×N1 et C×N2 masqués (9). Sans l'exemption, la colonne N1 aurait retenu A×N1 (3, le plus petit), dont la valeur se lit
  // pourtant sur le filtre A seul.
  it("seule cellule d'une marge affichée : affichée (exempt), la colonne se protège par les autres cellules", () => {
    const cells = { [crossKey("A", N1)]: cell(ps("a", 3)), [crossKey("B", N1)]: cell(["p1"]), [crossKey("B", N2)]: cell(ps("b", 4)), [crossKey("C", N1)]: cell(ps("c", 4)), [crossKey("C", N2)]: cell(ps("d", 5)) };
    const all = { etablissement: new Map([["A", "shown"], ["B", "shown"], ["C", "shown"]] as const), nature: new Map([[N1, "shown"], [N2, "shown"]] as const) };
    const st = crossMask(cells, all, 3);
    expect([crossKey("A", N1), crossKey("B", N1), crossKey("B", N2), crossKey("C", N1), crossKey("C", N2)].map((k) => st.get(k))).toEqual(["shown", "masked", "secondary", "secondary", "secondary"]);
  });

  it("l'ordre d'insertion des cellules ne change aucun statut (ordre canonique des libellés)", () => {
    const entries: [string, MaskCell][] = [
      [crossKey("B", N1), cell(ps("c", 3))],
      [crossKey("A", N1), cell(ps("a", 3))],
      [crossKey("B", N2), cell(ps("b", 3))],
      [crossKey("A", N2), cell(["p1"])],
    ];
    const margins = { etablissement: new Map([["A", "shown"], ["B", "shown"]] as const), nature: new Map([[N1, "shown"], [N2, "shown"]] as const) };
    const a = crossMask(Object.fromEntries(entries), margins, 3);
    const b = crossMask(Object.fromEntries([...entries].reverse()), margins, 3);
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
  });
});

// =====================================================================================================================================
// 2. Filtres Établissement + Nature combinés, de bout en bout (kpiSuiviOf) : cas des relecteurs (rv13, coherence/filtres-2d*.test.ts)
// =====================================================================================================================================
// DSN fictives de juillet 2025 à juin 2026, seuil 3. Deux établissements A (…00011) et B (…00022), deux natures CDI (01) et CDD (02).
type Worker = { i: number; start: string; nic: string; nature: string };
const W = (i: number, nature: string, nic: string, start = "2025-01-01"): Worker => ({ i, start, nic, nature });
const person = (w: Worker): DsnPerson => ({ nir: `2990175${100000 + w.i}`, employeeNumber: `E${w.i}`, contracts: [{ number: `K-${w.i}`, start: w.start, nature: w.nature, gross: "1000.00" }] });
function build(workers: Worker[], from: string, to: string) {
  const nics = [...new Set(workers.map((w) => w.nic))].sort();
  const specs: DsnDeclarationSpec[] = monthRange(from, to).flatMap((month) => nics.map((nic) => ({ month, nic, people: workers.filter((w) => w.nic === nic && w.start <= `${month}-31`).map(person) })));
  return dsnBuild(edgeFiles(specs));
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const A = "00000000000011";
const B = "00000000000022";
const COMBOS: Record<string, Record<string, string>> = {
  A: { etab: A },
  B: { etab: B },
  CDI: { nature: "01" },
  CDD: { nature: "02" },
  "A+CDD": { etab: A, nature: "02" },
  "A+CDI": { etab: A, nature: "01" },
  "B+CDD": { etab: B, nature: "02" },
  "B+CDI": { etab: B, nature: "01" },
};

describe("flux sous les deux filtres (entrées d'avril 2026, seuil 3) : plus aucun croisement ne se lit par différence", () => {
  // Base depuis le 01/01/2025 : 5 personnes dans chacune des quatre combinaisons (la garde des effectifs ne masque rien). Entrées
  // d'avril 2026 (une personne chacune) : A×CDD 1 ; A×CDI 3 ; B×CDD 3 ; B×CDI 3. Marges : A 4, B 6, CDD 4, CDI 6 (colonnes canoniques
  // affichées, rien sous 3). Tableau : cas des relecteurs de crossMask, les quatre croisements n.d. Avant : chaque partition était
  // masquée seule, B+CDI = 3 restait affiché et A×CDD = 4 − (6 − 3) = 1 se lisait.
  const WORKERS: Worker[] = [
    ...range(1, 5).map((i) => W(i, "01", "00011")),
    ...range(11, 15).map((i) => W(i, "02", "00011")),
    ...range(21, 25).map((i) => W(i, "01", "00022")),
    ...range(31, 35).map((i) => W(i, "02", "00022")),
    W(101, "02", "00011", "2026-04-02"),
    ...range(111, 113).map((i) => W(i, "01", "00011", `2026-04-${String(i - 105).padStart(2, "0")}`)),
    ...range(121, 123).map((i) => W(i, "02", "00022", `2026-04-${String(i - 110).padStart(2, "0")}`)),
    ...range(131, 133).map((i) => W(i, "01", "00022", `2026-04-${String(i - 115).padStart(2, "0")}`)),
  ];
  const data = build(WORKERS, "2025-07", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: ["01", "02"] }), openMonths: [] };
  const ctx = ctxOf(kpi, [A, B], ["01", "02"]);
  const entries = (sp: Record<string, string>, m = "2026-04") => {
    const s = ready(ctx, { ...sp, fin: "2026-06" }, set(3));
    expect(s.guard, JSON.stringify(sp)).toBeNull();
    return s.dash.rows.find((r) => r.month === m)!.movements.entries;
  };

  it("filtres seuls inchangés (A 4, B 6, CDI 6, CDD 4) ; les quatre croisements n.d. avec la raison du seuil", () => {
    expect(Object.fromEntries(["A", "B", "CDI", "CDD"].map((k) => [k, entries(COMBOS[k])]))).toEqual({
      A: { kind: "exact", value: 4, qualifiers: [] },
      B: { kind: "exact", value: 6, qualifiers: [] },
      CDI: { kind: "exact", value: 6, qualifiers: [] },
      CDD: { kind: "exact", value: 4, qualifiers: [] },
    });
    for (const k of ["A+CDD", "A+CDI", "B+CDD", "B+CDI"]) expect(entries(COMBOS[k]), k).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R3 } });
  });

  it("mois sans entrée (mars) : 0 affiché sous les deux filtres ; la garde des flux ne retient qu'avril", () => {
    expect(entries(COMBOS["B+CDI"], "2026-03")).toMatchObject({ kind: "exact", value: 0 });
    const g = flowGuard({ base: kpi, scope: { establishments: [B], nature: "01" }, months: monthRange("2025-07", "2026-06"), establishments: [A, B], natures: ["01", "02"], seuil: 3 });
    expect([...g!.months]).toEqual([["2026-04", { entries: R3 }]]);
  });
});

describe("stocks sous les deux filtres (fin de mois, seuil 3) : garde du périmètre sur le même tableau", () => {
  // Tous présents depuis le 01/01/2025 : A×CDD 1 (K-1), A×CDI 3, B×CDD 3, B×CDI 3. Chaque fin de mois : marges A 4, B 6, CDD 4,
  // CDI 6, affichées ; tableau : les quatre croisements n.d. (même calcul que les entrées ci-dessus). Avant : B+CDI = 3 inscrits
  // affichés, A×CDD = 4 − (6 − 3) = 1.
  const WORKERS: Worker[] = [W(1, "02", "00011"), ...range(11, 13).map((i) => W(i, "01", "00011")), ...range(21, 23).map((i) => W(i, "02", "00022")), ...range(31, 33).map((i) => W(i, "01", "00022"))];
  const data = build(WORKERS, "2025-07", "2026-06");
  const kpi: KpiInput = { ...kpiInput(data, DSN_ABSENCES, { natures: ["01", "02"] }), openMonths: [] };
  const ctx = ctxOf(kpi, [A, B], ["01", "02"]);

  it("filtres seuls affichés (A 4, B 6, CDI 6, CDD 4 inscrits fin mars) ; les quatre croisements gardés (raison du seuil)", () => {
    const shown = Object.fromEntries(
      ["A", "B", "CDI", "CDD"].map((k) => {
        const s = ready(ctx, { ...COMBOS[k], fin: "2026-06" }, set(3));
        expect(s.guard, k).toBeNull();
        const h = s.dash.rows.find((r) => r.month === "2026-03")!.headcount;
        return [k, h.kind === "nd" ? null : h.contracts];
      }),
    );
    expect(shown).toEqual({ A: 4, B: 6, CDI: 6, CDD: 4 });
    for (const k of ["A+CDD", "A+CDI", "B+CDD", "B+CDI"]) expect(ready(ctx, { ...COMBOS[k], fin: "2026-06" }, set(3)).guard, k).toEqual({ cause: "seuil", reason: R3 });
  });

  it("tableau de fin mars (crossStockColumn) : quatre cellules, chacune de ses contrats ; statuts de crossMask", () => {
    const c = crossStockColumn(data, monthEnd("2026-03"), countedOpts(kpi), 3)!;
    expect(Object.fromEntries(Object.entries(c.groups).map(([k, g]) => [k, g.contracts]))).toEqual({ [crossKey(A, N2)]: 1, [crossKey(A, N1)]: 3, [crossKey(B, N2)]: 3, [crossKey(B, N1)]: 3 });
    expect(Object.fromEntries(c.status)).toEqual({ [crossKey(A, N2)]: "masked", [crossKey(A, N1)]: "secondary", [crossKey(B, N2)]: "secondary", [crossKey(B, N1)]: "secondary" });
    // Seuil 1 : rien n'est masqué, ni seul ni croisé.
    expect(scopeGuard({ input: { ...kpi, scope: { establishments: [B], nature: "01" } }, months: ["2026-03"], establishments: [A, B], natures: ["01", "02"], confidentialite: set(1) })).toBeNull();
  });
});

// =====================================================================================================================================
// 3. Valeur affichée ≠ cellule contrôlée : contrats continus (rv13, verif-regles/c0-flux-continuite.test.ts, regles/continuite-filtre)
// =====================================================================================================================================
describe("filtre Nature, contrat continu CDD → CDI (seuil 5) : la sortie comptée sous le filtre seulement est n.d.", () => {
  // DSN fictives d'octobre 2025 à septembre 2026, un établissement, trois natures comptées (01, 02, 07), 6 personnes chacune depuis le
  // 01/01/2025. P : CDD K-30 (02) jusqu'au 31/03/2026, puis CDI K-31 (01) dès le 01/04/2026 (même personne, J / J+1 : contrat continu).
  // Sans filtre : sortie de mars et entrée d'avril neutralisées → la cellule canonique « CDD » des sorties de mars vaut 0 (affichée).
  // Filtre CDD : le partenaire (entrée CDI) est hors du périmètre, la sortie de P est comptée → 1 affiché, une seule personne, alors
  // que la cellule contrôlée vaut 0. Après : comptes différents (1 ≠ 0) → sorties de mars n.d. (raison du seuil), total de la période et
  // turnover qui les contiennent n.d. ; même chose pour l'entrée d'avril sous le filtre CDI.
  const NATURES = ["01", "02", "07"];
  const worker = (i: number, nature: string) => ({ nir: `2990175${100000 + i}`, employeeNumber: `E${i}`, contracts: [{ number: `K-${i}`, start: "2025-01-01", nature, gross: "1000.00" }] });
  const base6 = [...range(1, 6).map((i) => worker(i, "01")), ...range(11, 16).map((i) => worker(i, "02")), ...range(21, 26).map((i) => worker(i, "07"))];
  const P = (month: string): DsnPerson => {
    const contracts: DsnPerson["contracts"] = [];
    if (month <= "2026-03") contracts.push({ number: "K-30", start: "2025-01-01", nature: "02", gross: "1000.00", ...(month === "2026-03" ? { end: "2026-03-31", endReason: "031" } : {}) });
    if (month >= "2026-04") contracts.push({ number: "K-31", start: "2026-04-01", nature: "01", gross: "1000.00" });
    return { nir: "2990175199999", employeeNumber: "E30", contracts };
  };
  const data = dsnBuild(edgeFiles(monthRange("2025-10", "2026-09").map((month) => ({ month, people: [...base6, P(month)] }))));
  const input = kpiInput(data, DSN_ABSENCES, { natures: NATURES });
  const ctx = ctxOf(input, [], NATURES);

  it("sans filtre : sorties de mars 0 et entrées d'avril 0 (neutralisées), aucune garde", () => {
    expect(monthMovements(input, "2026-03").exits).toMatchObject({ kind: "exact", value: 0 });
    expect(monthMovements(input, "2026-04").entries).toMatchObject({ kind: "exact", value: 0 });
    expect(ready(ctx, { fin: "2026-09" }, set(5)).flows).toBeNull();
  });

  it("filtre CDD : sorties de mars n.d. (écran, total de la période, turnover, export) ; filtre CDI : entrées d'avril n.d.", () => {
    const cdd = ready(ctx, { nature: "02", fin: "2026-09" }, set(5));
    expect(cdd.guard).toBeNull();
    // Valeur que l'écran afficherait sans la règle : 1 sortie (P seul).
    expect(countedMovements(monthMovements(cdd.input, "2026-03"), "exit")).toHaveLength(1);
    expect(cdd.dash.rows.find((r) => r.month === "2026-03")!.movements.exits).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
    expect(cdd.dash.movements.exits).toMatchObject({ kind: "nd", nd: { reason: R5 } });
    expect(cdd.dash.tiles.turnover.current).toMatchObject({ kind: "nd", nd: { reason: R5 } });
    const sh = suiviSheet({ dash: cdd.dash, data: cdd.data, establishments: cdd.input.scope.establishments, rawLimit: cdd.rawLimit, vue: "suivi" });
    const col = sh.columns.findIndex((x) => x.header === "Sorties");
    expect(sh.rows.find((r) => r[0] === "2026-03")![col]).toEqual({ nd: R5 });
    // Les autres mois du périmètre restent affichés (février : 0 sortie, cellule canonique 0).
    expect(cdd.dash.rows.find((r) => r.month === "2026-02")!.movements.exits).toMatchObject({ kind: "exact", value: 0 });
    const g = flowGuard({ base: input, scope: { nature: "02" }, months: ["2026-02", "2026-03", "2026-04"], establishments: [], natures: NATURES, seuil: 5 });
    expect([...g!.months]).toEqual([["2026-03", { exits: R5 }]]);
    const cdi = ready(ctx, { nature: "01", fin: "2026-09" }, set(5));
    expect(cdi.dash.rows.find((r) => r.month === "2026-04")!.movements.entries).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
    // Filtre 07 : aucun mouvement, rien n'est masqué.
    expect(ready(ctx, { nature: "07", fin: "2026-09" }, set(5)).flows?.months.size).toBe(0);
  });
});

describe("filtre Établissement, mutation J/J+1 entre deux établissements (seuil 5) : même règle", () => {
  // A (NIC 00011) : 6 CDI + P (K-30, CDI, fin le 31/03/2026) ; B (NIC 00022) : 6 CDI + P dès le 01/04/2026 (K-31, CDI). Sans filtre :
  // sortie de mars et entrée d'avril neutralisées (0 et 0). Filtre A : la sortie de P est comptée (1 ≠ 0) → n.d. ; filtre B : l'entrée
  // d'avril (1 ≠ 0) → n.d.
  const worker = (i: number) => ({ nir: `2990175${100000 + i}`, employeeNumber: `E${i}`, contracts: [{ number: `K-${i}`, start: "2025-01-01", nature: "01", gross: "1000.00" }] });
  const P = { nir: "2990175199999", employeeNumber: "E30" };
  const specs = monthRange("2025-10", "2026-09").flatMap((month) => [
    { month, nic: "00011", people: [...range(1, 6).map(worker), ...(month <= "2026-03" ? [{ ...P, contracts: [{ number: "K-30", start: "2025-01-01", nature: "01", gross: "1000.00", ...(month === "2026-03" ? { end: "2026-03-31", endReason: "059" } : {}) }] }] : [])] },
    { month, nic: "00022", people: [...range(11, 16).map(worker), ...(month >= "2026-04" ? [{ ...P, contracts: [{ number: "K-31", start: "2026-04-01", nature: "01", gross: "1000.00" }] }] : [])] },
  ]);
  const data = dsnBuild(edgeFiles(specs).map((f, i) => ({ ...f, filename: `${specs[i].month}-${specs[i].nic}-edge.dsn` })));
  const input = kpiInput(data, DSN_ABSENCES, { natures: ["01"] });
  const ctx = ctxOf(input, [A, B], ["01"]);

  it("filtre A : sorties de mars n.d. ; filtre B : entrées d'avril n.d. ; sans filtre : 0 et 0", () => {
    expect(monthMovements(input, "2026-03").exits).toMatchObject({ kind: "exact", value: 0 });
    expect(monthMovements(input, "2026-04").entries).toMatchObject({ kind: "exact", value: 0 });
    const sa = ready(ctx, { etab: A, fin: "2026-09" }, set(5));
    expect(sa.guard).toBeNull();
    expect(sa.dash.rows.find((r) => r.month === "2026-03")!.movements.exits).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
    const sb = ready(ctx, { etab: B, fin: "2026-09" }, set(5));
    expect(sb.guard).toBeNull();
    expect(sb.dash.rows.find((r) => r.month === "2026-04")!.movements.entries).toEqual({ kind: "nd", nd: { code: "confidentialite", reason: R5 } });
  });
});
