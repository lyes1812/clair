import { monthRange } from "@/lib/connectors/months";
import { monthEnd } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { monthPayroll, serviceOf, type JournalInput } from "@/lib/payroll/engine";
import { classify, gridRubrics } from "@/lib/payroll/grid";
import { headcountAt } from "@/lib/rh/headcount";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { countedOpts } from "@/lib/rh/kpi/period";
import { monthMovements } from "@/lib/rh/kpi/turnover";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { categoryOfContract, type CategoryNatures, type ContractCategories } from "./categories";
import { flowsOf } from "./flows";
import { CATEGORY_LABELS, type BaseSnapshot, type CategoryId, type Hypothesis, type PresentPerson, type Projection } from "./types";
import type { Cell } from "./versions";

// Effectifs mensuels : une mesure (ETP, inscrit fin de mois, entrées, sorties, masse salariale) mois par mois et par axe
// de ventilation, pour le réel PayFit ou pour un scénario (mois réalisés lus dans le réel courant, mois projetés dans la
// projection). Un axe que la source ne fournit pas est n.d. avec sa raison ; un groupe sans salarié un mois donné vaut 0
// (mois connu), jamais un mois n.d.
export type Axis = "categorie" | "contrat" | "etablissement" | "statut" | "service";
export const AXES: { key: Axis; label: string }[] = [
  { key: "categorie", label: "Catégorie (CDI, CDD, apprenti, stagiaire)" },
  { key: "contrat", label: "Contrat (nature)" },
  { key: "etablissement", label: "Établissement (SIRET)" },
  { key: "statut", label: "Statut (cadre dirigeant / autres)" },
  { key: "service", label: "Service (code analytique du journal)" },
];
// Axes du modèle observé que les données lues ne fournissent pas : listés avec leur raison, jamais inventés.
export const UNAVAILABLE_AXES: { label: string; reason: string }[] = [
  { label: "Direction", reason: "aucune direction dans les données PayFit lues ni dans la DSN" },
  { label: "Métier", reason: "aucun métier dans les données PayFit lues ni dans la DSN" },
  { label: "Motif d'embauche", reason: "motif d'embauche absent des données lues" },
  { label: "Sexe", reason: "sexe absent du référentiel Collaborateurs lu" },
  { label: "Société", reason: "une seule société (un SIREN) par espace : un seul groupe" },
];
export type Measure = "etp" | "inscrit" | "entrees" | "sorties" | "masse";
export const MEASURES: { key: Measure; label: string; unit: "etp" | "nombre" | "eur"; kind: string }[] = [
  { key: "etp", label: "ETP", unit: "etp", kind: "stock : ETP de fin de mois" },
  { key: "inscrit", label: "Inscrit fin de mois", unit: "nombre", kind: "stock : effectif compté le dernier jour du mois" },
  { key: "entrees", label: "Entrées", unit: "nombre", kind: "flux : entrées du mois" },
  { key: "sorties", label: "Sorties", unit: "nombre", kind: "flux : sorties du mois" },
  { key: "masse", label: "Masse salariale chargée", unit: "eur", kind: "flux : coût employeur du mois" },
];
export type EtpService = (month: string, filter: { value: string | null }) => Cell;
export type RealSource = { kpi: KpiInput | null; journal: JournalInput | null; natures: CategoryNatures; overrides: ContractCategories; etpService?: EtpService };
export type ScenarioSource = { base: BaseSnapshot; hyps: Hypothesis[]; proj: Projection };

type MonthResult = { kind: "value"; values: Map<string, number>; layer: "reel" | "projete" } | { kind: "nd"; reason: string };
export type Grid =
  | { kind: "value"; months: string[]; groups: string[]; layers: Map<string, "reel" | "projete">; cell: (group: string, month: string) => Cell; total: (month: string) => Cell }
  | { kind: "nd"; reason: string };

const NO_CATEGORY = "Non classé";
const OUT = "Hors salarié";
const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const nd = (reason: string): MonthResult => ({ kind: "nd", reason });

// --- Réel.
type ContractLike = { externalId: string; nature: string | null; establishmentId: string | null; executive: boolean | null };
function realGroup(c: ContractLike, axis: Exclude<Axis, "service">, src: RealSource): string {
  if (axis === "categorie") {
    const id = categoryOfContract(c.externalId, c.nature, src.natures, src.overrides);
    return id ? CATEGORY_LABELS[id] : NO_CATEGORY;
  }
  if (axis === "contrat") return c.nature ? contractNatureLabel(c.nature) : "Nature n.d.";
  if (axis === "etablissement") return c.establishmentId ?? "Établissement n.d.";
  return c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : "Statut n.d.";
}

function realMonth(src: RealSource, m: string, measure: Measure, axis: Axis): MonthResult {
  const out = new Map<string, number>();
  const { kpi, journal } = src;
  if (measure === "masse") {
    if (!journal) return nd("journal de paie PayFit indisponible");
    if (axis === "service" && !journal.serviceAxis) return nd("axe analytique du service non choisi (Paramètres)");
    if (axis !== "service" && !kpi) return nd("référentiel Collaborateurs indisponible : lignes de paie non rattachables aux contrats");
    if (journal.openMonths.includes(m)) return nd(`paie de ${m} non clôturée à la lecture`);
    const mp = monthPayroll(journal, m);
    if (mp.kind === "nd") return nd(mp.nd.reason);
    const byExternal = kpi ? new Map(kpi.data.contracts.map((c) => [c.externalId, c])) : null;
    const rubrics = gridRubrics(journal.grid);
    for (const l of journal.lines) {
      if (l.month !== m) continue;
      const c = classify(l.accountId, rubrics);
      if (!c.rubric || c.rubric.role === "hors-masse") continue;
      const v = (l.debitCents ?? 0) - (l.creditCents ?? 0);
      if (axis === "service") bump(out, serviceOf(l, journal.serviceAxis) ?? "Non ventilé", v);
      else {
        const ct = l.contractId ? byExternal!.get(l.contractId) : undefined;
        bump(out, ct ? realGroup(ct, axis, src) : OUT, v);
      }
    }
    return { kind: "value", values: out, layer: "reel" };
  }
  if (!kpi) return nd("référentiel Collaborateurs indisponible");
  if (measure === "etp" && axis === "service") {
    if (!journal?.serviceAxis) return nd("axe analytique du service non choisi (Paramètres)");
    if (!src.etpService) return nd("ETP par service indisponible");
    const services = new Set<string | null>();
    for (const l of journal.lines) if (l.month === m) services.add(serviceOf(l, journal.serviceAxis));
    for (const s of services) {
      const c = src.etpService(m, { value: s });
      if (c.kind === "nd") return nd(c.reason);
      if (c.kind === "value") out.set(s ?? "Non ventilé", c.v);
    }
    return { kind: "value", values: out, layer: "reel" };
  }
  if (axis === "service") return nd("effectif et mouvements par service non historisés pour les mois réalisés (le service est un code analytique des lignes de paie)");
  if (measure === "entrees" || measure === "sorties") {
    const mv = monthMovements(kpi, m);
    const c = measure === "entrees" ? mv.entries : mv.exits;
    if (c.kind === "nd") return nd(c.nd.reason);
    if (c.kind === "lower_bound") return nd(`${measure === "entrees" ? "entrées" : "sorties"} de ${m} en borne basse (source incomplète)`);
    for (const x of mv.events) if (x.why === "counted" && x.row.event.kind === (measure === "entrees" ? "entry" : "exit")) bump(out, realGroup(x.row.contract as never, axis, src), 1);
    return { kind: "value", values: out, layer: "reel" };
  }
  const h = headcountAt(kpi.data, monthEnd(m), countedOpts(kpi));
  if (h.kind === "nd") return nd(h.nd.reason);
  if (h.kind === "lower_bound") return nd(`effectif de ${m} en borne basse (source incomplète)`);
  const byKey = new Map(kpi.data.contracts.map((c) => [c.contractKey, c]));
  let etp: Map<string, number> | null = null;
  if (measure === "etp") {
    const e = etpMonthEnd(kpi, m);
    if (e.kind !== "exact") return nd(e.kind === "nd" ? e.nd.reason : `ETP de ${m} en borne basse (contrat sans quotité ou source incomplète)`);
    etp = new Map(e.contributions.map((x) => [x.contractKey, x.etp4]));
  }
  for (const key of h.contractKeys) {
    const c = byKey.get(key);
    if (!c) continue;
    bump(out, realGroup(c, axis, src), etp ? (etp.get(key) ?? 0) : 1);
  }
  return { kind: "value", values: out, layer: "reel" };
}

// --- Scénario (mois projetés).
function scenarioMonth(src: ScenarioSource, m: string, measure: Measure, axis: Axis): MonthResult {
  const { base, hyps, proj } = src;
  if (proj.kind === "error") return nd("projection refusée (hypothèses en erreur)");
  const pm = proj.months.find((x) => x.month === m);
  if (!pm) return nd(`mois ${m} hors de l'horizon du scénario`);
  if (pm.kind === "nd") return nd(pm.reasons.join(" ; "));
  const baseBy = new Map(base.contracts.map((c) => [c.contractKey, c]));
  const catOverride = new Map(hyps.flatMap((h) => (h.kind === "categorie" ? [[h.contractKey, h.category] as const] : [])));
  const hireBy = new Map<string, Extract<Hypothesis, { kind: "embauche" }>>(hyps.flatMap((h) => (h.kind === "embauche" ? [[`embauche:${h.id}`, h] as [string, Extract<Hypothesis, { kind: "embauche" }>]] : [])));
  const label = (c: CategoryId | null | undefined) => (c ? CATEGORY_LABELS[c] : NO_CATEGORY);
  if (axis === "etablissement") return nd("établissement non conservé dans la base du scénario : lisible pour le réel seulement");
  const out = new Map<string, number>();
  const keyGroup = (key: string, person?: PresentPerson): string => {
    if (axis === "service") return person ? (person.service ?? "Non ventilé") : (baseBy.get(key)?.service ?? hireBy.get(key)?.service ?? "Non ventilé");
    if (axis === "categorie") return person ? label((person.category as CategoryId | null) ?? null) : label(catOverride.get(key) ?? baseBy.get(key)?.category ?? hireBy.get(key)?.category);
    const c = baseBy.get(key);
    if (axis === "statut") return c?.executive === true ? "Cadre dirigeant" : c?.executive === false ? "Hors cadre dirigeant" : "Statut n.d.";
    return c ? (c.nature ? contractNatureLabel(c.nature) : "Nature n.d.") : hireBy.has(key) ? "Embauche prévisionnelle" : "Nature n.d.";
  };
  if (measure === "masse") {
    for (const c of pm.contributions) bump(out, c.contractKey ? keyGroup(c.contractKey) : axis === "service" ? (c.service ?? "Non ventilé") : OUT, c.cost);
    return { kind: "value", values: out, layer: "projete" };
  }
  if (measure === "etp" || measure === "inscrit") {
    if (measure === "etp" && pm.etp4 === null) return nd(pm.etpNd ?? "ETP n.d.");
    for (const [k, p] of Object.entries(pm.people ?? {})) bump(out, keyGroup(k, p), measure === "etp" ? (p.etp4 ?? 0) : 1);
    return { kind: "value", values: out, layer: "projete" };
  }
  const f = flowsOf(base, proj).find((x) => x.month === m);
  if (!f || f.kind === "nd") return nd(f?.kind === "nd" ? f.reason : "mouvements n.d.");
  const idx = proj.months.findIndex((x) => x.month === m);
  const prevPeople: Record<string, PresentPerson> = idx > 0 ? ((proj.months[idx - 1] as { people?: Record<string, PresentPerson> }).people ?? {}) : Object.fromEntries(base.contracts.filter((c) => c.counted).map((c) => [c.contractKey, { etp4: c.etp4, category: c.category ?? null, service: c.service }]));
  const cur = pm.people ?? {};
  for (const k of measure === "entrees" ? f.entrees : f.sorties) bump(out, keyGroup(k, measure === "entrees" ? cur[k] : prevPeople[k]), 1);
  return { kind: "value", values: out, layer: "projete" };
}

// --- Grille d'une année : réel PayFit, ou scénario (mois réalisés lus dans le réel courant, mois projetés dans la projection).
export function monthlyGrid(a: { measure: Measure; axis: Axis; year: string; real: RealSource; scenario: ScenarioSource | null }): Grid {
  const months = monthRange(`${a.year}-01`, `${a.year}-12`);
  const results = new Map<string, MonthResult>();
  for (const m of months) {
    const useReal = !a.scenario || m <= a.scenario.base.refMonth;
    results.set(m, useReal ? realMonth(a.real, m, a.measure, a.axis) : scenarioMonth(a.scenario!, m, a.measure, a.axis));
  }
  const values = [...results.values()].filter((r): r is Extract<MonthResult, { kind: "value" }> => r.kind === "value");
  if (values.length === 0) {
    const reasons = [...new Set([...results.values()].map((r) => (r.kind === "nd" ? r.reason : "")))].filter(Boolean);
    return { kind: "nd", reason: reasons.slice(0, 2).join(" ; ") || "aucun mois disponible" };
  }
  const groups = [...new Set(values.flatMap((r) => [...r.values.keys()]))].sort((x, y) => {
    const tail = (s: string) => (s === NO_CATEGORY || s === OUT || s.endsWith("n.d.") ? 1 : 0);
    return tail(x) - tail(y) || x.localeCompare(y);
  });
  const layers = new Map<string, "reel" | "projete">();
  for (const [m, r] of results) if (r.kind === "value") layers.set(m, r.layer);
  return {
    kind: "value", months, groups, layers,
    cell: (g, m) => {
      const r = results.get(m);
      return !r ? { kind: "nd", reason: `mois ${m} non couvert` } : r.kind === "nd" ? { kind: "nd", reason: r.reason } : { kind: "value", v: r.values.get(g) ?? 0 };
    },
    total: (m) => {
      const r = results.get(m);
      return !r ? { kind: "nd", reason: `mois ${m} non couvert` } : r.kind === "nd" ? { kind: "nd", reason: r.reason } : { kind: "value", v: [...r.values.values()].reduce((s, x) => s + x, 0) };
    },
  };
}
