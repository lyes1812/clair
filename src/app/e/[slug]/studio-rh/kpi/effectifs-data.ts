import { monthRange } from "@/lib/connectors/months";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { project } from "@/lib/budget/engine";
import { AXES, MEASURES, monthlyGrid, type Axis, type Grid, type Measure, type RealSource } from "@/lib/budget/monthly";
import { getScenario, KIND_LABELS, listScenarios, type ScenarioFull } from "@/lib/budget/store";
import { nd, val } from "@/lib/budget/versions";
import { loadPayrollContext } from "@/lib/payroll/context";
import { selectableYears } from "@/lib/rh/kpi/period";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { monthShortLabel, repartition } from "@/lib/viz/kpi";

// Chargement commun des Effectifs mensuels (écran et export) : rubrique, axe, version (réel PayFit ou scénario) et année lus dans
// l'adresse ; une valeur inconnue prend le défaut de l'écran. La grille vient de monthlyGrid, sans autre calcul.
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
  grid: Grid;
  unit: "etp" | "nombre" | "eur";
  stock: boolean; // ETP et inscrits : stocks (répartition au dernier mois connu) ; entrées, sorties, masse : flux (cumul)
};

export async function loadEffectifs(slug: string, workspaceId: string, kpi: KpiInput | null, search: EffectifsSearch): Promise<EffectifsData> {
  const pay = await loadPayrollContext(slug);
  const [{ natures }, overrides, rows] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId), listScenarios(workspaceId)]);
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
  const grid = monthlyGrid({ measure, axis, year, real, scenario: full ? { base: full.base, hyps: full.hypotheses, proj: project(full.base, full.scenario.firstMonth, full.scenario.lastMonth, full.hypotheses, full.scenario.conventions) } : null });
  return { measure, axis, mdef, versions, version, versionLabel: versions.find((v) => v.value === version)!.label, full, years, year, grid, unit: mdef.unit, stock: measure === "etp" || measure === "inscrit" };
}

// Répartition par groupe et sa base, en clair : stocks au dernier mois connu, flux sur le cumul des mois connus.
export function effectifsShare(grid: Grid, stock: boolean, year: string) {
  const repart = grid.kind === "value" ? repartition(grid, stock) : null;
  const basis = repart && grid.kind === "value"
    ? stock ? (repart.used[0] ? `fin ${monthShortLabel(repart.used[0])} ${year}` : "aucun mois connu") : `cumul des ${repart.used.length} mois connus (${repart.known.length < 12 ? `${12 - repart.known.length} mois n.d. non comptés` : "année complète"})`
    : "";
  return { repart, basis };
}
