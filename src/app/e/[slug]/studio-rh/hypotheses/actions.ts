"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildBase } from "@/lib/budget/base";
import { getConventions } from "@/lib/budget/settings";
import { z } from "zod";
import { addHypothesis, BudgetError, MAX_MONTH_CENTS, createScenario, deleteBudget, deleteHypothesis, deleteScenario, duplicateScenario, freezeScenario, getScenario, saveBudget, type ScenarioKind } from "@/lib/budget/store";
import { chainBase } from "@/lib/budget/chain";
import { project } from "@/lib/budget/engine";
import type { Amount, Hypothesis, HypothesisKind, Scope } from "@/lib/budget/types";
import { isMonth, monthRange } from "@/lib/connectors/months";
import { addMonths } from "@/lib/dates";
import { recordEvent } from "@/lib/events";
import { toCents } from "@/lib/money";
import { loadPayrollContext } from "@/lib/payroll/context";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string } | undefined;
const MAX_HORIZON = 24;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (slug: string) => `/e/${slug}/studio-rh/hypotheses`;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
// Seules les erreurs métier sont affichées telles quelles ; les autres sont journalisées côté serveur.
const fail = (e: unknown): FormState => {
  if (e instanceof BudgetError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: `Saisie hors des bornes autorisées (${[...new Set(e.issues.map((i) => i.path.join(".")))].join(", ") || "valeur"}).` };
  console.error("Hypothèses budgétaires : écriture en erreur", e);
  return { error: "Enregistrement impossible." };
};

export async function createScenarioAction(slug: string, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  const conv = await getConventions(workspace.id);
  if (!conv) return { error: "Conventions de calcul non renseignées : un administrateur doit choisir la règle de prorata dans Paramètres › Projection." };
  const name = str(f, "name");
  const kind = str(f, "kind") as ScenarioKind;
  const firstMonth = str(f, "firstMonth");
  const lastMonth = str(f, "lastMonth");
  if (!name || name.length > 120) return { error: "Nom du scénario requis (120 caractères au plus)." };
  if (!["budget", "revise", "simulation"].includes(kind)) return { error: "Type de scénario invalide." };
  if (!isMonth(firstMonth) || !isMonth(lastMonth) || lastMonth < firstMonth) return { error: "Premier et dernier mois projetés requis (AAAA-MM), le dernier après le premier." };
  if (monthRange(firstMonth, lastMonth).length > MAX_HORIZON) return { error: `Horizon de ${MAX_HORIZON} mois au plus.` };
  const ctx = await loadPayrollContext(slug);
  if (ctx.source !== "payfit" || !ctx.input || !ctx.read || !ctx.kpi.input) return { error: `Base indisponible : ${ctx.unavailable ?? "journal de paie PayFit et référentiel Collaborateurs requis"}.` };
  const refMonth = addMonths(firstMonth, -1);
  const b = buildBase({ input: ctx.input, kpi: ctx.kpi.input, refMonth, lastMonth, syncId: ctx.read.syncId, readAt: ctx.read.startedAt.toISOString().slice(0, 10) });
  if (b.kind === "nd") return { error: `Base figée impossible : ${b.reason}.` };
  let id: string;
  try {
    id = await createScenario(workspace.id, session.user.id, { name, kind, firstMonth, lastMonth }, b.base, conv.conventions);
    await recordEvent(workspace.id, session.user.id, "budget.scenario_created", { scenarioId: id, refMonth, firstMonth, lastMonth });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  redirect(`${page(slug)}?scenario=${id}`);
}

export async function duplicateScenarioAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  const name = str(f, "name");
  if (!name || name.length > 120) return { error: "Nom de la copie requis (120 caractères au plus)." };
  let id: string | null;
  try {
    id = await duplicateScenario(workspace.id, session.user.id, scenarioId, name);
    if (id) await recordEvent(workspace.id, session.user.id, "budget.scenario_duplicated", { from: scenarioId, scenarioId: id });
  } catch (e) {
    return fail(e);
  }
  if (!id) return { error: "Scénario introuvable." };
  revalidatePath(page(slug));
  redirect(`${page(slug)}?scenario=${id}`);
}

export async function freezeScenarioAction(slug: string, scenarioId: string, _prev: FormState, _f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  try {
    await freezeScenario(workspace.id, session.user.id, scenarioId);
    await recordEvent(workspace.id, session.user.id, "budget.scenario_frozen", { scenarioId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: "Scénario figé : ses hypothèses ne changeront plus." };
}

export async function deleteScenarioAction(slug: string, scenarioId: string, _prev: FormState, _f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  try {
    await deleteScenario(workspace.id, scenarioId);
    await recordEvent(workspace.id, session.user.id, "budget.scenario_deleted", { scenarioId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  redirect(page(slug));
}

// --- Hypothèses : lecture du formulaire par type, puis contrôle par le moteur avant enregistrement (une hypothèse
// qui rendrait le scénario incalculable — conflit, date hors horizon, contrat inconnu — est refusée avec la raison).
const euros = (f: FormData, k: string, what: string) => {
  const c = toCents(str(f, k));
  if (c === null) throw new Error(`${what} : montant en euros requis (ex. 3 200,00).`);
  return c;
};
const pct = (f: FormData, k: string, what: string) => {
  const c = toCents(str(f, k)); // « 2,5 » % → 250 points de base
  if (c === null) throw new Error(`${what} : pourcentage requis (ex. 2,5).`);
  return c;
};
function amountOf(f: FormData, prefix: string, what: string): Amount | null {
  const mode = str(f, `${prefix}Mode`);
  if (mode === "" || mode === "aucun") return null;
  if (mode === "brut") return { mode, brutCents: euros(f, `${prefix}Brut`, what), chargesBps: pct(f, `${prefix}Taux`, `${what} — taux de charges`) };
  if (mode === "charge") return { mode, costCents: euros(f, `${prefix}Cout`, what) };
  throw new Error(`${what} : mode de saisie invalide.`);
}
function scopeOf(v: string): Scope {
  if (v === "global") return { kind: "global" };
  if (v.startsWith("service:") && v.length > 8) return { kind: "service", service: v.slice(8) };
  if (v.startsWith("contrat:") && v.length > 8) return { kind: "contrat", key: v.slice(8) };
  throw new Error("Périmètre requis.");
}

function readHypothesis(kind: HypothesisKind, f: FormData): Hypothesis {
  const id = randomUUID();
  const label = str(f, "label");
  if (!label) throw new Error("Libellé requis.");
  if (kind === "augmentation") {
    const from = str(f, "from");
    if (!isMonth(from)) throw new Error("Mois d'effet requis (AAAA-MM).");
    const rateBps = pct(f, "rate", "Taux d'augmentation");
    if (rateBps === 0) throw new Error("Taux d'augmentation nul.");
    return { id, kind, label, from, rateBps, scope: scopeOf(str(f, "scope")) };
  }
  if (kind === "embauche") {
    const start = str(f, "start");
    const end = str(f, "end");
    if (!isDate(start)) throw new Error("Premier jour payé requis (date).");
    if (end && !isDate(end)) throw new Error("Dernier jour payé invalide.");
    const counted = str(f, "counted");
    if (counted !== "oui" && counted !== "non") throw new Error("Indiquez si le poste est compté dans l'effectif.");
    const quotaBps = pct(f, "quota", "Quotité");
    if (quotaBps <= 0 || quotaBps > 10_000) throw new Error("Quotité entre 0 et 100 %.");
    const svc = str(f, "service");
    return {
      id, kind, label, service: svc || null, start, end: end || null,
      grossFullTimeCents: euros(f, "gross", "Brut mensuel temps plein"), quotaBps, chargesBps: pct(f, "charges", "Taux de charges"),
      counted: counted === "oui", replaces: str(f, "replaces") || null,
    };
  }
  if (kind === "depart") {
    const lastPaidDate = str(f, "lastPaidDate");
    if (!isDate(lastPaidDate)) throw new Error("Dernier jour payé requis (date).");
    const contractKey = str(f, "contractKey");
    if (!contractKey) throw new Error("Contrat requis.");
    return { id, kind, label, contractKey, lastPaidDate, exitCost: amountOf(f, "exit", "Coûts de sortie") };
  }
  if (kind === "ponctuel") {
    const month = str(f, "month");
    if (!isMonth(month)) throw new Error("Mois requis (AAAA-MM).");
    const amount = amountOf(f, "amount", "Montant");
    if (!amount) throw new Error("Montant requis.");
    const svc = str(f, "service");
    return { id, kind, label, month, amount, service: svc || null };
  }
  const contractKey = str(f, "contractKey");
  if (!contractKey) throw new Error("Contrat requis.");
  const salaryCents = euros(f, "salary", "Salaire mensuel de base");
  if (salaryCents < 0) throw new Error("Salaire mensuel de base positif ou nul requis (0 : contrat non payé, ex. congé sans solde).");
  return { id, kind: "base", label, contractKey, salaryCents, chargesBps: pct(f, "charges", "Taux de charges") };
}

export async function addHypothesisAction(slug: string, scenarioId: string, kind: HypothesisKind, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  let h: Hypothesis;
  try {
    h = readHypothesis(kind, f);
  } catch (e) {
    return e instanceof Error && !(e instanceof z.ZodError) ? { error: e.message } : fail(e);
  }
  try {
    await addHypothesis(workspace.id, session.user.id, scenarioId, h);
    await recordEvent(workspace.id, session.user.id, "budget.hypothesis_added", { scenarioId, hypothesisId: h.id, kind: h.kind });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: `Hypothèse « ${h.label} » enregistrée.` };
}

export async function deleteHypothesisAction(slug: string, scenarioId: string, hypothesisId: string, _prev: FormState, _f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId) || !isUuid(hypothesisId)) return { error: "Hypothèse introuvable." };
  try {
    await deleteHypothesis(workspace.id, scenarioId, hypothesisId);
    await recordEvent(workspace.id, session.user.id, "budget.hypothesis_deleted", { scenarioId, hypothesisId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: "Hypothèse supprimée." };
}

// --- Simulateur N+1 : nouveau scénario dont la base est l'état projeté de ce scénario au dernier mois de son horizon.
export async function createChainedScenarioAction(slug: string, parentId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(parentId)) return { error: "Scénario introuvable." };
  const parent = await getScenario(workspace.id, parentId);
  if (!parent) return { error: "Scénario introuvable." };
  const name = str(f, "name");
  const kind = str(f, "kind") as ScenarioKind;
  const lastMonth = str(f, "lastMonth");
  const p = parent.scenario;
  const firstMonth = addMonths(p.lastMonth, 1);
  if (!name || name.length > 120) return { error: "Nom du scénario requis (120 caractères au plus)." };
  if (!["budget", "revise", "simulation"].includes(kind)) return { error: "Type de scénario invalide." };
  if (!isMonth(lastMonth) || lastMonth < firstMonth) return { error: `Dernier mois projeté requis, à partir de ${firstMonth}.` };
  if (monthRange(firstMonth, lastMonth).length > MAX_HORIZON) return { error: `Horizon de ${MAX_HORIZON} mois au plus.` };
  if (p.status !== "fige") return { error: "Figez ce scénario avant d'en dériver le budget suivant : un brouillon peut encore changer, la base dérivée ne serait plus traçable." };
  const proj = project(parent.base, p.firstMonth, p.lastMonth, parent.hypotheses, p.conventions);
  const b = chainBase({ id: p.id, name: p.name, firstMonth: p.firstMonth, lastMonth: p.lastMonth, conventions: p.conventions }, parent.base, parent.hypotheses, proj, new Date().toISOString().slice(0, 10), lastMonth);
  if (b.kind === "nd") return { error: `Base dérivée impossible : ${b.reason}.` };
  let id: string;
  try {
    id = await createScenario(workspace.id, session.user.id, { name, kind, firstMonth, lastMonth }, b.base, p.conventions);
    await recordEvent(workspace.id, session.user.id, "budget.scenario_created", { scenarioId: id, from: p.id, refMonth: p.lastMonth, firstMonth, lastMonth });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  redirect(`${page(slug)}?scenario=${id}`);
}

// --- Budgets saisis.
export async function saveBudgetAction(slug: string, budgetId: string | null, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (budgetId !== null && !isUuid(budgetId)) return { error: "Budget introuvable." };
  const name = str(f, "name");
  const year = str(f, "year");
  if (!name || name.length > 120) return { error: "Nom du budget requis (120 caractères au plus)." };
  if (!/^\d{4}$/.test(year)) return { error: "Année requise (AAAA)." };
  const amounts: Record<string, number | null> = {};
  for (const m of monthRange(`${year}-01`, `${year}-12`)) {
    const raw = str(f, `m${m.slice(5)}`);
    if (raw === "") {
      amounts[m] = null;
      continue;
    }
    const c = toCents(raw);
    if (c === null || c < 0 || c > MAX_MONTH_CENTS) return { error: `${m} : montant en euros positif ou nul (ex. 140 000,00) et inférieur à 1 000 milliards, ou vide pour « non saisi ».` };
    amounts[m] = c;
  }
  try {
    const id = await saveBudget(workspace.id, session.user.id, { id: budgetId ?? undefined, name, year, amounts });
    await recordEvent(workspace.id, session.user.id, "budget.reference_saved", { budgetId: id, year });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: `Budget « ${name} » enregistré.` };
}

export async function deleteBudgetAction(slug: string, budgetId: string, _prev: FormState, _f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(budgetId)) return { error: "Budget introuvable." };
  try {
    await deleteBudget(workspace.id, budgetId);
    await recordEvent(workspace.id, session.user.id, "budget.reference_deleted", { budgetId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: "Budget supprimé." };
}
