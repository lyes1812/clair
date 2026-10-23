"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildBase } from "@/lib/budget/base";
import { getConventions } from "@/lib/budget/settings";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { z } from "zod";
import { expandHires, IMPORTABLE_KINDS } from "@/lib/budget/bulk";
import { applyChanges, type GridChange } from "@/lib/budget/store";
import { planBases, planConstants, planEnvelopes, planRates, type EnvRow } from "@/lib/budget/grids";
import { addHypotheses, BudgetError, importHypotheses, MAX_MONTH_CENTS, createScenario, deleteBudget, deleteHypothesis, deleteScenario, duplicateScenario, freezeScenario, getScenario, saveBudget, type ScenarioKind } from "@/lib/budget/store";
import { chainBase } from "@/lib/budget/chain";
import { project } from "@/lib/budget/engine";
import { CATEGORY_IDS, type Amount, type CategoryId, type Hypothesis, type HypothesisKind, type Scope } from "@/lib/budget/types";
import { isMonth, monthRange } from "@/lib/connectors/months";
import { addMonths } from "@/lib/dates";
import { recordEvent } from "@/lib/events";
import { toCents } from "@/lib/money";
import { loadPayrollContext } from "@/lib/payroll/context";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string; details?: string[] } | undefined;
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
  const b = buildBase({ input: ctx.input, kpi: ctx.kpi.input, refMonth, lastMonth, syncId: ctx.read.syncId, readAt: ctx.read.startedAt.toISOString().slice(0, 10), conventions: conv.conventions, categoryNatures: (await getCategoryNatures(workspace.id)).natures, categoryOverrides: await getContractCategories(workspace.id) });
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
    const category = str(f, "category");
    if (!CATEGORY_IDS.includes(category as CategoryId)) throw new Error("Catégorie requise (CDI, CDD, apprenti ou stagiaire).");
    const motif = str(f, "motif");
    const metier = str(f, "metier");
    if (motif.length > 100 || metier.length > 100) throw new Error("Motif et métier : 100 caractères au plus.");
    const copiedFrom = str(f, "copiedFrom");
    return {
      id, kind, label, service: svc || null, category: category as CategoryId, start, end: end || null,
      grossFullTimeCents: euros(f, "gross", "Brut mensuel temps plein"), quotaBps, chargesBps: pct(f, "charges", "Taux de charges"),
      counted: counted === "oui", replaces: str(f, "replaces") || null,
      ...(motif ? { motif } : {}), ...(metier ? { metier } : {}), ...(copiedFrom ? { copiedFrom } : {}),
    };
  }
  if (kind === "depart") {
    const lastPaidDate = str(f, "lastPaidDate");
    if (!isDate(lastPaidDate)) throw new Error("Dernier jour payé requis (date).");
    const contractKey = str(f, "contractKey");
    if (!contractKey) throw new Error("Contrat requis.");
    const motif = str(f, "motif");
    if (motif.length > 100) throw new Error("Motif de 100 caractères au plus.");
    return { id, kind, label, contractKey, lastPaidDate, exitCost: amountOf(f, "exit", "Coûts de sortie"), ...(motif ? { motif } : {}) };
  }
  if (kind === "ponctuel") {
    const month = str(f, "month");
    if (!isMonth(month)) throw new Error("Mois requis (AAAA-MM).");
    const amount = amountOf(f, "amount", "Montant");
    if (!amount) throw new Error("Montant requis.");
    const svc = str(f, "service");
    const target = str(f, "contractKey");
    return { id, kind, label, month, amount, service: svc || null, ...(target ? { contractKey: target } : {}), ...(str(f, "nonRecurring") === "oui" ? { nonRecurring: true } : {}) };
  }
  if (kind === "absence") {
    const contractKey = str(f, "contractKey");
    const from = str(f, "from");
    const to = str(f, "to");
    if (!contractKey) throw new Error("Salarié requis.");
    if (!isDate(from) || !isDate(to)) throw new Error("Dates de début et de fin requises.");
    const paidBps = pct(f, "paid", "Part du salaire payée");
    if (paidBps < 0 || paidBps > 10_000) throw new Error("Part payée entre 0 et 100 % (0 : aucun salaire).");
    return { id, kind, label, contractKey, from, to, paidBps };
  }
  if (kind === "categorie") {
    const contractKey = str(f, "contractKey");
    const category = str(f, "category");
    if (!contractKey) throw new Error("Salarié requis.");
    if (!CATEGORY_IDS.includes(category as CategoryId)) throw new Error("Catégorie requise (CDI, CDD, apprenti ou stagiaire).");
    return { id, kind, label, contractKey, category: category as CategoryId };
  }
  if (kind === "changement") {
    const contractKey = str(f, "contractKey");
    const from = str(f, "from");
    const service = str(f, "service");
    const quota = str(f, "quota");
    const poste = str(f, "poste");
    if (!contractKey) throw new Error("Salarié requis.");
    if (!isMonth(from)) throw new Error("Mois d'effet requis (AAAA-MM).");
    if (poste.length > 200) throw new Error("Poste de 200 caractères au plus.");
    let quotaBps: number | undefined;
    if (quota) {
      quotaBps = pct(f, "quota", "Nouvelle quotité");
      if (quotaBps <= 0 || quotaBps > 10_000) throw new Error("Quotité entre 0 et 100 %.");
    }
    return { id, kind, label, contractKey, from, ...(service ? { service } : {}), ...(quotaBps !== undefined ? { quotaBps } : {}), ...(poste ? { poste } : {}) };
  }
  if (kind === "enveloppe" || kind === "constante") throw new Error("Cette saisie se fait dans sa grille.");
  if (kind === "realise") {
    const month = str(f, "month");
    if (!isMonth(month)) throw new Error("Mois réalisé requis (AAAA-MM).");
    const category = str(f, "category");
    if (!category) throw new Error("Catégorie requise.");
    const costCents = euros(f, "cost", "Montant chargé");
    if (costCents < 0) throw new Error("Montant positif ou nul requis.");
    return { id, kind, label, category, month, costCents };
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
  let list: Hypothesis[];
  try {
    const h = readHypothesis(kind, f);
    // Nombre de postes : N embauches indépendantes (les autres types n'ont pas ce champ).
    list = h.kind === "embauche" ? expandHires(h, Number(str(f, "count") || "1"), randomUUID) : [h];
  } catch (e) {
    return e instanceof Error && !(e instanceof z.ZodError) ? { error: e.message } : fail(e);
  }
  try {
    await addHypotheses(workspace.id, session.user.id, scenarioId, list, "all");
    for (const h of list) await recordEvent(workspace.id, session.user.id, "budget.hypothesis_added", { scenarioId, hypothesisId: h.id, kind: h.kind });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: list.length === 1 ? `Hypothèse « ${list[0].label} » enregistrée.` : `${list.length} hypothèses enregistrées : « ${list[0].label} » à « ${list[list.length - 1].label} ».` };
}

// --- Saisie en masse (une ligne par salarié ; les lignes vides sont ignorées). Tout ou rien : une ligne refusée par le
// moteur annule le lot et le message nomme chaque ligne refusée avec sa raison.
async function bulk(slug: string, scenarioId: string, build: (f: FormData, who: (key: string) => string, key: (i: number) => string, n: number) => Hypothesis[], f: FormData, event: "budget.bulk_departures" | "budget.bulk_raises"): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  const full = await getScenario(workspace.id, scenarioId);
  if (!full) return { error: "Scénario introuvable." };
  const labels = new Map(full.base.contracts.map((c) => [c.contractKey, c.label]));
  const n = Number(str(f, "n"));
  if (!Number.isInteger(n) || n < 1 || n > 2000) return { error: "Saisie invalide." };
  let list: Hypothesis[];
  try {
    list = build(f, (k) => labels.get(k) ?? k, (i) => str(f, `key_${i}`), n);
  } catch (e) {
    return e instanceof Error && !(e instanceof z.ZodError) ? { error: e.message } : fail(e);
  }
  if (list.length === 0) return { error: "Aucune ligne renseignée." };
  try {
    await addHypotheses(workspace.id, session.user.id, scenarioId, list, "all");
    await recordEvent(workspace.id, session.user.id, event, { scenarioId, count: list.length });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  return { ok: `${list.length} hypothèse${list.length > 1 ? "s" : ""} enregistrée${list.length > 1 ? "s" : ""}.` };
}

export async function bulkDeparturesAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  return bulk(slug, scenarioId, (f, who, key, n) => {
    const out: Hypothesis[] = [];
    for (let i = 0; i < n; i++) {
      const date = str(f, `date_${i}`);
      const cost = str(f, `cost_${i}`);
      const motif = str(f, `motif_${i}`);
      if (!date && !cost && !motif) continue;
      const contractKey = key(i);
      if (!contractKey) throw new Error(`Ligne ${i + 1} : salarié manquant.`);
      const name = who(contractKey);
      if (!isDate(date)) throw new Error(`${name} : dernier jour payé requis (date).`);
      if (motif.length > 100) throw new Error(`${name} : motif de 100 caractères au plus.`);
      let exitCost: Amount | null = null;
      if (cost) {
        const c = toCents(cost);
        if (c === null || c < 0) throw new Error(`${name} : coûts de sortie en euros chargés, positifs (ex. 12 500,00).`);
        exitCost = { mode: "charge", costCents: c };
      }
      out.push({ id: randomUUID(), kind: "depart", label: `Départ ${name}`, contractKey, lastPaidDate: date, exitCost, ...(motif ? { motif } : {}) });
    }
    return out;
  }, f, "budget.bulk_departures");
}

export async function bulkRaisesAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const from = str(f, "from");
  return bulk(slug, scenarioId, (f, who, key, n) => {
    const out: Hypothesis[] = [];
    for (let i = 0; i < n; i++) {
      const raw = str(f, `rate_${i}`);
      if (!raw) continue;
      if (!isMonth(from)) throw new Error("Mois d'effet requis (AAAA-MM).");
      const contractKey = key(i);
      if (!contractKey) throw new Error(`Ligne ${i + 1} : salarié manquant.`);
      const name = who(contractKey);
      const rateBps = toCents(raw);
      if (rateBps === null) throw new Error(`${name} : taux en pourcentage requis (ex. 2,5).`);
      if (rateBps === 0) throw new Error(`${name} : taux d'augmentation nul.`);
      out.push({ id: randomUUID(), kind: "augmentation", label: `Augmentation ${name}`, from, rateBps, scope: { kind: "contrat", key: contractKey } });
    }
    return out;
  }, f, "budget.bulk_raises");
}

// --- Reprise des hypothèses d'un autre scénario : seules celles qui restent calculables sont reprises ; les autres
// sont listées avec leur raison (date hors de l'horizon, contrat absent de la base…).
export async function importHypothesesAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  const source = str(f, "source");
  const kinds = new Set(f.getAll("kind").map(String).filter((k): k is HypothesisKind => (IMPORTABLE_KINDS as string[]).includes(k)));
  let r: Awaited<ReturnType<typeof importHypotheses>>;
  try {
    r = await importHypotheses(workspace.id, session.user.id, scenarioId, source, kinds);
    await recordEvent(workspace.id, session.user.id, "budget.hypotheses_imported", { scenarioId, from: source, added: r.added.length, skipped: r.skipped.length });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(page(slug));
  const details = [...r.notes, ...r.skipped.map((x) => `Non reprise — ${x.label} : ${x.reason}`)];
  return { ok: `${r.added.length} hypothèse${r.added.length > 1 ? "s" : ""} reprise${r.added.length > 1 ? "s" : ""}, ${r.skipped.length} non reprise${r.skipped.length > 1 ? "s" : ""}.`, ...(details.length ? { details } : {}) };
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

// --- Grilles de saisie mensuelles (taux d'augmentation, enveloppes, constantes, bases individuelles).
async function saveGrid(slug: string, scenarioId: string, f: FormData, plan: (existing: Hypothesis[], months: string[]) => GridChange, what: string): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  const full = await getScenario(workspace.id, scenarioId);
  if (!full) return { error: "Scénario introuvable." };
  let change: GridChange;
  try {
    change = plan(full.hypotheses, monthRange(full.scenario.firstMonth, full.scenario.lastMonth));
  } catch (e) {
    return e instanceof Error && !(e instanceof z.ZodError) ? { error: e.message } : fail(e);
  }
  if (change.put.length === 0 && change.remove.length === 0) return { ok: "Aucune modification à enregistrer." };
  try {
    const r = await applyChanges(workspace.id, session.user.id, scenarioId, change);
    await recordEvent(workspace.id, session.user.id, "budget.grid_saved", { scenarioId, grid: what, put: r.put, removed: r.removed });
    revalidatePath(page(slug));
    return { ok: `${what} — enregistrement : ${r.put} ligne${r.put > 1 ? "s" : ""} écrite${r.put > 1 ? "s" : ""}, ${r.removed} supprimée${r.removed > 1 ? "s" : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveRatesAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  return saveGrid(slug, scenarioId, f, (existing, months) => {
    const cells: { scope: string; month: string; raw: string }[] = [];
    for (const [name, v] of f.entries()) {
      if (!name.startsWith("rate|")) continue;
      const parts = name.split("|");
      const month = parts.at(-1)!;
      if (!months.includes(month)) throw new Error(`Mois ${month} hors de l'horizon du scénario.`);
      cells.push({ scope: parts.slice(1, -1).join("|"), month, raw: String(v) });
    }
    return planRates(existing, cells, randomUUID);
  }, "Taux d'augmentation");
}

const rowCells = (f: FormData, i: number, months: string[]) => Object.fromEntries(months.map((m) => [m, String(f.get(`m_${i}_${m}`) ?? "")]));
const rowCount = (f: FormData) => {
  const n = Number(str(f, "n"));
  if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error("Saisie invalide.");
  return n;
};

export async function saveEnvelopesAction(slug: string, scenarioId: string, axis: "service" | "rubrique", _prev: FormState, f: FormData): Promise<FormState> {
  return saveGrid(slug, scenarioId, f, (existing, months) => {
    const rows: EnvRow[] = Array.from({ length: rowCount(f) }, (_, i) => ({
      id: str(f, `id_${i}`) || null, target: str(f, `target_${i}`), mode: str(f, `mode_${i}`) === "brut" ? "brut" : "charge", taux: str(f, `taux_${i}`),
      nonRecurring: str(f, `nr_${i}`) === "oui", del: str(f, `del_${i}`) === "oui", cells: rowCells(f, i, months),
    }));
    return planEnvelopes(axis, rows, existing, randomUUID);
  }, axis === "service" ? "Enveloppes par service" : "Enveloppes par rubrique");
}

export async function saveConstantsAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  return saveGrid(slug, scenarioId, f, (existing, months) => {
    const rows = Array.from({ length: rowCount(f) }, (_, i) => ({
      id: str(f, `id_${i}`) || null, label: str(f, `label_${i}`), unit: str(f, `unit_${i}`) as "eur" | "pct" | "nombre", source: str(f, `source_${i}`), del: str(f, `del_${i}`) === "oui", cells: rowCells(f, i, months),
    }));
    return planConstants(rows, existing, randomUUID);
  }, "Constantes de référence");
}

export async function saveBasesAction(slug: string, scenarioId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const { workspace } = await requireWorkspace(slug, "editor");
  if (!isUuid(scenarioId)) return { error: "Scénario introuvable." };
  const full = await getScenario(workspace.id, scenarioId);
  if (!full) return { error: "Scénario introuvable." };
  const labels = new Map(full.base.contracts.map((c) => [c.contractKey, c.label]));
  return saveGrid(slug, scenarioId, f, (existing) => {
    const rows = Array.from({ length: rowCount(f) }, (_, i) => {
      const contractKey = str(f, `key_${i}`);
      if (!labels.has(contractKey)) throw new Error(`Ligne ${i + 1} : contrat absent de la base figée.`);
      return { contractKey, label: labels.get(contractKey)!, salary: str(f, `salary_${i}`), charges: str(f, `charges_${i}`) };
    });
    return planBases(rows, existing, randomUUID);
  }, "Bases individuelles");
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
