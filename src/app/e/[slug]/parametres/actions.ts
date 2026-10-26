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
import { setCategoryNatures, setContractCategories } from "@/lib/budget/categories";
import { CATEGORY_IDS } from "@/lib/budget/types";
import { CROISEE_PARSERS, LIBELLE_MAX, SEUILS_MAX, setCroiseeSettings, type CroiseeWrite, type SeuilEffectif } from "@/lib/croisee-settings";

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

// Définitions des KPI : chaque champ passe par son parseur strict ; un motif d'absence n'est accepté que s'il figure dans la
// lecture PayFit appliquée ou s'il est déjà enregistré.
export async function saveKpiSettings(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const current = await getKpiSettings(workspace.id);
  const active = await activePayFitSync(workspace.id);
  const readTypes = new Set(active ? (await loadAbsenceTypes(workspace.id, active.id)).map((t) => t.type) : []);
  const types = formData.getAll("absenceTypes").map(String);
  const unknown = types.filter((t) => !readTypes.has(t) && !current.values.absenceTypes.includes(t));
  if (unknown.length) return { error: `Motif d'absence absent de la lecture appliquée : ${unknown.join(", ")}.` };
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
    absenceTypes: "Motifs d'absence retenus",
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

// Corrections de catégorie contrat par contrat : un champ « c:<identifiant du contrat> » par contrat listé ; vide = selon la nature.
// Les corrections des contrats non listés (anciens contrats) sont conservées.
export async function saveContractCategories(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const { getContractCategories } = await import("@/lib/budget/categories");
  const current = await getContractCategories(workspace.id);
  const listed = new Set(formData.getAll("listed").map(String));
  const next: Record<string, string> = Object.fromEntries(Object.entries(current).filter(([k]) => !listed.has(k)));
  for (const k of listed) {
    const v = String(formData.get(`c:${k}`) ?? "");
    if (v) next[k] = v;
  }
  try {
    await setContractCategories(workspace.id, next, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Catégories par contrat enregistrées (KPI RH et scénarios créés ensuite)." };
}

// Masse salariale croisée : lecture du formulaire. Un champ présent et vide supprime le réglage (« non défini ») ; un champ absent
// du formulaire laisse le réglage inchangé ; une valeur hors règle refuse tout l'enregistrement. Rien n'est converti en silence :
// « 2,5 », « -1 » ou « abc » sont refusés, jamais arrondis ni remplacés par 0.
type CroiseeIntKey = "confidentialite" | "margeAlerte" | "horizonEcheances";
const CROISEE_INT_ERRORS: Record<CroiseeIntKey, string> = {
  confidentialite: "Valeur invalide : seuil de confidentialité (nombre entier de personnes, au moins 1).",
  margeAlerte: "Valeur invalide : marge d'alerte (nombre entier de salariés, 0 ou plus).",
  horizonEcheances: "Valeur invalide : horizon des échéances (nombre entier de jours, au moins 1).",
};
const digitsOf = (v: FormDataEntryValue | null | undefined) => String(v ?? "").replace(/[\s\u00a0\u202f]/g, "");
const wholeNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : Number.NaN);

function readCroiseeForm(formData: FormData): { values: CroiseeWrite } | { error: string } {
  const values: CroiseeWrite = {};
  for (const key of Object.keys(CROISEE_INT_ERRORS) as CroiseeIntKey[]) {
    if (!formData.has(key)) continue;
    const raw = digitsOf(formData.get(key));
    if (raw === "") {
      values[key] = null;
      continue;
    }
    const v = CROISEE_PARSERS[key](wholeNumber(raw));
    if (v === null) return { error: CROISEE_INT_ERRORS[key] };
    values[key] = v;
  }
  // Seuils d'effectif : lignes « libellé + effectif » dans l'ordre du tableau ; une ligne entièrement vide est ignorée. Le champ
  // caché « seuils » marque la présence du tableau dans le formulaire.
  if (formData.has("seuils")) {
    const labels = formData.getAll("seuilLibelle").map((v) => String(v).trim());
    const counts = formData.getAll("seuilValeur").map(digitsOf);
    const list: SeuilEffectif[] = [];
    for (let i = 0; i < Math.max(labels.length, counts.length); i++) {
      const libelle = labels[i] ?? "";
      const raw = counts[i] ?? "";
      if (libelle === "" && raw === "") continue;
      const row = `Seuil d'effectif n° ${i + 1}`;
      if (libelle === "" || raw === "") return { error: `${row} : libellé et effectif sont requis ensemble.` };
      if (libelle.length > LIBELLE_MAX) return { error: `${row} : libellé de ${LIBELLE_MAX} caractères au plus.` };
      const valeur = wholeNumber(raw);
      if (!Number.isSafeInteger(valeur) || valeur < 1) return { error: `${row} : effectif en nombre entier de salariés, au moins 1.` };
      list.push({ libelle, valeur });
    }
    if (list.length > SEUILS_MAX) return { error: `Seuils d'effectif : ${SEUILS_MAX} au plus.` };
    if (new Set(list.map((x) => x.valeur)).size !== list.length) return { error: "Seuils d'effectif : deux seuils ne peuvent pas avoir le même effectif." };
    if (list.length === 0) values.seuilsEffectif = null;
    else {
      const parsed = CROISEE_PARSERS.seuilsEffectif(list);
      if (parsed === null) return { error: "Valeur invalide : seuils d'effectif suivis." };
      values.seuilsEffectif = parsed;
    }
  }
  return { values };
}

// Paramètres de la Masse salariale croisée (administrateur) : quatre réglages sans valeur par défaut, un événement setting.changed
// par réglage modifié ou supprimé.
export async function saveCroiseeSettings(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const read = readCroiseeForm(formData);
  if ("error" in read) return { error: read.error };
  let written: string[];
  try {
    written = await setCroiseeSettings(workspace.id, read.values, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  if (written.length === 0) return { ok: "Aucune modification : rien n'a été enregistré." };
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Paramètres de la Masse salariale croisée enregistrés." };
}
