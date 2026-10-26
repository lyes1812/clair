import { project } from "@/lib/budget/engine";
import { BudgetError, getScenario, listBudgets, listScenarios, type BudgetRow, type ScenarioFull } from "@/lib/budget/store";
import type { Projection } from "@/lib/budget/types";
import { monthRange } from "@/lib/connectors/months";
import { dateFmt, journalReason } from "@/lib/croisee/format";
import { getCroiseeSettings, type CroiseeSettings } from "@/lib/croisee-settings";
import { monthPayroll, servicesOf } from "@/lib/payroll/engine";
import { loadPayrollContext, type ComptaSource, type PayrollContext } from "@/lib/payroll/context";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { closedMonths } from "@/lib/rh/kpi/period";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { hasAtLeast, type Role } from "@/lib/roles";
import { croiseeHref, parseQuery, shownValue, type CroiseeQuery, type QueryState } from "@/lib/viz/croisee";
import { capital } from "@/lib/viz/masse";
import { kpiRefusal, periodLabel, previousMonths, resolvePeriod, type Period } from "@/lib/viz/synthese";
import type { WorkspaceAccess } from "@/lib/workspace";
import type { Affichage } from "../components";
import { NV } from "../ecart-data";
import { chapterDef, type ChapterDef } from "./chapitres";

// Contexte partagé de la Masse salariale croisée : tout ce que la page et les chapitres lisent de l'adresse et de l'espace.
// Les lectures lourdes (journal de paie, référentiel RH, scénario et sa projection, comptabilité) sont des lecteurs paresseux et
// mémoïsés : chacune n'est faite qu'une fois par requête, et seulement si la page ou le chapitre affiché la demande. Ce contexte
// vit côté serveur : il n'est JAMAIS passé à un composant client (il porte des fonctions).

type Search = Record<string, string | string[] | undefined>;
export type Option = { value: string; label: string };
export type ScenarioListRow = Awaited<ReturnType<typeof listScenarios>>[number];
export type ScenarioLoad = { kind: "value"; full: ScenarioFull; proj: Projection } | { kind: "nd"; reason: string };

export type CroiseeLoaders = {
  payroll: () => Promise<PayrollContext>; // journal de paie, grille, ETP, axe de service, DSN de contrôle (loadPayrollContext)
  kpi: () => Promise<KpiContext>; // référentiel RH et paramètres des KPI (le même que celui du journal : lu une fois)
  compta: () => Promise<ComptaSource>; // comptabilité retenue (FEC ou API Pennylane)
  budgets: () => Promise<BudgetRow[]>;
  scenarios: () => Promise<ScenarioListRow[]>;
  scenario: () => Promise<ScenarioLoad>; // scénario retenu dans les filtres, avec sa projection
};

export type CroiseeContext = {
  slug: string;
  base: string; // adresse de la page, sans paramètres
  workspace: WorkspaceAccess;
  role: Role;
  canEdit: boolean;
  chapter: ChapterDef;
  query: CroiseeQuery;
  notices: string[]; // paramètres d'adresse écartés, avec leur raison
  settings: CroiseeSettings;
  // Période : null quand le chapitre n'a pas de filtres, ou qu'aucun mois n'est disponible (raison dans periodNd).
  period: Period | null;
  periodNd: string | null;
  prevMonths: string[];
  labels: { period: string; prev: string };
  openMonths: string[]; // mois de la période ou de N-1 dont la paie n'est pas clôturée à la lecture
  // Service : value undefined = tous les services ; null = non ventilé ; texte = code analytique de l'axe retenu.
  service: { axis: string | null; value: string | null | undefined; label: string; options: Option[]; reason: string | null };
  budget: { selected: BudgetRow | null; explicit: boolean; options: Option[]; reason: string | null };
  scenario: { selected: ScenarioListRow | null; explicit: boolean; options: Option[]; reason: string | null };
  affichage: Affichage;
  state: QueryState; // choix validés, repris par chaque lien de la page
  href: (patch?: QueryState, hash?: string) => string;
  load: CroiseeLoaders;
};

// Lecteur mémoïsé : la première demande lance la lecture, les suivantes reçoivent la même promesse.
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

// Mises en forme pures (src/lib/croisee/format.ts), ré-exportées pour la page et ses composants.
export { dateFmt, journalReason, openMonthsText } from "@/lib/croisee/format";

const yearsOf = (s: ScenarioListRow["scenario"]) => new Set(monthRange(s.firstMonth, s.lastMonth).map((m) => m.slice(0, 4)));

export async function loadCroiseeContext(slug: string, workspace: WorkspaceAccess, sp: Search): Promise<CroiseeContext> {
  const query = parseQuery(sp);
  const notices = [...query.notices];
  const chapter = chapterDef(query.chapitre);
  const base = `/e/${slug}/studio-rh/masse-salariale/croisee`;
  const ws = workspace.id;

  let selectedScenario: ScenarioListRow | null = null;
  let scenarioReason: string | null = null;
  const payroll = once(() => loadPayrollContext(slug));
  const load: CroiseeLoaders = {
    payroll,
    kpi: once(async () => (await payroll()).kpi),
    compta: once(async () => (await payroll()).compta()),
    budgets: once(() => listBudgets(ws)),
    scenarios: once(() => listScenarios(ws)),
    scenario: once(async (): Promise<ScenarioLoad> => {
      const s = selectedScenario;
      if (!s) return { kind: "nd", reason: scenarioReason ?? "aucun scénario retenu" };
      try {
        const full = await getScenario(ws, s.scenario.id);
        if (!full) return { kind: "nd", reason: "scénario introuvable" };
        const c = full.scenario;
        return { kind: "value", full, proj: project(full.base, c.firstMonth, c.lastMonth, full.hypotheses, c.conventions) };
      } catch (e) {
        // Base figée altérée : le scénario n'est pas lu, et l'écran le dit.
        if (e instanceof BudgetError) return { kind: "nd", reason: e.message };
        throw e;
      }
    }),
  };

  const settings = await getCroiseeSettings(ws);
  const ctxBase = {
    slug,
    base,
    workspace,
    role: workspace.role,
    canEdit: hasAtLeast(workspace.role, "editor"),
    chapter,
    query,
    notices,
    settings,
    affichage: query.affichage,
    load,
  };
  const make = (rest: Pick<CroiseeContext, "period" | "periodNd" | "prevMonths" | "labels" | "openMonths" | "service" | "budget" | "scenario" | "state">): CroiseeContext => ({
    ...ctxBase,
    ...rest,
    href: (patch = {}, hash) => croiseeHref(base, { ...rest.state, ...patch }, hash),
  });
  const none = { selected: null, explicit: false, options: [], reason: null };
  const keep: QueryState = { chapitre: chapter.id, affichage: query.affichage, tri: query.tri, sens: query.sens };

  // Chapitre sans filtres (chapitres « Prévu ») : aucune source n'est lue. Les choix de l'adresse sont repris tels quels dans les
  // liens (sommaire, onglets, précédent / suivant) : ils seront validés au retour sur un chapitre à filtres.
  if (!chapter.filtres) {
    const raw = (v: string) => v || null;
    const state: QueryState = { ...keep, annee: raw(query.annee), de: raw(query.de), a: raw(query.a), service: raw(query.service), budget: raw(query.budget), scenario: raw(query.scenario) };
    return make({ period: null, periodNd: null, prevMonths: [], labels: { period: "", prev: "" }, openMonths: [], service: { axis: null, value: undefined, label: "", options: [], reason: null }, budget: none, scenario: none, state });
  }

  // --- Période : mois clos du référentiel RH ou du journal de paie (même règle que la Synthèse du Studio RH).
  const pay = await payroll();
  const kpi = pay.kpi;
  const rh = kpi.input;
  const journal = pay.input;
  const rhClosed = rh ? closedMonths(rh.data, rh.openMonths ?? []) : [];
  const payClosed = journal ? journal.months.filter((m) => !journal.openMonths.includes(m) && monthPayroll(journal, m).kind === "value") : [];
  const period = resolvePeriod([...rhClosed, ...payClosed], { annee: query.annee, de: query.de, a: query.a });
  if (period) notices.push(...period.notices);
  const rhRefusal = kpiRefusal({
    chosen: Boolean(kpi.collab.source.chosen),
    sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(rh),
    invalid: kpi.settings.invalid.map((k) => KPI_KEYS[k]),
  });
  const payrollWhy = journalReason(pay);
  const periodNd = period ? null : capital(rhRefusal ?? payrollWhy ?? "aucun mois clos à la date de référence");
  const months = period?.months ?? [];
  const prevMonths = period ? previousMonths(months) : [];
  const inScope = new Set([...months, ...prevMonths]);
  const openMonths = [...new Set([...(journal?.openMonths ?? []), ...(rh?.openMonths ?? [])])].filter((m) => inScope.has(m)).sort();

  // --- Service (code analytique de l'axe retenu dans les Paramètres ; « __nv__ » = non ventilé).
  let service: CroiseeContext["service"];
  if (journal && pay.service.axis) {
    const known = servicesOf(journal, journal.months);
    const raw = query.service;
    const value: string | null | undefined = !raw ? undefined : raw === NV && known.includes(null) ? null : known.includes(raw) ? raw : undefined;
    if (raw && value === undefined) notices.push(`paramètre ignoré : service=${shownValue(raw)} (service absent du journal)`);
    const options: Option[] = [{ value: "", label: "Tous les services" }, ...known.filter((s): s is string => s !== null).map((s) => ({ value: s, label: s })), ...(known.includes(null) ? [{ value: NV, label: "Non ventilé" }] : [])];
    service = { axis: pay.service.axis, value, label: value === undefined ? "Tous les services" : value === null ? "Non ventilé" : value, options, reason: null };
  } else {
    const reason = !journal
      ? (payrollWhy ?? "journal de paie indisponible")
      : pay.service.origin === "setting"
        ? "ventilation par service désactivée par un administrateur"
        : pay.axes.length === 0
          ? "aucun code analytique dans le journal PayFit"
          : `plusieurs axes analytiques (${pay.axes.join(", ")}) : choisir celui du service dans les Paramètres`;
    if (query.service) notices.push(`paramètre ignoré : service=${shownValue(query.service)} (${reason})`);
    service = { axis: null, value: undefined, label: "Tous les services", options: [], reason };
  }

  // --- Budget saisi et scénario de l'année de la période : le plus récent par défaut, un autre au choix (adresse).
  let budget: CroiseeContext["budget"] = { ...none, reason: periodNd };
  let scenario: CroiseeContext["scenario"] = { ...none, reason: periodNd };
  if (period) {
    const year = String(period.year);
    const [budgets, scenarios] = await Promise.all([load.budgets(), load.scenarios()]);
    const ofYear = budgets.filter((b) => b.year === year).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const chosenBudget = query.budget ? (ofYear.find((b) => b.id === query.budget) ?? null) : null;
    if (query.budget && !chosenBudget) notices.push(`paramètre ignoré : budget=${shownValue(query.budget)} (identifiant inconnu parmi les budgets saisis pour ${year})`);
    const b = chosenBudget ?? ofYear[0] ?? null;
    budget = {
      selected: b,
      explicit: Boolean(chosenBudget),
      options: ofYear.map((x) => ({ value: x.id, label: `« ${x.name} » (modifié le ${dateFmt.format(x.updatedAt)})` })),
      reason: b ? null : `aucun budget saisi pour ${year}`,
    };
    const covering = scenarios.filter((r) => yearsOf(r.scenario).has(year));
    const chosenScenario = query.scenario ? (covering.find((r) => r.scenario.id === query.scenario) ?? null) : null;
    if (query.scenario && !chosenScenario) notices.push(`paramètre ignoré : scenario=${shownValue(query.scenario)} (identifiant inconnu parmi les scénarios qui couvrent ${year})`);
    const s = chosenScenario ?? covering[0] ?? null;
    scenario = {
      selected: s,
      explicit: Boolean(chosenScenario),
      options: covering.map((r) => ({ value: r.scenario.id, label: `« ${r.scenario.name} » (${r.scenario.status === "fige" ? "figé" : "brouillon"})` })),
      reason: s ? null : `aucun scénario ne couvre ${year}`,
    };
    selectedScenario = s;
    scenarioReason = scenario.reason;
  } else {
    scenarioReason = periodNd;
  }

  const state: QueryState = {
    ...keep,
    annee: period ? String(period.year) : null,
    de: period?.from ?? null,
    a: period?.to ?? null,
    service: service.value === undefined ? null : service.value === null ? NV : service.value,
    budget: budget.explicit ? (budget.selected?.id ?? null) : null,
    scenario: scenario.explicit ? (scenario.selected?.scenario.id ?? null) : null,
  };
  return make({
    period,
    periodNd,
    prevMonths,
    labels: { period: periodLabel(months), prev: periodLabel(prevMonths) },
    openMonths,
    service,
    budget,
    scenario,
    state,
  });
}
