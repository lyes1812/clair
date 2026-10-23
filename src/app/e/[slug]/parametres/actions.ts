"use server";
import { revalidatePath } from "next/cache";
import { ABSENCE_STATUSES } from "@/lib/connectors/payfit/client";
import { getKpiSettings, KPI_PARSERS, setKpiSettings, type KpiSettingValues } from "@/lib/rh-kpi-settings";
import { setPayrollGrid, setServiceAxis } from "@/lib/payroll-settings";
import { journalAxes } from "@/lib/payroll/context";
import { parseGrid, RUBRICS } from "@/lib/payroll/grid";
import { parsePayfitHistoryMode, setHeadcountNatures, setPayfitHistoryMode } from "@/lib/rh-settings";
import { activePayFitSync, loadAbsenceTypes } from "@/lib/rh/referential/store";
import { requireWorkspace } from "@/lib/workspace";
import { setProrata } from "@/lib/budget/settings";
import { setCategoryNatures } from "@/lib/budget/categories";
import { CATEGORY_IDS } from "@/lib/budget/types";

export type FormState = { error?: string; ok?: string } | undefined;

export async function saveHeadcountNatures(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const checked = formData.getAll("natures").map(String);
  const extra = String(formData.get("extra") ?? "")
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const codes = [...new Set([...checked, ...extra])];
  if (codes.some((c) => !/^\d{2}$/.test(c))) return { error: "Un code de nature est composé de deux chiffres (ex. 01, 02, 29)." };
  if (codes.length === 0) return { error: "Choisissez au moins une nature de contrat." };
  try {
    await setHeadcountNatures(workspace.id, codes, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Natures comptées dans l'effectif enregistrées." };
}

export async function savePayfitHistory(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const mode = parsePayfitHistoryMode(formData.get("mode"));
  if (!mode) return { error: "Choisissez un mode d'historique PayFit." };
  try {
    await setPayfitHistoryMode(workspace.id, mode, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Historique PayFit enregistré." };
}

export async function savePayrollGrid(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const raw = Object.fromEntries(RUBRICS.map((r) => [r.id, String(formData.get(r.id) ?? "").split(/[\s,;]+/).filter(Boolean)]));
  const grid = parseGrid(raw);
  if (!grid) return { error: "Grille invalide : préfixes de 2 à 10 chiffres, chacun dans une seule rubrique." };
  try {
    await setPayrollGrid(workspace.id, grid, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Grille de comptes enregistrée." };
}

export async function saveServiceAxis(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const axis = String(formData.get("serviceAxis") ?? "");
  if (axis && !(await journalAxes(workspace.id)).includes(axis)) return { error: "Axe absent du journal PayFit appliqué." };
  try {
    await setServiceAxis(workspace.id, axis, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: axis ? "Axe du service enregistré." : "Ventilation par service désactivée." };
}

// Définitions des KPI : chaque champ passe par son parseur strict ; un type d'absence n'est accepté que s'il figure dans la
// lecture PayFit appliquée ou s'il est déjà enregistré.
export async function saveKpiSettings(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const current = await getKpiSettings(workspace.id);
  const active = await activePayFitSync(workspace.id);
  const readTypes = new Set(active ? (await loadAbsenceTypes(workspace.id, active.id)).map((t) => t.type) : []);
  const types = formData.getAll("absenceTypes").map(String);
  const unknown = types.filter((t) => !readTypes.has(t) && !current.values.absenceTypes.includes(t));
  if (unknown.length) return { error: `Type d'absence absent de la lecture appliquée : ${unknown.join(", ")}.` };
  const raw: Record<keyof KpiSettingValues, unknown> = {
    fullTimeIsOne: formData.get("fullTimeIsOne") === "on",
    capAtOne: formData.get("capAtOne") === "on",
    forfaitJoursIsOne: formData.get("forfaitJoursIsOne") === "on",
    etpDecimals: Number(formData.get("etpDecimals")),
    turnoverFormula: String(formData.get("turnoverFormula") ?? ""),
    excludedExitNatures: formData.getAll("excludedExitNatures").map(String),
    neutralizeContinuity: formData.get("neutralizeContinuity") === "on",
    absenceTypes: types,
    absenceStatuses: formData.getAll("absenceStatuses").map(String).filter((x) => ABSENCE_STATUSES.has(x)),
    dayBasis: String(formData.get("dayBasis") ?? ""),
  };
  const LABELS: Record<keyof KpiSettingValues, string> = {
    fullTimeIsOne: "Temps plein = 1",
    capAtOne: "Plafond à 1",
    forfaitJoursIsOne: "Forfait jours = 1",
    etpDecimals: "Décimales des quotités",
    turnoverFormula: "Formule du turnover",
    excludedExitNatures: "Sorties exclues",
    neutralizeContinuity: "Contrats continus",
    absenceTypes: "Types d'absence",
    absenceStatuses: "Statuts d'absence (au moins un)",
    dayBasis: "Base des jours",
  };
  const next = {} as Record<keyof KpiSettingValues, unknown>;
  for (const k of Object.keys(raw) as (keyof KpiSettingValues)[]) {
    const v = KPI_PARSERS[k](raw[k]);
    if (v === null) return { error: `Valeur invalide : ${LABELS[k]}.` };
    next[k] = v;
  }
  try {
    await setKpiSettings(workspace.id, next as KpiSettingValues, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Définitions des KPI enregistrées." };
}

export async function saveProrata(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  try {
    await setProrata(workspace.id, formData.get("prorata"), session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Règle de prorata enregistrée." };
}

export async function saveCategoryNatures(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const v: Record<string, string[]> = {};
  for (const id of CATEGORY_IDS) {
    v[id] = String(formData.get(id) ?? "")
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  try {
    await setCategoryNatures(workspace.id, v, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Catégories de contrat enregistrées (scénarios créés ensuite)." };
}
