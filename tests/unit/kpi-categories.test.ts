import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as sheets from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { CATEGORY_TABLE_LABELS, categoryScopeNote, kpiSuiviOf, loadCategoryMonths, scopeGuard, type CategoryMonthMasked } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import { confidentialiteReason, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI, type ConfidentialiteSetting } from "@/lib/confidentialite";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import { civilWindow } from "@/lib/rh/kpi/period";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild } from "./helpers/rh";

// Lot 12 — KPI RH › Suivi, tableau « Effectif et ETP par catégorie » : il suit les filtres Établissement et Nature de l'écran, comme
// la tuile « ETP contractuel fin de mois » (défaut reproduit par Lyes : tuile filtrée, tableau de toute l'entreprise sans avertissement),
// et il suit le seuil de confidentialité de l'espace (répartition par catégorie : moteur partagé, masquage secondaire dans le mois dont
// le total est publié) ; sous un filtre Établissement ou Nature, une garde rend tout l'écran n.d. quand le périmètre retenu est masqué.
// Fixture DSN fictive (référentiel de test), deux natures : CDI (01) et un CDD (02 : contrat 003, quotité 50 %, du 01/10/2024 au
// 31/12/2025), chaque contrat relié à une personne distincte. Cas de référence écrits à la main, fenêtre janvier → décembre 2025
// (fin=2025-12), ETP en dix-millièmes :
//   décembre 2025, toute l'entreprise : 7 contrats, 1 + 0,8 + 0,5 + 1 + 1 + 0,8 + 0,5 = 5,60 ETP → CDI 6 · 51 000, CDD 1 · 5 000 ;
//   janvier 2025 (avant l'entrée du contrat 002, 0,8 ETP, le 01/04/2025) : CDI 5 · 43 000, CDD 1 · 5 000 ;
//   filtre Nature = CDD : CDD 1 · 5 000 chaque mois de 2025 (le CDD est présent toute l'année), CDI hors du périmètre (sans colonne) ;
//   filtre Nature = CDI : CDI seul, 6 · 51 000 en décembre, 5 · 43 000 en janvier, CDD hors du périmètre.
// Seuil 2 (ou 5) : chaque mois, CDD (1 personne) est masqué ; CDI (5 ou 6 personnes) est la seule autre cellule et le total du mois est
// publié : CDI est masqué à son tour (secondaire), même raison ; 24 cellules sur l'année ; totaux conservés. Seuil 1 : rien.
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));

const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const SEUIL_1 = set(1);
const ABSENT: ConfidentialiteSetting = { kind: "absent" };
const R2 = confidentialiteReason(2);
const R5 = confidentialiteReason(5);
const dsn = dsnFixtureBuild();
const ctx = {
  collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "editor" }, establishments: [{ id: "00000000000011", label: "SIRET fictif" }], natures: { codes: ["01", "02"], origin: "default" }, payfitHistory: null, state: null },
  settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
  input: { ...kpiInput(dsn, DSN_ABSENCES), openMonths: [] },
  readTypes: [],
} as unknown as KpiContext;
const ready = (sp: Record<string, string>, conf: ConfidentialiteSetting = SEUIL_1) => {
  const s = kpiSuiviOf(ctx, sp, conf);
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  return s;
};
const value = (c: CategoryMonthMasked) => (c.kind === "value" ? c : (() => { throw new Error(`${c.month} : ${c.reason}`); })());
// Cellules affichées d'un mois, sous la forme { effectif, ETP } ; une cellule n.d. fait échouer (sauf attendu).
const cells = (c: CategoryMonthMasked) =>
  Object.fromEntries(Object.entries(value(c).byCategory).map(([k, x]) => [k, x.kind === "value" ? { headcount: x.headcount, etp4: x.etp4 } : (() => { throw new Error(`${c.month} ${k} : ${x.reason}`); })()]));
const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);

describe("tableau par catégorie : même entrée filtrée que les tuiles (cas de référence écrits à la main)", () => {
  it("sans filtre : colonnes CDI et CDD ; décembre 2025 = CDI 6 · 5,10 + CDD 1 · 0,50 = 7 · 5,60 ; rien de caché, aucune mention", async () => {
    const s = ready({ fin: "2025-12" });
    expect(s.w.months).toEqual(MONTHS_2025);
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(cat.keys).toEqual(["cdi", "cdd"]);
    expect(cat.hidden).toEqual([]);
    expect(cells(cat.months[11])).toEqual({ cdi: { headcount: 6, etp4: 51_000 }, cdd: { headcount: 1, etp4: 5_000 } });
    expect(cells(cat.months[0])).toEqual({ cdi: { headcount: 5, etp4: 43_000 }, cdd: { headcount: 1, etp4: 5_000 } });
    expect(value(cat.months[11]).total).toEqual({ headcount: 7, etp4: 56_000 });
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 56_000 });
    expect(categoryScopeNote(s, cat.hidden)).toBeNull();
    expect([cat.masked, cat.seuil]).toEqual([0, { seuil: 1, reason: null }]);
    expect(s.guard).toBeNull();
  });

  it("filtre Nature = CDD : une seule colonne CDD, CDI nommée hors du périmètre ; chaque mois, la somme des catégories = ETP fin de mois filtré ; tuile 0,50", async () => {
    const s = ready({ fin: "2025-12", nature: "02" });
    expect(s.input.scope).toEqual({ establishments: undefined, nature: "02" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(cat.keys).toEqual(["cdd"]);
    expect(cat.hidden).toEqual(["cdi"]);
    cat.months.forEach((c, i) => {
      const row = s.dash.rows[i];
      expect(c.month).toBe(row.month);
      expect(cells(c), c.month).toEqual({ cdd: { headcount: 1, etp4: 5_000 } }); // jamais une cellule CDI à 0
      // Même calcul que la colonne « ETP fin de mois » du tableau mensuel (etpMonthEnd sur l'entrée filtrée).
      expect(row.etp.kind).toBe("exact");
      if (row.etp.kind !== "nd") {
        expect(value(c).total.etp4, c.month).toBe(row.etp.etp4);
        expect(value(c).total.headcount, c.month).toBe(row.etp.contributions.length + row.etp.missing.length);
      }
    });
    // Tuile « ETP contractuel fin décembre 2025 » filtrée : 0,50 ETP = 5 000 dix-millièmes = total du tableau.
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 5_000 });
    expect(categoryScopeNote(s, cat.hidden)).toBe("Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
  });

  it("filtre Nature = CDI : CDD hors du périmètre ; décembre 2025 = 6 · 5,10, janvier 2025 = 5 · 4,30 ; tuile 5,10", async () => {
    const s = ready({ fin: "2025-12", nature: "01" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(cat.keys).toEqual(["cdi"]);
    expect(cat.hidden).toEqual(["cdd"]);
    expect(cells(cat.months[11])).toEqual({ cdi: { headcount: 6, etp4: 51_000 } });
    expect(cells(cat.months[0])).toEqual({ cdi: { headcount: 5, etp4: 43_000 } });
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 51_000 });
    cat.months.forEach((c, i) => {
      const e = s.dash.rows[i].etp;
      if (e.kind !== "nd") expect(value(c).total.etp4, c.month).toBe(e.etp4);
    });
    expect(categoryScopeNote(s, cat.hidden)).toBe("Filtres appliqués : nature CDI (01). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDD.");
  });

  it("filtre Établissement (seul établissement de la fixture) : mêmes chiffres que toute l'entreprise, mention avec le libellé, rien de caché", async () => {
    const s = ready({ fin: "2025-12", etab: "00000000000011" });
    expect(s.input.scope).toEqual({ establishments: ["00000000000011"], nature: undefined });
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(cat.keys).toEqual(["cdi", "cdd"]);
    expect(cat.hidden).toEqual([]);
    expect(cells(cat.months[11])).toEqual({ cdi: { headcount: 6, etp4: 51_000 }, cdd: { headcount: 1, etp4: 5_000 } });
    expect(categoryScopeNote(s, cat.hidden)).toBe("Filtres appliqués : établissement SIRET fictif. Mêmes contrats que les indicateurs.");
    // Les deux filtres : établissement puis nature ; un établissement inconnu du contexte garde son identifiant.
    const both = ready({ fin: "2025-12", etab: "00000000000011", nature: "02" });
    expect(categoryScopeNote(both, ["cdi"])).toBe("Filtres appliqués : établissement SIRET fictif · nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
    expect(categoryScopeNote({ ...both, etab: "99999999999999" }, [])).toBe("Filtres appliqués : établissement 99999999999999 · nature CDD (02). Mêmes contrats que les indicateurs.");
    expect(categoryScopeNote({ ...both, etab: "", nature: "" }, ["cdi"])).toBeNull();
  });

  it("fenêtre sans aucun contrat de la nature retenue (CDD, année 2026) : aucune colonne, total du tableau = tuile = 0 contrat (valeur calculée, pas inventée)", async () => {
    // Le CDD 003 se termine le 31/12/2025 : sur janvier → septembre 2026, l'effectif de nature 02 est vide ; la tuile dit 0 contrat et
    // 0,00 ETP (résultat exact du moteur, aucun contrat compté) et le tableau n'a aucune colonne de catégorie : CDI est nommée hors du périmètre.
    const s = ready({ fin: "2026-09", nature: "02" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(cat.keys).toEqual(["cdd"]); // octobre → décembre 2025 : le CDD est encore présent
    expect(cat.hidden).toEqual(["cdi"]);
    expect(cells(cat.months[11])).toEqual({});
    expect(value(cat.months[11]).total).toEqual({ headcount: 0, etp4: 0 });
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 0 });
    const civil = ready({ mode: "civil", annee: "2026", nature: "02" });
    const cat26 = await loadCategoryMonths(civil.input, civil.w, "w1", SEUIL_1);
    expect(cat26.keys).toEqual([]);
    expect(cat26.hidden).toEqual(["cdi"]);
  });
});

describe("tableau par catégorie : seuil de confidentialité (répartition par catégorie, moteur partagé)", () => {
  it("seuil 2 : chaque mois, CDD (1 personne) n.d. et CDI (seule autre cellule, total publié) n.d. avec la même raison ; totaux conservés ; 24 cellules", async () => {
    const s = ready({ fin: "2025-12" }, set(2));
    const cat = await loadCategoryMonths(s.input, s.w, "w1", set(2));
    expect(cat.keys).toEqual(["cdi", "cdd"]);
    for (const c of cat.months) {
      expect(value(c).byCategory, c.month).toEqual({ cdi: { kind: "nd", reason: R2 }, cdd: { kind: "nd", reason: R2 } });
    }
    expect(value(cat.months[11]).total).toEqual({ headcount: 7, etp4: 56_000 });
    expect(value(cat.months[0]).total).toEqual({ headcount: 6, etp4: 48_000 });
    expect(cat.masked).toBe(24);
    expect(cat.seuil).toEqual({ seuil: 2, reason: null });
  });
  it("seuil 5 : même résultat (CDI compte 5 ou 6 personnes, assez pour protéger le CDD : masqué à son tour) ; seuil 1 : rien", async () => {
    const s = ready({ fin: "2025-12" }, set(5));
    const five = await loadCategoryMonths(s.input, s.w, "w1", set(5));
    expect(value(five.months[0]).byCategory).toEqual({ cdi: { kind: "nd", reason: R5 }, cdd: { kind: "nd", reason: R5 } });
    expect(five.masked).toBe(24);
    const one = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    expect(one.masked).toBe(0);
    expect(cells(one.months[0])).toEqual({ cdi: { headcount: 5, etp4: 43_000 }, cdd: { headcount: 1, etp4: 5_000 } });
  });
  it("seuil absent ou illisible : chaque cellule n.d. avec la raison du paramètre (aucun masquage par défaut), totaux conservés", async () => {
    const s = ready({ fin: "2025-12" }, ABSENT);
    const cat = await loadCategoryMonths(s.input, s.w, "w1", ABSENT);
    expect(value(cat.months[11]).byCategory).toEqual({ cdi: { kind: "nd", reason: SEUIL_NON_DEFINI }, cdd: { kind: "nd", reason: SEUIL_NON_DEFINI } });
    expect(value(cat.months[11]).total).toEqual({ headcount: 7, etp4: 56_000 });
    expect([cat.masked, cat.seuil]).toEqual([0, { seuil: null, reason: SEUIL_NON_DEFINI }]);
    const bad = await loadCategoryMonths(s.input, s.w, "w1", { kind: "invalid", raw: "5" });
    expect(value(bad.months[0]).byCategory.cdi).toEqual({ kind: "nd", reason: SEUIL_ILLISIBLE });
  });
  it("sous un filtre Nature (CDD seul dans le périmètre, seuil 2) : la cellule est le total du périmètre, publié par la garde ou non ; ici masquée (1 personne)", async () => {
    const s = ready({ fin: "2025-12", nature: "02" }, set(2));
    const cat = await loadCategoryMonths(s.input, s.w, "w1", set(2));
    expect(value(cat.months[11]).byCategory).toEqual({ cdd: { kind: "nd", reason: R2 } });
    expect(value(cat.months[11]).total).toEqual({ headcount: 1, etp4: 5_000 });
  });
});

describe("garde du périmètre (filtre Établissement ou Nature) : comme le service retenu de la Masse salariale", () => {
  it("nature CDD (1 personne), seuil 2 : gardé avec la raison du seuil ; nature CDI : gardé aussi (masqué à son tour sans filtre : il protège le CDD) ; seuil 1 : rien", () => {
    expect(ready({ fin: "2025-12", nature: "02" }, set(2)).guard).toEqual({ cause: "seuil", reason: R2 });
    expect(ready({ fin: "2025-12", nature: "01" }, set(2)).guard).toEqual({ cause: "seuil", reason: R2 });
    expect(ready({ fin: "2025-12", nature: "02" }, SEUIL_1).guard).toBeNull();
    expect(ready({ fin: "2025-12", nature: "01" }, SEUIL_1).guard).toBeNull();
  });
  it("sans filtre : jamais de garde, quel que soit le seuil ; seuil absent sous un filtre : garde « non défini »", () => {
    expect(ready({ fin: "2025-12" }, set(50)).guard).toBeNull();
    expect(ready({ fin: "2025-12" }, ABSENT).guard).toBeNull();
    expect(ready({ fin: "2025-12", nature: "02" }, ABSENT).guard).toEqual({ cause: "parametre", reason: SEUIL_NON_DEFINI });
    expect(ready({ fin: "2025-12", etab: "00000000000011" }, { kind: "invalid", raw: "5" }).guard).toEqual({ cause: "parametre", reason: SEUIL_ILLISIBLE });
  });
  it("établissement unique (6 à 7 personnes) : affiché au seuil 2, gardé au seuil 10 (1 à seuil − 1 personnes)", () => {
    expect(ready({ fin: "2025-12", etab: "00000000000011" }, set(2)).guard).toBeNull();
    expect(ready({ fin: "2025-12", etab: "00000000000011" }, set(10)).guard).toEqual({ cause: "seuil", reason: confidentialiteReason(10) });
  });
  it("les mois de N-1 comptent (tuiles et colonnes N-1) : CDD de 2026 (aucun contrat sur la période, 1 personne sur N-1), seuil 2 : gardé", () => {
    // Période janvier → septembre 2026 (fin=2026-09) : aucun CDD ; N-1 octobre 2024 → septembre 2025 : le CDD 003 est présent (1 personne).
    const s = ready({ fin: "2026-09", nature: "02" }, set(2));
    expect(s.guard).toEqual({ cause: "seuil", reason: R2 });
    // Sur les seuls mois de 2026 (fonction pure, sans N-1 ; octobre → décembre hors de la lecture : ignorés) : le périmètre ne désigne
    // personne, rien à protéger.
    expect(scopeGuard({ input: s.input, months: civilWindow(2026).months, establishments: ["00000000000011"], natures: ["01", "02"], confidentialite: set(2) })).toBeNull();
  });
  it("valeur du filtre inconnue des listes de l'espace : masquage principal du seul périmètre (jamais une valeur affichée sans contrôle)", () => {
    const s = ready({ fin: "2025-12", nature: "02" }, set(2));
    expect(scopeGuard({ input: s.input, months: ["2025-12"], establishments: [], natures: ["01"], confidentialite: set(2) })).toEqual({ cause: "seuil", reason: R2 });
    expect(scopeGuard({ input: s.input, months: ["2025-12"], establishments: [], natures: ["01"], confidentialite: SEUIL_1 })).toBeNull();
  });
});

describe("feuille Excel « Par catégorie » : mêmes cellules que l'écran filtré, note qui dit que les filtres s'appliquent", () => {
  it("filtre Nature = CDD : une colonne CDD, douze lignes 1 · 0,50, note avec la mention ; la note contraire du lot 11 n'existe plus", async () => {
    const s = ready({ fin: "2025-12", nature: "02" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1", SEUIL_1);
    const sh = sheets.categoriesSheet(cat.months, cat.keys, CATEGORY_TABLE_LABELS, { scope: categoryScopeNote(s, cat.hidden) });
    expect(sh.columns.map((c) => c.header)).toEqual(["Mois", "CDD — effectif", "CDD — ETP", "Total — effectif", "Total — ETP", "Observations"]);
    expect(sh.rows).toEqual(MONTHS_2025.map((m) => [m, 1, 5_000, 1, 5_000, ""]));
    expect(sh.note).toBe("Fin de mois ; catégorie sans contrat ce mois-là : cellule vide. Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
    expect(sh.note).not.toContain("ne s'appliquent pas");
    expect("CATEGORIES_UNSCOPED_NOTE" in sheets).toBe(false);
  });
  it("seuil 2, sans filtre : les mêmes cellules n.d. que l'écran (raison en commentaire), totaux conservés", async () => {
    const s = ready({ fin: "2025-12" }, set(2));
    const cat = await loadCategoryMonths(s.input, s.w, "w1", set(2));
    const sh = sheets.categoriesSheet(cat.months, cat.keys, CATEGORY_TABLE_LABELS);
    expect(sh.rows[11]).toEqual(["2025-12", { nd: R2 }, { nd: R2 }, { nd: R2 }, { nd: R2 }, 7, 56_000, ""]);
  });
});

describe("écran KPI RH : assemblage du bloc par catégorie (lecture du code de la page)", () => {
  const page = readFileSync("src/app/e/[slug]/studio-rh/kpi/page.tsx", "utf8");
  it("le tableau reçoit l'entrée filtrée des tuiles (input) et le seuil de l'espace, plus jamais le référentiel sans périmètre (ctx.input)", () => {
    expect(page).toContain("loadCategoryMonths(input, w, ctx.collab.workspace.id, confidentialite)");
    expect(page).not.toContain("loadCategoryMonths(ctx.input");
  });
  it("la mention du périmètre est écrite sous le tableau, avec son data-testid, et le libellé des colonnes vient du même dictionnaire que l'export", () => {
    expect(page).toContain("categoryScopeNote(suivi, cat.hidden)");
    expect(page).toContain('{catScope && <p className="desc" data-testid="kpi-categories-scope">{catScope}</p>}');
    expect(page.indexOf('data-testid="kpi-categories-table"')).toBeLessThan(page.indexOf('data-testid="kpi-categories-scope"'));
    expect(page).toContain("labels={CATEGORY_TABLE_LABELS}");
    expect(page).not.toContain("ne s'appliquent pas");
  });
  it("une cellule masquée est n.d. avec sa raison, le total vient du calcul avant masquage ; ligne Confidentialité et garde du périmètre", () => {
    expect(page).toContain('<abbr className="nd" title={x.reason}>n.d.</abbr>');
    expect(page).toContain("{c.total.headcount}");
    expect(page).toContain('testid="kpi-categories-confidentialite"');
    expect(page).toContain('data-testid="kpi-categories-masked"');
    expect(page).toContain('data-testid="kpi-scope-guard"');
    expect(page).toContain("Retirer les filtres Établissement et Nature");
    expect(page).not.toContain("Object.values(c.byCategory)"); // plus aucun total recalculé par l'écran sur des cellules masquées
  });
});
