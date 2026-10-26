import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { monthRange } from "@/lib/connectors/months";
import type { PayrollContext } from "@/lib/payroll/context";
import { fixtureAbsences, kpiInput, DSN_ABSENCES } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";

// Table des catégories de l'espace (lecture en base) remplacée par la table par défaut : aucun accès à la base dans ce fichier.
vi.mock("@/lib/budget/categories", async (orig) => {
  const actual = await orig<typeof import("@/lib/budget/categories")>();
  return { ...actual, getCategoryNatures: async () => ({ natures: actual.DEFAULT_CATEGORY_NATURES, origin: "default" }), getContractCategories: async () => ({}) };
});
import { EffectifsView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChEffectifs";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { monthlyGrid, type Grid, type RealSource } from "@/lib/budget/monthly";
import { val } from "@/lib/budget/versions";
import type { CroiseeSettings } from "@/lib/croisee-settings";
import type { EcheanceContract } from "@/lib/croisee/echeances";
import { confidentialiteReason, type StructureContract } from "@/lib/croisee/structure";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { ETP_PRORATED_LABEL } from "@/lib/rh/kpi/etp-prorata";
import { cellView, tableNdReasons, type CroiseeTable } from "@/lib/viz/croisee";
import {
  buildEffectifs,
  continuitySwaps,
  continuityText,
  countByNature,
  DSN_ECHEANCES,
  effectifsModel,
  exitMotifRows,
  gapCell,
  loadEffectifsInput,
  MOTIF_PAYFIT,
  natureCells,
  NON_FILTRABLE,
  PREVU_INDICATEURS,
  PREVU_MOTIFS_PAYFIT,
  PREVU_PROJECTION,
  PREVU_STRUCTURE,
  REPARTITION_BORNE,
  scrubText,
  seuilAlerts,
  seuilGap,
  serviceSizes,
  type EffectifsData,
  type EffectifsInput,
  type EffectifsModel,
  type JournalEventIn,
  type JournalMonthIn,
} from "@/lib/viz/croisee-effectifs";
import type { RowIn } from "@/lib/viz/kpi";
import { periodLabel } from "@/lib/viz/synthese";

// Chapitre 02 · Effectifs & mouvements : buildEffectifs avec des entrées fictives écrites à la main (aucune donnée réelle), puis rendu
// du modèle. Période juillet → septembre 2026, N-1 juillet → septembre 2025, lecture RH du 30/09/2026, seuil de confidentialité 2.

const ND_MOIS = "mois non couvert par la source";
const row = (month: string, hc: RowIn["headcount"], entries: RowIn["movements"]["entries"], exits: RowIn["movements"]["exits"]): RowIn => ({
  month,
  headcount: hc,
  etp: { kind: "nd", nd: { reason: "non utilisé" } },
  movements: { entries, exits },
  absenteeism: { kind: "nd", nd: { reason: "non utilisé" } },
  previous: { month, etp: { kind: "nd", nd: { reason: "non utilisé" } }, absenteeism: { kind: "nd", nd: { reason: "non utilisé" } } },
});
const ex = (n: number) => ({ kind: "exact" as const, value: n });
const lo = (n: number) => ({ kind: "lower_bound" as const, value: n });
const ndc = (reason: string) => ({ kind: "nd" as const, nd: { reason } });
const ROWS: RowIn[] = [
  row("2026-07", { kind: "exact", persons: 10 }, ex(1), ex(0)),
  row("2026-08", ndc(ND_MOIS), ndc(ND_MOIS), ndc(ND_MOIS)),
  row("2026-09", { kind: "exact", persons: 12 }, ex(2), lo(1)),
];
const PREV_ROWS: RowIn[] = [
  row("2025-07", { kind: "exact", persons: 9 }, ex(0), ex(1)),
  row("2025-08", { kind: "lower_bound", persons: 9 }, ex(1), ex(0)),
  row("2025-09", { kind: "exact", persons: 10 }, ex(0), ex(0)),
];

// Grille des effectifs mensuels écrite à la main : valeurs par mois et par groupe ; un mois listé dans `nd` est n.d. avec sa raison.
const grid = (values: Record<string, Record<string, number>>, nd: Record<string, string> = {}): Grid => {
  const groups = [...new Set(Object.values(values).flatMap((v) => Object.keys(v)))].sort();
  return {
    kind: "value",
    months: Object.keys(values),
    groups,
    layers: new Map(),
    cell: (g, m) => (nd[m] ? { kind: "nd", reason: nd[m] } : { kind: "value", v: values[m]?.[g] ?? 0 }),
    total: (m) => (nd[m] ? { kind: "nd", reason: nd[m] } : { kind: "value", v: Object.values(values[m] ?? {}).reduce((s, x) => s + x, 0) }),
  };
};
const SERVICE_ND = "effectif et mouvements par service non historisés pour les mois réalisés (le service est un code analytique des lignes de paie)";
const SERVICE_INSCRITS = { cur: { kind: "nd" as const, reason: SERVICE_ND }, prev: { kind: "nd" as const, reason: SERVICE_ND } };
// Effectif de chaque service (contrats qui portent l'ETP de fin de mois) : Atelier 6, Bureau 5, Non ventilé 1 ; N-1 : 5 et 4.
const GRIDS: EffectifsData["grids"] = [
  {
    axis: "service",
    inscrit: SERVICE_INSCRITS,
    etp: { cur: grid({ "2026-09": { Atelier: 60000, Bureau: 50000, "Non ventilé": 5000 } }), prev: grid({ "2025-09": { Atelier: 55000, Bureau: 45000 } }) },
    sizes: { cur: { Atelier: 6, Bureau: 5, "Non ventilé": 1 }, prev: { Atelier: 5, Bureau: 4 } },
  },
  {
    axis: "categorie",
    inscrit: { cur: grid({ "2026-09": { CDI: 10, CDD: 2 } }), prev: grid({ "2025-09": { CDI: 9, CDD: 1 } }) },
    etp: { cur: grid({ "2026-09": { CDI: 100000, CDD: 15000 } }), prev: grid({ "2025-09": {} }, { "2025-09": "mois hors couverture" }) },
  },
  {
    axis: "statut",
    inscrit: { cur: grid({ "2026-09": { "Cadre dirigeant": 1, "Hors cadre dirigeant": 11 } }), prev: grid({ "2025-09": { "Cadre dirigeant": 1, "Hors cadre dirigeant": 9 } }) },
    etp: { cur: grid({ "2026-09": { "Cadre dirigeant": 10000, "Hors cadre dirigeant": 105000 } }), prev: grid({ "2025-09": { "Cadre dirigeant": 10000, "Hors cadre dirigeant": 90000 } }) },
  },
];

const DROIT = "droit contracts:time-information:read non accordé à la clé";
const pc = (contractKey: string, personKey: string, isFullTimeAtRead: boolean | null, modalityAtRead: string | null, executive: boolean | null): StructureContract => ({
  contractKey,
  personKey,
  isFullTimeAtRead,
  modalityAtRead,
  executive,
  fieldsNd: isFullTimeAtRead === null ? { isFullTimeAtRead: { reason: DROIT }, modalityAtRead: { reason: DROIT } } : {},
});
const POPULATION: StructureContract[] = [
  pc("k-c1", "k-p1", true, "standard", false),
  pc("k-c2", "k-p2", true, "standard", false),
  pc("k-c3", "k-p3", false, "standard", false),
  pc("k-c4", "k-p4", true, "forfait_jours", true),
  pc("k-c5", "k-p5", null, null, false),
  pc("k-c6", "k-p1", false, "standard", false),
];
// Échéances : lecture du 30/09/2026, horizon 90 jours (01/10 → 29/12/2026).
const CONTRATS: EcheanceContract[] = [
  { startDate: "2026-03-01", endDate: "2026-10-15", nature: "02" }, // fin CDD en octobre
  { startDate: "2026-11-02", endDate: null, nature: "01", endUnknown: false }, // entrée CDI en novembre
  { startDate: "2026-10-01", endDate: "2026-12-29", nature: "02" }, // entrée CDD en octobre, fin en décembre
  { startDate: null, endDate: null, nature: "01" }, // sans date de début
  { startDate: "2026-05-01", endDate: null, nature: "02", endUnknown: true }, // CDD en cours, fin non renseignée
];

// Journal agrégé sur douze mois (octobre 2025 → septembre 2026) : totaux du moteur par mois, mouvements comptés par nature.
const jm = (month: string, entries: JournalMonthIn["entries"], exits: JournalMonthIn["exits"]): JournalMonthIn => ({ month, entries, exits });
const JOURNAL_MONTHS: JournalMonthIn[] = monthRange("2025-10", "2026-09").map((m) =>
  m === "2025-11" ? jm(m, ex(3), ex(0)) : m === "2026-01" ? jm(m, ex(0), ex(1)) : m === "2026-03" ? jm(m, ex(4), ex(0)) : m === "2026-07" ? jm(m, ex(1), ex(0)) : m === "2026-08" ? jm(m, ndc(ND_MOIS), ndc(ND_MOIS)) : m === "2026-09" ? jm(m, ex(2), lo(1)) : jm(m, ex(0), ex(0)),
);
const ev = (month: string, kind: "entry" | "exit", nature: string, endReason: string | null = null): JournalEventIn => ({ month, kind, nature, endReason });
const EVENTS: JournalEventIn[] = [
  ev("2025-11", "entry", "01"),
  ev("2025-11", "entry", "01"),
  ev("2025-11", "entry", "02"),
  ev("2026-01", "exit", "02"),
  ev("2026-03", "entry", "01"),
  ev("2026-03", "entry", "01"),
  ev("2026-03", "entry", "02"),
  ev("2026-03", "entry", "02"),
  ev("2026-07", "entry", "02"),
  ev("2026-09", "entry", "01"),
  ev("2026-09", "entry", "01"),
  ev("2026-09", "exit", "01"),
];

const DATA: EffectifsData = {
  source: "payfit",
  referenceDate: "2026-09-30",
  rows: ROWS,
  prevRows: PREV_ROWS,
  headcountDelta: { kind: "exact", unit: "persons", value: { num: 2, den: 1 } },
  etpEnd: { current: { kind: "exact", etp4: 115000 }, previous: { kind: "exact", etp4: 100000 }, delta: { kind: "exact", unit: "etp", value: { num: 3, den: 2 } } },
  etpProrated: {
    current: { kind: "exact", ratio: { num: 23, den: 2 } },
    previous: ndc("N-1 hors couverture"),
    delta: { kind: "nd", nd: { code: "previous-nd", reason: "N-1 (fin septembre 2025) : N-1 hors couverture" } },
    qualifier: "ETP contractuel proratisé : quotité à la date de lecture (30/09/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact",
  },
  etpAverage: { current: ndc(`2026-08 : ${ND_MOIS}`), previous: { kind: "exact", ratio: { num: 31, den: 3 } }, delta: { kind: "nd", nd: { code: "current-not-exact", reason: `valeur n.d. — 2026-08 : ${ND_MOIS}` } } },
  headcountAverage: { current: ndc(`2026-08 : ${ND_MOIS}`), previous: { kind: "exact", ratio: { num: 28, den: 3 } }, delta: { kind: "nd", nd: { code: "current-not-exact", reason: `valeur n.d. — 2026-08 : ${ND_MOIS}` } } },
  movements: { current: { entries: ndc(`2026-08 : ${ND_MOIS}`), exits: ndc(`2026-08 : ${ND_MOIS}`) }, previous: { entries: ex(1), exits: ex(1) } },
  turnover: {
    label: "12 mois glissants : octobre 2025 → septembre 2026",
    current: { kind: "exact", ratio: { num: 1, den: 8 } },
    previous: { kind: "exact", ratio: { num: 1, den: 10 } },
    delta: { kind: "exact", unit: "points", value: { num: 5, den: 2 } },
    entries: 1,
    exits: 2,
  },
  annual: {
    prevYear: 2025,
    prev: { kind: "exact", ratio: { num: 594, den: 12 } }, // 49,5
    curMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    cur: { kind: "exact", ratio: { num: 459, den: 9 } }, // 51
  },
  grids: GRIDS,
  journal: { from: "2025-10", to: "2026-09", months: JOURNAL_MONTHS, total: { entries: ndc(`2026-08 : ${ND_MOIS}`), exits: ndc(`2026-08 : ${ND_MOIS}`) }, events: EVENTS },
  population: { kind: "value", lower: false, contracts: POPULATION },
  natures: ["01", "02"],
  contracts: CONTRATS,
  reasonSwaps: [],
};

const set = <T>(value: T) => ({ kind: "set" as const, value, updatedAt: null, updatedBy: null });
const ABSENT: CroiseeSettings = { confidentialite: { kind: "absent" }, seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } };
const DEFINED: CroiseeSettings = {
  confidentialite: set(2),
  seuilsEffectif: set([
    { libelle: "Seuil A", valeur: 50 },
    { libelle: "Seuil B", valeur: 250 },
  ]),
  margeAlerte: set(1),
  horizonEcheances: set(90),
};
const LABELS = { period: "juillet → septembre 2026", prev: "juillet → septembre 2025" };
const LINKS = { parametres: "/e/demo/parametres#croisee", donnees: "/e/demo/donnees", mouvements: "/e/demo/studio-rh/collaborateurs/mouvements?de=2025-10&a=2026-09", tableau: "/e/demo/croisee?chapitre=effectifs&affichage=tableau" };
const input = (over: Partial<EffectifsInput> = {}): EffectifsInput => ({
  links: LINKS,
  period: { months: ["2026-07", "2026-08", "2026-09"], prevMonths: ["2025-07", "2025-08", "2025-09"], labels: LABELS },
  service: { value: undefined, label: "Tous les services" },
  settings: DEFINED,
  nd: null,
  data: DATA,
  ...over,
});

const tile = (m: EffectifsModel, id: string) => m.tiles.find((t) => t.id === id)!;
const table = (m: EffectifsModel, id: string) => m.tables.find((t) => t.id === id)!;
const block = (m: EffectifsModel, id: string) => m.blocks.find((b) => b.id === id)!;
// Lecture à l'écran d'un tableau : texte de chaque cellule, ou « n.d. : raison ».
const shown = (t: CroiseeTable) =>
  [...t.rows, ...(t.foot ? [t.foot] : [])].map((r) =>
    r.cells.map((c, i) => {
      const v = cellView(c, t.columns[i], r);
      return v.nd !== null ? `n.d. : ${v.nd}` : v.text;
    }),
  );
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (m: EffectifsModel, affichage: Affichage = "tout") => unescape(renderToStaticMarkup(h(EffectifsView, { model: m, slug: "demo", affichage, tableauHref: LINKS.tableau })));
const C2 = `n.d. : ${confidentialiteReason(2)}`;

describe("buildEffectifs : cartes", () => {
  const m = buildEffectifs(input());

  it("huit cartes dans l'ordre, avec N-1 et l'écart du moteur, sans couleur de tendance (effectifs, ETP, taux)", () => {
    expect(m.tiles.map((t) => t.id)).toEqual(["effectif", "etp-fin", "etp-proratise", "etp-moyen", "effectif-moyen", "entrees", "sorties", "turnover"]);
    expect(m.tiles.every((t) => !t.cost && (t.variations ?? []).every((v) => v.tone === "flat"))).toBe(true);
    const eff = tile(m, "effectif");
    expect([eff.label, eff.sub, eff.value.text]).toEqual(["Effectif fin de mois", "fin septembre 2026", "12"]);
    // Écart de personnes entier : sans décimales.
    expect(eff.variations!.map((v) => [v.label, v.text])).toEqual([["N-1", "10"], ["Écart", "+2 personnes"]]);
    // Mini-courbe : le mois n.d. reste null (jamais 0).
    expect(eff.spark?.values).toEqual([10, null, 12]);
    const etp = tile(m, "etp-fin");
    expect([etp.value.text, etp.variations![0].text, etp.variations![1].text]).toEqual(["11,50", "10,00", "+1,50 ETP"]);
    const to = tile(m, "turnover");
    // Le pourcentage est séparé par une espace insécable (format du moteur des KPI).
    expect([to.sub, to.value.text, to.variations![0].text, to.variations![1].text, to.note]).toEqual(["12 mois glissants : octobre 2025 → septembre 2026", "12,50 %", "10,00 %", "+2,50 pts", "1 entrée · 2 sorties"]);
  });

  it("turnover dont les sorties ne sont pas publiées : « sorties n.d. », jamais 0", () => {
    const t = tile(buildEffectifs(input({ data: { ...DATA, turnover: { ...DATA.turnover, exits: null } } })), "turnover");
    expect(t.note).toBe("1 entrée · sorties n.d.");
  });

  it("ETP proratisé : libellé exact du moteur et qualifieur obligatoire ; N-1 et écart n.d. avec leur raison", () => {
    const p = tile(m, "etp-proratise");
    expect(p.label).toBe(ETP_PRORATED_LABEL);
    expect(p.label).toBe("ETP contractuel proratisé — quotité actuelle");
    expect(p.value.text).toBe("11,50");
    expect(p.note).toBe("quotité à la date de lecture ; ni ETP payé ni historique exact");
    expect(p.variations![0]).toMatchObject({ text: null, reason: "N-1 hors couverture" });
    expect(p.variations![1]).toMatchObject({ text: null, reason: "N-1 (fin septembre 2025) : N-1 hors couverture" });
  });

  it("ETP proratisé en borne basse : les remarques du moteur (contrat sans quotité) restent sous la carte, comme dans KPI RH", () => {
    const q = ["ETP contractuel proratisé : quotité à la date de lecture (30/09/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact", "1 contrat(s) présent(s) sans quotité : total en borne basse"];
    const p = tile(buildEffectifs(input({ data: { ...DATA, etpProrated: { ...DATA.etpProrated, current: { kind: "lower_bound", ratio: { num: 21, den: 2 } }, qualifiers: q } } })), "etp-proratise");
    expect(p.value.text).toBe("≥ 10,50");
    expect(p.note).toBe("quotité à la date de lecture ; ni ETP payé ni historique exact ; 1 contrat(s) présent(s) sans quotité : total en borne basse");
  });

  it("une valeur n.d. reste n.d. avec sa raison (jamais 0) ; PayFit : motif de sortie n.d.", () => {
    expect(tile(m, "etp-moyen").value).toEqual({ text: "n.d.", kind: "nd", reason: `2026-08 : ${ND_MOIS}` });
    expect(tile(m, "etp-moyen").variations![0].text).toBe("10,33");
    expect(tile(m, "effectif-moyen").variations![0].text).toBe("9,33");
    expect(tile(m, "entrees").value.kind).toBe("nd");
    expect(tile(m, "entrees").variations![0].text).toBe("1");
    expect(tile(m, "sorties").note).toBe(`Motif de sortie : n.d. — ${MOTIF_PAYFIT}`);
    expect(MOTIF_PAYFIT).toBe("PayFit n'expose pas le motif de fin");
  });
});

describe("buildEffectifs : graphiques et tableaux exacts (libellés de période du contexte)", () => {
  const m = buildEffectifs(input());

  it("effectif fin de mois N-1 et N : libellés de période, un n.d. et une borne basse non tracés, le tableau dit n.d. et « ≥ »", () => {
    const c = m.charts.find((x) => x.id === "effectif-mensuel")!;
    expect(c.title).toBe("Effectif en fin de mois, juillet → septembre 2026 face à juillet → septembre 2025");
    expect([c.unit, c.tableId, c.categories]).toEqual(["nombre", "effectif-mensuel", ["juil.", "août", "sept."]]);
    expect(c.series.map((s) => [s.key, s.name, s.values])).toEqual([
      ["effectif-n1", "juillet → septembre 2025 (N-1)", [9, null, 10]],
      ["effectif", "juillet → septembre 2026", [10, null, 12]],
    ]);
    expect(c.series[0].reasons![1]).toMatch(/^borne basse \(≥ 9\)/);
    expect(c.series[1].reasons![1]).toBe(ND_MOIS);
    const t = table(m, "effectif-mensuel");
    expect(t.columns.map((x) => x.header)).toEqual(["Mois", "Juillet → septembre 2025 (N-1)", "Juillet → septembre 2026"]);
    expect(shown(t)).toEqual([
      ["Juillet", "9", "10"],
      ["Août", "≥ 9", `n.d. : ${ND_MOIS}`],
      ["Septembre", "10", "12"],
    ]);
    // Projection du dernier trimestre : mention « Prévu » avec sa raison, aucune trame inventée.
    expect(block(m, "effectif").prevu).toEqual([PREVU_PROJECTION]);
  });

  it("entrées et sorties sur les deux périodes, avec le total de chaque période ; n.d. jusqu'au graphique", () => {
    const c = m.charts.find((x) => x.id === "mouvements")!;
    expect(c.title).toBe("Entrées et sorties par mois, juillet → septembre 2025 et juillet → septembre 2026");
    expect(c.categories).toEqual(["juil. 25", "août 25", "sept. 25", "juil. 26", "août 26", "sept. 26"]);
    expect(c.series.map((s) => s.values)).toEqual([
      [0, 1, 0, 1, null, 2],
      [1, 0, 0, 0, null, null],
    ]);
    expect(c.series[1].reasons![5]).toMatch(/^borne basse \(≥ 1\)/);
    expect(shown(table(m, "mouvements"))).toEqual([
      ["Juillet 2025", "0", "1"],
      ["Août 2025", "1", "0"],
      ["Septembre 2025", "0", "0"],
      ["Total juillet → septembre 2025", "1", "1"],
      ["Juillet 2026", "1", "0"],
      ["Août 2026", `n.d. : ${ND_MOIS}`, `n.d. : ${ND_MOIS}`],
      ["Septembre 2026", "2", "≥ 1"],
      ["Total juillet → septembre 2026", `n.d. : 2026-08 : ${ND_MOIS}`, `n.d. : 2026-08 : ${ND_MOIS}`],
    ]);
  });
});

describe("Où sont les effectifs ? seuil de confidentialité, masquage secondaire, écart N − N-1", () => {
  const m = buildEffectifs(input());
  const SVC = `n.d. : ${SERVICE_ND}`;

  it("par service : effectif = contrats qui portent l'ETP ; Non ventilé (1) masqué, le plus petit service affiché (Bureau) aussi ; total non masqué", () => {
    expect(table(m, "effectifs-service").columns.map((c) => c.header)).toEqual(["Service", "Inscrits fin sept. 2026", "Inscrits fin sept. 2025", "Écart", "ETP fin sept. 2026", "ETP fin sept. 2025", "Écart ETP"]);
    // N : Atelier 6, Bureau 5, Non ventilé 1 → Non ventilé masqué, Bureau (plus petit ETP affiché) masqué aussi.
    // N-1 : Atelier 5, Bureau 4, Non ventilé 0 → rien de masqué. Écart Atelier 6,00 − 5,50 = +0,50.
    expect(shown(table(m, "effectifs-service"))).toEqual([
      ["Atelier", SVC, SVC, SVC, "6,00", "5,50", "+0,50"],
      ["Bureau", SVC, SVC, SVC, C2, "4,50", C2],
      ["Non ventilé", SVC, SVC, SVC, C2, "0,00", C2],
      ["Total", SVC, SVC, SVC, "11,50", "10,00", "+1,50"],
    ]);
  });

  it("par catégorie : CDD N-1 (1 contrat) masqué, CDI N-1 aussi (seul autre groupe) ; l'écart d'un groupe masqué est masqué", () => {
    const H = "n.d. : mois hors couverture";
    expect(shown(table(m, "effectifs-categorie"))).toEqual([
      ["CDD", "2", C2, C2, "1,50", H, H],
      ["CDI", "10", C2, C2, "10,00", H, H],
      ["Total", "12", "10", "+2", "11,50", H, H],
    ]);
  });

  it("par statut : « Cadre dirigeant » (1) masqué, comme dans la structure ; le seul autre groupe aussi ; total de l'entreprise affiché", () => {
    expect(shown(table(m, "effectifs-statut"))).toEqual([
      ["Cadre dirigeant", C2, C2, C2, C2, C2, C2],
      ["Hors cadre dirigeant", C2, C2, C2, C2, C2, C2],
      ["Total", "12", "10", "+2", "11,50", "10,00", "+1,50"],
    ]);
    expect(table(m, "axes-indisponibles").rows.map((r) => r.cells[0])).toEqual(["Direction", "Métier", "Motif d'embauche", "Sexe", "Société"]);
  });

  it("gapCell : écart exact de deux entiers ; n.d. avec la raison de la cellule qui manque", () => {
    expect(gapCell(12, 10)).toBe(2);
    expect(gapCell(45000, 50000)).toBe(-5000);
    expect(gapCell({ nd: "x" }, 10)).toEqual({ nd: "x" });
    expect(gapCell(3, { nd: "y" })).toEqual({ nd: "y" });
    expect(gapCell("", 3)).toBe("");
  });

  it("serviceSizes : contrats rangés par le service de leurs lignes de paie du mois ; sans ligne : Non ventilé", () => {
    const svc: Record<string, string | null> = { a: "Atelier", b: "Atelier", c: null, d: "Bureau" };
    expect(serviceSizes(["a", "b", "c", "d", "e"], (id) => svc[id] ?? null)).toEqual({ Atelier: 2, "Non ventilé": 2, Bureau: 1 });
  });
});

describe("Journal agrégé et motifs de sortie : aucune date exacte, aucun service, seuil sur chaque nature et chaque motif", () => {
  const m = buildEffectifs(input());

  it("une ligne par mois : total du moteur, puis « dont » par nature masqué sous le seuil (masquage secondaire dans le mois)", () => {
    const t = table(m, "journal-mouvements");
    expect(t.columns.map((c) => c.header)).toEqual(["Mois", "Entrées", "dont CDI (01)", "dont CDD (02)", "Sorties", "dont CDI (01)", "dont CDD (02)"]);
    const Z = ["0", "0", "0"];
    const M = `n.d. : ${ND_MOIS}`;
    expect(shown(t)).toEqual([
      ["Octobre 2025", ...Z, ...Z],
      // 3 entrées : CDI 2, CDD 1 → CDD masqué, CDI (plus petite affichée) aussi.
      ["Novembre 2025", "3", C2, C2, ...Z],
      ["Décembre 2025", ...Z, ...Z],
      // 1 sortie CDD : masquée, et la cellule CDI (0) avec elle.
      ["Janvier 2026", ...Z, "1", C2, C2],
      ["Février 2026", ...Z, ...Z],
      ["Mars 2026", "4", "2", "2", ...Z],
      ["Avril 2026", ...Z, ...Z],
      ["Mai 2026", ...Z, ...Z],
      ["Juin 2026", ...Z, ...Z],
      ["Juillet 2026", "1", C2, C2, ...Z],
      ["Août 2026", M, M, M, M, M, M],
      // Total des sorties en borne basse : la répartition n'est pas publiée.
      ["Septembre 2026", "2", "2", "0", "≥ 1", `n.d. : ${REPARTITION_BORNE}`, `n.d. : ${REPARTITION_BORNE}`],
      ["Total oct. 2025 → sept. 2026", `n.d. : 2026-08 : ${ND_MOIS}`, "—", "—", `n.d. : 2026-08 : ${ND_MOIS}`, "—", "—"],
    ]);
    expect(block(m, "journal").link).toEqual({ href: LINKS.mouvements, label: "Détail nominatif : Collaborateurs › Mouvements" });
    // PayFit : récapitulatif des motifs « Prévu », avec la raison.
    expect(block(m, "journal").prevu).toEqual([PREVU_MOTIFS_PAYFIT]);
    expect(block(m, "journal").tables).toEqual(["journal-mouvements"]);
  });

  it("countByNature et natureCells : agrégation et masquage d'un mois (cas à la main)", () => {
    expect(countByNature(EVENTS, "2026-03", "entry")).toEqual({ "01": 2, "02": 2 });
    expect(countByNature(EVENTS, "2026-03", "exit")).toEqual({});
    expect(natureCells({ "01": 2, "02": 2 }, ["01", "02"], ex(4), 2)).toEqual([2, 2]);
    expect(natureCells({ "01": 4, "02": 1, "07": 2 }, ["01", "02", "07"], 7, 2)).toEqual([4, { nd: confidentialiteReason(2) }, { nd: confidentialiteReason(2) }]);
    expect(natureCells({}, ["01", "02"], ndc("raison"), 2)).toEqual([{ nd: "raison" }, { nd: "raison" }]);
    expect(natureCells({ "01": 1 }, ["01", "02"], lo(1), 2)).toEqual([{ nd: REPARTITION_BORNE }, { nd: REPARTITION_BORNE }]);
  });

  it("DSN : motifs de sortie récapitulés sur douze mois ; un motif sous le seuil rejoint « Autres motifs » ; aucun motif par ligne", () => {
    // Sorties comptées : 026 ×2, 059 ×3, 011 ×1, motif non déclaré ×1 = 7.
    const exits = [ev("2026-01", "exit", "02", "026"), ev("2026-01", "exit", "02", "026"), ev("2026-01", "exit", "01", "059"), ev("2026-04", "exit", "01", "059"), ev("2026-04", "exit", "01", "059"), ev("2026-06", "exit", "01", "011"), ev("2026-06", "exit", "01", null)];
    const months = monthRange("2025-10", "2026-09").map((mm) => jm(mm, ex(0), ex(mm === "2026-01" ? 3 : mm === "2026-04" ? 2 : mm === "2026-06" ? 2 : 0)));
    const dsn = buildEffectifs(input({ data: { ...DATA, source: "dsn", journal: { ...DATA.journal, months, total: { entries: ex(0), exits: ex(7) }, events: exits } } }));
    expect(shown(table(dsn, "motifs-sortie"))).toEqual([
      ["Démission (059)", "3"],
      ["Fin de contrat à durée déterminée (026)", "2"],
      ["Autres motifs (2 motifs)", "2"],
      ["Total", "7"],
    ]);
    expect(block(dsn, "journal").tables).toEqual(["journal-mouvements", "motifs-sortie"]);
    expect(block(dsn, "journal").prevu).toEqual([]);
    expect(tile(dsn, "sorties").note).toBeUndefined();
    // Seuil 3 : seule « Démission » (3) est nommée ; seuil 4 : tout rejoint « Autres motifs ».
    expect(exitMotifRows(exits, 3)).toEqual({ rows: [{ label: "Démission (059)", cell: 3 }, { label: "Autres motifs (3 motifs)", cell: 4 }], total: 7 });
    expect(exitMotifRows(exits, 4)).toEqual({ rows: [{ label: "Autres motifs (4 motifs)", cell: 7 }], total: 7 });
    // « Autres motifs » sous le seuil : masqué, et le plus petit motif affiché avec lui.
    const few = [ev("2026-01", "exit", "01", "059"), ev("2026-01", "exit", "01", "059"), ev("2026-01", "exit", "01", "059"), ev("2026-02", "exit", "02", "026"), ev("2026-02", "exit", "01", "011")];
    expect(exitMotifRows(few, 3)).toEqual({ rows: [{ label: "Démission (059)", cell: { nd: confidentialiteReason(3) } }, { label: "Autres motifs (2 motifs)", cell: { nd: confidentialiteReason(3) } }], total: 5 });
  });

  it("DSN : un mois de sorties n.d. → motifs non récapitulés (n.d. avec la raison)", () => {
    const dsn = buildEffectifs(input({ data: { ...DATA, source: "dsn" } }));
    expect(block(dsn, "journal").nd).toEqual([{ label: "Motifs de sortie", reason: "sorties de août 2026 n.d. : motifs non récapitulés" }]);
  });
});

describe("Identifiants retirés des raisons du moteur (contrats continus non vérifiables)", () => {
  const RAW = "sorties de 2026-03 : contrats continus non vérifiables (C-FICTIF-1 le 31/03/2026, C-FICTIF-2 le 31/03/2026) — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés";
  const unknown = (kind: "entry" | "exit") => ({ why: "continuity-unknown" as const, row: { event: { kind } } });
  const counted = (kind: "entry" | "exit") => ({ why: "counted" as const, row: { event: { kind } } });

  it("continuitySwaps : texte exact du moteur → mois et nombre de contrats ; même code sans contrat continu (PayFit archivés) : gardé", () => {
    const swaps = continuitySwaps([
      { month: "2026-03", entries: { kind: "exact" }, exits: { kind: "nd", nd: { code: "coverage-incomplete", reason: RAW } }, events: [unknown("exit"), unknown("exit"), counted("exit"), unknown("entry")] },
      { month: "2026-04", entries: { kind: "exact" }, exits: { kind: "nd", nd: { code: "coverage-incomplete", reason: "sorties de 2026-04 inconnues : contrats archivés" } }, events: [] },
    ]);
    expect(swaps).toEqual([{ raw: RAW, text: "2 contrats continus non vérifiables en 2026-03 (détail dans KPI RH)" }]);
    expect(continuityText(1, "2026-05")).toBe("1 contrat continu non vérifiable en 2026-05 (détail dans KPI RH)");
  });

  it("scrubText : raison reprise dans une autre (période, N-1) remplacée ; liste coupée ou reformulée retirée par le filet", () => {
    const swaps = [{ raw: RAW, text: continuityText(2, "2026-03") }];
    expect(scrubText(`N-1 (12 mois) : 2026-03 : sorties n.d. — ${RAW}`, swaps)).toBe("N-1 (12 mois) : 2026-03 : sorties n.d. — 2 contrats continus non vérifiables en 2026-03 (détail dans KPI RH)");
    expect(scrubText("entrées de 2026-02 : contrats continus non vérifiables (C-FICTIF-3 le 01/02/2026, C-FICT…", [])).toBe("entrées de 2026-02 : contrats continus non vérifiables (détail dans KPI RH)");
    expect(scrubText("raison sans identifiant", swaps)).toBe("raison sans identifiant");
  });

  it("buildEffectifs : aucune trace des identifiants dans le modèle (cartes, tableaux, séries, notes)", () => {
    const nested = `2026-03 : sorties n.d. — ${RAW}`;
    const data: EffectifsData = {
      ...DATA,
      turnover: { ...DATA.turnover, previous: ndc(nested), delta: { kind: "nd", nd: { code: "previous-nd", reason: `N-1 (12 mois glissants) : ${nested}` } } },
      rows: [ROWS[0], row("2026-08", { kind: "exact", persons: 11 }, ex(0), ndc(RAW)), ROWS[2]],
      reasonSwaps: [{ raw: RAW, text: continuityText(2, "2026-03") }],
    };
    const m = buildEffectifs(input({ data }));
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/C-FICTIF/);
    expect(tile(m, "turnover").variations![0].reason).toBe("2026-03 : sorties n.d. — 2 contrats continus non vérifiables en 2026-03 (détail dans KPI RH)");
    expect(m.charts.find((c) => c.id === "mouvements")!.series[1].reasons![4]).toBe("2 contrats continus non vérifiables en 2026-03 (détail dans KPI RH)");
  });
});

describe("buildEffectifs : structure, échéances et seuils selon les réglages", () => {
  it("structure masquée sous le seuil de confidentialité avec masquage secondaire, total inchangé, qualifieur « à la date de lecture »", () => {
    const m = buildEffectifs(input());
    const t = table(m, "structure-effectif");
    expect(shown(t)).toEqual([
      ["Temps plein", "3"],
      ["Temps partiel", C2],
      ["Temps de travail non renseigné", C2],
      ["Forfait jours", C2],
      ["Autres modalités du temps de travail", "4"],
      ["Modalité non renseignée", C2],
      ["Cadres dirigeants", C2],
      ["Salariés hors cadres dirigeants", C2],
      ["Total des contrats comptés", "6"],
    ]);
    expect(t.notes).toEqual(["Valeurs à la date de lecture, non historisées (lecture du 30/09/2026).", "Seuil de confidentialité : 2 personnes."]);
    expect(block(m, "structure").prevu).toEqual(PREVU_STRUCTURE);
    expect(PREVU_STRUCTURE.map((x) => x.label)).toEqual(["Femmes et hommes", "Âge moyen et tranches d'âge", "Cadres et non-cadres", "Ancienneté moyenne et tranches d'ancienneté"]);
    expect(PREVU_STRUCTURE[0].reason).toBe("sexe absent du référentiel Collaborateurs lu");
  });

  it("DSN : raison du statut cadre propre à la DSN ; pas de note « date de lecture » sous la structure", () => {
    const m = buildEffectifs(input({ data: { ...DATA, source: "dsn" } }));
    expect(block(m, "structure").prevu.find((x) => x.label === "Cadres et non-cadres")!.reason).toBe("statut catégoriel de la DSN non lu par Clair");
    expect(table(m, "structure-effectif").notes).toEqual(["Seuil de confidentialité : 2 personnes."]);
  });

  it("échéances PayFit : une ligne par mois de l'horizon, « dont » par nature masqué, fin non datée à part, total des fins en borne basse", () => {
    const m = buildEffectifs(input());
    const t = table(m, "echeances-contrat");
    expect(t.title).toBe("Échéances de contrat d'ici 90 jours");
    expect(t.columns.map((c) => c.header)).toEqual(["Mois", "Fins de contrat", "dont CDI (01)", "dont CDD (02)", "Entrées à venir", "dont CDI (01)", "dont CDD (02)"]);
    expect(shown(t)).toEqual([
      // Octobre : 1 fin CDD et 1 entrée CDD, chacune masquée avec la cellule CDI (0) de son mois.
      ["Octobre 2026", "1", C2, C2, "1", C2, C2],
      ["Novembre 2026", "0", "0", "0", "1", C2, C2],
      ["Décembre 2026", "1", C2, C2, "0", "0", "0"],
      ["Total", "≥ 2", "—", "—", "2", "—", "—"],
    ]);
    expect(t.notes).toEqual([
      "Du 01/10/2026 au 29/12/2026, à partir de la lecture du 30/09/2026.",
      "Fin non datée : 1 contrat en cours ou à venir sans date de fin renseignée, hors du tableau ; total des fins en borne basse.",
      "1 contrat sans date de début : non positionnable, hors du tableau.",
      "Seuil de confidentialité : 2 personnes.",
    ]);
  });

  it("échéances, seuil 1 et aucune fin non datée : valeurs exactes, total exact", () => {
    const one: CroiseeSettings = { ...DEFINED, confidentialite: set(1) };
    const m = buildEffectifs(input({ settings: one, data: { ...DATA, contracts: CONTRATS.slice(0, 4) } }));
    expect(shown(table(m, "echeances-contrat"))).toEqual([
      ["Octobre 2026", "1", "0", "1", "1", "0", "1"],
      ["Novembre 2026", "0", "0", "0", "1", "1", "0"],
      ["Décembre 2026", "1", "0", "1", "0", "0", "0"],
      ["Total", "2", "—", "—", "2", "—", "—"],
    ]);
  });

  it("échéances DSN : bloc n.d., la DSN ne déclare ni les entrées ni les fins à venir (jamais un total à 0)", () => {
    const m = buildEffectifs(input({ data: { ...DATA, source: "dsn" } }));
    expect(DSN_ECHEANCES).toBe("la DSN ne déclare ni les entrées ni les fins à venir");
    expect(block(m, "echeances").nd).toEqual([{ reason: DSN_ECHEANCES }]);
    expect(block(m, "echeances").tables).toEqual([]);
    expect(tableNdReasons(table(m, "echeances-contrat"))).toEqual([DSN_ECHEANCES]);
  });

  it("effectif moyen annuel et écart exact aux seuils (calcul à la main), repère quand l'écart ≤ marge", () => {
    const m = buildEffectifs(input());
    expect(table(m, "effectif-moyen-annuel").columns.map((c) => c.header)).toEqual(["Indicateur", "Année 2025", "Janvier → septembre 2026"]);
    expect(shown(table(m, "effectif-moyen-annuel"))).toEqual([["Effectif moyen", "49,50", "51,00"]]);
    // 594/12 − 50 = −0,5 ; 594/12 − 250 = −200,5 ; 459/9 − 50 = +1 ; 459/9 − 250 = −199.
    expect(shown(table(m, "seuils-effectif"))).toEqual([
      ["« Seuil A »", "50", "−0,50", "+1,00"],
      ["« Seuil B »", "250", "−200,50", "−199,00"],
    ]);
    // 2025 : prochain seuil 50, distance 0,5 ≤ marge 1 → repère ; 2026 : prochain seuil 250, distance 199 > 1 → rien.
    expect(m.alerts).toEqual([
      {
        id: "effectifs-seuil-n1",
        level: "repere",
        label: "Effectif proche d'un seuil",
        text: "Effectif moyen 2025 : 49,50 pour le seuil « Seuil A » (50) ; marge d'alerte : 1.",
        href: "#cx-effectifs-seuils",
        linkLabel: "Voir les seuils",
      },
    ]);
  });

  it("réglages absents : blocs n.d. avec la raison écrite et le lien Paramètres ; tableau d'une ligne pour l'export ; aucune alerte", () => {
    const m = buildEffectifs(input({ settings: ABSENT }));
    const param = { href: LINKS.parametres, label: "Paramètres" };
    const conf = "seuil de confidentialité non défini (Paramètres)";
    expect(block(m, "structure").nd).toEqual([{ reason: conf, action: param }]);
    expect(block(m, "structure").tables).toEqual([]);
    expect(block(m, "structure").prevu).toEqual(PREVU_STRUCTURE);
    expect(block(m, "echeances").nd).toEqual([{ reason: "horizon des échéances non défini (Paramètres)", action: param }]);
    expect(block(m, "seuils").nd).toEqual([{ label: "Seuils d'effectif", reason: "seuils d'effectif non définis (Paramètres)", action: param }]);
    expect(block(m, "seuils").tables).toEqual(["effectif-moyen-annuel"]);
    // Répartitions et journal : n.d. (seuil non défini) ; les totaux de l'entreprise (cartes, graphiques) restent affichés.
    expect(block(m, "repartition").nd).toEqual([{ label: "Par service, par catégorie de contrat, par statut de cadre dirigeant", reason: conf, action: param }]);
    expect(block(m, "repartition").tables).toEqual(["axes-indisponibles"]);
    expect(block(m, "journal").nd).toEqual([{ reason: conf, action: param }]);
    expect(block(m, "journal").link).toBeDefined();
    expect(m.charts.map((c) => c.id)).toEqual(["effectif-mensuel", "mouvements"]);
    expect(m.alerts).toEqual([]);
    for (const id of ["structure-effectif", "echeances-contrat", "seuils-effectif", "journal-mouvements", "effectifs-service", "effectifs-categorie", "effectifs-statut"]) expect(tableNdReasons(table(m, id)), id).toHaveLength(1);
    expect(tableNdReasons(table(m, "structure-effectif"))).toEqual([conf]);
  });

  it("horizon défini, seuil de confidentialité absent : échéances n.d. (répartition par nature)", () => {
    const m = buildEffectifs(input({ settings: { ...DEFINED, confidentialite: { kind: "absent" } } }));
    expect(block(m, "echeances").nd).toEqual([{ reason: "seuil de confidentialité non défini (Paramètres)", action: { href: LINKS.parametres, label: "Paramètres" } }]);
  });

  it("seuils définis sans marge d'alerte : écarts affichés, aucune alerte, marge n.d.", () => {
    const m = buildEffectifs(input({ settings: { ...DEFINED, margeAlerte: { kind: "absent" } } }));
    expect(block(m, "seuils").tables).toEqual(["effectif-moyen-annuel", "seuils-effectif"]);
    expect(block(m, "seuils").nd).toEqual([{ label: "Marge d'alerte", reason: "marge d'alerte des seuils d'effectif non définie (Paramètres)", action: { href: LINKS.parametres, label: "Paramètres" } }]);
    expect(m.alerts).toEqual([]);
  });

  it("seuilGap et seuilAlerts : comparaison exacte, bornes incluses (≤ marge), seuil atteint non « proche »", () => {
    expect(seuilGap({ kind: "exact", ratio: { num: 49, den: 1 } }, 50)).toEqual({ exact: -1 });
    expect(seuilGap({ kind: "exact", ratio: { num: 594, den: 12 } }, 50)).toEqual({ exact: -0.5 });
    expect(seuilGap({ kind: "nd", nd: { reason: "x" } }, 50)).toEqual({ nd: "x" });
    expect(seuilGap({ kind: "lower_bound", ratio: { num: 49, den: 1 } }, 50)).toEqual({ nd: "effectif moyen en borne basse : écart non calculable" });
    const seuils = [{ libelle: "S", valeur: 50 }];
    const avg = (num: number, den = 1) => [{ id: "a", label: "Effectif moyen", avg: { kind: "exact" as const, ratio: { num, den } } }];
    expect(seuilAlerts(avg(49), seuils, 1)).toHaveLength(1); // 50 − 49 = 1 ≤ 1
    expect(seuilAlerts(avg(49), seuils, 0)).toHaveLength(0);
    expect(seuilAlerts(avg(50), seuils, 10)).toHaveLength(0); // seuil atteint : aucun seuil supérieur
    expect(seuilAlerts(avg(97, 2), seuils, 1)).toHaveLength(0); // 50 − 48,5 = 1,5 > 1
  });
});

describe("buildEffectifs : filtre de service", () => {
  const svc = (value: string | null, label = value ?? "Non ventilé") => ({ value, label });
  const m = buildEffectifs(input({ service: svc("Atelier") }));

  it("la carte « ETP fin de mois » lit la grille masquée du service ; les autres cartes sont n.d. « non filtrable par service »", () => {
    expect(NON_FILTRABLE).toBe("non filtrable par service");
    const etp = tile(m, "etp-fin");
    expect([etp.sub, etp.value.text, etp.variations![0].text, etp.variations![1].text]).toEqual(["fin septembre 2026 · Atelier", "6,00", "5,50", "+0,50 ETP"]);
    for (const t of m.tiles.filter((x) => x.id !== "etp-fin")) expect(t.value, t.id).toEqual({ text: "n.d.", kind: "nd", reason: NON_FILTRABLE });
    // Le qualifieur obligatoire de l'ETP proratisé reste écrit sous la carte n.d.
    expect(tile(m, "etp-proratise").note).toBe("quotité à la date de lecture ; ni ETP payé ni historique exact");
    expect(m.charts).toEqual([]);
    for (const id of ["effectif", "mouvements", "journal", "structure", "echeances", "seuils"]) expect(block(m, id).nd, id).toEqual([{ reason: NON_FILTRABLE }]);
  });

  it("répartition : la ligne du service retenu seulement, mêmes cellules (et même masquage) que sans filtre ; catégorie et statut n.d.", () => {
    const SVC = `n.d. : ${SERVICE_ND}`;
    expect(shown(table(m, "effectifs-service"))).toEqual([["Atelier", SVC, SVC, SVC, "6,00", "5,50", "+0,50"]]);
    expect(block(m, "repartition").tables).toEqual(["effectifs-service", "axes-indisponibles"]);
    expect(block(m, "repartition").nd.map((n) => n.reason)).toEqual([NON_FILTRABLE, NON_FILTRABLE]);
    // Bureau, masqué sans filtre (masquage secondaire), reste masqué avec le filtre : sa carte est n.d., N-1 affiché.
    const b = buildEffectifs(input({ service: svc("Bureau") }));
    expect(tile(b, "etp-fin").value).toEqual({ text: "n.d.", kind: "nd", reason: confidentialiteReason(2) });
    expect(tile(b, "etp-fin").variations![0].text).toBe("4,50");
    expect(tile(b, "etp-fin").variations![1]).toMatchObject({ text: null, reason: `valeur n.d. — ${confidentialiteReason(2)}` });
    expect(shown(table(b, "effectifs-service"))[0].slice(4)).toEqual([C2, "4,50", C2]);
  });

  it("grille de service entièrement n.d. : la ligne du service retenu est émise avec la raison, jamais un tableau vide", () => {
    const AXE = "axe analytique du service non choisi (Paramètres)";
    const grids = [{ axis: "service" as const, inscrit: SERVICE_INSCRITS, etp: { cur: { kind: "nd" as const, reason: AXE }, prev: { kind: "nd" as const, reason: AXE } } }, ...GRIDS.slice(1)];
    const n = buildEffectifs(input({ service: svc("Atelier"), data: { ...DATA, grids } }));
    expect(shown(table(n, "effectifs-service"))).toEqual([["Atelier", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, `n.d. : ${AXE}`, `n.d. : ${AXE}`, `n.d. : ${AXE}`]]);
    expect(tile(n, "etp-fin").value).toEqual({ text: "n.d.", kind: "nd", reason: AXE });
  });

  it("mois N-1 sans aucune ligne de journal : ETP du service n.d. (grille des effectifs mensuels), jamais 0", () => {
    // Journal fictif : lignes de paie en août 2025 et en septembre 2026 seulement ; septembre 2025 n'a aucune ligne.
    const line = (month: string, code: string): LedgerLine => ({ key: `${month}-${code}`, month, accountId: "641100", accountName: null, debitCents: 100000, creditCents: 0, contractId: "C-FICTIF-1", analytic: [{ type: "Service", code, value: code }] });
    const journal = { lines: [line("2025-08", "Atelier"), line("2026-09", "Atelier")], months: [], openMonths: [], grid: {}, serviceAxis: "Service" } as unknown as JournalInput;
    // L'ETP par service d'un mois lu vaut 4,00 ; l'ancien calcul direct aurait donné 0 pour un mois sans ligne.
    const real = { kpi: {}, journal, natures: {}, overrides: {}, etpService: () => val(40000) } as unknown as RealSource;
    const etp = { cur: monthlyGrid({ measure: "etp", axis: "service", year: "2026", real, scenario: null }), prev: monthlyGrid({ measure: "etp", axis: "service", year: "2025", real, scenario: null }) };
    const grids = [{ axis: "service" as const, inscrit: SERVICE_INSCRITS, etp, sizes: { cur: { Atelier: 3 }, prev: null } }, ...GRIDS.slice(1)];
    const n = buildEffectifs(input({ service: svc("Atelier"), data: { ...DATA, grids } }));
    const t = tile(n, "etp-fin");
    const reason = "aucune ligne de paie lue pour 2025-09 : ETP par service indisponible";
    expect(t.value.text).toBe("4,00");
    expect(t.variations![0]).toMatchObject({ text: null, reason });
    expect(t.variations![1]).toMatchObject({ text: null });
    expect(shown(table(n, "effectifs-service"))[0].slice(4)).toEqual(["4,00", `n.d. : ${reason}`, `n.d. : ${reason}`]);
  });

  it("seuil de confidentialité absent : la carte du service filtré est n.d. avec la raison", () => {
    const n = buildEffectifs(input({ service: svc("Atelier"), settings: { ...DEFINED, confidentialite: { kind: "absent" } } }));
    expect(tile(n, "etp-fin").value).toEqual({ text: "n.d.", kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
  });
});

describe("buildEffectifs : chapitre non calculable", () => {
  it("source RH absente : modèle n.d. avec la raison et l'action, aucune carte ni tableau", () => {
    const m = buildEffectifs(input({ nd: { reason: "Aucune source RH retenue (à choisir dans Données)", action: { href: LINKS.donnees, label: "Données" } }, data: null }));
    expect(m.nd).toEqual({ reason: "Aucune source RH retenue (à choisir dans Données)", action: { href: LINKS.donnees, label: "Données" } });
    expect([m.tiles, m.tables, m.charts, m.blocks]).toEqual([[], [], [], []]);
    expect(render(m)).toContain('data-testid="cx-effectifs-nd"');
  });
});

describe("modèle : identifiants et glossaire", () => {
  const m = buildEffectifs(input());
  it("identifiants de tableau et de graphique uniques ; chaque graphique a son tableau exact", () => {
    const ids = m.tables.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of m.charts) expect(ids, c.id).toContain(c.tableId);
  });
  it("chaque identifiant du glossaire cité existe", () => {
    const terms = new Set([
      ...m.terms,
      ...m.tiles.map((t) => t.term ?? ""),
      ...m.blocks.map((b) => b.term ?? ""),
      ...m.tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.map((c) => c.term ?? "")]),
    ]);
    terms.delete("");
    for (const id of terms) expect(glossaryEntry(id), id).toBeDefined();
  });
  it("aucune clé de personne ni de contrat dans le modèle", () => {
    expect(JSON.stringify(m)).not.toMatch(/k-p\d|k-c\d/);
  });
});

describe("EffectifsView : rendu du modèle", () => {
  const m = buildEffectifs(input());

  it("Afficher tout : cartes, graphiques chacun suivi de son tableau exact, tableaux titrés, Prévu, limites", () => {
    const out = render(m);
    for (const id of ["effectif", "etp-fin", "etp-proratise", "etp-moyen", "effectif-moyen", "entrees", "sorties", "turnover"]) expect(out).toContain(`data-testid="cx-tile-effectifs-${id}"`);
    for (const id of ["effectif-mensuel", "mouvements"]) {
      expect(out).toContain(`data-testid="cx-chart-${id}"`);
      expect(out).toContain(`data-testid="cx-table-${id}"`);
    }
    for (const id of ["effectifs-service", "effectifs-categorie", "effectifs-statut", "axes-indisponibles", "journal-mouvements", "structure-effectif", "echeances-contrat", "effectif-moyen-annuel", "seuils-effectif"]) expect(out).toContain(`data-testid="cx-table-${id}"`);
    // Blocs à plusieurs tableaux : un titre visible par tableau.
    for (const id of ["effectifs-service", "effectifs-categorie", "effectifs-statut", "axes-indisponibles", "effectif-moyen-annuel", "seuils-effectif"]) expect(out).toContain(`data-testid="cx-effectifs-titre-${id}"`);
    expect(out).not.toContain('data-testid="cx-effectifs-titre-structure-effectif"');
    for (const id of ["structure", "non-disponibles", "effectif", "journal"]) expect(out).toContain(`data-testid="cx-prevu-${id}"`);
    for (const x of [...PREVU_INDICATEURS, PREVU_PROJECTION, PREVU_MOTIFS_PAYFIT]) expect(out).toContain(x.reason);
    expect(out).toContain(ETP_PRORATED_LABEL);
    expect(out).toContain('id="cx-effectifs-journal"');
    expect(out).toContain('data-testid="cx-alerts"');
    expect(out).toContain('href="#cx-effectifs-seuils"');
    expect(out).toContain(`href="${LINKS.mouvements}"`);
    expect(out).toContain('data-testid="cx-effectifs-limites"');
    expect(out).not.toMatch(/k-p\d|k-c\d/);
  });

  it("Graphiques : pas de tableau, un lien vers le tableau exact sous chaque graphique ; « Prévu » du graphique ; lien d'alerte vers les tableaux", () => {
    const out = render(m, "graphique");
    expect(out).toContain('data-testid="cx-chart-effectif-mensuel"');
    expect(out).not.toContain('data-testid="cx-table-');
    expect(out).toContain(`href="${LINKS.tableau}#cx-table-mouvements"`);
    expect(out).not.toContain('id="cx-effectifs-journal"');
    expect(out).toContain('data-testid="cx-tile-effectifs-effectif"');
    expect(out).toContain('data-testid="cx-prevu-effectif"');
    expect(out).toContain(PREVU_PROJECTION.reason);
    // Le bloc des seuils n'est pas rendu en affichage « Graphiques » : le lien de l'alerte ouvre l'affichage « Tableaux ».
    expect(out).toContain(`href="${LINKS.tableau}#cx-effectifs-seuils"`);
    expect(out).not.toContain('href="#cx-effectifs-seuils"');
  });

  it("Tableaux : aucun graphique, tous les tableaux", () => {
    const out = render(m, "tableau");
    expect(out).not.toContain('data-testid="cx-chart-');
    expect(out).toContain('data-testid="cx-table-effectif-mensuel"');
    expect(out).toContain('data-testid="cx-table-journal-mouvements"');
  });

  it("réglages absents : n.d. avec la raison et le lien Paramètres à l'écran", () => {
    const out = render(buildEffectifs(input({ settings: ABSENT })));
    expect(out).toContain('data-testid="cx-effectifs-structure-nd"');
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain('data-testid="cx-effectifs-echeances-nd"');
    expect(out).toContain("horizon des échéances non défini (Paramètres)");
    expect(out).toContain('data-testid="cx-effectifs-seuils-nd"');
    expect(out).toContain('data-testid="cx-effectifs-repartition-nd"');
    expect(out).toContain('data-testid="cx-effectifs-journal-nd"');
    expect(out).toContain(`href="${LINKS.parametres}"`);
    expect(out).not.toContain('data-testid="cx-table-structure-effectif"');
  });
});

// --- Lecture des sources (loadEffectifsInput) sur les référentiels fictifs des tests (transport PayFit fictif, DSN fictives) ----------

type FakeOpts = { service?: { value: string | null | undefined; label: string; axis: string | null; reason: string | null }; settings?: CroiseeSettings };
function fakeCtx(pay: PayrollContext, months: string[], o: FakeOpts = {}, calls = { payroll: 0 }): CroiseeContext {
  const href = (patch: Record<string, string | null> = {}, hash?: string) => `/e/demo/studio-rh/masse-salariale/croisee?chapitre=effectifs${patch.affichage ? `&affichage=${patch.affichage}` : ""}${hash ? `#${hash}` : ""}`;
  const prevMonths = months.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
  return {
    slug: "demo",
    workspace: { id: "ws-demo" },
    canEdit: false,
    period: { year: Number(months[0].slice(0, 4)), from: months[0].slice(5), to: months[months.length - 1].slice(5), years: [], last: "", months, notices: [] },
    periodNd: null,
    prevMonths,
    labels: { period: periodLabel(months), prev: periodLabel(prevMonths) },
    service: { options: [], ...(o.service ?? { value: undefined, label: "Tous les services", axis: null, reason: "journal de paie indisponible" }) },
    settings: o.settings ?? DEFINED,
    affichage: "tout",
    href,
    load: {
      payroll: async () => {
        calls.payroll += 1;
        return pay;
      },
    },
  } as unknown as CroiseeContext;
}
function fakePay(input: ReturnType<typeof kpiInput> | null, source: "payfit" | "dsn"): PayrollContext {
  return {
    kpi: { collab: { source: { chosen: source, reason: "source retenue" }, state: null }, settings: { invalid: [] }, input, readTypes: [] },
    source,
    input: null,
    unavailable: source === "dsn" ? null : "aucune lecture PayFit appliquée",
    etp: (months: string[]) => months.map((month) => ({ month, etp4: null, reason: "journal de paie indisponible" })),
    service: { axis: null, origin: "none", updatedAt: null },
  } as unknown as PayrollContext;
}

describe("loadEffectifsInput puis buildEffectifs : référentiels fictifs", () => {
  it("PayFit fictif : huit cartes, deux graphiques avec leur tableau, journal agrégé sans identifiant, structure et échéances calculées", async () => {
    const data = await payfitFixtureBuild();
    const kin = kpiInput(data, await fixtureAbsences());
    const months = monthRange("2026-07", "2026-09");
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(fakePay(kin, "payfit"), months)));
    expect(m.nd).toBeNull();
    expect(m.tiles).toHaveLength(8);
    expect(m.charts.map((c) => c.id)).toEqual(["effectif-mensuel", "mouvements"]);
    expect(m.charts[0].series.map((s) => s.name)).toEqual(["juillet → septembre 2025 (N-1)", "juillet → septembre 2026"]);
    for (const c of m.charts) expect(m.tables.some((t) => t.id === c.tableId)).toBe(true);
    // Effectif fin de mois : la carte et la dernière colonne du graphique viennent du même calcul.
    const eff = m.tiles.find((t) => t.id === "effectif")!;
    const last = m.charts[0].series[1].values.at(-1);
    if (eff.value.kind === "value") expect(eff.value.text).toBe(String(last));
    const journal = m.tables.find((t) => t.id === "journal-mouvements")!;
    expect(journal.columns.map((c) => c.header)).toEqual(["Mois", "Entrées", "dont CDI (01)", "dont CDD (02)", "Sorties", "dont CDI (01)", "dont CDD (02)"]);
    expect(journal.rows).toHaveLength(12);
    // Aucun nom, prénom ni identifiant de personne ou de contrat dans le modèle (écran et exports).
    const json = JSON.stringify(m);
    const secrets = [...data.persons.flatMap((p) => [p.familyName, p.givenNames, p.usageName, p.employeeNumber, p.externalId]), ...data.contracts.map((c) => c.externalId)].filter((x): x is string => typeof x === "string" && x.length > 3);
    expect(secrets.length).toBeGreaterThan(0);
    for (const x of secrets) expect(json.includes(x), x).toBe(false);
    expect(m.blocks.find((b) => b.id === "structure")!.tables).toEqual(["structure-effectif"]);
    expect(m.blocks.find((b) => b.id === "echeances")!.tables).toEqual(["echeances-contrat"]);
    expect(m.blocks.find((b) => b.id === "journal")!.prevu).toEqual([PREVU_MOTIFS_PAYFIT]);
  });

  it("DSN fictives (janvier → septembre 2026) : aucune trace des identifiants de contrat (contrats continus non vérifiables en N-1)", async () => {
    const data = dsnFixtureBuild();
    const kin = kpiInput(data, DSN_ABSENCES);
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(fakePay(kin, "dsn"), monthRange("2026-01", "2026-09"))));
    expect(m.nd).toBeNull();
    const json = JSON.stringify(m);
    const ids = [...data.contracts.map((c) => c.externalId), ...data.persons.flatMap((p) => [p.familyName, p.givenNames, p.employeeNumber, p.externalId])].filter((x): x is string => typeof x === "string" && x.length > 3);
    expect(ids.length).toBeGreaterThan(0);
    for (const x of ids) expect(json.includes(x), x).toBe(false);
    // Le turnover N-1 (octobre 2024 → septembre 2025) bute sur des contrats continus non vérifiables : la raison garde le mois et le nombre.
    expect(json).toMatch(/\d+ contrats continus non vérifiables en 2024-10 \(détail dans KPI RH\)/);
    expect(m.blocks.find((b) => b.id === "echeances")!.nd).toEqual([{ reason: DSN_ECHEANCES }]);
    expect(m.blocks.find((b) => b.id === "journal")!.prevu).toEqual([]);
    expect(json).not.toContain(MOTIF_PAYFIT);
  });

  it("référentiel RH absent : chapitre n.d. avec la raison et le lien Données", async () => {
    const pay = fakePay(null, "payfit");
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(pay, monthRange("2026-07", "2026-09"))));
    expect(m.nd).toEqual({ reason: "Référentiel RH non construit", action: { href: "/e/demo/donnees", label: "Données" } });
  });

  it("effectifsModel : un seul calcul par contexte de requête (le composant et l'export partagent le même modèle)", async () => {
    const kin = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
    const calls = { payroll: 0 };
    const ctx = fakeCtx(fakePay(kin, "dsn"), monthRange("2026-07", "2026-09"), {}, calls);
    const a = effectifsModel(ctx);
    const b = effectifsModel(ctx);
    expect(a).toBe(b);
    expect((await a).chapter).toBe("effectifs");
    expect(calls.payroll).toBe(1);
  });
});
