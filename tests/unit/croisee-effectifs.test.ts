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
import type { Grid } from "@/lib/budget/monthly";
import type { CroiseeSettings } from "@/lib/croisee-settings";
import type { EcheanceContract } from "@/lib/croisee/echeances";
import type { StructureContract } from "@/lib/croisee/structure";
import { glossaryEntry } from "@/lib/glossary";
import { ETP_PRORATED_LABEL } from "@/lib/rh/kpi/etp-prorata";
import { cellView, tableNdReasons, type CroiseeTable } from "@/lib/viz/croisee";
import {
  buildEffectifs,
  loadEffectifsInput,
  MOTIF_PAYFIT,
  NON_FILTRABLE,
  PREVU_INDICATEURS,
  PREVU_STRUCTURE,
  seuilAlerts,
  seuilGap,
  type EffectifsData,
  type EffectifsInput,
  type EffectifsModel,
} from "@/lib/viz/croisee-effectifs";
import type { RowIn } from "@/lib/viz/kpi";

// Chapitre 02 · Effectifs & mouvements : buildEffectifs avec des entrées fictives écrites à la main (aucune donnée réelle), puis rendu
// du modèle. Période juillet → septembre 2026, N-1 juillet → septembre 2025, lecture RH du 30/09/2026.

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
const GRIDS: EffectifsData["grids"] = [
  {
    axis: "service",
    inscrit: { cur: { kind: "nd", reason: SERVICE_ND }, prev: { kind: "nd", reason: SERVICE_ND } },
    etp: { cur: grid({ "2026-09": { Atelier: 60000, Bureau: 50000, "Non ventilé": 5000 } }), prev: grid({ "2025-09": { Atelier: 55000, Bureau: 45000 } }) },
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
const CONTRATS: EcheanceContract[] = [
  { startDate: "2026-03-01", endDate: "2026-10-15", nature: "02" },
  { startDate: "2026-11-02", endDate: null, nature: "01" },
  { startDate: "2026-10-01", endDate: "2026-12-29", nature: "02" },
  { startDate: null, endDate: null, nature: "01" },
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
  etpService: null,
  annual: {
    prevYear: 2025,
    prev: { kind: "exact", ratio: { num: 594, den: 12 } }, // 49,5
    curMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    cur: { kind: "exact", ratio: { num: 459, den: 9 } }, // 51
  },
  grids: GRIDS,
  journal: {
    from: "2025-10",
    to: "2026-09",
    months: [
      { month: "2026-07", entries: ex(1), exits: ex(0) },
      { month: "2026-08", entries: ndc(ND_MOIS), exits: ndc(ND_MOIS) },
      { month: "2026-09", entries: ex(2), exits: lo(1) },
    ],
    events: [
      { date: "2026-09-15", kind: "exit", nature: "01", endReason: null, endReasonNd: null, why: "excluded-nature", service: { kind: "value", value: "Bureau" } },
      { date: "2025-11-03", kind: "entry", nature: "01", endReason: null, endReasonNd: null, why: "counted", service: { kind: "value", value: "Atelier" } },
      { date: "2026-01-31", kind: "exit", nature: "02", endReason: null, endReasonNd: null, why: "counted", service: { kind: "value", value: null } },
      { date: "2026-02-02", kind: "entry", nature: "02", endReason: null, endReasonNd: null, why: "neutralized", service: { kind: "nd", reason: "aucune ligne de paie du contrat ce mois-là" } },
      { date: "2026-09-30", kind: "exit", nature: "29", endReason: null, endReasonNd: null, why: "out-of-scope", service: { kind: "value", value: "Atelier" } },
    ],
  },
  population: { kind: "value", lower: false, contracts: POPULATION },
  natures: ["01", "02"],
  contracts: CONTRATS,
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
const LINKS = { parametres: "/e/demo/parametres#croisee", donnees: "/e/demo/donnees", mouvements: "/e/demo/studio-rh/collaborateurs/mouvements?de=2025-10&a=2026-09", tableau: "/e/demo/croisee?chapitre=effectifs&affichage=tableau" };
const input = (over: Partial<EffectifsInput> = {}): EffectifsInput => ({
  links: LINKS,
  period: { months: ["2026-07", "2026-08", "2026-09"], prevMonths: ["2025-07", "2025-08", "2025-09"] },
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

describe("buildEffectifs : cartes", () => {
  const m = buildEffectifs(input());

  it("huit cartes dans l'ordre, avec N-1 et l'écart du moteur, sans couleur de tendance (effectifs, ETP, taux)", () => {
    expect(m.tiles.map((t) => t.id)).toEqual(["effectif", "etp-fin", "etp-proratise", "etp-moyen", "effectif-moyen", "entrees", "sorties", "turnover"]);
    expect(m.tiles.every((t) => !t.cost && (t.variations ?? []).every((v) => v.tone === "flat"))).toBe(true);
    const eff = tile(m, "effectif");
    expect([eff.label, eff.sub, eff.value.text]).toEqual(["Effectif fin de mois", "fin septembre 2026", "12"]);
    expect(eff.variations!.map((v) => [v.label, v.text])).toEqual([["N-1", "10"], ["Écart", "+2,00 personnes"]]);
    // Mini-courbe : le mois n.d. reste null (jamais 0).
    expect(eff.spark?.values).toEqual([10, null, 12]);
    const etp = tile(m, "etp-fin");
    expect([etp.value.text, etp.variations![0].text, etp.variations![1].text]).toEqual(["11,50", "10,00", "+1,50 ETP"]);
    const to = tile(m, "turnover");
    // Le pourcentage est séparé par une espace insécable (format du moteur des KPI).
    expect([to.sub, to.value.text, to.variations![0].text, to.variations![1].text, to.note]).toEqual(["12 mois glissants : octobre 2025 → septembre 2026", "12,50\u00a0%", "10,00\u00a0%", "+2,50 pts", "1 entrée · 2 sorties"]);
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

describe("buildEffectifs : graphiques et tableaux exacts", () => {
  const m = buildEffectifs(input());

  it("effectif fin de mois N-1 et N : un n.d. et une borne basse ne sont pas tracés, le tableau dit n.d. et « ≥ »", () => {
    const c = m.charts.find((x) => x.id === "effectif-mensuel")!;
    expect([c.unit, c.tableId, c.categories]).toEqual(["nombre", "effectif-mensuel", ["juil.", "août", "sept."]]);
    expect(c.series.map((s) => [s.key, s.name, s.values])).toEqual([
      ["effectif-n1", "2025 (N-1)", [9, null, 10]],
      ["effectif", "2026", [10, null, 12]],
    ]);
    expect(c.series[0].reasons![1]).toMatch(/^borne basse \(≥ 9\)/);
    expect(c.series[1].reasons![1]).toBe(ND_MOIS);
    expect(shown(table(m, "effectif-mensuel"))).toEqual([
      ["Juillet", "9", "10"],
      ["Août", "≥ 9", `n.d. : ${ND_MOIS}`],
      ["Septembre", "10", "12"],
    ]);
  });

  it("entrées et sorties sur les deux périodes, avec le total de chaque période ; n.d. jusqu'au graphique", () => {
    const c = m.charts.find((x) => x.id === "mouvements")!;
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

  it("Où sont les effectifs ? inscrits et ETP par axe, N et N-1, axes indisponibles avec leur raison", () => {
    expect(shown(table(m, "effectifs-service"))).toEqual([
      ["Atelier", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, "6,00", "5,50"],
      ["Bureau", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, "5,00", "4,50"],
      ["Non ventilé", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, "0,50", "0,00"],
      ["Total", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, "11,50", "10,00"],
    ]);
    expect(shown(table(m, "effectifs-categorie"))).toEqual([
      ["CDD", "2", "1", "1,50", "n.d. : mois hors couverture"],
      ["CDI", "10", "9", "10,00", "n.d. : mois hors couverture"],
      ["Total", "12", "10", "11,50", "n.d. : mois hors couverture"],
    ]);
    expect(table(m, "effectifs-categorie").columns.map((c) => c.header)).toEqual(["Catégorie", "Inscrits fin sept. 2026", "Inscrits fin sept. 2025", "ETP fin sept. 2026", "ETP fin sept. 2025"]);
    expect(table(m, "axes-indisponibles").rows.map((r) => r.cells[0])).toEqual(["Direction", "Métier", "Motif d'embauche", "Sexe", "Société"]);
  });

  it("journal des mouvements sans nom : date, sens, nature, service, motif (PayFit : n.d.), décompte du turnover ; hors natures comptées non listé", () => {
    const t = table(m, "journal-mouvements");
    expect(shown(t)).toEqual([
      ["03/11/2025", "Entrée", "CDI (01)", "Atelier", "—", "compté"],
      ["31/01/2026", "Sortie", "CDD (02)", "Non ventilé", `n.d. : ${MOTIF_PAYFIT}`, "compté"],
      ["02/02/2026", "Entrée", "CDD (02)", "n.d. : aucune ligne de paie du contrat ce mois-là", "—", "neutralisé : contrat continu"],
      ["15/09/2026", "Sortie", "CDI (01)", "Bureau", `n.d. : ${MOTIF_PAYFIT}`, "exclu : nature de sortie (Paramètres)"],
    ]);
    expect(t.notes).toEqual([`août 2026 : entrées n.d. — ${ND_MOIS}`, `août 2026 : sorties n.d. — ${ND_MOIS}`, "sept. 2026 : sorties : au moins celles connues (source incomplète)"]);
    expect(block(m, "journal").link).toEqual({ href: LINKS.mouvements, label: "Détail nominatif : Collaborateurs › Mouvements" });
  });

  it("DSN : le motif de sortie déclaré est repris avec son libellé ; absent : n.d. avec la raison de la source", () => {
    const events = [
      { date: "2026-03-31", kind: "exit" as const, nature: "02", endReason: "026", endReasonNd: null, why: "counted" as const, service: { kind: "value" as const, value: "Atelier" } },
      { date: "2026-04-30", kind: "exit" as const, nature: "01", endReason: null, endReasonNd: "motif de rupture absent (S21.G00.62.002)", why: "counted" as const, service: { kind: "value" as const, value: "Atelier" } },
    ];
    const dsn = buildEffectifs(input({ data: { ...DATA, source: "dsn", journal: { ...DATA.journal, events } } }));
    expect(shown(table(dsn, "journal-mouvements")).map((r) => r[4])).toEqual(["Fin de contrat à durée déterminée (026)", "n.d. : motif de rupture absent (S21.G00.62.002)"]);
    expect(tile(dsn, "sorties").note).toBeUndefined();
  });
});

describe("buildEffectifs : structure, échéances et seuils selon les réglages", () => {
  it("réglages définis : structure masquée sous le seuil de confidentialité, total inchangé, qualifieur « à la date de lecture »", () => {
    const m = buildEffectifs(input());
    const t = table(m, "structure-effectif");
    const n2 = "n.d. : groupe de moins de 2 personnes : non affiché (seuil de confidentialité)";
    expect(shown(t)).toEqual([
      ["Temps plein", "3"],
      ["Temps partiel", "2"],
      ["Temps de travail non renseigné", n2],
      ["Forfait jours", n2],
      ["Autres modalités du temps de travail", "4"],
      ["Modalité non renseignée", n2],
      ["Cadres dirigeants", n2],
      ["Salariés hors cadres dirigeants", "5"],
      ["Total des contrats comptés", "6"],
    ]);
    expect(t.notes).toEqual(["Valeurs à la date de lecture, non historisées (lecture du 30/09/2026).", "Seuil de confidentialité : 2 personnes."]);
    expect(block(m, "structure").prevu).toEqual(PREVU_STRUCTURE);
    expect(PREVU_STRUCTURE.map((x) => x.label)).toEqual(["Femmes et hommes", "Âge moyen et tranches d'âge", "Cadres et non-cadres", "Ancienneté moyenne et tranches d'ancienneté"]);
    expect(PREVU_STRUCTURE[0].reason).toBe("sexe absent du référentiel Collaborateurs lu");
  });

  it("réglages définis : échéances par mois et par nature dans l'horizon, depuis la lecture RH", () => {
    const m = buildEffectifs(input());
    const t = table(m, "echeances-contrat");
    expect(t.title).toBe("Échéances de contrat d'ici 90 jours");
    expect(shown(t)).toEqual([
      ["Octobre 2026", "CDD (02)", "1", "1"],
      ["Novembre 2026", "CDI (01)", "0", "1"],
      ["Décembre 2026", "CDD (02)", "1", "0"],
      ["Total", "—", "2", "2"],
    ]);
    expect(t.notes).toEqual(["Du 01/10/2026 au 29/12/2026, à partir de la lecture du 30/09/2026.", "1 contrat sans date de début : non daté, hors du tableau."]);
  });

  it("réglages définis : effectif moyen annuel et écart exact aux seuils (calcul à la main), repère quand l'écart ≤ marge", () => {
    const m = buildEffectifs(input());
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
    expect(block(m, "structure").nd).toEqual([{ reason: "seuil de confidentialité non défini (Paramètres)", action: param }]);
    expect(block(m, "structure").tables).toEqual([]);
    expect(block(m, "structure").prevu).toEqual(PREVU_STRUCTURE);
    expect(block(m, "echeances").nd).toEqual([{ reason: "horizon des échéances non défini (Paramètres)", action: param }]);
    expect(block(m, "seuils").nd).toEqual([{ label: "Seuils d'effectif", reason: "seuils d'effectif non définis (Paramètres)", action: param }]);
    expect(block(m, "seuils").tables).toEqual(["effectif-moyen-annuel"]);
    expect(m.alerts).toEqual([]);
    for (const id of ["structure-effectif", "echeances-contrat", "seuils-effectif"]) expect(tableNdReasons(table(m, id)), id).toHaveLength(1);
    expect(tableNdReasons(table(m, "structure-effectif"))).toEqual(["seuil de confidentialité non défini (Paramètres)"]);
  });

  it("seuils définis sans marge d'alerte : écarts affichés, aucune alerte, marge n.d.", () => {
    const m = buildEffectifs(input({ settings: { ...DEFINED, margeAlerte: { kind: "absent" } } }));
    expect(block(m, "seuils").tables).toEqual(["effectif-moyen-annuel", "seuils-effectif"]);
    expect(block(m, "seuils").nd).toEqual([{ label: "Marge d'alerte", reason: "marge d'alerte des seuils d'effectif non définie (Paramètres)", action: { href: LINKS.parametres, label: "Paramètres" } }]);
    expect(m.alerts).toEqual([]);
  });

  it("seuilGap et seuilAlerts : comparaison exacte, bornes incluses (≤ marge), seuil atteint non « proche »", () => {
    expect(seuilGap({ kind: "exact", ratio: { num: 49, den: 1 } }, 50)).toEqual({ exact: -1 });
    expect(seuilGap({ kind: "nd", nd: { reason: "x" } }, 50)).toEqual({ nd: "x" });
    const seuils = [{ libelle: "S", valeur: 50 }];
    const avg = (num: number, den = 1) => [{ id: "a", label: "Effectif moyen", avg: { kind: "exact" as const, ratio: { num, den } } }];
    expect(seuilAlerts(avg(49), seuils, 1)).toHaveLength(1); // 50 − 49 = 1 ≤ 1
    expect(seuilAlerts(avg(49), seuils, 0)).toHaveLength(0);
    expect(seuilAlerts(avg(50), seuils, 10)).toHaveLength(0); // seuil atteint : aucun seuil supérieur
    expect(seuilAlerts(avg(97, 2), seuils, 1)).toHaveLength(0); // 50 − 48,5 = 1,5 > 1
  });
});

describe("buildEffectifs : filtre de service", () => {
  const svc = { value: "Atelier", label: "Atelier" };
  const etpService: EffectifsData["etpService"] = { current: { etp4: 60000, reason: null }, previous: { etp4: 55000, reason: null }, delta: { kind: "exact", unit: "etp", value: { num: 1, den: 2 } } };
  const m = buildEffectifs(input({ service: svc, data: { ...DATA, etpService } }));

  it("seul l'ETP de fin de mois du service est une valeur ; les autres cartes sont n.d. « non filtrable par service »", () => {
    expect(NON_FILTRABLE).toBe("non filtrable par service");
    const etp = tile(m, "etp-fin");
    expect([etp.sub, etp.value.text, etp.variations![0].text, etp.variations![1].text]).toEqual(["fin septembre 2026 · Atelier", "6,00", "5,50", "+0,50 ETP"]);
    for (const t of m.tiles.filter((x) => x.id !== "etp-fin")) expect(t.value, t.id).toEqual({ text: "n.d.", kind: "nd", reason: NON_FILTRABLE });
    expect(m.charts).toEqual([]);
    for (const id of ["effectif", "mouvements", "structure", "echeances", "seuils"]) expect(block(m, id).nd, id).toEqual([{ reason: NON_FILTRABLE }]);
  });

  it("répartition : la ligne du service retenu seulement ; catégorie et statut n.d.", () => {
    expect(shown(table(m, "effectifs-service"))).toEqual([["Atelier", `n.d. : ${SERVICE_ND}`, `n.d. : ${SERVICE_ND}`, "6,00", "5,50"]]);
    expect(block(m, "repartition").tables).toEqual(["effectifs-service", "axes-indisponibles"]);
    expect(block(m, "repartition").nd.map((n) => n.reason)).toEqual([NON_FILTRABLE, NON_FILTRABLE]);
  });

  it("journal filtré par le service du mouvement ; un service inconnu est écarté et compté dans une note", () => {
    const t = table(m, "journal-mouvements");
    expect(shown(t).map((r) => r[0])).toEqual(["03/11/2025"]);
    expect(t.notes![0]).toBe("1 mouvement au service inconnu, non affiché avec le filtre de service.");
    const nv = buildEffectifs(input({ service: { value: null, label: "Non ventilé" }, data: { ...DATA, etpService } }));
    expect(shown(table(nv, "journal-mouvements")).map((r) => r[0])).toEqual(["31/01/2026"]);
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
    const json = JSON.stringify({ ...m, blocks: m.blocks });
    expect(json).not.toMatch(/k-p\d|k-c\d/);
  });
});

describe("EffectifsView : rendu du modèle", () => {
  const m = buildEffectifs(input());

  it("Afficher tout : cartes, graphiques chacun suivi de son tableau exact, tableaux, Prévu, limites", () => {
    const out = render(m);
    for (const id of ["effectif", "etp-fin", "etp-proratise", "etp-moyen", "effectif-moyen", "entrees", "sorties", "turnover"]) expect(out).toContain(`data-testid="cx-tile-effectifs-${id}"`);
    for (const id of ["effectif-mensuel", "mouvements"]) {
      expect(out).toContain(`data-testid="cx-chart-${id}"`);
      expect(out).toContain(`data-testid="cx-table-${id}"`);
    }
    for (const id of ["effectifs-service", "effectifs-categorie", "effectifs-statut", "axes-indisponibles", "journal-mouvements", "structure-effectif", "echeances-contrat", "effectif-moyen-annuel", "seuils-effectif"]) expect(out).toContain(`data-testid="cx-table-${id}"`);
    expect(out).toContain('data-testid="cx-prevu-structure"');
    expect(out).toContain('data-testid="cx-prevu-non-disponibles"');
    for (const x of PREVU_INDICATEURS) expect(out).toContain(x.reason);
    expect(out).toContain(ETP_PRORATED_LABEL);
    expect(out).toContain('id="cx-effectifs-journal"');
    expect(out).toContain('data-testid="cx-alerts"');
    expect(out).toContain(`href="${LINKS.mouvements}"`);
    expect(out).toContain('data-testid="cx-effectifs-limites"');
    expect(out).not.toMatch(/k-p\d|k-c\d/);
  });

  it("Graphiques : pas de tableau, un lien vers le tableau exact sous chaque graphique ; blocs de tableaux absents", () => {
    const out = render(m, "graphique");
    expect(out).toContain('data-testid="cx-chart-effectif-mensuel"');
    expect(out).not.toContain('data-testid="cx-table-');
    expect(out).toContain(`href="${LINKS.tableau}#cx-table-mouvements"`);
    expect(out).not.toContain('id="cx-effectifs-journal"');
    expect(out).toContain('data-testid="cx-tile-effectifs-effectif"');
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
    expect(out).toContain(`href="${LINKS.parametres}"`);
    expect(out).not.toContain('data-testid="cx-table-structure-effectif"');
  });
});

// --- Lecture des sources (loadEffectifsInput) sur les référentiels fictifs des tests (transport PayFit fictif, DSN fictives) ----------

type FakeOpts = { service?: { value: string | null | undefined; label: string; axis: string | null; reason: string | null }; settings?: CroiseeSettings };
function fakeCtx(pay: PayrollContext, months: string[], o: FakeOpts = {}): CroiseeContext {
  const href = (patch: Record<string, string | null> = {}, hash?: string) => `/e/demo/studio-rh/masse-salariale/croisee?chapitre=effectifs${patch.affichage ? `&affichage=${patch.affichage}` : ""}${hash ? `#${hash}` : ""}`;
  return {
    slug: "demo",
    workspace: { id: "ws-demo" },
    canEdit: false,
    period: { year: Number(months[0].slice(0, 4)), from: months[0].slice(5), to: months[months.length - 1].slice(5), years: [], last: "", months, notices: [] },
    periodNd: null,
    prevMonths: months.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`),
    service: { options: [], ...(o.service ?? { value: undefined, label: "Tous les services", axis: null, reason: "journal de paie indisponible" }) },
    settings: o.settings ?? DEFINED,
    affichage: "tout",
    href,
    load: { payroll: async () => pay },
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
  it("PayFit fictif : huit cartes, deux graphiques avec leur tableau, journal sans nom, structure et échéances calculées", async () => {
    const data = await payfitFixtureBuild();
    const kin = kpiInput(data, await fixtureAbsences());
    const months = monthRange("2026-07", "2026-09");
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(fakePay(kin, "payfit"), months)));
    expect(m.nd).toBeNull();
    expect(m.tiles).toHaveLength(8);
    expect(m.charts.map((c) => c.id)).toEqual(["effectif-mensuel", "mouvements"]);
    for (const c of m.charts) expect(m.tables.some((t) => t.id === c.tableId)).toBe(true);
    // Effectif fin de mois : la carte et la dernière colonne du graphique viennent du même calcul.
    const eff = m.tiles.find((t) => t.id === "effectif")!;
    const last = m.charts[0].series[1].values.at(-1);
    if (eff.value.kind === "value") expect(eff.value.text).toBe(String(last));
    expect(m.tables.find((t) => t.id === "journal-mouvements")!.columns.map((c) => c.header)).toEqual(["Date", "Mouvement", "Nature du contrat", "Service", "Motif de sortie", "Décompte du turnover"]);
    // Aucun nom, prénom ni identifiant de personne ou de contrat dans le modèle (écran et exports).
    const json = JSON.stringify(m);
    const secrets = [...data.persons.flatMap((p) => [p.familyName, p.givenNames, p.usageName, p.employeeNumber, p.externalId]), ...data.contracts.map((c) => c.externalId)].filter((x): x is string => typeof x === "string" && x.length > 3);
    expect(secrets.length).toBeGreaterThan(0);
    for (const x of secrets) expect(json.includes(x), x).toBe(false);
    expect(m.blocks.find((b) => b.id === "structure")!.tables).toEqual(["structure-effectif"]);
    expect(m.blocks.find((b) => b.id === "echeances")!.tables).toEqual(["echeances-contrat"]);
    // Sans journal de paie : le service du mouvement est n.d. avec la raison du contexte.
    const journal = m.tables.find((t) => t.id === "journal-mouvements")!;
    for (const r of journal.rows) expect(r.cells[3]).toEqual({ nd: "journal de paie indisponible" });
  });

  it("DSN fictives : motif de sortie déclaré ou n.d. avec la raison de la source, jamais la mention PayFit", async () => {
    const kin = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(fakePay(kin, "dsn"), monthRange("2026-01", "2026-09"))));
    expect(m.nd).toBeNull();
    const journal = m.tables.find((t) => t.id === "journal-mouvements")!;
    const motifs = journal.rows.filter((r) => r.cells[1] === "Sortie").map((r) => r.cells[4]);
    for (const x of motifs) expect(x).not.toEqual({ nd: MOTIF_PAYFIT });
    expect(m.tiles.find((t) => t.id === "sorties")!.note).toBeUndefined();
  });

  it("référentiel RH absent : chapitre n.d. avec la raison et le lien Données", async () => {
    const pay = fakePay(null, "payfit");
    const m = buildEffectifs(await loadEffectifsInput(fakeCtx(pay, monthRange("2026-07", "2026-09"))));
    expect(m.nd).toEqual({ reason: "Référentiel RH non construit", action: { href: "/e/demo/donnees", label: "Données" } });
  });
});
