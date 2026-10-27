import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as sheets from "@/app/e/[slug]/studio-rh/kpi/export/sheets";
import { CATEGORY_TABLE_LABELS, categoryScopeNote, kpiSuiviOf, loadCategoryMonths } from "@/app/e/[slug]/studio-rh/kpi/suivi-data";
import type { CategoryMonth } from "@/lib/budget/categories";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild } from "./helpers/rh";

// Lot 12 — KPI RH › Suivi, tableau « Effectif et ETP par catégorie » : il suit les filtres Établissement et Nature de l'écran, comme
// la tuile « ETP contractuel fin de mois » (défaut reproduit par Lyes : tuile filtrée, tableau de toute l'entreprise sans avertissement).
// Fixture DSN fictive (référentiel de test), deux natures : CDI (01) et un CDD (02 : contrat 003, quotité 50 %, du 01/10/2024 au
// 31/12/2025). Cas de référence écrits à la main, fenêtre janvier → décembre 2025 (fin=2025-12), ETP en dix-millièmes :
//   décembre 2025, toute l'entreprise : 7 contrats, 1 + 0,8 + 0,5 + 1 + 1 + 0,8 + 0,5 = 5,60 ETP → CDI 6 · 51 000, CDD 1 · 5 000 ;
//   janvier 2025 (avant l'entrée du contrat 002, 0,8 ETP, le 01/04/2025) : CDI 5 · 43 000, CDD 1 · 5 000 ;
//   filtre Nature = CDD : CDD 1 · 5 000 chaque mois de 2025 (le CDD est présent toute l'année), CDI hors du périmètre (sans colonne) ;
//   filtre Nature = CDI : CDI seul, 6 · 51 000 en décembre, 5 · 43 000 en janvier, CDD hors du périmètre.
vi.mock("@/lib/budget/categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/budget/categories")>()),
  getCategoryNatures: async () => ({ natures: (await orig<typeof import("@/lib/budget/categories")>()).DEFAULT_CATEGORY_NATURES, origin: "default" }),
  getContractCategories: async () => ({}),
}));

const dsn = dsnFixtureBuild();
const ctx = {
  collab: { workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: "editor" }, establishments: [{ id: "00000000000011", label: "SIRET fictif" }], natures: { codes: ["01", "02"], origin: "default" }, payfitHistory: null, state: null },
  settings: { values: KPI_DEFAULTS, origins: {}, invalid: [] },
  input: { ...kpiInput(dsn, DSN_ABSENCES), openMonths: [] },
  readTypes: [],
} as unknown as KpiContext;
const ready = (sp: Record<string, string>) => {
  const s = kpiSuiviOf(ctx, sp);
  if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
  return s;
};
const value = (c: CategoryMonth) => (c.kind === "value" ? c : (() => { throw new Error(`${c.month} : ${c.reason}`); })());
const totalEtp4 = (c: CategoryMonth) => Object.values(value(c).byCategory).reduce((n, x) => n + (x.etp4 ?? 0), 0);
const totalHeadcount = (c: CategoryMonth) => Object.values(value(c).byCategory).reduce((n, x) => n + x.headcount, 0);
const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);

describe("tableau par catégorie : même entrée filtrée que les tuiles (cas de référence écrits à la main)", () => {
  it("sans filtre : colonnes CDI et CDD ; décembre 2025 = CDI 6 · 5,10 + CDD 1 · 0,50 = 7 · 5,60 ; rien de caché, aucune mention", async () => {
    const s = ready({ fin: "2025-12" });
    expect(s.w.months).toEqual(MONTHS_2025);
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    expect(cat.keys).toEqual(["cdi", "cdd"]);
    expect(cat.hidden).toEqual([]);
    expect(value(cat.months[11]).byCategory).toEqual({ cdi: { headcount: 6, etp4: 51_000 }, cdd: { headcount: 1, etp4: 5_000 } });
    expect(value(cat.months[0]).byCategory).toEqual({ cdi: { headcount: 5, etp4: 43_000 }, cdd: { headcount: 1, etp4: 5_000 } });
    expect(totalEtp4(cat.months[11])).toBe(56_000);
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 56_000 });
    expect(categoryScopeNote(s, cat.hidden)).toBeNull();
  });

  it("filtre Nature = CDD : une seule colonne CDD, CDI nommée hors du périmètre ; chaque mois, la somme des catégories = ETP fin de mois filtré ; tuile 0,50", async () => {
    const s = ready({ fin: "2025-12", nature: "02" });
    expect(s.input.scope).toEqual({ establishments: undefined, nature: "02" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    expect(cat.keys).toEqual(["cdd"]);
    expect(cat.hidden).toEqual(["cdi"]);
    cat.months.forEach((c, i) => {
      const row = s.dash.rows[i];
      expect(c.month).toBe(row.month);
      expect(value(c).byCategory, c.month).toEqual({ cdd: { headcount: 1, etp4: 5_000 } }); // jamais une cellule CDI à 0
      // Même calcul que la colonne « ETP fin de mois » du tableau mensuel (etpMonthEnd sur l'entrée filtrée).
      expect(row.etp.kind).toBe("exact");
      if (row.etp.kind !== "nd") {
        expect(totalEtp4(c), c.month).toBe(row.etp.etp4);
        expect(totalHeadcount(c), c.month).toBe(row.etp.contributions.length + row.etp.missing.length);
      }
    });
    // Tuile « ETP contractuel fin décembre 2025 » filtrée : 0,50 ETP = 5 000 dix-millièmes = total du tableau.
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 5_000 });
    expect(totalEtp4(cat.months[11])).toBe(5_000);
    expect(categoryScopeNote(s, cat.hidden)).toBe("Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
  });

  it("filtre Nature = CDI : CDD hors du périmètre ; décembre 2025 = 6 · 5,10, janvier 2025 = 5 · 4,30 ; tuile 5,10", async () => {
    const s = ready({ fin: "2025-12", nature: "01" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    expect(cat.keys).toEqual(["cdi"]);
    expect(cat.hidden).toEqual(["cdd"]);
    expect(value(cat.months[11]).byCategory).toEqual({ cdi: { headcount: 6, etp4: 51_000 } });
    expect(value(cat.months[0]).byCategory).toEqual({ cdi: { headcount: 5, etp4: 43_000 } });
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 51_000 });
    cat.months.forEach((c, i) => {
      const e = s.dash.rows[i].etp;
      if (e.kind !== "nd") expect(totalEtp4(c), c.month).toBe(e.etp4);
    });
    expect(categoryScopeNote(s, cat.hidden)).toBe("Filtres appliqués : nature CDI (01). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDD.");
  });

  it("filtre Établissement (seul établissement de la fixture) : mêmes chiffres que toute l'entreprise, mention avec le libellé, rien de caché", async () => {
    const s = ready({ fin: "2025-12", etab: "00000000000011" });
    expect(s.input.scope).toEqual({ establishments: ["00000000000011"], nature: undefined });
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    expect(cat.keys).toEqual(["cdi", "cdd"]);
    expect(cat.hidden).toEqual([]);
    expect(value(cat.months[11]).byCategory).toEqual({ cdi: { headcount: 6, etp4: 51_000 }, cdd: { headcount: 1, etp4: 5_000 } });
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
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    expect(cat.keys).toEqual(["cdd"]); // octobre → décembre 2025 : le CDD est encore présent
    expect(cat.hidden).toEqual(["cdi"]);
    expect(value(cat.months[11]).byCategory).toEqual({});
    expect(s.dash.tiles.etpEnd.current).toMatchObject({ kind: "exact", etp4: 0 });
    const civil = ready({ mode: "civil", annee: "2026", nature: "02" });
    const cat26 = await loadCategoryMonths(civil.input, civil.w, "w1");
    expect(cat26.keys).toEqual([]);
    expect(cat26.hidden).toEqual(["cdi"]);
  });
});

describe("feuille Excel « Par catégorie » : mêmes cellules que l'écran filtré, note qui dit que les filtres s'appliquent", () => {
  it("filtre Nature = CDD : une colonne CDD, douze lignes 1 · 0,50, note avec la mention ; la note contraire du lot 11 n'existe plus", async () => {
    const s = ready({ fin: "2025-12", nature: "02" });
    const cat = await loadCategoryMonths(s.input, s.w, "w1");
    const sh = sheets.categoriesSheet(cat.months, cat.keys, CATEGORY_TABLE_LABELS, { scope: categoryScopeNote(s, cat.hidden) });
    expect(sh.columns.map((c) => c.header)).toEqual(["Mois", "CDD — effectif", "CDD — ETP", "Total — effectif", "Total — ETP", "Observations"]);
    expect(sh.rows).toEqual(MONTHS_2025.map((m) => [m, 1, 5_000, 1, 5_000, ""]));
    expect(sh.note).toBe("Fin de mois ; catégorie sans contrat ce mois-là : cellule vide. Filtres appliqués : nature CDD (02). Mêmes contrats que les indicateurs ; hors de ce périmètre, sans colonne : CDI.");
    expect(sh.note).not.toContain("ne s'appliquent pas");
    expect("CATEGORIES_UNSCOPED_NOTE" in sheets).toBe(false);
  });
});

describe("écran KPI RH : assemblage du bloc par catégorie (lecture du code de la page)", () => {
  const page = readFileSync("src/app/e/[slug]/studio-rh/kpi/page.tsx", "utf8");
  it("le tableau reçoit l'entrée filtrée des tuiles (input), plus jamais le référentiel sans périmètre (ctx.input)", () => {
    expect(page).toContain("loadCategoryMonths(input, w, ctx.collab.workspace.id)");
    expect(page).not.toContain("loadCategoryMonths(ctx.input");
  });
  it("la mention du périmètre est écrite sous le tableau, avec son data-testid, et le libellé des colonnes vient du même dictionnaire que l'export", () => {
    expect(page).toContain("categoryScopeNote(suivi, cat.hidden)");
    expect(page).toContain('{catScope && <p className="desc" data-testid="kpi-categories-scope">{catScope}</p>}');
    expect(page.indexOf('data-testid="kpi-categories-table"')).toBeLessThan(page.indexOf('data-testid="kpi-categories-scope"'));
    expect(page).toContain("labels={CATEGORY_TABLE_LABELS}");
    expect(page).not.toContain("ne s'appliquent pas");
  });
});
