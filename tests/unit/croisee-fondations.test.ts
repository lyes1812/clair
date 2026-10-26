import { readFileSync } from "node:fs";
import { createElement as h, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Espace, sources et budgets simulés (valeurs fictives écrites à la main) ------------------------------------------------------
const state = vi.hoisted(() => ({
  pay: null as unknown,
  payCalls: 0,
  budgets: [] as unknown[],
  scenarios: [] as unknown[],
  getScenario: null as null | ((id: string) => Promise<unknown>),
  getScenarioCalls: 0,
}));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string) => ({ session: {}, workspace: { id: "w1", name: "Espace démo", slug, role: "reader" } }),
}));
vi.mock("@/lib/payroll/context", () => ({
  loadPayrollContext: async () => {
    state.payCalls++;
    return state.pay;
  },
}));
vi.mock("@/lib/budget/store", () => {
  class BudgetError extends Error {}
  return {
    BudgetError,
    KIND_LABELS: { budget: "Budget", revise: "Révisé", simulation: "Simulation" },
    listBudgets: async () => state.budgets,
    listScenarios: async () => state.scenarios,
    getScenario: async (_ws: string, id: string) => {
      state.getScenarioCalls++;
      return state.getScenario ? state.getScenario(id) : null;
    },
  };
});
vi.mock("@/lib/croisee-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/croisee-settings")>()),
  getCroiseeSettings: async () => ({ confidentialite: { kind: "absent" }, seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } }),
}));
// Journal de paie : chaque mois lu a une valeur ; trois services dont « non ventilé ».
vi.mock("@/lib/payroll/engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/payroll/engine")>()),
  monthPayroll: (_i: unknown, month: string) => ({ kind: "value", month }),
  servicesOf: () => ["Atelier", "Bureau", null],
}));
// Les dix chapitres sont remplacés par un composant simulé : le gabarit de la page est testé sans dépendre du contenu des chapitres
// (que leurs agents remplacent). Les vrais modules sont lus avec vi.importActual dans le bloc « composants des chapitres ».
const stub = vi.hoisted(() => async (id: string) => {
  const { createElement } = await import("react");
  return { default: ({ ctx }: { ctx: { chapter: { id: string } } }) => createElement("section", { "data-testid": `cx-stub-${id}`, "data-ctx": ctx.chapter.id }, "Chapitre simulé") };
});
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChSynthese", () => stub("synthese"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffectifs", () => stub("effectifs"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChAbsences", () => stub("absences"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChFixeVariable", () => stub("fixe-variable"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChServices", () => stub("services"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChBudget", () => stub("budget"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChPaieCompta", () => stub("paie-compta"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffets", () => stub("effets"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChRestructuration", () => stub("restructuration"));
vi.mock("@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChJuridique", () => stub("juridique"));

import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { CROISEE_TERMS, GLOSSARY_CROISEE } from "@/lib/glossary/croisee";
import {
  ALERT_LEVEL_LABELS,
  CHAPTER_IDS,
  cellView,
  croiseeHref,
  monthNdLines,
  parseQuery,
  REFERENCE_TABLE_ID,
  referenceTable,
  roundDecimal,
  yearMonths,
  sortAlerts,
  sortHref,
  sortRows,
  sortState,
  sparkDrawable,
  sparkValues,
  tableNdReasons,
  variationTone,
  costVariation,
  plainVariation,
  type AlertSpec,
  type CroiseeColumn,
  type CroiseeTable,
  type TileSpec,
} from "@/lib/viz/croisee";
import { BudgetError } from "@/lib/budget/store";
import CroiseePage from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/page";
import { CHAPTER_TOTAL, CHAPTERS, chapterDef, chapterLinks, EN_CONSTRUCTION, neighbours } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import { loadCroiseeContext, once, type CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { journalReason } from "@/lib/croisee/format";
import { selectAlerts } from "@/lib/croisee/alertes";
import { partitionCohorts } from "@/lib/croisee/cohortes";
import { CSV_BOM, LOWER_BOUND, SERVICES_EXPORT_LABEL, tableCsv } from "@/lib/croisee/export";
import { confidentialiteReason, maskGroups } from "@/lib/croisee/structure";
import { croiseeSettingReason, SEUILS_MAX } from "@/lib/croisee-settings";
import { safeText } from "@/lib/export/safe-text";
import { DSN_ECHEANCES, MOTIF_PAYFIT, seuilAlerts } from "@/lib/viz/croisee-effectifs";
import { BRUT_NUL, N1_NUL, PREVU_FIXE_VARIABLE } from "@/lib/viz/croisee-masse";
import { maskServices } from "@/lib/viz/croisee-paie";
import { PRINT_REPERES_MAX } from "@/lib/viz/croisee-synthese";
import { AlertList, ChapterPrevu, ModelTable, NdNote, Pliant, Spark, Tuile, Tuiles } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/atomes";
import type { MonthPayroll, PayrollWindow } from "@/lib/payroll/engine";
import type { ChapterId } from "@/lib/viz/croisee";

const sp = (s: string) => s.replace(/[  ]/g, " "); // espaces insécables → espace
const WS = { id: "w1", name: "Espace démo", slug: "demo", role: "reader" as const };

// --- Chapitres -----------------------------------------------------------------------------------------------------------------
describe("chapitres", () => {
  it("dix identifiants uniques, dans l'ordre du contrat d'adresse, numérotés 01 à 10", () => {
    expect(CHAPTERS).toHaveLength(10);
    expect(CHAPTER_TOTAL).toBe("10");
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(10);
    expect(CHAPTERS.map((c) => c.id)).toEqual([...CHAPTER_IDS]);
    expect(CHAPTER_IDS).toEqual(["synthese", "effectifs", "absences", "fixe-variable", "services", "budget", "paie-compta", "effets", "restructuration", "juridique"]);
    expect(CHAPTERS.map((c) => c.num)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  });

  it("titre, question et description d'une ligne ; seuls Restructuration et Bibliothèque juridique sont « Prévu », sans filtres", () => {
    for (const c of CHAPTERS) {
      for (const t of [c.title, c.question, c.description]) {
        expect(t.trim()).not.toBe("");
        expect(t).not.toMatch(/\n/);
      }
      expect(c.question.length, c.id).toBeLessThanOrEqual(90);
      expect(c.question.endsWith("?"), c.id).toBe(true);
      expect(c.description.length, c.id).toBeLessThanOrEqual(60);
      for (const w of ["outil observé", "cahier", "webinaire", "capture", " tu ", " toi "]) expect(`${c.title} ${c.question} ${c.description}`.toLowerCase()).not.toContain(w);
    }
    expect(CHAPTERS.filter((c) => c.statut === "prevu").map((c) => c.id)).toEqual(["restructuration", "juridique"]);
    expect(CHAPTERS.filter((c) => !c.filtres).map((c) => c.id)).toEqual(["restructuration", "juridique"]);
  });

  it("précédent / suivant aux extrémités ; liens « Ce qui existe déjà » dans l'espace", () => {
    expect(neighbours("synthese")).toEqual({ prev: null, next: chapterDef("effectifs") });
    expect(neighbours("juridique")).toEqual({ prev: chapterDef("restructuration"), next: null });
    expect(neighbours("services").prev?.id).toBe("fixe-variable");
    expect(chapterLinks("demo", chapterDef("fixe-variable"))).toEqual([{ href: "/e/demo/studio-rh/masse-salariale?vue=fixe-variable", title: "Masse salariale › Fixe & variable", text: "Fixe, variable, primes par libellé." }]);
  });
});

// --- Glossaire -----------------------------------------------------------------------------------------------------------------
describe("glossaire de la Masse salariale croisée", () => {
  it("chaque identifiant de CROISEE_TERMS et de chaque chapitre existe au glossaire", () => {
    for (const id of Object.values(CROISEE_TERMS)) expect(glossaryEntry(id), id).toBeDefined();
    for (const c of CHAPTERS) for (const id of c.terms) expect(glossaryEntry(id), `${c.id} → ${id}`).toBeDefined();
  });

  it("vingt-six entrées neuves, famille Masse salariale, sans « croisee-etp-proratise » (l'entrée etp-prorated est réutilisée)", () => {
    expect(GLOSSARY_CROISEE).toHaveLength(26);
    expect(GLOSSARY_CROISEE.map((e) => e.id)).toEqual(Object.values(CROISEE_TERMS).filter((id) => id.startsWith("croisee-")));
    for (const e of GLOSSARY_CROISEE) {
      expect(e.id).toMatch(/^croisee-/);
      expect(e.family).toBe("Masse salariale");
      expect(GLOSSARY.filter((g) => g.id === e.id)).toHaveLength(1);
      if (e.formula) expect(e.formula).not.toMatch(/\n/);
      expect(e.definition).not.toMatch(/\btu\b|\btoi\b|\bton\b|\btes\b/i);
    }
    expect(glossaryEntry("croisee-etp-proratise")).toBeUndefined();
    expect(CROISEE_TERMS.etpProratise).toBe("etp-prorated");
  });

  it("exports : protection contre les formules alignée sur l'addendum L (« - » sauf nombre pur) ; impression : en-tête complet", () => {
    const exp = glossaryEntry("croisee-export")!.definition;
    expect(exp).toContain("(il commence par =, @, une tabulation, un retour chariot ou un saut de ligne, ou par + ou - quand ce n'est pas un nombre)");
    expect(exp).not.toContain("=, +, -, @");
    expect(glossaryEntry("croisee-impression")!.definition).toContain("la période, N-1, le service, le budget saisi et le scénario retenus, et les mois non clos");
    expect(glossaryEntry("croisee-vue-ensemble")!.definition).toContain("« Référence annuelle N-1 sur douze mois »");
  });

  // Les définitions disent ce que le code fait : chaque phrase vérifiée ici l'est sur la fonction ou la constante qui la met en œuvre,
  // avec un cas écrit à la main (valeurs fictives).
  it("export : chaque début de texte cité est protégé, un nombre signé ne l'est pas ; CSV avec marque d'ordre, points-virgules, décimal français, « n.d. (raison) » ; borne basse nommée", () => {
    const exp = glossaryEntry("croisee-export")!.definition;
    for (const s of ["=A1", "@A1", "\tA", "\rA", "\nA", "+A", "-A"]) expect(safeText(s), JSON.stringify(s)).toBe(`'${s}`);
    for (const s of ["+12", "-3,5", "-0.25", "Atelier"]) expect(safeText(s), s).toBe(s);
    const cols: CroiseeColumn[] = [
      { key: "ligne", header: "Ligne", kind: "text" },
      { key: "montant", header: "Montant", kind: "eur" },
      { key: "taux", header: "Taux", kind: "pourcent" },
    ];
    const csv = tableCsv({ id: "t", title: "Tableau", columns: cols, rows: [{ cells: ["=Total", 123456, { exact: 0.0534 }] }, { cells: ["B", { nd: "mois non lu" }, ""] }] });
    expect(csv).toBe(`${CSV_BOM}"Ligne";"Montant";"Taux"\r\n"'=Total";"1234,56";"5,34"\r\n"B";"n.d. (mois non lu)";""\r\n`);
    expect(exp).toContain("marque d'ordre des octets, champs entre guillemets séparés par des points-virgules, fin de ligne Windows");
    expect(exp).toContain("(5,34 pour 5,34 %)");
    expect(exp).toContain(`« ${LOWER_BOUND} »`);
    for (const sheet of ["« Chiffres clés »", "« Non disponibles »", "« Filtres »", "« Sources »", "« Définitions »"]) expect(exp).toContain(sheet);
    expect(exp).toContain(`« ${SERVICES_EXPORT_LABEL} »`);
  });

  it("seuil de confidentialité : raison citée, masquage secondaire « zéro compris », provision par service cumulée jusqu'au seuil", () => {
    const conf = glossaryEntry("croisee-confidentialite")!.definition;
    expect(conf).toContain(`« ${confidentialiteReason(2).replace("2 personnes", "N personnes")} »`);
    expect(conf).toContain(`« ${croiseeSettingReason("confidentialite", { kind: "absent" })} »`);
    // Un groupe de 1 personne (seuil 3) : masqué ; le plus petit autre groupe affiché, ici vide, l'est aussi ; le reste est affiché.
    expect(maskGroups([{ size: 1, value: 1 }, { size: 0, value: 0 }, { size: 6, value: 6 }], 3, true)).toEqual(["masked", "secondary", "shown"]);
    // Sans total affiché, pas de masquage secondaire.
    expect(maskGroups([{ size: 1, value: 1 }, { size: 6, value: 6 }], 3, false)).toEqual(["masked", "shown"]);
    // Provision par service (seuil 3) : 1 contrat masqué ; le service sans contrat (provision la plus faible) ne suffit pas, le suivant
    // est masqué aussi.
    expect(maskServices([{ size: 1, order: 100 }, { size: 0, order: 0 }, { size: 5, order: 500 }, { size: 8, order: 800 }], 3)).toEqual(["masked", "secondary", "secondary", "shown"]);
    expect(conf).toContain("un service sans contrat rémunéré (« Non ventilé », par exemple) ne suffit jamais à en protéger un autre");
    expect(conf).toContain("zéro compris");
  });

  it("seuils d'effectif : prochain seuil strictement supérieur, distance inférieure ou égale à la marge ; libellé du repère et limites de saisie", () => {
    const d = glossaryEntry("croisee-seuils-effectif")!.definition;
    const seuils = [{ libelle: "Seuil A", valeur: 10 }, { libelle: "Seuil B", valeur: 20 }];
    const avg = (num: number, den = 1) => ({ kind: "exact" as const, ratio: { num, den } });
    // 19 / 2 = 9,5 : prochain seuil 10, distance 0,5 ≤ 1 → repère.
    const near = seuilAlerts([{ id: "n", label: "Effectif moyen", avg: avg(19, 2) }], seuils, 1);
    expect(near.map((a) => [a.level, a.label])).toEqual([["repere", "Effectif proche d'un seuil"]]);
    // 10 : le seuil 10 est atteint, le prochain est 20 (distance 10 > 1) → aucun repère ; 9 avec une marge de 1 → distance 1 ≤ 1 → repère.
    expect(seuilAlerts([{ id: "n", label: "Effectif moyen", avg: avg(10) }], seuils, 1)).toEqual([]);
    expect(seuilAlerts([{ id: "n", label: "Effectif moyen", avg: avg(9) }], seuils, 1)).toHaveLength(1);
    expect(d).toContain("premier seuil strictement supérieur");
    expect(d).toContain("inférieure ou égale à la marge d'alerte");
    expect(d).toContain("« Effectif proche d'un seuil »");
    expect(SEUILS_MAX).toBe(20);
    expect(d).toContain("vingt seuils au plus");
    expect(d).toContain(`« ${croiseeSettingReason("seuilsEffectif", { kind: "absent" })} »`);
  });

  it("points à surveiller : libellés des niveaux et des points défavorables, regroupement des repères à l'impression", () => {
    const d = glossaryEntry("croisee-alertes")!.definition;
    for (const l of Object.values(ALERT_LEVEL_LABELS)) expect(d.toLowerCase()).toContain(l.toLowerCase());
    const out = selectAlerts({
      year: 2026,
      budget: { kind: "value", name: "B", gap: { kind: "value", real: 300, budget: 200, delta: 100 }, monthly: [{ month: "2026-01", real: 150, budget: 100 }, { month: "2026-02", real: 150, budget: 100 }] },
      landing: { kind: "value", total: 1300, gap: { kind: "value", landing: 1300, budget: 1200, delta: 100, months: 12, excluded: [] } },
      openMonths: [],
      unclassified: [],
      missing: [],
      seuils: { kind: "skip" },
      checks: { compta: { kind: "skip" }, dsn: { kind: "skip" } },
      hrefs: { parametres: "#", grille: "#", budget: "#", paieCompta: "#", donnees: "#" },
    });
    const defav = out.alerts.filter((a) => a.level === "defavorable").map((a) => a.label);
    expect(defav).toEqual(["Budget dépassé", "Atterrissage au-dessus du budget annuel"]);
    for (const l of defav) expect(d).toContain(`« ${l} »`);
    expect(PRINT_REPERES_MAX).toBe(3);
    expect(d).toContain("au-delà de trois repères");
    expect(d).toContain("« + k autres repères »");
  });

  it("chapitres 02, 04, 05 et 06 : termes et phrases repris du code (titres de blocs, raisons, libellés de cartes)", () => {
    expect(glossaryEntry(CROISEE_TERMS.rigidite)!.term).toBe("Part des salaires dans le brut");
    expect(glossaryEntry(CROISEE_TERMS.partPrimes)!.term).toBe("Part des primes dans le brut");
    expect(glossaryEntry(CROISEE_TERMS.contributionServices)!.term).toBe("Contribution des services à l'écart");
    const rig = glossaryEntry(CROISEE_TERMS.rigidite)!.definition;
    expect(rig).toContain(`« ${PREVU_FIXE_VARIABLE.find((x) => x.id === "fixe-variable-rigidite")!.reason} »`);
    expect(rig).toContain(`« ${BRUT_NUL} »`);
    expect(glossaryEntry(CROISEE_TERMS.contributionServices)!.definition).toContain(`« ${N1_NUL} »`);
    expect(glossaryEntry(CROISEE_TERMS.structureEffectif)!.definition).toContain("« Qui compose l'effectif salarié ? »");
    expect(glossaryEntry(CROISEE_TERMS.journalMouvements)!.definition).toContain("« Autres motifs (k motifs) »");
    expect(glossaryEntry(CROISEE_TERMS.journalMouvements)!.definition).toContain(`L'API ${MOTIF_PAYFIT}`);
    expect(glossaryEntry(CROISEE_TERMS.echeancesContrat)!.definition).toContain(`${DSN_ECHEANCES.replace(/^la DSN/, "La DSN")}`);
    expect(glossaryEntry(CROISEE_TERMS.personnesObservees)!.term).toBe("Contrats observés seulement en N-1, seulement en N, dans les deux périodes");
    // Partition écrite à la main : contrat « a » en N-1 seulement, « b » dans les deux, « c » en N seulement, lignes sans contrat ;
    // la somme des contributions, lignes sans contrat comprises, égale l'écart total.
    const part = partitionCohorts(new Map([["a", 100], ["b", 200], ["x", 10]]), new Map([["b", 250], ["c", 80], ["x", 30]]), "x");
    expect(part.kind).toBe("value");
    if (part.kind === "value") {
      expect([part.onlyPrev.delta, part.both.delta, part.onlyCur.delta, part.outside?.delta]).toEqual([-100, 50, 80, 20]);
      expect(part.total.delta).toBe(50);
      expect(part.total.count).toBe(3);
    }
  });
});

// --- Adresse ---------------------------------------------------------------------------------------------------------------------
describe("paramètres d'adresse", () => {
  it("chapitre absent : Synthèse sans avis ; inconnu : Synthèse avec un avis court", () => {
    expect(parseQuery({}).chapitre).toBe("synthese");
    expect(parseQuery({}).notices).toEqual([]);
    const q = parseQuery({ chapitre: "inconnu" });
    expect(q.chapitre).toBe("synthese");
    expect(q.notices).toEqual(["paramètre ignoré : chapitre=inconnu (chapitre inconnu : Synthèse affichée)"]);
    expect(parseQuery({ chapitre: ["paie-compta", "services"] }).chapitre).toBe("paie-compta");
    expect(parseQuery({ chapitre: "x".repeat(60) }).notices[0]).toContain(`chapitre=${"x".repeat(40)}…`);
  });

  it("affichage, tri et sens validés ; année, mois, service, budget et scénario transmis tels quels au contexte", () => {
    const q = parseQuery({ chapitre: "services", affichage: "graphique", tri: "services.cout-n", sens: "asc", annee: " 2026 ", de: "01", a: "03", service: "Atelier", budget: "b1", scenario: "s1" });
    expect(q).toMatchObject({ chapitre: "services", affichage: "graphique", tri: "services.cout-n", sens: "asc", annee: "2026", de: "01", a: "03", service: "Atelier", budget: "b1", scenario: "s1", notices: [] });
    const bad = parseQuery({ affichage: "camembert", tri: "Coût N", sens: "haut" });
    expect(bad).toMatchObject({ affichage: "tout", tri: null, sens: null });
    expect(bad.notices).toEqual([
      "paramètre ignoré : affichage=camembert (valeurs : tout, graphique, tableau)",
      "paramètre ignoré : tri=Coût N (colonne inconnue)",
      "paramètre ignoré : sens=haut (valeurs : asc, desc)",
    ]);
  });

  it("croiseeHref : ordre fixe, valeurs vides et affichage « tout » omis, ancre", () => {
    const base = "/e/demo/studio-rh/masse-salariale/croisee";
    expect(croiseeHref(base, {})).toBe(base);
    expect(croiseeHref(base, { sens: "asc", chapitre: "services", annee: "2026", affichage: "tout", service: "__nv__", budget: null, tri: "services.cout-n" }, "cx-chapitre")).toBe(
      `${base}?chapitre=services&annee=2026&service=__nv__&tri=services.cout-n&sens=asc#cx-chapitre`,
    );
    expect(croiseeHref(base, { chapitre: "budget", affichage: "tableau", service: "R&D" })).toBe(`${base}?chapitre=budget&service=R%26D&affichage=tableau`);
  });
});

// --- Cellules : un n.d. n'est jamais 0 ----------------------------------------------------------------------------------------------
const col = (kind: CroiseeColumn["kind"], extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key: "k", header: "K", kind, ...extra });
describe("mise en forme des cellules par nature (cas écrits à la main)", () => {
  it("n.d. reste « n.d. » avec sa raison, dans toutes les natures ; cellule vide = sans objet", () => {
    for (const kind of ["text", "eur", "etp", "nombre", "pourcent", "date"] as const) {
      const v = cellView({ nd: "journal absent" }, col(kind, { costTrend: true, signed: true }));
      expect(v).toMatchObject({ text: "n.d.", nd: "journal absent", tone: "flat" });
      expect(v.text).not.toMatch(/\d/);
    }
    expect(cellView("", col("eur"))).toMatchObject({ text: "—", na: true, nd: null });
    expect(cellView(undefined, col("eur"))).toMatchObject({ text: "—", na: true });
  });

  it("valeurs en unité de base : centimes, dix-millièmes d'ETP, points de base", () => {
    expect(sp(cellView(123456, col("eur")).text)).toBe("1 234,56 €");
    expect(sp(cellView(-5000, col("eur")).text)).toBe("−50,00 €");
    expect(sp(cellView(5000, col("eur", { signed: true })).text)).toBe("+50,00 €");
    expect(sp(cellView(0, col("eur")).text)).toBe("0,00 €"); // un zéro connu reste un zéro
    expect(cellView(12345, col("etp")).text).toBe("1,23"); // 1,2345 ETP arrondi au centième, demi vers le haut
    expect(cellView(-2500, col("etp", { signed: true })).text).toBe("−0,25");
    expect(sp(cellView(1234, col("nombre")).text)).toBe("1 234");
    expect(cellView(534, col("pourcent")).text.replace(/\s/g, " ")).toBe("5,34 %"); // 534 points de base
    expect(cellView(25, col("pourcent", { points: true, signed: true })).text).toBe("+0,25 pts");
    expect(cellView("2026-03-31", col("date")).text).toBe("31/03/2026");
    expect(cellView("Atelier", col("text")).text).toBe("Atelier");
  });

  it("valeurs exactes dans l'unité affichée : ETP, fraction d'un pourcentage, euros", () => {
    expect(cellView({ exact: 1.23456 }, col("etp")).text).toBe("1,23");
    expect(cellView({ exact: 0.125 }, col("pourcent")).text.replace(/\s/g, " ")).toBe("12,50 %");
    expect(sp(cellView({ exact: 1234.5 }, col("eur")).text)).toBe("1 234,50 €");
    // Demi exact : arrondi sur la représentation décimale, vers l'extérieur de zéro, comme le format de la cellule Excel.
    expect(sp(cellView({ exact: 1.005 }, col("eur")).text)).toBe("1,01 €");
    expect(sp(cellView({ exact: -1.005 }, col("eur")).text)).toBe("−1,01 €");
    expect(sp(cellView({ exact: 2.675 }, col("eur", { signed: true })).text)).toBe("+2,68 €");
    expect(cellView({ exact: 1.005 }, col("etp")).text).toBe("1,01");
    expect(cellView({ exact: 0.00125 }, col("pourcent")).text.replace(/\s/g, " ")).toBe("0,13 %"); // 0,125 % → 0,13 %
    // Une valeur qui s'affiche 0,00 n'a ni signe ni ton.
    expect(cellView({ exact: -0.004 }, col("eur", { signed: true, costTrend: true }))).toMatchObject({ tone: "flat" });
    expect(sp(cellView({ exact: -0.004 }, col("eur", { signed: true })).text)).toBe("0,00 €");
    expect(cellView({ exact: 1e21 }, col("eur"))).toMatchObject({ text: "n.d.", nd: "valeur hors limites" });
    expect(cellView({ exact: 1.5 }, col("text"))).toMatchObject({ text: "n.d.", nd: "valeur numérique dans une colonne de texte" });
    expect(cellView(12.5, col("eur"))).toMatchObject({ text: "n.d.", nd: "valeur hors de l'unité de base" });
  });

  it("ton de tendance seulement sur une colonne d'écart de coût ; l'unité de la ligne remplace celle de la colonne", () => {
    expect(cellView(5000, col("eur", { costTrend: true })).tone).toBe("bad");
    expect(cellView(-5000, col("eur", { costTrend: true })).tone).toBe("good");
    expect(cellView(0, col("eur", { costTrend: true })).tone).toBe("flat");
    expect(cellView(5000, col("eur")).tone).toBe("flat");
    expect(cellView(3, col("nombre")).tone).toBe("flat");
    expect(cellView(12345, col("eur"), { kind: "etp" }).text).toBe("1,23");
    expect(cellView("Atelier", col("text"), { kind: "eur" }).text).toBe("Atelier");
  });
});

describe("roundDecimal (cas écrits à la main)", () => {
  it("arrondi au demi supérieur (vers l'extérieur de zéro) sur la représentation décimale", () => {
    expect(roundDecimal(1.005, 2)).toBe(101); // 1,005 × 100 vaut 100,4999… en flottant : Math.round donnerait 100
    expect(roundDecimal(-1.005, 2)).toBe(-101);
    expect(roundDecimal(2.675, 2)).toBe(268);
    expect(roundDecimal(1234.5, 2)).toBe(123450);
    expect(roundDecimal(1.23456, 2)).toBe(123);
    expect(roundDecimal(0.125, 4)).toBe(1250);
    expect(roundDecimal(0.00125, 4)).toBe(13);
    expect(roundDecimal(0.004, 2)).toBe(0);
    expect(Object.is(roundDecimal(-0.004, 2), 0)).toBe(true); // jamais −0
    expect(roundDecimal(1e-7, 2)).toBe(0);
    expect(roundDecimal(0, 2)).toBe(0);
    expect(roundDecimal(12, 0)).toBe(12);
    expect(roundDecimal(Number.POSITIVE_INFINITY, 2)).toBeNull();
    expect(roundDecimal(Number.NaN, 2)).toBeNull();
    expect(roundDecimal(1e21, 2)).toBeNull(); // hors des entiers sûrs
  });
});

// --- Tableau du modèle --------------------------------------------------------------------------------------------------------
const TABLE: CroiseeTable = {
  id: "services",
  title: "Coût par service",
  columns: [
    { key: "service", header: "Service", kind: "text", sortable: true },
    { key: "cout-n", header: "Coût N", kind: "eur", sortable: true },
    { key: "ecart", header: "Écart", kind: "eur", signed: true, costTrend: true, term: "evolution" },
  ],
  rows: [
    { cells: ["Atelier", 100000, 5000] },
    { cells: ["Bureau", { nd: "journal du mois absent" }, ""] },
    { cells: ["Comptoir", 250000, -2000], href: "/e/demo/x?service=Comptoir" },
  ],
  foot: { cells: ["Total", { nd: "journal du mois absent" }, 3000] },
  notes: ["Coût moyen : ce n'est pas un coût par ETP."],
};

describe("ModelTable", () => {
  const html = (p: Partial<Parameters<typeof ModelTable>[0]> = {}) => sp(renderToStaticMarkup(h(ModelTable, { table: TABLE, slug: "demo", ...p })));

  it("rôles, identifiant de test, total en pied ; n.d. en abréviation avec sa raison, raisons listées sous le tableau", () => {
    const out = html();
    expect(out).toContain('data-testid="cx-table-services"');
    expect(out).toContain('role="table"');
    expect(out).toContain('role="columnheader"');
    expect(out).toContain('role="rowheader"');
    expect(out).toContain("<tfoot");
    expect(out.match(/<abbr class="nd" title="journal du mois absent">n\.d\.<\/abbr>/g)).toHaveLength(2);
    expect(out).toContain('data-testid="cx-table-services-nd"');
    expect(out).toContain("<li>journal du mois absent</li>");
    expect(out).toContain('<span class="cx-na" title="sans objet">—</span>');
    expect(out).toContain("Coût moyen : ce n&#x27;est pas un coût par ETP.");
    // Écart de coût en hausse : rouge (trend-bad) ; en baisse : vert (trend-good). Le signe reste écrit.
    expect(out).toMatch(/class="num trend-bad"[^>]*>.*?\+50 €/);
    expect(out).toMatch(/class="num trend-good"[^>]*>.*?−20 €/);
    expect(out).toContain('href="/e/demo/x?service=Comptoir"');
    expect(out).toContain('aria-label="Définition : Écart"');
  });

  it("une cellule n.d. n'est jamais rendue 0", () => {
    const one: CroiseeTable = { id: "t", title: "T", columns: [col("text"), { key: "v", header: "V", kind: "eur" }], rows: [{ cells: ["Mois", { nd: "paie non clôturée" }] }] };
    const out = sp(renderToStaticMarkup(h(ModelTable, { table: one, slug: "demo" })));
    expect(out).not.toMatch(/data-money-cents="0"|0,00|>0 €/);
    expect(out).toContain('title="paie non clôturée">n.d.</abbr>');
    expect(tableNdReasons(TABLE)).toEqual(["journal du mois absent"]);
  });

  it("tri par l'adresse : en-têtes en liens avec aria-sort, n.d. en dernier, total jamais trié", () => {
    expect(sortState(TABLE, "services.cout-n", null)).toEqual({ key: "cout-n", dir: "desc" });
    expect(sortState(TABLE, "service", null)).toEqual({ key: "service", dir: "asc" });
    expect(sortState(TABLE, "autre.cout-n", "asc")).toBeNull();
    expect(sortState(TABLE, "services.ecart", "asc")).toBeNull(); // colonne non triable
    expect(sortRows(TABLE, "cout-n", "desc").map((r) => r.cells[0])).toEqual(["Comptoir", "Atelier", "Bureau"]);
    expect(sortRows(TABLE, "cout-n", "asc").map((r) => r.cells[0])).toEqual(["Atelier", "Comptoir", "Bureau"]);
    expect(sortRows(TABLE, "service", "desc").map((r) => r.cells[0])).toEqual(["Comptoir", "Bureau", "Atelier"]);
    expect(sortHref("/e/demo/c?chapitre=services&tri=x&sens=asc#ancre", "services", "cout-n", "desc")).toBe("/e/demo/c?chapitre=services&tri=services.cout-n&sens=desc#cx-table-services");
    const out = html({ sortBase: "/e/demo/c?chapitre=services", tri: "services.cout-n", sens: "desc" });
    expect(out).toContain('aria-sort="descending"');
    expect(out).toContain('aria-sort="none"');
    expect(out).toContain('href="/e/demo/c?chapitre=services&amp;tri=services.cout-n&amp;sens=asc#cx-table-services"');
    const order = ["Comptoir", "Atelier", "Bureau"].map((s) => out.indexOf(`>${s}<`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out.indexOf(">Total<")).toBeGreaterThan(order[2]);
    // Sans adresse de tri : aucun lien d'en-tête.
    expect(html()).not.toContain("cx-sort");
  });
});

// --- Mini-courbe -----------------------------------------------------------------------------------------------------------------
describe("Spark", () => {
  it("null reste null, jamais 0 ; un zéro connu reste un zéro", () => {
    expect(sparkValues([100, { nd: "n.d." }, null, undefined, Number.NaN, 0, 300])).toEqual([100, null, null, null, null, 0, 300]);
    expect(sparkDrawable([4, null, 6])).toBe(false); // points isolés : pas de tendance
    expect(sparkDrawable([4, 6, null])).toBe(true);
    expect(sparkDrawable([null, null])).toBe(false);
  });

  it("image nommée, ligne coupée au mois n.d., rien sans deux mois consécutifs connus", () => {
    const out = renderToStaticMarkup(h(Spark, { values: [100, 200, null, 300, 400], label: "Masse chargée sur douze mois" }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Masse chargée sur douze mois"');
    expect(out.match(/<polyline/g)).toHaveLength(2);
    expect(renderToStaticMarkup(h(Spark, { values: [100, null, 300], label: "x" }))).toBe("");
  });
});

// --- Cartes ------------------------------------------------------------------------------------------------------------------------
describe("Tuile", () => {
  const masse: TileSpec = {
    id: "masse",
    label: "Masse salariale chargée",
    term: "masse",
    sub: "janvier → mars 2026",
    value: { text: "300 000,00 €", kind: "value", reason: null },
    cost: true,
    main: true,
    variations: [costVariation("Écart N-1", 1000000, "+10 000,00 € (+3,45 %)"), plainVariation("N-1", "290 000,00 €")],
    spark: { label: "Masse chargée, douze mois", values: [1, 2, 3] },
  };
  it("coût en hausse : rouge (trend-bad) sur la variation, signe écrit ; identifiant cx-tile-<chapitre>-<id>", () => {
    const out = sp(renderToStaticMarkup(h(Tuile, { t: masse, chapter: "synthese", slug: "demo" })));
    expect(out).toContain('data-testid="cx-tile-synthese-masse"');
    expect(out).toMatch(/<span class="trend-bad">.*\+10 000 €/);
    expect(out).toContain('role="img"');
    expect(out).toContain("janvier → mars 2026");
  });
  it("le ton n'est jamais appliqué hors d'une carte de coût (effectif, ETP, taux)", () => {
    const etp: TileSpec = { id: "etp", label: "ETP moyen", value: { text: "12,50", kind: "value", reason: null }, variations: [{ label: "Écart", text: "+1,00 ETP", tone: "bad" }] };
    expect(variationTone(etp, etp.variations![0])).toBe("flat");
    const out = renderToStaticMarkup(h(Tuile, { t: etp, chapter: "effectifs", slug: "demo" }));
    expect(out).not.toContain("trend-");
  });
  it("n.d. : « n.d. » et sa raison écrite, sans valeur ni mini-courbe inventées", () => {
    const t: TileSpec = { id: "budget", label: "Écart au budget", value: { text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" }, cost: true, valueTone: "bad" };
    const out = renderToStaticMarkup(h(Tuile, { t, chapter: "synthese", slug: "demo" }));
    expect(out).toContain('<dd class="nd">n.d.</dd>');
    expect(out).toContain("aucun budget saisi pour 2026");
    expect(out).not.toContain("trend-");
  });
  it("six cartes : grille « six »", () => {
    const tiles = Array.from({ length: 6 }, (_, i) => ({ ...masse, id: `t${i}` }));
    expect(renderToStaticMarkup(h(Tuiles, { tiles, chapter: "synthese", slug: "demo", testid: "cx-tiles-synthese" }))).toContain('class="facts ms-tiles cx-tiles six"');
  });
});

// --- Alertes -------------------------------------------------------------------------------------------------------------------
describe("AlertList", () => {
  const alerts: AlertSpec[] = [
    { id: "mois-provisoire", level: "repere", label: "Mois provisoire", text: "mars 2026 : paie non clôturée." },
    { id: "budget-absent", level: "a-completer", label: "Budget absent", text: "aucun budget saisi pour 2026." },
    { id: "budget-depasse", level: "defavorable", label: "Budget dépassé", text: "+1 000,00 € sur la période." },
    { id: "seuil", level: "repere", label: "Seuil", text: "effectif proche d'un seuil." },
  ];
  it("ordre : défavorable, à compléter, repère ; ordre d'origine conservé dans un niveau ; aucun plafond", () => {
    expect(sortAlerts(alerts).map((a) => a.id)).toEqual(["budget-depasse", "budget-absent", "mois-provisoire", "seuil"]);
    expect(ALERT_LEVEL_LABELS).toEqual({ defavorable: "Défavorable", "a-completer": "À compléter", repere: "Repère" });
  });
  it("niveau écrit, pastille de forme propre, jamais de classe de tendance (rouge / vert)", () => {
    const out = renderToStaticMarkup(h(AlertList, { alerts, slug: "demo" }));
    expect(out).toContain('data-testid="cx-alerts"');
    for (const a of alerts) expect(out).toContain(`data-testid="cx-alert-${a.id}"`);
    expect(out).toContain("Défavorable");
    expect(out).toContain("À compléter");
    expect(out).toContain("Repère");
    expect(out).not.toMatch(/trend|--bad|--good/);
    expect(out.indexOf("cx-alert-budget-depasse")).toBeLessThan(out.indexOf("cx-alert-budget-absent"));
  });
  it("sans alerte : la phrase le dit", () => {
    expect(renderToStaticMarkup(h(AlertList, { alerts: [], slug: "demo" }))).toContain("Aucun point à surveiller sur ce périmètre.");
  });
});

// --- Autres atomes ---------------------------------------------------------------------------------------------------------------
describe("Pliant, NdNote, ChapterPrevu", () => {
  it("Pliant : details fermé par défaut, lien « Définitions et méthode » vers le glossaire (rien de recopié)", () => {
    const out = renderToStaticMarkup(h(Pliant, { title: "Détail", term: "masse", slug: "demo", children: "contenu" }));
    expect(out).toMatch(/^<details class="cx-fold">/);
    expect(out).toContain('href="/e/demo/glossaire#def-masse">Définitions et méthode</a>');
    expect(renderToStaticMarkup(h(Pliant, { title: "Détail", open: true, term: "inconnu", slug: "demo", children: "x" }))).not.toContain("Définitions et méthode");
  });
  it("NdNote : n.d., raison écrite et action", () => {
    const out = renderToStaticMarkup(h(NdNote, { reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" }, testid: "x" }));
    expect(out).toContain("n.d.");
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain('href="/e/demo/parametres#croisee"');
  });
  it("ChapterPrevu : identifiant cx-prevu-<id>, mention « Prévu », raison et liens existants", () => {
    const out = renderToStaticMarkup(h(ChapterPrevu, { slug: "demo", id: "juridique", reason: EN_CONSTRUCTION, links: chapterLinks("demo", chapterDef("juridique")) }));
    expect(out).toContain('data-testid="cx-prevu-juridique"');
    expect(out).toContain('<span class="tag">Prévu</span>');
    expect(out).toContain("Chapitre en cours de construction.");
    expect(out).toContain('href="/e/demo/glossaire"');
  });
});

// --- Composants des chapitres -------------------------------------------------------------------------------------------------
// Les chapitres vivants sont remplacés par leurs agents : on vérifie seulement que chaque module exporte un composant par défaut.
// Les chapitres de statut « prevu » (chapitres.ts) rendent la mention Prévu (cx-prevu-<id>), qu'ils soient synchrones ou non.
const MODULES: Record<ChapterId, string> = {
  synthese: "ChSynthese",
  effectifs: "ChEffectifs",
  absences: "ChAbsences",
  "fixe-variable": "ChFixeVariable",
  services: "ChServices",
  budget: "ChBudget",
  "paie-compta": "ChPaieCompta",
  effets: "ChEffets",
  restructuration: "ChRestructuration",
  juridique: "ChJuridique",
};
type ChapterView = (p: { ctx: CroiseeContext }) => ReactNode | Promise<ReactNode>;
const actualChapter = async (id: ChapterId) => (await vi.importActual<{ default: unknown }>(`@/app/e/[slug]/studio-rh/masse-salariale/croisee/${MODULES[id]}`)).default;

describe("composants des chapitres", () => {
  beforeEach(() => {
    Object.assign(state, { pay: fakePay(), payCalls: 0, budgets: BUDGETS, scenarios: SCENARIOS, getScenario: null, getScenarioCalls: 0 });
  });

  it("chaque module de chapitre exporte un composant par défaut", async () => {
    for (const c of CHAPTERS) expect(typeof (await actualChapter(c.id)), c.id).toBe("function");
  });

  it("les chapitres « Prévu » rendent cx-prevu-<id>, sans lire aucune source", async () => {
    const prevu = CHAPTERS.filter((c) => c.statut === "prevu");
    expect(prevu.map((c) => c.id)).toEqual(["restructuration", "juridique"]);
    for (const c of prevu) {
      const ctx = await loadCroiseeContext("demo", WS, { chapitre: c.id });
      const view = (await actualChapter(c.id)) as ChapterView;
      const out = renderToStaticMarkup((await view({ ctx })) as ReactElement);
      expect(out, c.id).toContain(`data-testid="cx-prevu-${c.id}"`);
      expect(out, c.id).toContain('<span class="tag">Prévu</span>');
    }
    expect(state.payCalls).toBe(0);
  });
});

// --- Contexte -------------------------------------------------------------------------------------------------------------------
const MONTHS = ["2025-01", "2025-02", "2025-03", "2026-01", "2026-02", "2026-03"];
function fakePay() {
  return {
    kpi: {
      collab: { source: { domain: "rh", chosen: "payfit", reason: "API connectée et appliquée.", mode: "auto", apiApplied: true, filesApplied: false, appliedAt: new Date("2026-04-02T08:00:00Z"), modeSetAt: null }, state: { kind: "ready" } },
      settings: { invalid: [] },
      input: null,
    },
    source: "payfit",
    read: { syncId: "s1", startedAt: new Date("2026-04-02T08:00:00Z"), months: MONTHS },
    unavailable: null,
    input: { lines: [], months: MONTHS, openMonths: ["2026-03"], grid: [], serviceAxis: "SVC" },
    service: { axis: "SVC", origin: "single-axis", updatedAt: null },
    axes: ["SVC"],
    compta: async () => ({ source: null, reason: "", lines: [], months: [], nd: {}, error: false }),
  };
}
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const BUDGETS = [
  { id: "b-old", name: "Budget initial", year: "2026", updatedAt: day("2026-01-10"), amounts: {} },
  { id: "b-new", name: "Budget révisé", year: "2026", updatedAt: day("2026-06-01"), amounts: {} },
  { id: "b-2025", name: "Budget 2025", year: "2025", updatedAt: day("2026-07-01"), amounts: {} },
];
const SCENARIOS = [
  { scenario: { id: "s-b", name: "Scénario B", firstMonth: "2027-01", lastMonth: "2027-12", status: "brouillon" }, refMonth: "2026-12" },
  { scenario: { id: "s-a", name: "Scénario A", firstMonth: "2026-04", lastMonth: "2026-12", status: "fige" }, refMonth: "2026-03" },
];

describe("contexte partagé", () => {
  beforeEach(() => {
    Object.assign(state, { pay: fakePay(), payCalls: 0, budgets: BUDGETS, scenarios: SCENARIOS, getScenario: null, getScenarioCalls: 0 });
  });

  it("once : une seule lecture, la même promesse ensuite", async () => {
    let n = 0;
    const f = once(async () => ++n);
    expect(await f()).toBe(1);
    expect(await f()).toBe(1);
    expect(n).toBe(1);
  });

  it("chapitre sans filtres : aucune source lue ; le scénario n'est lu qu'à la demande", async () => {
    const ctx = await loadCroiseeContext("demo", WS, { chapitre: "juridique" });
    expect(ctx.chapter.id).toBe("juridique");
    expect(ctx.period).toBeNull();
    expect(state.payCalls).toBe(0);
    expect(state.getScenarioCalls).toBe(0);
  });

  it("chapitre sans filtres : les choix de l'adresse sont gardés tels quels dans les liens (validés au retour)", async () => {
    const ctx = await loadCroiseeContext("demo", WS, { chapitre: "restructuration", annee: "2025", a: "06", service: "Bureau", budget: "b-old", scenario: "s-a", affichage: "tableau" });
    expect(ctx.href({ chapitre: "synthese" })).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=synthese&annee=2025&a=06&service=Bureau&budget=b-old&scenario=s-a&affichage=tableau");
    expect(ctx.notices).toEqual([]);
    expect(state.payCalls).toBe(0);
    // Retour sur un chapitre à filtres : les valeurs y sont validées par le contexte (mois disponibles).
    const back = await loadCroiseeContext("demo", WS, { chapitre: "synthese", annee: "2025", a: "02" });
    expect(back.period).toMatchObject({ year: 2025, from: "01", to: "02" });
  });

  it("raison du journal non lu : lecture absente ou incomplète, source DSN, journal lu", () => {
    const p = fakePay();
    expect(journalReason(p as never)).toBeNull();
    expect(journalReason({ input: null, unavailable: "journal comptable absent de la lecture PayFit appliquée", source: "payfit" })).toBe("journal comptable absent de la lecture PayFit appliquée");
    expect(journalReason({ input: null, unavailable: null, source: "dsn" })).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
    expect(journalReason({ input: null, unavailable: "aucune source RH retenue (Aucune source appliquée pour ce domaine.) : connectez PayFit ou déposez des DSN dans Données", source: null })).toBe(
      "aucune source RH retenue (aucune source appliquée pour ce domaine) : connectez PayFit ou déposez des DSN dans Données",
    );
  });

  it("période par défaut : de janvier au dernier mois clos de la dernière année ; N-1 sur les mêmes mois", async () => {
    const ctx = await loadCroiseeContext("demo", WS, {});
    expect(ctx.period).toMatchObject({ year: 2026, from: "01", to: "02", months: ["2026-01", "2026-02"] });
    expect(ctx.prevMonths).toEqual(["2025-01", "2025-02"]);
    expect(ctx.labels).toEqual({ period: "janvier → février 2026", prev: "janvier → février 2025" });
    expect(ctx.openMonths).toEqual([]);
    expect(ctx.periodNd).toBeNull();
    expect(state.payCalls).toBe(1);
    await ctx.load.payroll();
    await ctx.load.kpi();
    expect(state.payCalls).toBe(1); // journal et référentiel lus une seule fois
  });

  it("mois non clos de la période signalé ; service « non ventilé » ; budget et scénario les plus récents de l'année par défaut", async () => {
    const ctx = await loadCroiseeContext("demo", WS, { a: "03", service: "__nv__" });
    expect(ctx.period?.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(ctx.openMonths).toEqual(["2026-03"]);
    expect(ctx.service).toMatchObject({ axis: "SVC", value: null, label: "Non ventilé", reason: null });
    expect(ctx.service.options.map((o) => o.value)).toEqual(["", "Atelier", "Bureau", "__nv__"]);
    expect(ctx.budget.selected?.id).toBe("b-new"); // modifié le plus récemment, parmi les budgets de 2026
    expect(ctx.budget.explicit).toBe(false);
    expect(ctx.budget.options.map((o) => o.value)).toEqual(["b-new", "b-old"]);
    expect(ctx.scenario.selected?.scenario.id).toBe("s-a"); // seul scénario qui couvre 2026
    expect(ctx.scenario.options.map((o) => o.value)).toEqual(["s-a"]);
    expect(ctx.notices).toEqual([]);
    expect(ctx.href({ chapitre: "services" })).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=services&annee=2026&de=01&a=03&service=__nv__");
  });

  it("choix explicites gardés dans l'adresse ; budget d'une autre année, scénario hors année et service inconnu : avis et défaut", async () => {
    const ok = await loadCroiseeContext("demo", WS, { chapitre: "budget", budget: "b-old", scenario: "s-a", service: "Atelier" });
    expect(ok.budget).toMatchObject({ explicit: true, reason: null });
    expect(ok.budget.selected?.id).toBe("b-old");
    expect(ok.scenario.explicit).toBe(true);
    expect(ok.href()).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&annee=2026&de=01&a=02&service=Atelier&budget=b-old&scenario=s-a");
    const ko = await loadCroiseeContext("demo", WS, { budget: "b-2025", scenario: "s-b", service: "Inconnu" });
    expect(ko.budget.selected?.id).toBe("b-new");
    expect(ko.scenario.selected?.scenario.id).toBe("s-a");
    expect(ko.service.value).toBeUndefined();
    expect(ko.notices).toEqual([
      "paramètre ignoré : service=Inconnu (service absent du journal)",
      "paramètre ignoré : budget=b-2025 (identifiant inconnu parmi les budgets saisis pour 2026)",
      "paramètre ignoré : scenario=s-b (identifiant inconnu parmi les scénarios qui couvrent 2026)",
    ]);
  });

  it("sans budget ni scénario de l'année : n.d. avec la raison ; scénario à base altérée : n.d. avec le message", async () => {
    state.budgets = [BUDGETS[2]];
    state.scenarios = [SCENARIOS[0]];
    const ctx = await loadCroiseeContext("demo", WS, {});
    expect(ctx.budget).toMatchObject({ selected: null, reason: "aucun budget saisi pour 2026" });
    expect(ctx.scenario).toMatchObject({ selected: null, reason: "aucun scénario ne couvre 2026" });
    expect(await ctx.load.scenario()).toEqual({ kind: "nd", reason: "aucun scénario ne couvre 2026" });
    expect(state.getScenarioCalls).toBe(0);
    state.scenarios = SCENARIOS;
    state.getScenario = async () => {
      throw new BudgetError("Base figée altérée.");
    };
    const altered = await loadCroiseeContext("demo", WS, {});
    expect(await altered.load.scenario()).toEqual({ kind: "nd", reason: "Base figée altérée." });
    expect(await altered.load.scenario()).toEqual({ kind: "nd", reason: "Base figée altérée." });
    expect(state.getScenarioCalls).toBe(1); // mémoïsé
  });

  it("aucune source : période n.d. avec la raison, rien d'autre n'est lu", async () => {
    const p = fakePay();
    state.pay = { ...p, input: null, unavailable: "aucune lecture PayFit appliquée : connectez PayFit dans Données", service: { axis: null, origin: "none", updatedAt: null }, axes: [] };
    const ctx = await loadCroiseeContext("demo", WS, { service: "Atelier" });
    expect(ctx.period).toBeNull();
    expect(ctx.periodNd).toBe("Référentiel RH non construit");
    expect(ctx.budget.reason).toBe("Référentiel RH non construit");
    expect(ctx.service.reason).toBe("aucune lecture PayFit appliquée : connectez PayFit dans Données");
    expect(ctx.notices).toEqual(["paramètre ignoré : service=Atelier (aucune lecture PayFit appliquée : connectez PayFit dans Données)"]);
  });
});

// --- Blocs communs : référence annuelle N-1 (adaptateur pur) -------------------------------------------------------------------
describe("référence annuelle N-1 sur douze mois", () => {
  const nd = (month: string, code: "not-read" | "no-journal", reason: string): MonthPayroll => ({ month, kind: "nd", open: false, nd: { code, reason } });
  it("douze mois de l'année ; raisons des mois n.d. regroupées (le mois retiré du texte du moteur)", () => {
    expect(yearMonths(2025)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"]);
    const rows = [
      nd("2025-01", "no-journal", "journal de paie 2025-01 non renvoyé par PayFit (mois non clôturé ou hors historique)"),
      nd("2025-02", "no-journal", "journal de paie 2025-02 non renvoyé par PayFit (mois non clôturé ou hors historique)"),
      { month: "2025-03", kind: "value" } as unknown as MonthPayroll,
      nd("2025-04", "not-read", "mois 2025-04 hors de la lecture PayFit appliquée"),
    ];
    expect(monthNdLines(rows)).toEqual([
      "janv. 2025, févr. 2025 : journal de paie non renvoyé par PayFit (mois non clôturé ou hors historique)",
      "avr. 2025 : mois hors de la lecture PayFit appliquée",
    ]);
  });

  it("valeurs du moteur reprises telles quelles (masse chargée, brut) ; mois non clos signalé ; n.d. jamais 0", () => {
    // Cas écrit à la main : brut 3 000,00 € + cotisations 1 200,00 € = masse chargée 4 200,00 €.
    const value = { kind: "value", brut: 300000, cotisations: 120000, masse: 420000, months: [], openMonths: ["2025-12"], paidContractMonths: 0 } as unknown as PayrollWindow;
    const t = referenceTable({ year: 2025, scope: "Tous les services", window: value });
    expect(t.id).toBe(REFERENCE_TABLE_ID);
    expect(t.title).toBe("Référence annuelle 2025, janvier → décembre · Tous les services");
    expect(t.columns.map((c) => [c.header, c.kind])).toEqual([["Indicateur", "text"], ["2025 (douze mois)", "eur"]]);
    expect(t.rows.map((r) => r.cells)).toEqual([["Masse salariale chargée", 420000], ["Rémunération brute", 300000]]);
    expect(t.notes).toEqual(["Mois non clos : déc. 2025."]);
    const out = sp(renderToStaticMarkup(h(ModelTable, { table: t, slug: "demo" })));
    expect(out).toContain("4 200,00 €");
    expect(out).toContain("3 000,00 €");
    expect(out).toContain('data-testid="cx-table-commun-reference-n1"');

    const months = [nd("2025-11", "not-read", "mois 2025-11 hors de la lecture PayFit appliquée"), nd("2025-12", "not-read", "mois 2025-12 hors de la lecture PayFit appliquée")];
    const missing = { kind: "nd", nd: { code: "month-nd", reason: "…" }, months } as unknown as PayrollWindow;
    const t2 = referenceTable({ year: 2025, scope: "Atelier", window: missing });
    const why = "nov. 2025, déc. 2025 : mois hors de la lecture PayFit appliquée";
    expect(t2.rows.map((r) => r.cells[1])).toEqual([{ nd: why }, { nd: why }]);
    expect(t2.notes).toEqual([]);
    const out2 = sp(renderToStaticMarkup(h(ModelTable, { table: t2, slug: "demo" })));
    expect(out2).not.toMatch(/0,00|data-money-cents="0"/);
    expect(out2.match(new RegExp(`<li>${why}</li>`, "g"))).toHaveLength(1); // raison écrite une fois sous le tableau
  });
});

// --- La page ---------------------------------------------------------------------------------------------------------------------
describe("page Masse salariale croisée", () => {
  beforeEach(() => {
    Object.assign(state, { pay: fakePay(), payCalls: 0, budgets: BUDGETS, scenarios: SCENARIOS, getScenario: null, getScenarioCalls: 0 });
  });
  const render = async (q: Record<string, string> = {}) => sp(renderToStaticMarkup(await CroiseePage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(q) })));
  const part = (out: string, re: RegExp) => out.match(re)?.[0] ?? "";

  it("gabarit : en-tête « Masse salariale », onglet croisée courant et non « Prévu », sommaire, onglets, filtres, chapitre, pied", async () => {
    const out = await render();
    expect(out).toContain("<h1>Masse salariale</h1>");
    expect(out).toMatch(/data-testid="ms-tabs"[\s\S]*?<a href="\/e\/demo\/studio-rh\/masse-salariale\/croisee" aria-current="page" data-tab="croisee">Masse salariale croisée<\/a>/);
    expect(out.match(/data-testid="ms-tabs"[\s\S]*?<\/nav>/)![0].match(/class="soon"/g)).toHaveLength(3);
    for (const id of ["cx-page", "cx-chapter-menu", "cx-chapter-tabs", "cx-chapter-head", "cx-filters", "cx-pager", "cx-foot", "cx-stub-synthese", "cx-print-synthese", "cx-presets", "cx-commun"]) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out).toContain('data-ctx="synthese"'); // le chapitre reçoit le contexte
    expect(out).toContain("01 / 10");
    expect(out).toContain("Où en est la masse salariale face au budget, et où finit l&#x27;année ?");
    expect(out).toContain("Début du rapport");
    // Onglets de chapitres : navigation de liens (aria-current), sans tablist.
    expect(out).not.toContain('role="tablist"');
    expect(out).toMatch(/data-testid="cx-chapter-tabs"[\s\S]*?aria-current="page" data-tab="synthese"/);
    // Périmètre écrit une fois, budget et scénario retenus par défaut.
    expect(out).toContain("Budget : « Budget révisé »");
    expect(out).toContain("Scénario : « Scénario A »");
    expect(out.match(/janvier → février 2026/g)!.length).toBeLessThanOrEqual(2); // résumé du tiroir et en-tête d'impression
  });

  it("identifiants HTML uniques (chapitre budget : corps cx-budget, champ du tiroir cx-f-budget) ; chaque libellé vise un champ", async () => {
    const out = await render({ chapitre: "budget" });
    const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(["cx-budget", "cx-f-annee", "cx-f-de", "cx-f-a", "cx-f-service", "cx-f-budget", "cx-f-scenario", "cx-chapitre"]));
    for (const m of out.matchAll(/\sfor="([^"]+)"/g)) expect(ids, m[1]).toContain(m[1]);
    // Le « ? » de la période est à côté du champ, hors du libellé (nom accessible du champ = son libellé).
    expect(out).toContain('<label for="cx-f-de">Premier mois</label>');
    expect(out).not.toMatch(/<label[^>]*>[^<]*<a class="gloss-link"/);
    expect(out).toMatch(/<select class="select" id="cx-f-de"[\s\S]*?<\/select><a class="gloss-link"/);
  });

  it("chapitre inconnu : Synthèse et un avis ; chapitre « Prévu » : ni filtres, ni bouton de synthèse, ni blocs communs, aucune source lue", async () => {
    const unknown = await render({ chapitre: "zz" });
    expect(unknown).toContain('data-chapter="synthese"');
    expect(unknown).toContain("paramètre ignoré : chapitre=zz (chapitre inconnu : Synthèse affichée)");
    state.payCalls = 0;
    const prevu = await render({ chapitre: "restructuration" });
    expect(prevu).toContain('data-testid="cx-stub-restructuration"');
    expect(prevu).toContain("09 / 10");
    for (const id of ["cx-filters", "cx-print-synthese", "cx-commun", "cx-commun-sources", "cx-commun-reference", "cx-commun-definitions", "cx-source-paie"]) expect(prevu, id).not.toContain(`data-testid="${id}"`);
    expect(prevu).toContain('data-testid="cx-print"');
    expect(state.payCalls).toBe(0);
    // « Synthèse en PDF · 1 page » : sur la Synthèse seulement.
    expect(await render({ chapitre: "services" })).not.toContain('data-testid="cx-print-synthese"');
  });

  it("liens de chapitre : même période et service, tri retiré ; précédent / suivant vers l'en-tête du chapitre", async () => {
    const out = await render({ chapitre: "services", service: "Bureau", tri: "services.cout-n", sens: "asc" });
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau"');
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=fixe-variable&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau#cx-chapitre"');
    expect(out).toContain('href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=budget&amp;annee=2026&amp;de=01&amp;a=02&amp;service=Bureau#cx-chapitre"');
    // Réinitialiser : le chapitre seul.
    expect(out).toContain('<a class="btn" href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=services">Réinitialiser</a>');
  });

  it("chapitre sans filtres (09, 10) : les liens gardent les valeurs brutes de l'adresse", async () => {
    const out = await render({ chapitre: "restructuration", annee: "2025", a: "06", service: "Bureau", budget: "b-old", scenario: "s-a" });
    const q = "annee=2025&amp;a=06&amp;service=Bureau&amp;budget=b-old&amp;scenario=s-a";
    expect(out).toContain(`href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=synthese&amp;${q}"`); // sommaire et onglets
    expect(out).toContain(`href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=effets&amp;${q}#cx-chapitre"`); // précédent
    expect(out).toContain(`href="/e/demo/studio-rh/masse-salariale/croisee?chapitre=juridique&amp;${q}#cx-chapitre"`); // suivant
    expect(state.payCalls).toBe(0);
  });

  it("en-tête d'impression : espace, chapitre, période, N-1, service, budget, scénario et mois non clos", async () => {
    const head = part(await render({ a: "03" }), /<p class="cx-print-head"[\s\S]*?<\/p>/);
    expect(head).toContain('data-testid="cx-print-head"');
    for (const t of ["Espace démo", "01 / 10 Synthèse", "janvier → mars 2026", "N-1 : janvier → mars 2025", "Tous les services", "Budget : « Budget révisé »", "Scénario : « Scénario A »", "mois non clos : mars 2026"]) expect(head, t).toContain(t);
    state.budgets = [];
    state.scenarios = [];
    const nd = part(await render(), /<p class="cx-print-head"[\s\S]*?<\/p>/);
    expect(nd).toContain("Budget : n.d. (aucun budget saisi pour 2026)");
    expect(nd).toContain("Scénario : n.d. (aucun scénario ne couvre 2026)");
    expect(nd).not.toContain("mois non clos");
  });

  it("impression de la synthèse : la classe .cx-syn est documentée et agrandie dans croisee.css ; menus lisibles (11 px) et onglets non rognés", () => {
    const css = readFileSync("src/styles/croisee.css", "utf8");
    expect(css).toMatch(/body\[data-print="synthese"\] \.cx-syn \{[^}]*zoom: 1\.1/);
    expect(css).toMatch(/body\[data-print="synthese"\][^{]*\.cx-common/);
    expect(css).toMatch(/\.cx-menu-name \.soon \{[^}]*font-size: 11px/);
    expect(css).toMatch(/\.cx-tabs \.tabs \{[^}]*padding-block: 4px/);
    expect(css).toMatch(/\.cx-menu \.ui-dropdown-panel \{[^}]*calc\(100vw - var\(--sidebar\) - 72px\)/);
  });

  it("pied de page : date du journal seulement s'il est lu ; sinon n.d. et la raison exacte (lecture incomplète, source DSN)", async () => {
    const ok = part(await render(), /<p class="tile-foot" data-testid="cx-source-paie">[\s\S]*?<\/p>/);
    expect(ok).toContain("Journal de paie : lecture PayFit du ");
    expect(ok).not.toContain("n.d.");

    const p = fakePay();
    state.pay = { ...p, input: null, unavailable: "journal comptable absent de la lecture PayFit appliquée", service: { axis: null, origin: "none", updatedAt: null }, axes: [] };
    const partial = part(await render(), /<p class="tile-foot" data-testid="cx-source-paie">[\s\S]*?<\/p>/);
    expect(partial).toContain('Journal de paie : <span class="nd">n.d.</span> — journal comptable absent de la lecture PayFit appliquée');
    expect(partial).not.toContain("lecture PayFit du");

    state.pay = { ...p, source: "dsn", read: null, input: null, unavailable: null, service: { axis: null, origin: "none", updatedAt: null }, axes: [] };
    const dsn = part(await render(), /<p class="tile-foot" data-testid="cx-source-paie">[\s\S]*?<\/p>/);
    expect(dsn).toContain('<span class="nd">n.d.</span> — source RH retenue : DSN — journal de paie PayFit non lu');
    expect(dsn).not.toContain("aucune lecture appliquée");
  });

  it("blocs communs sous le chapitre : sources et hypothèses de travail, référence annuelle N-1, définitions (renvois au glossaire)", async () => {
    const out = await render({ service: "Atelier" });
    // Ordre : chapitre, précédent / suivant, blocs communs, pied de page ; blocs repliés par défaut.
    const at = (t: string) => out.indexOf(`data-testid="${t}"`);
    expect(at("cx-stub-synthese")).toBeLessThan(at("cx-pager"));
    expect(at("cx-pager")).toBeLessThan(at("cx-commun-sources"));
    expect(at("cx-commun-sources")).toBeLessThan(at("cx-commun-reference"));
    expect(at("cx-commun-reference")).toBeLessThan(at("cx-commun-definitions"));
    expect(at("cx-commun-definitions")).toBeLessThan(at("cx-foot"));
    expect(out).toMatch(/<details class="cx-fold" id="cx-commun-sources" data-testid="cx-commun-sources"><summary>Sources et hypothèses de travail<\/summary>/);

    const sources = part(out, /data-testid="cx-commun-sources"[\s\S]*?<\/details>/);
    expect(sources).toContain("« Budget révisé » · modifié le 01/06/2026 · par défaut, le plus récent de l&#x27;année");
    expect(sources).toContain("« Scénario A » · figé · mois du scénario : avr. 2026 → déc. 2026 · base figée sur mars 2026 · par défaut, le plus récent qui couvre l&#x27;année");
    expect(sources).toContain("Seuil de confidentialité</dt>");
    expect(sources).toContain('<span class="nd">n.d.</span> — seuil de confidentialité non défini (Paramètres)');
    expect(sources).toContain('<span class="nd">n.d.</span> — seuils d&#x27;effectif non définis (Paramètres)');
    expect(sources).toContain('href="/e/demo/parametres#croisee"');

    // Référence N-1 : journal lu sans montant pour 2025 dans ce jeu → n.d., raisons par mois, jamais 0 ; service écrit.
    const ref = part(out, /data-testid="cx-commun-reference"[\s\S]*?<\/details>/);
    expect(ref).toContain("Référence annuelle N-1 sur douze mois");
    expect(ref).toContain("Référence annuelle 2025, janvier → décembre · Atelier");
    expect(ref).toContain("janv. 2025, févr. 2025, mars 2025 : journal de paie non renvoyé par PayFit (mois non clôturé ou hors historique)");
    expect(ref).toContain("avr. 2025, mai 2025, juin 2025, juil. 2025, août 2025, sept. 2025, oct. 2025, nov. 2025, déc. 2025 : mois hors de la lecture PayFit appliquée");
    expect(ref).not.toMatch(/0,00|data-money-cents="0"/);

    const defs = part(out, /data-testid="cx-commun-definitions"[\s\S]*?<\/details>/);
    for (const id of [...chapterDef("synthese").terms, CROISEE_TERMS.vueEnsemble, CROISEE_TERMS.periodeFiltres]) expect(defs, id).toContain(`href="/e/demo/glossaire#def-${id}"`);
    expect(defs).toContain(`>${glossaryEntry(CROISEE_TERMS.alertes)!.term}</a>`);
    for (const e of [CROISEE_TERMS.alertes, CROISEE_TERMS.ecartBudget]) expect(defs).not.toContain(glossaryEntry(e)!.definition.slice(0, 40)); // aucune définition recopiée
  });

  it("référence N-1 sans journal ou sans période : n.d. avec la raison exacte", async () => {
    const p = fakePay();
    state.pay = { ...p, source: "dsn", read: null, input: null, unavailable: null, service: { axis: null, origin: "none", updatedAt: null }, axes: [] };
    const ref = part(await render(), /data-testid="cx-commun-reference"[\s\S]*?<\/details>/);
    expect(ref).toContain('data-testid="cx-commun-reference-nd"');
    expect(ref).toContain("Référentiel RH non construit"); // période n.d. : raison de la période
    expect(ref).not.toContain("cx-table-commun-reference-n1");
  });
});
