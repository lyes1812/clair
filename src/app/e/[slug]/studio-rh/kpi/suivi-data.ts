import { categoryMonth, getCategoryNatures, getContractCategories, type CategoryMonth } from "@/lib/budget/categories";
import { CATEGORY_IDS } from "@/lib/budget/types";
import { formatDate, monthEnd } from "@/lib/dates";
import { coverageAt, gateAt } from "@/lib/rh/headcount";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { civilWindow, closedMonths, defaultYear, lastClosedMonth, rollingWindow, selectableYears } from "@/lib/rh/kpi/period";
import type { KpiDashboard, KpiInput, Window } from "@/lib/rh/kpi/types";
import { loadKpiContext, type KpiContext } from "@/lib/rh/kpi-context";
import type { PayfitHistoryLimit } from "@/lib/rh/raw-history";
import type { RhBuildData } from "@/lib/rh/referential/types";
import type { Shown } from "@/lib/rh/view";
import { resolveKpiVue, type KpiVue } from "./tabs";

// Chargement commun de KPI RH (page et export) : contexte, mois clos, paramètres d'adresse (mode, fin, année, établissement,
// nature ; une valeur invalide est remplacée par le défaut et signalée), fenêtre et tableau de bord. Rien n'est enregistré.
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Couverture d'un mois du tableau : complet, borne basse ou n.d. avec la raison.
export function coverageShown(data: RhBuildData, month: string, establishments?: string[], raw?: PayfitHistoryLimit | null): Shown {
  const ref = data.build.referenceDate;
  if (ref && monthEnd(month) > ref) return { text: `n.d. — mois non clos à la date de référence (${formatDate(ref)})`, kind: "nd" };
  const cov = coverageAt(data, month, establishments);
  const g = gateAt(data, monthEnd(month), establishments);
  if (g.nd) return { text: `n.d. — ${g.nd.reason}`, kind: "nd" };
  const lower = cov.filter((c) => c.presenceStatus === "lower_bound");
  if (lower.length) return { text: "borne basse", kind: "lower", foot: lower[0].presenceReason ?? undefined };
  // Historique PayFit brut : mois antérieur à la limite de conservation, calculé sur ce que l'API renvoie (mention en tête).
  if (raw && month >= raw.lowerFrom && month <= raw.lowerTo) return { text: "brut (API PayFit)", kind: "value" };
  return { text: "complet", kind: "value" };
}

// Colonnes du tableau « Mois par mois » : toutes pour le Suivi ; Turnover et Absentéisme n'en montrent qu'une sélection.
export const SUIVI_COLUMNS = ["coverage", "headcount", "etp", "etp-prorated", "entries", "exits", "theoretical", "absence-days", "absenteeism", "etp-n1", "absenteeism-n1"] as const;
export type SuiviColumn = (typeof SUIVI_COLUMNS)[number];
const TURNOVER_COLUMNS: string[] = ["coverage", "headcount", "entries", "exits"];
const ABSENCE_COLUMNS: string[] = ["coverage", "theoretical", "absence-days", "absenteeism", "absenteeism-n1"];
export const suiviColumnOn = (vue: KpiVue, c: string): boolean => vue === "suivi" || (vue === "turnover" ? TURNOVER_COLUMNS.includes(c) : ABSENCE_COLUMNS.includes(c));

type Ready = {
  kind: "ready";
  ctx: KpiContext & { input: KpiInput };
  data: RhBuildData;
  open: string[];
  rawLimit: PayfitHistoryLimit | null;
  closed: string[];
  last: string;
  years: { year: number; closed: boolean }[];
  vue: KpiVue;
  mode: "civil" | "glissant";
  fin: string;
  year: number;
  etab: string;
  nature: string;
  w: Window;
  input: KpiInput; // entrée du moteur avec le périmètre choisi (établissement, nature)
  dash: KpiDashboard;
  notices: string[]; // paramètres écartés, avec leur raison (la page y ajoute ceux du détail)
};
export type KpiSuivi =
  | { kind: "no-input"; ctx: KpiContext }
  | { kind: "settings-invalid"; ctx: KpiContext & { input: KpiInput }; last: string | null }
  | { kind: "no-closed-month"; ctx: KpiContext & { input: KpiInput }; data: RhBuildData }
  | Ready;

// Fonction pure (le contexte est déjà chargé) : mêmes règles que l'écran pour chaque paramètre d'adresse.
export function kpiSuiviOf(ctx: KpiContext, sp: Search): KpiSuivi {
  if (!ctx.input) return { kind: "no-input", ctx };
  const c = ctx as KpiContext & { input: KpiInput };
  const data = c.input.data;
  const open = c.input.openMonths ?? [];
  const rawLimit = ctx.collab.payfitHistory?.mode === "raw" ? ctx.collab.payfitHistory.limit : null;
  const closed = closedMonths(data, open);
  const last = lastClosedMonth(data, open);
  if (ctx.settings.invalid.length) return { kind: "settings-invalid", ctx: c, last };
  if (!last) return { kind: "no-closed-month", ctx: c, data };

  const notices: string[] = [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  const vue = resolveKpiVue(one(sp.vue));
  const rawMode = one(sp.mode);
  const mode = rawMode === "civil" ? "civil" : "glissant";
  if (rawMode && rawMode !== "civil" && rawMode !== "glissant") ignore("mode", rawMode, "valeurs possibles : glissant, civil");
  const rawFin = one(sp.fin);
  const fin = closed.includes(rawFin) ? rawFin : last;
  if (rawFin && rawFin !== fin) ignore("fin", rawFin, "hors des mois clos");
  const years = selectableYears(data, open);
  const rawYear = one(sp.annee);
  const year = years.some((y) => String(y.year) === rawYear) ? Number(rawYear) : defaultYear(data, open)!;
  if (rawYear && String(year) !== rawYear) ignore("annee", rawYear, "hors des années couvertes");
  const rawEtab = one(sp.etab);
  const etab = ctx.collab.establishments.some((e) => e.id === rawEtab) ? rawEtab : "";
  if (rawEtab && !etab) ignore("etab", rawEtab, "établissement inconnu");
  const rawNature = one(sp.nature);
  const nature = ctx.collab.natures.codes.includes(rawNature) ? rawNature : "";
  if (rawNature && !nature) ignore("nature", rawNature, "nature non comptée dans l'effectif");

  const w: Window = mode === "civil" ? civilWindow(year) : rollingWindow(fin);
  const input: KpiInput = { ...c.input, scope: { establishments: etab ? [etab] : undefined, nature: nature || undefined } };
  return { kind: "ready", ctx: c, data, open, rawLimit, closed, last, years, vue, mode, fin, year, etab, nature, w, input, dash: kpiDashboard(input, w), notices };
}

export async function loadKpiSuivi(slug: string, sp: Search): Promise<KpiSuivi> {
  return kpiSuiviOf(await loadKpiContext(slug, {}), sp);
}

// Effectif et ETP par catégorie (Suivi) : un calcul par mois de la fenêtre, sur le référentiel sans filtre de périmètre ; seules les
// catégories présentes au moins un mois sont des colonnes.
export async function loadCategoryMonths(kpi: KpiInput, w: Window, workspaceId: string): Promise<{ months: CategoryMonth[]; keys: string[] }> {
  const [catNatures, catOverrides] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId)]);
  const months = w.months.map((m) => categoryMonth(kpi, m, catNatures.natures, catOverrides));
  return { months, keys: [...CATEGORY_IDS, "nc"].filter((k) => months.some((c) => c.kind === "value" && c.byCategory[k])) };
}
