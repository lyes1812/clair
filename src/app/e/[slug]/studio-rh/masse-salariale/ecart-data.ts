import { monthRange } from "@/lib/connectors/months";
import { project } from "@/lib/budget/engine";
import { getScenario, KIND_LABELS, listBudgets, listScenarios, type ScenarioFull } from "@/lib/budget/store";
import { budgetVersion, ndVersion, nd, reelVersion, scenarioVersion, val, type ServiceFilter, type Version } from "@/lib/budget/versions";
import type { ZoomSource } from "@/lib/budget/zoom";
import { flowsOf, type MonthFlow } from "@/lib/budget/flows";
import { projectedMasseByService } from "@/lib/budget/monthly";
import type { ProjectedMonth } from "@/lib/budget/types";
import { confidentialiteReason, confidentialiteSettingReason, isHidden, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { columnStatus, maskColumn, stockColumn } from "@/lib/confidentialite/columns";
import { projectedCell, projectedGroup } from "@/lib/confidentialite/groups";
import { croiseeLink } from "@/lib/croisee/confidentialite";
import { servicesOf } from "@/lib/payroll/engine";
import { loadPayrollContext, type PayrollContext } from "@/lib/payroll/context";
import { serviceGuardOnWindows, serviceLabel, worstGuard, type ServiceGuard } from "@/lib/payroll/service-rows";

// Choix des versions comparées (Écart budgétaire, Analyse des écarts) : réel PayFit d'une année, scénario d'une année ou budget
// saisi ; période en rangs de mois de l'année de chaque version ; filtre de service. Rien n'est enregistré : tout vient de
// l'adresse de la page.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
export const NV = "__nv__";

export type Option = { value: string; label: string };
export type Loaded = {
  ctx: PayrollContext;
  options: Option[];
  selected: string[]; // valeurs choisies, dans l'ordre des colonnes
  versions: Version[];
  shorts: string[]; // libellés courts des versions (en-têtes de colonnes)
  sources: ZoomSource[];
  scenarios: Map<string, ScenarioFull>; // scénarios chargés, par identifiant
  from: string;
  to: string;
  months: (year: string) => string[];
  services: string[];
  hasNv: boolean;
  filter: ServiceFilter;
  notices: string[];
};

export async function loadVersions(slug: string, workspaceId: string, sp: Search, columns: 2 | 3): Promise<Loaded> {
  const ctx = await loadPayrollContext(slug);
  const journal = ctx.input;
  const kpi = ctx.kpi.input;
  const notices: string[] = [];
  const [rows, budgets] = await Promise.all([listScenarios(workspaceId), listBudgets(workspaceId)]);

  const options: Option[] = [];
  const realYears = journal ? [...new Set(journal.months.map((m) => m.slice(0, 4)))].sort() : [];
  for (const y of realYears) options.push({ value: `reel:${y}`, label: `Réel PayFit ${y}` });
  for (const r of rows) {
    const s = r.scenario;
    const years = [...new Set([r.refMonth.slice(0, 4), ...monthRange(s.firstMonth, s.lastMonth).map((m) => m.slice(0, 4))])].sort();
    for (const y of years) options.push({ value: `scenario:${s.id}:${y}`, label: `Scénario « ${s.name} » (${KIND_LABELS[s.kind]}, ${s.status === "fige" ? "figé" : "brouillon"}) ${y}` });
  }
  for (const b of budgets) options.push({ value: `budget:${b.id}`, label: `Budget saisi « ${b.name} » ${b.year}` });

  // Par défaut : réel de l'année précédente au scénario le plus récent, scénario le plus récent, puis le suivant (N+1) ou le budget.
  const newest = rows[0]?.scenario;
  const defaults: string[] = [];
  if (newest) {
    const y = newest.firstMonth.slice(0, 4);
    const prevReal = `reel:${Number(y) - 1}`;
    if (options.some((o) => o.value === prevReal)) defaults.push(prevReal);
    defaults.push(`scenario:${newest.id}:${y}`);
    const next = rows.find((r) => r.scenario.firstMonth.slice(0, 4) === String(Number(y) + 1) && r.scenario.id !== newest.id);
    const nextOpt = next ? `scenario:${next.scenario.id}:${next.scenario.firstMonth.slice(0, 4)}` : budgets.find((b) => b.year === y) ? `budget:${budgets.find((b) => b.year === y)!.id}` : null;
    if (nextOpt) defaults.push(nextOpt);
  } else if (realYears.length) defaults.push(`reel:${realYears.at(-1)}`);

  const raw = [one(sp.v1), one(sp.v2), one(sp.v3)].slice(0, columns);
  const explicit = raw.some((v) => v !== "");
  const selected = (explicit ? raw : defaults.slice(0, columns)).filter((v) => v !== "");
  const valid = selected.filter((v) => options.some((o) => o.value === v));
  if (valid.length !== selected.length) notices.push("une version choisie n'existe plus : ignorée");

  // Période : rangs de mois, appliqués à l'année de chaque version.
  let from = MM.includes(one(sp.de)) ? one(sp.de) : "01";
  let to = MM.includes(one(sp.a)) ? one(sp.a) : "12";
  if (from > to) {
    notices.push("période inversée : année entière utilisée");
    from = "01";
    to = "12";
  }

  // Filtre de service : codes analytiques du journal et services des scénarios choisis.
  const scenarios = new Map<string, ScenarioFull>();
  for (const v of valid) {
    if (!v.startsWith("scenario:")) continue;
    const id = v.split(":")[1];
    if (!scenarios.has(id)) {
      const full = await getScenario(workspaceId, id);
      if (full) scenarios.set(id, full);
    }
  }
  const known = new Set<string>();
  let hasNv = false;
  if (journal && ctx.service.axis) for (const s of servicesOf(journal, journal.months)) (s === null ? (hasNv = true) : known.add(s));
  for (const f of scenarios.values()) for (const c of f.base.contracts) if (c.service) known.add(c.service);
  const rawService = one(sp.service);
  const filter: ServiceFilter = !rawService ? null : rawService === NV ? { value: null } : known.has(rawService) ? { value: rawService } : null;
  if (rawService && !filter) notices.push(`service ${rawService} inconnu : tous les services`);

  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = ctx.etp([m], f);
    return e.etp4 === null ? nd(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const why = ctx.unavailable ?? "journal de paie PayFit indisponible";
  const versions: Version[] = [];
  const sources: ZoomSource[] = [];
  const shorts: string[] = [];
  for (const v of valid) {
    const label = options.find((o) => o.value === v)!.label;
    shorts.push(v.startsWith("reel:") ? `Réel ${v.slice(5)}` : v.startsWith("scenario:") ? `${rows.find((r) => r.scenario.id === v.split(":")[1])?.scenario.name ?? "Scénario"} ${v.split(":")[2]}` : `Budget ${budgets.find((b) => b.id === v.slice(7))?.name ?? ""}`);
    if (v.startsWith("reel:")) {
      const y = v.slice(5);
      versions.push(journal ? reelVersion(v, label, y, journal, kpi, filter, etpService) : ndVersion(v, label, "reel", y, why));
      sources.push(journal ? { kind: "reel", journal, filter } : { kind: "budget" });
    } else if (v.startsWith("scenario:")) {
      const [, id, y] = v.split(":");
      const full = scenarios.get(id);
      if (!full) {
        versions.push(ndVersion(v, label, "scenario", y, "scénario introuvable"));
        sources.push({ kind: "budget" });
        continue;
      }
      const s = full.scenario;
      const proj = project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions);
      versions.push(scenarioVersion(v, label, y, full.base, proj, journal, kpi, filter, etpService));
      sources.push({ kind: "scenario", base: full.base, proj, journal, filter });
    } else {
      const b = budgets.find((x) => x.id === v.slice(7))!;
      versions.push(filter ? ndVersion(v, label, "budget", b.year, "budget saisi global : non filtrable par service") : budgetVersion(v, label, b.year, b.amounts));
      sources.push({ kind: "budget" });
    }
  }
  return {
    ctx, options, selected: valid, versions, shorts, sources, scenarios, from, to,
    months: (year) => monthRange(`${year}-${from}`, `${year}-${to}`),
    services: [...known].sort(), hasNv, filter, notices,
  };
}

// --- Garde du filtre Service : la garde unique de src/lib/payroll/service-rows.ts, appliquée aux versions comparées --------------------
// Sous le filtre Service, l'Écart budgétaire et l'Analyse des écarts décrivent le service retenu sur chaque version. Ses mois réels
// (version réelle : les mois de la période ; scénario : ses mois figés) passent par les lignes par service du journal entier, masquées
// par le moteur unique (serviceGuardOnWindows, masquage secondaire compris, comme la Synthèse de la Masse salariale), et par la colonne
// des stocks de chaque mois pour l'ETP de fin de mois (serviceStockMask, comme KPI RH › Effectifs mensuels et la croisée 02). Ses mois projetés
// (scénario) passent par les colonnes du mois projeté (maskProjectedServices) : le service est n.d. dès qu'une de ses cellules y est
// masquée, principal ou secondaire. Un budget saisi est global : n.d. sous le filtre, rien à protéger. Seuil absent ou illisible : n.d.
// avec la raison du paramètre (l'écran ajoute le lien vers Paramètres › Confidentialité). null : rien n'est masqué. Fonction pure.

// Mois projeté d'un scénario. Sans filtre, l'écran publie les totaux du scénario pour ce mois (masse, effectif et ETP de fin de mois,
// entrées) ; sous le filtre Service, il publie ceux du service retenu. Chaque grandeur est donc une répartition par service dont le
// total est publié : une colonne par grandeur, masquée par le moteur unique avec son total fixe, masquage secondaire compris, dans
// l'ordre canonique des services (maskColumn, stockColumn de src/lib/confidentialite/columns.ts : les mêmes statuts que tout autre
// écran qui publie la même colonne). Cellules de chaque service du mois (projectedCell : contrats réels reliés à leur personne par le
// référentiel ; une embauche prévue ne décrit personne et ne protège jamais ; valeur absolue, qui ne sert qu'à l'ordre du masquage) :
// - masse (et ses rubriques) : contrats et embauches qui portent une contribution du service, groupes de projectedMasseByService
//   (service porté par la contribution, le même découpage que KPI RH › Effectifs mensuels, masse × service) ;
// - effectif et ETP : salariés et embauches comptés présents en fin de mois dans le service (stockColumn, valeur = l'effectif) ;
// - entrées : entrants du mois dans le service, valeur = leur nombre (colonne absente quand les mouvements du mois sont n.d.).
// Rend, pour chaque service présent ce mois-là (null : non ventilé), son statut dans chaque colonne, dans cet ordre. Le statut d'un
// mois ne dépend que de ses colonnes, jamais d'une fenêtre. Fonction pure.
export function maskProjectedServices(pm: Extract<ProjectedMonth, { kind: "value" }>, flow: MonthFlow | undefined, link: PersonLink, seuil: number): Map<string | null, MaskStatus[]> {
  type Group = { masse: number; contributors: Set<string>; present: string[]; entrants: string[] };
  const groups = new Map<string | null, Group>();
  const at = (service: string | null): Group => {
    let g = groups.get(service);
    if (!g) groups.set(service, (g = { masse: 0, contributors: new Set(), present: [], entrants: [] }));
    return g;
  };
  for (const [service, m] of projectedMasseByService(pm)) {
    const g = at(service);
    g.masse = m.cost;
    g.contributors = m.keys;
  }
  const people = pm.people ?? {};
  for (const [key, p] of Object.entries(people)) at(p.service).present.push(key);
  const entrants = flow?.kind === "value" ? flow.entrees : null;
  if (entrants) for (const key of entrants) if (people[key]) at(people[key].service).entrants.push(key);
  const list = [...groups];
  const masse = maskColumn(list.map(([service, g]) => ({ key: service, label: serviceLabel(service), cell: projectedCell(g.contributors, link, seuil, g.masse) })), seuil, true);
  const stock = stockColumn(
    Object.fromEntries(list.filter(([, g]) => g.present.length > 0).map(([service, g]) => {
      const pg = projectedGroup(g.present, link);
      return [serviceLabel(service), { ...pg, contracts: g.present.length - pg.hires }];
    })),
    seuil,
  );
  const entrees = entrants ? maskColumn(list.map(([service, g]) => ({ key: service, label: serviceLabel(service), cell: projectedCell(g.entrants, link, seuil, g.entrants.length) })), seuil, true) : null;
  return new Map(list.map(([service, g]) => [service, [
    columnStatus(masse, service, g.masse),
    columnStatus(stock, serviceLabel(service), g.present.length),
    ...(entrees ? [columnStatus(entrees, service, g.entrants.length)] : []),
  ]]));
}

export function ecartServiceGuard(loaded: Pick<Loaded, "ctx" | "versions" | "sources" | "months" | "filter">, conf: ConfidentialiteSetting): ServiceGuard | null {
  if (!loaded.filter) return null;
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null || conf.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_VERIFIABLE };
  const seuil = conf.value;
  const value = loaded.filter.value;
  const data = loaded.ctx.kpi.input?.data ?? null;
  const link = data ? croiseeLink(data) : new Map<string, string>();
  const windows: string[][] = [];
  const projected: MaskStatus[] = [];
  loaded.versions.forEach((v, i) => {
    const src = loaded.sources[i];
    if (!src || src.kind === "budget") return;
    const months = loaded.months(v.year);
    windows.push(months.filter((m) => v.months.get(m)?.layer === "reel"));
    if (src.kind !== "scenario" || src.proj.kind !== "value") return;
    const flows = new Map(flowsOf(src.base, src.proj).map((f) => [f.month, f]));
    for (const m of months) {
      // Mois projeté par le scénario lui-même (un mois projeté par le scénario parent n'est pas filtrable : n.d. sous le filtre).
      if (v.months.get(m)?.layer !== "projete") continue;
      const pm = src.proj.months.find((x) => x.month === m);
      if (!pm || pm.kind !== "value") continue; // mois n.d. : aucun total publié, rien à protéger
      projected.push(...(maskProjectedServices(pm, flows.get(m), link, seuil).get(value) ?? []));
    }
  });
  const journal = loaded.ctx.input;
  // Mois réels : colonne de masse de chaque mois et, la ligne ETP des versions publiant l'ETP de fin de mois du service, colonne des
  // stocks de ces mêmes mois (celle de KPI RH › Effectifs mensuels, ETP × service, et de la croisée 02).
  const real = journal ? serviceGuardOnWindows(journal, windows, value, link, conf, { kpi: loaded.ctx.kpi.input, months: windows.flat() }) : null;
  const proj: ServiceGuard | null = projected.some((s) => s === "masked" || s === "secondary")
    ? { cause: "seuil", reason: confidentialiteReason(seuil) }
    : projected.some(isHidden) ? { cause: "seuil", reason: SEUIL_NON_VERIFIABLE } : null;
  return worstGuard([real, proj], seuil);
}
