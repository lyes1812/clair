import { describe, expect, it } from "vitest";
import { etpCascade, type Cascade, type StepId } from "@/lib/budget/cascade";
import type { Version } from "@/lib/budget/versions";
import { confidentialiteReason } from "@/lib/confidentialite";
import { buildEffets, EFFETS_TABLE_IDS, type EffetsInput } from "@/lib/viz/croisee-budget";
import { cascadeView, maskCascade, maskCascadeSteps } from "@/lib/viz/ecart";

// Cascade d'ETP (Analyse des écarts et croisée 08) : règle « union » du lot 12. Un palier d'une période est n.d. dès qu'il est masqué
// dans la cascade de la période ou dans celle d'un seul de ses mois (mêmes versions, même rang de mois), puis la relation de la période
// (écart total publié) est reprise avec ces paliers déjà masqués. Cas fictifs écrits à la main, seuil 3, ETP en dix-millièmes.

const E = (x: number) => Math.round(x * 10000);
const R3 = confidentialiteReason(3);
type Who = Record<string, (number | null)[]>; // clé → ETP par rang de mois (janvier, février, mars), null : absent
const version = (label: string, year: string, who: Who): Version =>
  ({
    key: label, label, kind: "reel", year,
    months: new Map([0, 1, 2].map((i) => {
      const m = `${year}-0${i + 1}`;
      const map = Object.fromEntries(Object.entries(who).flatMap(([k, v]) => (v[i] === null || v[i] === undefined ? [] : [[k, E(v[i] as number)]])));
      return [m, { month: m, people: { kind: "value", map } }];
    })),
  }) as unknown as Version;
const many = (keys: string[], v: (number | null)[]): Who => Object.fromEntries(keys.map((k) => [k, v]));
const W = ["W1", "W2", "W3", "W4", "W5"], Y = ["Y1", "Y2", "Y3"], Z = ["Z1", "Z2", "Z3"];
const LINK = new Map([...W, "X", ...Y, ...Z].map((k) => [k, `P-${k}`] as const));

// --- Cas des relecteurs, prolongé à mars ---------------------------------------------------------------------------------------
// Réel 2025 (A) : W1…W5 à 1,00 ; X à 0,60 en janvier seulement (une seule personne, qui sort) ; Y1…Y3 à 0,50 en janvier, 0,20 en
// février et mars. Réel 2026 (B) : W1…W5 à 1,00 ; Y1…Y3 à 0,80 en janvier, 1,00 en février et mars ; Z1…Z3 à 1,00 en janvier seulement.
// Jumeau : X à 0,40 et Y1 à 0,70 en janvier 2025 (même total de janvier 2025 : 0,60 + 0,50 = 0,40 + 0,70), tout le reste identique.
const aOf = (x: number, y1: number): Who => ({ ...many(W, [1, 1, 1]), X: [x, null, null], Y1: [y1, 0.2, 0.2], ...many(["Y2", "Y3"], [0.5, 0.2, 0.2]) });
const B = version("Réel 2026", "2026", { ...many(W, [1, 1, 1]), ...many(Y, [0.8, 1, 1]), ...many(Z, [1, null, null]) });
const CASE = { A: version("Réel 2025", "2025", aOf(0.6, 0.5)), B };
const TWIN = { A: version("Réel 2025", "2025", aOf(0.4, 0.7)), B };
const PERIODS: [string, number[]][] = [["janvier", [1]], ["février", [2]], ["mars", [3]], ["janvier → février", [1, 2]], ["février → mars", [2, 3]], ["janvier → mars", [1, 2, 3]]];
const cascadeOf = (v: { A: Version; B: Version }, ranks: number[]): Extract<Cascade, { kind: "value" }> => {
  const c = etpCascade(v.A, v.B, ranks.map((r) => `2025-0${r}`), ranks.map((r) => `2026-0${r}`));
  if (c.kind !== "value") throw new Error(c.reason);
  return c;
};
const ids = (c: { steps: { id: StepId }[] }) => c.steps.map((s) => s.id);
// Ce que l'Analyse des écarts publie pour une période : départ, arrivée, résiduel, et chaque palier (valeur ou « n.d. » et sa raison).
function analyse(v: { A: Version; B: Version }, ranks: number[]) {
  const view = cascadeView(cascadeOf(v, ranks), { kind: "set", value: 3 }, LINK, null);
  if (view.kind !== "value") throw new Error(view.reason);
  return { start: view.start, end: view.end, residual: view.residual, steps: view.steps.map((s) => (s.nd === null ? s.etp4 : s.nd)) };
}

describe("cascades de chaque mois (byMonth) : même calcul que la période, mêmes versions, même rang de mois", () => {
  it("janvier → mars : paliers de janvier, février et mars calculés à la main", () => {
    const c = cascadeOf(CASE, [1, 2, 3]);
    expect(c.byMonth).toHaveLength(3);
    // Janvier : entrées {Z} 3 × 1,00 = +3,00 ; sorties {X} −0,60 ; changement {Y} 3 × (0,80 − 0,50) = +0,90. Février et mars :
    // changement {Y} 3 × (1,00 − 0,20) = +2,40. W ne bouge pas (contribution nulle, non listé). Un mois ne connaît ni report ni déport.
    expect(c.byMonth.map((steps) => steps.map((s) => s.etp4))).toEqual([[30000, 0, -6000, 0, 9000], [0, 0, 0, 0, 24000], [0, 0, 0, 0, 24000]]);
    expect(c.byMonth[0].map((s) => s.people.map((p) => p.key))).toEqual([Z, [], ["X"], [], Y]);
    // Période d'un mois : son seul mois est la période elle-même.
    const jan = cascadeOf(CASE, [1]);
    expect(jan.byMonth).toEqual([jan.steps]);
  });
});

describe("cas des relecteurs : la sortie de X (une personne) n'est plus reconstituable", () => {
  it("janvier → février : le « Changement d'ETP » (1,65) est n.d. car celui de janvier est masqué (secondaire) ; 2 × 1,65 − 2,40 ne se calcule plus", () => {
    // Janvier (seuil 3) : sorties {X} masquées ; en second, le plus petit palier qui décrit quelqu'un : changement 0,90 < entrées 3,00.
    expect(maskCascadeSteps(cascadeOf(CASE, [1]).steps, LINK, 3)).toEqual(["shown", "shown", "masked", "shown", "secondary"]);
    // Janvier → février seule : entrées (Z1…Z3 à 1,00 en janvier) 3 ÷ 2 = 1,50 ; sorties −0,60 ÷ 2 = −0,30 ; changement
    // 3 × (1,80 − 0,70) ÷ 4 × 2 = 1,65. Sorties masquées, entrées (1,50 < 1,65) en second : le changement restait affiché.
    const jf = cascadeOf(CASE, [1, 2]);
    expect(jf.steps.map((s) => s.etp4)).toEqual([15000, 0, -3000, 0, 16500]);
    expect(maskCascadeSteps(jf.steps, LINK, 3)).toEqual(["secondary", "shown", "masked", "shown", "shown"]);
    // Règle « union » : le changement de janvier est masqué, donc celui de janvier → février aussi.
    expect(maskCascade(jf, LINK, 3).status).toEqual(["secondary", "shown", "masked", "shown", "secondary"]);
    expect(analyse(CASE, [1, 2]).steps).toEqual([R3, 0, R3, 0, R3]);
  });

  it("janvier, février, mars, janvier → février, février → mars, janvier → mars : le jumeau (X à 0,40) publie exactement les mêmes nombres, alors que sa sortie de janvier vaut −0,40 au lieu de −0,60", () => {
    // Publication de l'Analyse, période par période (seuil 3), calculée à la main :
    // janvier : départ 7,10 (5 + 0,60 + 1,50), arrivée 10,40 (5 + 2,40 + 3), entrées +3,00, report 0, sorties n.d., déport 0, changement n.d. ;
    // février et mars : départ 5,60, arrivée 8,00, changement +2,40, autres paliers 0 ;
    // janvier → février : départ 6,35, arrivée 9,20, report 0 et déport 0, entrées, sorties et changement n.d. ;
    // février → mars : comme février ;
    // janvier → mars : départ 6,10, arrivée 8,80, report 0 et déport 0, entrées (1,00 < changement 1,90 : second), sorties et
    // changement (union : janvier) n.d.
    // Jumeau : janvier, changement 0,10 + 0,30 + 0,30 = 0,70 (toujours plus petit que les entrées 3,00 : même secondaire) ; janvier →
    // février, changement 0,45 + 0,55 + 0,55 = 1,55 > entrées 1,50 ; janvier → mars, changement 1,8333 > entrées 1,00 : mêmes statuts.
    const expected: Record<string, ReturnType<typeof analyse>> = {
      janvier: { start: 71000, end: 104000, residual: 0, steps: [30000, 0, R3, 0, R3] },
      "février": { start: 56000, end: 80000, residual: 0, steps: [0, 0, 0, 0, 24000] },
      mars: { start: 56000, end: 80000, residual: 0, steps: [0, 0, 0, 0, 24000] },
      "janvier → février": { start: 63500, end: 92000, residual: 0, steps: [R3, 0, R3, 0, R3] },
      "février → mars": { start: 56000, end: 80000, residual: 0, steps: [0, 0, 0, 0, 24000] },
      "janvier → mars": { start: 61000, end: 88000, residual: 0, steps: [R3, 0, R3, 0, R3] },
    };
    for (const [name, ranks] of PERIODS) {
      expect(analyse(CASE, ranks), name).toEqual(expected[name]);
      expect(analyse(TWIN, ranks), `jumeau, ${name}`).toEqual(expected[name]);
    }
    // Les deux cas diffèrent sur la cellule protégée : aucune combinaison de ces publications ne peut donc rendre la sortie de X.
    const sortie = (v: { A: Version; B: Version }) => cascadeOf(v, [1]).steps.find((s) => s.id === "sorties")!.etp4;
    expect([sortie(CASE), sortie(TWIN)]).toEqual([-6000, -4000]);
    expect(ids(cascadeOf(CASE, [1]))).toEqual(["entrees-new", "entrees-report", "sorties", "sorties-deport", "etp-change"]);
  });

  it("croisée 08 (N-1 → N sur la période) : même règle, mêmes cellules n.d. que l'Analyse, et le jumeau publie le même tableau", () => {
    // Départ et arrivée exacts de la croisée : somme des ETP de fin de mois ÷ (n × 10 000), comme la carte (ici égaux à la cascade).
    const sum = (v: Version, months: string[]) => months.reduce((s, m) => s + Object.values((v.months.get(m) as unknown as { people: { map: Record<string, number> } }).people.map).reduce((x, y) => x + y, 0), 0);
    const effets = (v: { A: Version; B: Version }, ranks: number[]) => {
      const ma = ranks.map((r) => `2025-0${r}`);
      const mb = ranks.map((r) => `2026-0${r}`);
      const den = ranks.length * 10000;
      const input: EffetsInput = {
        kind: "value", year: 2026, labels: { period: "période N", prev: "période N-1" },
        masse: { cur: { kind: "nd", reason: "hors du cas" }, prev: { kind: "nd", reason: "hors du cas" } },
        pont: { kind: "nd", reason: "hors du cas" },
        cascade: etpCascade(v.A, v.B, ma, mb),
        etp: { cur: { kind: "value", num: sum(v.B, mb), den }, prev: { kind: "value", num: sum(v.A, ma), den } },
        confidentialite: { kind: "set", value: 3 }, serviceGuard: null, link: LINK,
        hrefs: { analyse: "/a", embauches: "/e", globales: "/g", fixeVariable: "/f", parametres: "/p" },
      };
      const t = buildEffets(input).tables.find((x) => x.id === EFFETS_TABLE_IDS.etp)!;
      return [...t.rows.map((r) => r.cells), t.foot?.cells];
    };
    const N3 = { nd: R3 };
    // Janvier → février : départ 12,70 ÷ 2 = 6,35, arrivée 18,40 ÷ 2 = 9,20, entrées, sorties et changement n.d., écart total +2,85.
    expect(effets(CASE, [1, 2]).map((cells) => cells![2])).toEqual(["", N3, 0, N3, 0, N3, { exact: 0 }, { exact: 2.85 }, ""]);
    for (const [name, ranks] of PERIODS) expect(effets(TWIN, ranks), name).toEqual(effets(CASE, ranks));
  });
});

describe("relation de la période reprise après l'union : un palier masqué par un mois ne reste pas seul", () => {
  it("X présent en janvier 2025 et en février 2026 seulement : le changement de janvier → février, affiché par la période et par ses mois, est masqué en second", () => {
    // A : W1…W4 à 1,00 ; X à 0,60 en janvier ; Y1…Y3 à 0,50. B : W1…W4 à 1,00 ; Z1…Z3 à 0,20 ; X à 0,80 en février ; Y1…Y3 à 1,00.
    const v = {
      A: version("Réel 2025", "2025", { ...many(W.slice(0, 4), [1, 1, 1]), X: [0.6, null, null], ...many(Y, [0.5, 0.5, 0.5]) }),
      B: version("Réel 2026", "2026", { ...many(W.slice(0, 4), [1, 1, 1]), ...many(Z, [0.2, 0.2, 0.2]), X: [null, 0.8, null], ...many(Y, [1, 1, 1]) }),
    };
    const c = cascadeOf(v, [1, 2]);
    // Janvier : entrées {Z} +0,60, sorties {X} −0,60 (masquées), changement {Y} +1,50 ; en second, entrées (0,60 < 1,50).
    // Février : entrées {Z, X} +1,40 (4 personnes), changement {Y} +1,50 : rien sous le seuil.
    expect(c.byMonth.map((steps) => steps.map((s) => s.etp4))).toEqual([[6000, 0, -6000, 0, 15000], [14000, 0, 0, 0, 15000]]);
    expect(c.byMonth.map((steps) => maskCascadeSteps(steps, LINK, 3))).toEqual([["secondary", "shown", "masked", "shown", "shown"], ["shown", "shown", "shown", "shown", "shown"]]);
    // Période : X est présent dans les deux versions (un mois chacune) : changement (0,80 − 0,60) ÷ 2 = +0,10 avec Y (3 × 0,50) =
    // +1,60 ; entrées {Z} 3 × 0,40 ÷ 2 = +0,60 ; sorties vides. Seule, la période ne masque rien.
    expect(c.steps.map((s) => s.etp4)).toEqual([6000, 0, 0, 0, 16000]);
    expect(maskCascadeSteps(c.steps, LINK, 3)).toEqual(Array(5).fill("shown"));
    // Union : entrées (second en janvier) et sorties (masquées en janvier, vides sur la période) n.d. Les sorties étant vides, l'écart
    // total moins le changement redonnerait les entrées : la relation reprise masque aussi le changement (sans cela, l'ETP de X se
    // déduisait des trois périodes janvier, février et janvier → février).
    const m = maskCascade(c, LINK, 3);
    expect(m.status).toEqual(["secondary", "shown", "secondary", "shown", "secondary"]);
    expect(m.reasons).toEqual([R3, null, R3, null, R3]);
    expect(m.chart).toBe(R3);
  });
});
