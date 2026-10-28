import { monthRange } from "@/lib/connectors/months";
import { getCategoryNatures, getContractCategories, categoryOfContract, type CategoryNatures, type ContractCategories } from "@/lib/budget/categories";
import { project } from "@/lib/budget/engine";
import { flowsOf } from "@/lib/budget/flows";
import { AXES, MEASURES, monthlyGrid, type Axis, type Grid, type Measure, type RealSource, type ScenarioSource } from "@/lib/budget/monthly";
import { getScenario, KIND_LABELS, listScenarios, type ScenarioFull } from "@/lib/budget/store";
import { CATEGORY_LABELS, type CategoryId, type Hypothesis, type PresentPerson } from "@/lib/budget/types";
import { nd, val } from "@/lib/budget/versions";
import { getConfidentialite, linkFromReferential, personsOfContracts, SEUIL_NON_DEFINI, type ConfidentialiteSetting, type PersonLink } from "@/lib/confidentialite";
import { isHireKey } from "@/lib/croisee/confidentialite";
import { monthEnd } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { loadPayrollContext } from "@/lib/payroll/context";
import { serviceOf, type JournalInput } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { buildContractServiceMap } from "@/lib/payroll/service-map";
import { serviceLabel, serviceMonthMask } from "@/lib/payroll/service-rows";
import { headcountAt } from "@/lib/rh/headcount";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { countedOpts, selectableYears } from "@/lib/rh/kpi/period";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput } from "@/lib/rh/kpi/types";
import type { ContractDraft } from "@/lib/rh/referential/types";
import { gridMask, maskedCount, maskedGrid, monthShortLabel, repartition, repartitionMasked, seuilOf, type GridCanonical, type GridMask, type GridRead, type GridSizes, type MaskedRepartition } from "@/lib/viz/kpi";

// Chargement commun des Effectifs mensuels (écran et export) : rubrique, axe, version (réel PayFit ou scénario) et année lus dans
// l'adresse ; une valeur inconnue prend le défaut de l'écran. La grille vient de monthlyGrid, sans autre calcul.
//
// Seuil de confidentialité (paramètre de l'espace, module partagé src/lib/confidentialite, sans valeur par défaut) : chaque cellule
// (groupe × mois) d'une répartition est comptée en PERSONNES DISTINCTES — les contrats qui portent la valeur affichée, reliés à leur
// personne par le référentiel Collaborateurs — et reçoit un statut CANONIQUE, le même sur tous les écrans qui publient la même cellule
// (gridMask : le statut d'un mois ne dépend que de sa colonne, dont le total est publié ; stocks par la passe partagée avec le Suivi et
// la croisée 02 ; masse × service des mois réels par la colonne de la Masse salariale ; le cumul d'un flux se déduit de ses mois). Le
// total du mois n'est jamais masqué. `grid` est la grille APRÈS masquage (écran, graphiques et export lisent les mêmes cellules) ;
// `raw` la grille du calcul et `mask` les statuts, qui servent à la répartition par groupe (repartitionMasked : anneau, tableau et
// feuille « Répartition » lisent les mêmes statuts).
// Embauches prévisionnelles d'un scénario (décision du lot 12, à confirmer par Lyes) : elles ne décrivent aucune personne réelle ; une
// cellule portée seulement par des embauches prévues est affichée, ne protège jamais et n'est masquée qu'avec toute sa colonne quand
// celle-ci ne peut pas être protégée (projectedGroupCell) ; une cellule qui mêle embauches et contrats réels se juge sur ses contrats
// réels.
export type EffectifsSearch = { mesure: string; axe: string; version: string; annee: string };
export type EffectifsData = {
  measure: Measure;
  axis: Axis;
  mdef: (typeof MEASURES)[number];
  versions: { value: string; label: string }[];
  version: string;
  versionLabel: string;
  full: ScenarioFull | null;
  years: string[];
  year: string;
  grid: Grid; // après masquage
  raw: Grid; // avant masquage (jamais affichée telle quelle)
  unit: "etp" | "nombre" | "eur";
  stock: boolean; // ETP et inscrits : stocks (répartition au dernier mois connu) ; entrées, sorties, masse : flux (cumul)
  confidentialite: ConfidentialiteSetting;
  seuil: number | null; // seuil utilisable, ou null (absent, illisible) avec seuilReason
  seuilReason: string | null;
  sizes: GridSizes;
  mask: GridMask | null;
  masked: number; // cellules masquées par le seuil (hors paramètre absent)
};

const NO_CATEGORY = "Non classé";
const OUT = "Hors salarié";
const NON_VENTILE = "Non ventilé";
// Groupe → identifiants de contrat (externalId pour le réel, clé de contrat pour un scénario) et embauches prévisionnelles (clé
// d'embauche du moteur de projection, isHireKey du module partagé), tenues à part : elles ne sont reliées à personne et n'entrent pas
// dans le décompte.
type Members = Map<string, { contracts: Set<string>; hires: Set<string> }>;
const add = (m: Members, group: string, id: string | null) => {
  let s = m.get(group);
  if (!s) m.set(group, (s = { contracts: new Set(), hires: new Set() }));
  if (id !== null) (isHireKey(id) ? s.hires : s.contracts).add(id);
};

// Groupe d'un contrat du référentiel sur un axe, pour les mois réalisés : mêmes libellés que la grille (budget/monthly.ts) ; une
// divergence rendrait le groupe non dénombré (valeur sans personne : non vérifiable), jamais une valeur affichée à tort.
function realGroupOf(c: ContractDraft, axis: Exclude<Axis, "service">, natures: CategoryNatures, overrides: ContractCategories): string {
  if (axis === "categorie") {
    const id = categoryOfContract(c.externalId, c.nature, natures, overrides);
    return id ? CATEGORY_LABELS[id] : NO_CATEGORY;
  }
  if (axis === "contrat") return c.nature ? contractNatureLabel(c.nature) : "Nature n.d.";
  if (axis === "etablissement") return c.establishmentId ?? "Établissement n.d.";
  return c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : "Statut n.d.";
}

// Contrats qui portent la valeur de chaque groupe d'un mois réalisé (mêmes moteurs que la grille) ; null : mois non dénombré (la
// grille est alors n.d. ou en borne basse pour ce mois).
function realMembers(src: { kpi: KpiInput | null; journal: JournalInput | null; natures: CategoryNatures; overrides: ContractCategories; serviceMap: Map<string, string | null> | null }, m: string, measure: Measure, axis: Axis): Members | null {
  const { kpi, journal } = src;
  const out: Members = new Map();
  if (measure === "masse") {
    if (!journal) return null;
    if (axis === "service" && !journal.serviceAxis) return null;
    if (axis !== "service" && !kpi) return null;
    const byExternal = kpi ? new Map(kpi.data.contracts.map((c) => [c.externalId, c])) : null;
    const rubrics = gridRubrics(journal.grid);
    for (const l of journal.lines) {
      if (l.month !== m) continue;
      const c = classify(l.accountId, rubrics);
      if (!c.rubric || c.rubric.role === "hors-masse") continue;
      if (axis === "service") add(out, serviceOf(l, journal.serviceAxis) ?? NON_VENTILE, l.contractId);
      else {
        const ct = l.contractId ? byExternal!.get(l.contractId) : undefined;
        add(out, ct ? realGroupOf(ct, axis, src.natures, src.overrides) : OUT, l.contractId);
      }
    }
    return out;
  }
  if (!kpi) return null;
  if (measure === "etp" && axis === "service") {
    if (!src.serviceMap) return null;
    const e = etpMonthEnd(kpi, m);
    if (e.kind !== "exact") return null;
    for (const c of e.contributions) add(out, src.serviceMap.get(`${m}|${c.externalId}`) ?? NON_VENTILE, c.externalId);
    return out;
  }
  if (axis === "service") return null;
  if (measure === "entrees" || measure === "sorties") {
    const mv = monthMovements(kpi, m);
    if ((measure === "entrees" ? mv.entries : mv.exits).kind !== "exact") return null;
    for (const x of mv.events) if (x.why === "counted" && x.row.event.kind === (measure === "entrees" ? "entry" : "exit")) add(out, realGroupOf(x.row.contract, axis, src.natures, src.overrides), x.row.contract.externalId);
    return out;
  }
  const h = headcountAt(kpi.data, monthEnd(m), countedOpts(kpi));
  if (h.kind !== "exact") return null;
  if (measure === "etp" && etpMonthEnd(kpi, m).kind !== "exact") return null;
  const byKey = new Map(kpi.data.contracts.map((c) => [c.contractKey, c]));
  for (const key of h.contractKeys) {
    const c = byKey.get(key);
    if (c) add(out, realGroupOf(c, axis, src.natures, src.overrides), c.externalId);
  }
  return out;
}

// Contrats et embauches qui portent la valeur de chaque groupe d'un mois projeté : mêmes règles de groupe que la grille
// (budget/monthly.ts, mois projetés) ; une embauche prévisionnelle (clé « embauche:<id> ») est comptée à part : elle ne décrit personne,
// ne protège jamais, et une cellule qu'elle porte seule n'est masquée qu'avec toute sa colonne (voir gridMask).
function scenarioMembers(src: ScenarioSource, m: string, measure: Measure, axis: Axis): Members | null {
  const { base, hyps, proj } = src;
  if (proj.kind === "error" || axis === "etablissement") return null;
  const pm = proj.months.find((x) => x.month === m);
  if (!pm || pm.kind === "nd") return null;
  const baseBy = new Map(base.contracts.map((c) => [c.contractKey, c]));
  const catOverride = new Map(hyps.flatMap((h) => (h.kind === "categorie" ? [[h.contractKey, h.category] as const] : [])));
  const hireBy = new Map<string, Extract<Hypothesis, { kind: "embauche" }>>(hyps.flatMap((h) => (h.kind === "embauche" ? [[`embauche:${h.id}`, h] as [string, Extract<Hypothesis, { kind: "embauche" }>]] : [])));
  const label = (c: CategoryId | null | undefined) => (c ? CATEGORY_LABELS[c] : NO_CATEGORY);
  const keyGroup = (key: string, person?: PresentPerson): string => {
    if (axis === "service") return person ? (person.service ?? NON_VENTILE) : (baseBy.get(key)?.service ?? hireBy.get(key)?.service ?? NON_VENTILE);
    if (axis === "categorie") return person ? label((person.category as CategoryId | null) ?? null) : label(catOverride.get(key) ?? baseBy.get(key)?.category ?? hireBy.get(key)?.category);
    const c = baseBy.get(key);
    if (axis === "statut") return c?.executive === true ? "Cadre dirigeant" : c?.executive === false ? "Hors cadre dirigeant" : "Statut n.d.";
    return c ? (c.nature ? contractNatureLabel(c.nature) : "Nature n.d.") : hireBy.has(key) ? "Embauche prévisionnelle" : "Nature n.d.";
  };
  const out: Members = new Map();
  if (measure === "masse") {
    for (const c of pm.contributions) add(out, c.contractKey ? keyGroup(c.contractKey) : axis === "service" ? (c.service ?? NON_VENTILE) : OUT, c.contractKey);
    return out;
  }
  if (measure === "etp" || measure === "inscrit") {
    if (measure === "etp" && pm.etp4 === null) return null;
    for (const [k, p] of Object.entries(pm.people ?? {})) add(out, keyGroup(k, p), k);
    return out;
  }
  const f = flowsOf(base, proj).find((x) => x.month === m);
  if (!f || f.kind === "nd") return null;
  const idx = proj.months.findIndex((x) => x.month === m);
  const prevPeople: Record<string, PresentPerson> = idx > 0 ? ((proj.months[idx - 1] as { people?: Record<string, PresentPerson> }).people ?? {}) : Object.fromEntries(base.contracts.filter((c) => c.counted).map((c) => [c.contractKey, { etp4: c.etp4, category: c.category ?? null, service: c.service }]));
  const cur = pm.people ?? {};
  for (const k of measure === "entrees" ? f.entrees : f.sorties) add(out, keyGroup(k, measure === "entrees" ? cur[k] : prevPeople[k]), k);
  return out;
}

// Lien contrat → personne du référentiel, par identifiant dans la source (lignes de paie, contributions de l'ETP) et par clé de
// contrat (base d'un scénario) ; une embauche prévisionnelle ou un contrat inconnu n'y figure pas.
function personLink(kpi: KpiInput | null): PersonLink {
  const link = kpi ? linkFromReferential(kpi.data) : new Map<string, string>();
  if (kpi) for (const c of kpi.data.contracts) if (c.personKey !== null) link.set(c.contractKey, c.personKey);
  return link;
}

export async function loadEffectifs(slug: string, workspaceId: string, kpi: KpiInput | null, search: EffectifsSearch): Promise<EffectifsData> {
  const pay = await loadPayrollContext(slug);
  const [{ natures }, overrides, rows, confidentialite] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId), listScenarios(workspaceId), getConfidentialite(workspaceId)]);
  const measure: Measure = (MEASURES.some((m) => m.key === search.mesure) ? search.mesure : "etp") as Measure;
  const axis: Axis = (AXES.some((a) => a.key === search.axe) ? search.axe : "categorie") as Axis;
  const mdef = MEASURES.find((m) => m.key === measure)!;
  const versions = [{ value: "reel", label: "Réel PayFit" }, ...rows.map((r) => ({ value: `scenario:${r.scenario.id}`, label: `Scénario « ${r.scenario.name} » (${KIND_LABELS[r.scenario.kind]}, ${r.scenario.status === "fige" ? "figé" : "brouillon"})` }))];
  const version = versions.some((v) => v.value === search.version) ? search.version : "reel";
  const full = version.startsWith("scenario:") ? await getScenario(workspaceId, version.slice(9)) : null;
  const years = full
    ? [...new Set([full.base.refMonth.slice(0, 4), ...monthRange(full.scenario.firstMonth, full.scenario.lastMonth).map((m) => m.slice(0, 4))])].sort()
    : kpi ? selectableYears(kpi.data, kpi.openMonths ?? []).map((y) => String(y.year)) : [];
  const year = years.includes(search.annee) ? search.annee : (full ? full.scenario.firstMonth.slice(0, 4) : years.at(-1) ?? String(new Date().getFullYear()));
  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? nd(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const real: RealSource = { kpi, journal: pay.input, natures, overrides, etpService };
  const scenario: ScenarioSource | null = full ? { base: full.base, hyps: full.hypotheses, proj: project(full.base, full.scenario.firstMonth, full.scenario.lastMonth, full.hypotheses, full.scenario.conventions) } : null;
  const raw = monthlyGrid({ measure, axis, year, real, scenario });

  // Personnes distinctes de chaque cellule (groupe × mois) : contrats qui portent la valeur, reliés par le référentiel (mémo par mois).
  const journal = pay.input;
  const serviceMap = journal?.serviceAxis ? buildContractServiceMap(journal.lines, journal.grid, journal.serviceAxis) : null;
  const link = personLink(kpi);
  const members = new Map<string, Members | null>();
  const membersOf = (m: string): Members | null => {
    if (!members.has(m)) {
      const useReal = !scenario || m <= scenario.base.refMonth;
      members.set(m, useReal ? realMembers({ kpi, journal, natures, overrides, serviceMap }, m, measure, axis) : scenarioMembers(scenario!, m, measure, axis));
    }
    return members.get(m)!;
  };
  // contracts : nombre de contrats du groupe (l'effectif d'un stock, valeur d'ordre de son masquage, comme le Suivi et la croisée 02).
  const sizes: GridSizes = (group, m) => {
    const mem = membersOf(m);
    if (!mem) return null;
    const g = mem.get(group);
    return g ? { ...personsOfContracts(g.contracts, link), hires: g.hires.size, contracts: g.contracts.size } : { persons: [], unlinked: 0, hires: 0, contracts: 0 };
  };
  const stock = measure === "etp" || measure === "inscrit";
  const read = seuilOf(confidentialite);
  // Masse × service, mois réels : la masse d'un service pour un mois est aussi publiée par la Masse salariale (Synthèse, export,
  // croisée 01 et 05) et sous le filtre Service ; son statut est celui de la colonne canonique du mois (serviceMonthMask : mêmes
  // groupes, même valeur, même ordre), jamais une colonne recalculée ici. Les mois projetés d'un scénario gardent la colonne du mois.
  const seuil = read.seuil;
  const canonical: GridCanonical | undefined =
    raw.kind === "value" && seuil !== null && measure === "masse" && axis === "service" && journal?.serviceAxis
      ? (m) => (raw.layers.get(m) === "reel" ? new Map([...serviceMonthMask(journal, m, link, seuil)].map(([v, st]) => [serviceLabel(v), st])) : null)
      : undefined;
  const mask = raw.kind === "value" && seuil !== null ? gridMask(raw, sizes, seuil, stock, canonical) : null;
  const grid: Grid = raw.kind === "value" ? maskedGrid(raw, mask, read.seuil, read.reason) : raw;
  return { measure, axis, mdef, versions, version, versionLabel: versions.find((v) => v.value === version)!.label, full, years, year, grid, raw, unit: mdef.unit, stock, confidentialite, seuil: read.seuil, seuilReason: read.reason, sizes, mask, masked: maskedCount(mask) };
}

// Base de la répartition, en clair : stocks au dernier mois connu, flux sur le cumul des mois connus.
function basisText(r: { known: string[]; used: string[] }, stock: boolean, year: string): string {
  return stock ? (r.used[0] ? `fin ${monthShortLabel(r.used[0])} ${year}` : "aucun mois connu") : `cumul des ${r.used.length} mois connus (${r.known.length < 12 ? `${12 - r.known.length} mois n.d. non comptés` : "année complète"})`;
}

// Répartition par groupe et sa base, sans seuil (grille telle quelle).
export function effectifsShare(grid: Grid, stock: boolean, year: string) {
  const repart = grid.kind === "value" ? repartition(grid, stock) : null;
  return { repart, basis: repart ? basisText(repart, stock, year) : "" };
}

// Répartition par groupe après seuil de confidentialité (écran : anneau et tableau ; export : feuille « Répartition ») : calculée sur
// la grille du calcul, avec les statuts de la passe unique de masquage (mask) ; le total reste celui de l'entreprise.
export function effectifsShareOf(e: Pick<EffectifsData, "raw" | "stock" | "year" | "mask" | "seuil" | "seuilReason">): { repart: MaskedRepartition | null; basis: string } {
  if (e.raw.kind !== "value") return { repart: null, basis: "" };
  const read: GridRead = e.seuil === null || e.mask === null ? { seuil: null, reason: e.seuilReason ?? SEUIL_NON_DEFINI } : { seuil: e.seuil, mask: e.mask };
  const repart = repartitionMasked(e.raw, e.stock, read);
  return { repart, basis: basisText(repart, e.stock, e.year) };
}
