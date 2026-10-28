import { monthRange } from "@/lib/connectors/months";
import { project } from "@/lib/budget/engine";
import { getScenario, KIND_LABELS, listBudgets, listScenarios, type ScenarioFull } from "@/lib/budget/store";
import { budgetVersion, ndVersion, nd, reelVersion, scenarioVersion, val, type ServiceFilter, type Version } from "@/lib/budget/versions";
import type { ZoomSource } from "@/lib/budget/zoom";
import { confidentialiteSettingReason, isHidden, maskGroups, maskReason, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskCell } from "@/lib/confidentialite";
import { projectedCell } from "@/lib/confidentialite/groups";
import { croiseeLink } from "@/lib/croisee/confidentialite";
import { servicesOf } from "@/lib/payroll/engine";
import { loadPayrollContext, type PayrollContext } from "@/lib/payroll/context";
import { serviceGuardOnWindows, worstGuard, type ServiceGuard } from "@/lib/payroll/service-rows";

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
// par le moteur unique (serviceGuardOnWindows : le service est n.d. dès que sa ligne l'est, masquage secondaire compris, comme la
// Synthèse de la Masse salariale). Ses mois projetés (scénario) passent par la composition projetée du service : contrats réels
// reliés par le référentiel Collaborateurs ; embauches prévues exemptes (projectedCell), masquage principal (aucune somme par service
// n'est publiée). Un budget saisi est global : n.d. sous le filtre, rien à protéger. Seuil absent ou illisible : n.d. avec la raison
// du paramètre (l'écran ajoute le lien vers Paramètres › Confidentialité). null : rien n'est masqué. Fonction pure.
export function ecartServiceGuard(loaded: Pick<Loaded, "ctx" | "versions" | "sources" | "months" | "filter">, conf: ConfidentialiteSetting): ServiceGuard | null {
  if (!loaded.filter) return null;
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null || conf.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_VERIFIABLE };
  const seuil = conf.value;
  const value = loaded.filter.value;
  const data = loaded.ctx.kpi.input?.data ?? null;
  const link = data ? croiseeLink(data) : new Map<string, string>();
  const windows: string[][] = [];
  const projected: MaskCell[] = [];
  loaded.versions.forEach((v, i) => {
    const src = loaded.sources[i];
    if (!src || src.kind === "budget") return;
    const months = loaded.months(v.year);
    windows.push(months.filter((m) => v.months.get(m)?.layer === "reel"));
    if (src.kind !== "scenario") return;
    for (const m of months) {
      const f = v.months.get(m);
      if (!f || f.layer === "reel") continue;
      // Mois projeté : la masse affichée du service (null : déjà n.d.) et sa composition ; composition n.d. : effectif non dénombré.
      const masse = f.masse.kind === "value" ? f.masse.v : null;
      projected.push(f.people.kind === "value" ? projectedCell(Object.keys(f.people.map), link, seuil, masse) : { size: null, value: masse === null ? null : Math.abs(masse) });
    }
  });
  const journal = loaded.ctx.input;
  const real = journal ? serviceGuardOnWindows(journal, windows, value, link, conf) : null;
  const st = maskGroups(projected, seuil, false);
  const worst = st.find((x) => x === "masked") ?? st.find(isHidden);
  const proj: ServiceGuard | null = worst === undefined ? null : { cause: "seuil", reason: maskReason(worst, seuil)! };
  return worstGuard([real, proj], seuil);
}
