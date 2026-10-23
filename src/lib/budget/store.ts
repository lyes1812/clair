import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { budgetBase, budgetHypothesis, budgetReference, budgetScenario } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { isMonth } from "@/lib/connectors/months";
import { IMPORTABLE_KINDS, planImport } from "./bulk";
import { hireKey, project } from "./engine";
import { CATEGORY_IDS, CURRENCY, type BaseSnapshot, type Conventions, type Hypothesis, type HypothesisKind } from "./types";

// Stockage des scénarios (module 5). Une base figée n'est jamais modifiée (déclencheur SQL, empreinte revérifiée à la
// lecture) ; un scénario figé n'accepte plus d'hypothèse (déclencheur SQL). Chaque écriture vérifie l'espace (RLS) et
// l'état du scénario dans la même transaction que l'écriture, ligne du scénario verrouillée.

// Erreur métier : son message est affiché tel quel à l'utilisateur.
export class BudgetError extends Error {}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().refine(isMonth);
const cents = z.number().int().safe();
const bps = z.number().int().min(-10_000).max(100_000);
const label = z.string().trim().min(1).max(200);
const amount = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("brut"), brutCents: cents, chargesBps: bps.min(0) }),
  z.object({ mode: z.literal("charge"), costCents: cents }),
]);
const scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("service"), service: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("contrat"), key: z.string().min(1).max(300) }),
]);
const id = z.string().uuid();
export const hypothesisSchema: z.ZodType<Hypothesis> = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("augmentation"), label, from: month, rateBps: bps.refine((v) => v !== 0), scope }),
  z.object({
    id, kind: z.literal("embauche"), label, service: z.string().min(1).max(200).nullable(), start: date, end: date.nullable(),
    grossFullTimeCents: cents.positive(), quotaBps: z.number().int().min(1).max(10_000), chargesBps: bps.min(0), counted: z.boolean(), replaces: id.nullable(), category: (z.enum(CATEGORY_IDS as [string, ...string[]]) as unknown as z.ZodType<(typeof CATEGORY_IDS)[number]>).nullable().optional(),
    motif: z.string().trim().max(100).optional(), metier: z.string().trim().max(100).optional(), copiedFrom: z.string().min(1).max(300).nullable().optional(),
  }),
  z.object({ id, kind: z.literal("depart"), label, contractKey: z.string().min(1).max(300), lastPaidDate: date, exitCost: amount.nullable(), motif: z.string().trim().max(100).optional() }),
  z.object({ id, kind: z.literal("absence"), label, contractKey: z.string().min(1).max(300), from: date, to: date, paidBps: z.number().int().min(0).max(10_000) }),
  z.object({ id, kind: z.literal("categorie"), label, contractKey: z.string().min(1).max(300), category: z.enum(CATEGORY_IDS as [string, ...string[]]) as unknown as z.ZodType<(typeof CATEGORY_IDS)[number]> }),
  z.object({ id, kind: z.literal("ponctuel"), label, month, amount, service: z.string().min(1).max(200).nullable(), nonRecurring: z.boolean().optional(), contractKey: z.string().min(1).max(300).nullable().optional() }),
  z.object({ id, kind: z.literal("realise"), label, category: z.string().trim().min(1).max(100), month, costCents: cents.nonnegative() }),
  z.object({ id, kind: z.literal("base"), label, contractKey: z.string().min(1).max(300), salaryCents: cents.nonnegative(), chargesBps: bps.min(0) }),
  z.object({
    id, kind: z.literal("enveloppe"), label, axis: z.enum(["service", "rubrique"]), target: z.string().trim().min(1).max(200),
    monthly: z.record(z.string().refine(isMonth), cents.min(-100_000_000_000_000).max(100_000_000_000_000)), chargesBps: bps.min(0).nullable(), nonRecurring: z.boolean().optional(),
  }),
  z.object({ id, kind: z.literal("constante"), label, unit: z.enum(["eur", "pct", "nombre"]), values: z.record(z.string().refine(isMonth), cents), source: z.string().trim().max(300) }),
  z.object({
    id, kind: z.literal("changement"), label, contractKey: z.string().min(1).max(300), from: month, service: z.string().trim().min(1).max(200).optional(),
    quotaBps: z.number().int().min(1).max(10_000).optional(), poste: z.string().trim().max(200).optional(),
  }),
]) as z.ZodType<Hypothesis>;

export type ScenarioKind = "budget" | "revise" | "simulation";
export const KIND_LABELS: Record<ScenarioKind, string> = { budget: "Budget", revise: "Révisé", simulation: "Simulation" };
export type ScenarioRow = typeof budgetScenario.$inferSelect;
export type ScenarioFull = { scenario: ScenarioRow; base: BaseSnapshot; baseHash: string; hypotheses: Hypothesis[] };

export async function listScenarios(workspaceId: string) {
  return withWorkspace(workspaceId, (tx) =>
    tx
      .select({ scenario: budgetScenario, refMonth: budgetBase.refMonth })
      .from(budgetScenario)
      .innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId))
      .orderBy(desc(budgetScenario.createdAt)),
  );
}

export async function getScenario(workspaceId: string, scenarioId: string): Promise<ScenarioFull | null> {
  if (!z.string().uuid().safeParse(scenarioId).success) return null;
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.select({ scenario: budgetScenario, base: budgetBase }).from(budgetScenario).innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId)).where(eq(budgetScenario.id, scenarioId));
    if (!row) return null;
    if (sha256(canonicalJson(row.base.data)) !== row.base.hash) throw new BudgetError("Base figée altérée : son empreinte ne correspond plus à celle enregistrée à la création.");
    const hyps = await tx.select().from(budgetHypothesis).where(eq(budgetHypothesis.scenarioId, scenarioId)).orderBy(asc(budgetHypothesis.createdAt), asc(budgetHypothesis.id));
    return { scenario: row.scenario, base: row.base.data, baseHash: row.base.hash, hypotheses: hyps.map((h) => hypothesisSchema.parse(h.data)) };
  });
}

export async function createScenario(
  workspaceId: string,
  actor: string,
  input: { name: string; kind: ScenarioKind; firstMonth: string; lastMonth: string },
  base: BaseSnapshot,
  conventions: Conventions,
): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const [b] = await tx.insert(budgetBase).values({ workspaceId, refMonth: base.refMonth, syncId: base.syncId, data: base, hash: sha256(canonicalJson(base)), createdBy: actor }).returning({ id: budgetBase.id });
    const [s] = await tx
      .insert(budgetScenario)
      .values({ workspaceId, baseId: b.id, name: input.name, kind: input.kind, firstMonth: input.firstMonth, lastMonth: input.lastMonth, conventions, status: "brouillon", createdBy: actor })
      .returning({ id: budgetScenario.id });
    return s.id;
  });
}

// Duplication : même base figée, hypothèses recopiées avec de nouveaux identifiants (tous les liens vers des embauches
// ou des départs sont remplacés en conséquence, comme pour une reprise complète).
export async function duplicateScenario(workspaceId: string, actor: string, scenarioId: string, name: string): Promise<string | null> {
  const src = await getScenario(workspaceId, scenarioId);
  if (!src) return null;
  const plan = planImport(src.hypotheses, new Set(IMPORTABLE_KINDS), randomUUID);
  if (plan.dropped.length) throw new BudgetError(`Duplication impossible : ${plan.dropped.map((d) => `« ${d.label} » (${d.reason})`).join(", ")}.`);
  return withWorkspace(workspaceId, async (tx) => {
    const s = src.scenario;
    const [locked] = await tx.select({ id: budgetBase.id }).from(budgetBase).where(eq(budgetBase.id, s.baseId)).for("update");
    if (!locked) throw new BudgetError("Base figée introuvable (scénario supprimé entre-temps).");
    const [row] = await tx
      .insert(budgetScenario)
      .values({ workspaceId, baseId: s.baseId, name, kind: s.kind, firstMonth: s.firstMonth, lastMonth: s.lastMonth, conventions: s.conventions, status: "brouillon", duplicatedFrom: s.id, createdBy: actor })
      .returning({ id: budgetScenario.id });
    if (plan.items.length) await tx.insert(budgetHypothesis).values(plan.items.map((h) => ({ id: h.id, workspaceId, scenarioId: row.id, kind: h.kind, data: h, currency: CURRENCY, createdBy: actor })));
    return row.id;
  });
}

type Tx = Parameters<Parameters<typeof withWorkspace>[1]>[0];
// Verrouille la ligne du scénario, vérifie qu'il est en brouillon et relit sa base et ses hypothèses.
async function lockDraft(tx: Tx, scenarioId: string) {
  const [row] = await tx.select({ scenario: budgetScenario, base: budgetBase.data }).from(budgetScenario).innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId)).where(eq(budgetScenario.id, scenarioId)).for("update", { of: budgetScenario });
  if (!row) throw new BudgetError("Scénario introuvable.");
  if (row.scenario.status !== "brouillon") throw new BudgetError("Scénario figé : ses hypothèses ne peuvent plus changer (dupliquez-le pour une variante).");
  const hyps = await tx.select({ data: budgetHypothesis.data }).from(budgetHypothesis).where(eq(budgetHypothesis.scenarioId, scenarioId)).orderBy(asc(budgetHypothesis.createdAt), asc(budgetHypothesis.id));
  return { scenario: row.scenario, base: row.base, hypotheses: hyps.map((h) => hypothesisSchema.parse(h.data)) };
}

// Ajout contrôlé par le moteur dans la même transaction : une hypothèse qui rendrait le scénario incalculable
// (conflit, date hors horizon, contrat inconnu…) est refusée avec la raison.
export async function addHypothesis(workspaceId: string, actor: string, scenarioId: string, h: Hypothesis): Promise<void> {
  const parsed = hypothesisSchema.parse(h);
  await withWorkspace(workspaceId, async (tx) => {
    const { scenario: s, base, hypotheses } = await lockDraft(tx, scenarioId);
    const check = project(base, s.firstMonth, s.lastMonth, [...hypotheses, parsed], s.conventions);
    if (check.kind === "error") throw new BudgetError(`Hypothèse refusée : ${check.errors.join(" ; ")}.`);
    await tx.insert(budgetHypothesis).values({ id: parsed.id, workspaceId, scenarioId, kind: parsed.kind, data: parsed, currency: CURRENCY, createdBy: actor });
  });
}

export type Skipped = { label: string; reason: string };
export type Screened = { added: Hypothesis[]; skipped: Skipped[]; notes: string[] };

// Contrôle les candidates une à une par le moteur, chacune avec celles déjà retenues : celle qui rendrait le scénario
// incalculable est écartée avec la raison. Le lien « remplace » vers un départ écarté est retiré (lien documentaire).
function screen(s: ScenarioRow, base: BaseSnapshot, existing: Hypothesis[], candidates: Hypothesis[]): Screened {
  const kept = [...existing];
  const out: Screened = { added: [], skipped: [], notes: [] };
  const dropped = new Set<string>();
  for (const c of candidates) {
    let h = c;
    if (h.kind === "embauche" && h.replaces && dropped.has(h.replaces)) {
      h = { ...h, replaces: null };
      out.notes.push(`« ${h.label} » : lien « remplace » retiré, le départ visé n'est pas repris.`);
    }
    const check = project(base, s.firstMonth, s.lastMonth, [...kept, h], s.conventions);
    if (check.kind === "error") {
      out.skipped.push({ label: c.label, reason: check.errors.join(" ; ") });
      dropped.add(c.id);
      continue;
    }
    kept.push(h);
    out.added.push(h);
  }
  return out;
}

const insertAll = (tx: Tx, workspaceId: string, scenarioId: string, actor: string, hs: Hypothesis[]) =>
  hs.length ? tx.insert(budgetHypothesis).values(hs.map((h) => ({ id: h.id, workspaceId, scenarioId, kind: h.kind, data: h, currency: CURRENCY, createdBy: actor }))) : Promise.resolve();

// Saisie groupée. « all » : tout ou rien (une ligne refusée annule le lot et le message les nomme toutes) ;
// « valid » : les lignes acceptées sont enregistrées, les autres sont rendues avec leur raison.
export async function addHypotheses(workspaceId: string, actor: string, scenarioId: string, list: Hypothesis[], mode: "all" | "valid"): Promise<Screened> {
  const parsed = list.map((h) => hypothesisSchema.parse(h));
  return withWorkspace(workspaceId, async (tx) => {
    const { scenario: s, base, hypotheses } = await lockDraft(tx, scenarioId);
    const r = screen(s, base, hypotheses, parsed);
    if (mode === "all" && r.skipped.length) throw new BudgetError(`Rien n'a été enregistré. ${r.skipped.map((x) => `${x.label} : ${x.reason}`).join(" ; ")}.`);
    await insertAll(tx, workspaceId, scenarioId, actor, r.added);
    return r;
  });
}

// Enregistrement d'une grille (taux, enveloppes, constantes) : les lignes modifiées remplacent les anciennes, les lignes
// retirées sont supprimées, le tout dans une transaction contrôlée par le moteur sur l'ensemble final. Rien n'est
// enregistré si le scénario final est incalculable.
export type GridChange = { put: Hypothesis[]; remove: string[] };
export async function applyChanges(workspaceId: string, actor: string, scenarioId: string, change: GridChange): Promise<{ put: number; removed: number }> {
  const put = change.put.map((h) => hypothesisSchema.parse(h));
  return withWorkspace(workspaceId, async (tx) => {
    const { scenario: s, base, hypotheses } = await lockDraft(tx, scenarioId);
    const gone = new Set([...change.remove, ...put.map((h) => h.id)]);
    const known = new Set(hypotheses.map((h) => h.id));
    const missing = change.remove.filter((id) => !known.has(id));
    if (missing.length) throw new BudgetError("Une hypothèse à supprimer n'existe plus : rechargez la page.");
    const final = [...hypotheses.filter((h) => !gone.has(h.id)), ...put];
    const check = project(base, s.firstMonth, s.lastMonth, final, s.conventions);
    if (check.kind === "error") throw new BudgetError(`Saisie refusée : ${check.errors.join(" ; ")}.`);
    const ids = [...gone].filter((id) => known.has(id));
    for (const id of ids) await tx.delete(budgetHypothesis).where(and(eq(budgetHypothesis.scenarioId, scenarioId), eq(budgetHypothesis.id, id)));
    await insertAll(tx, workspaceId, scenarioId, actor, put);
    return { put: put.length, removed: change.remove.length };
  });
}

// Reprise des hypothèses d'un autre scénario de l'espace (base identique ou non) : seules celles qui restent calculables
// contre la base et l'horizon du scénario cible sont reprises ; les autres sont listées avec leur raison.
export async function importHypotheses(workspaceId: string, actor: string, targetId: string, sourceId: string, kinds: ReadonlySet<HypothesisKind>): Promise<Screened> {
  if (targetId === sourceId) throw new BudgetError("Choisissez un autre scénario que celui-ci.");
  if (!z.string().uuid().safeParse(sourceId).success) throw new BudgetError("Scénario source introuvable.");
  if (kinds.size === 0) throw new BudgetError("Choisissez au moins un type d'hypothèse à reprendre.");
  return withWorkspace(workspaceId, async (tx) => {
    const { scenario: s, base, hypotheses } = await lockDraft(tx, targetId);
    const [src] = await tx.select({ id: budgetScenario.id }).from(budgetScenario).where(eq(budgetScenario.id, sourceId));
    if (!src) throw new BudgetError("Scénario source introuvable.");
    const rows = await tx.select({ data: budgetHypothesis.data }).from(budgetHypothesis).where(eq(budgetHypothesis.scenarioId, sourceId)).orderBy(asc(budgetHypothesis.createdAt), asc(budgetHypothesis.id));
    const plan = planImport(rows.map((r) => hypothesisSchema.parse(r.data)), kinds, randomUUID);
    const r = screen(s, base, hypotheses, plan.items);
    await insertAll(tx, workspaceId, targetId, actor, r.added);
    return { ...r, skipped: [...plan.dropped, ...r.skipped] };
  });
}

export async function deleteHypothesis(workspaceId: string, scenarioId: string, hypothesisId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const { hypotheses } = await lockDraft(tx, scenarioId);
    const users = hypotheses.filter((h) => (h.kind === "embauche" && h.replaces === hypothesisId) || (h.kind === "augmentation" && h.scope.kind === "contrat" && h.scope.key === hireKey(hypothesisId)));
    if (users.length) throw new BudgetError(`Hypothèse utilisée par ${users.map((u) => `« ${u.label} »`).join(", ")} : supprimez d'abord ces hypothèses.`);
    const gone = await tx.delete(budgetHypothesis).where(and(eq(budgetHypothesis.scenarioId, scenarioId), eq(budgetHypothesis.id, hypothesisId))).returning({ id: budgetHypothesis.id });
    if (!gone.length) throw new BudgetError("Hypothèse introuvable.");
  });
}

// Gel : définitif ; refusé si la projection est en erreur ou si un mois projeté est n.d.
export async function freezeScenario(workspaceId: string, actor: string, scenarioId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const { scenario: s, base, hypotheses } = await lockDraft(tx, scenarioId);
    const p = project(base, s.firstMonth, s.lastMonth, hypotheses, s.conventions);
    if (p.kind === "error") throw new BudgetError(`Gel refusé : ${p.errors.join(" ; ")}.`);
    const nd = p.months.filter((m) => m.kind === "nd").map((m) => m.month);
    if (nd.length) throw new BudgetError(`Gel refusé : projection n.d. pour ${nd.join(", ")} (bases à compléter dans Hypothèses).`);
    await tx.update(budgetScenario).set({ status: "fige", frozenBy: actor, frozenAt: new Date() }).where(and(eq(budgetScenario.id, scenarioId), eq(budgetScenario.status, "brouillon")));
  });
}

// Suppression d'un brouillon ; sa base figée est supprimée si aucun autre scénario ne la partage.
export async function deleteScenario(workspaceId: string, scenarioId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const { scenario: s } = await lockDraft(tx, scenarioId);
    // Base verrouillée : deux suppressions (ou une suppression et une duplication) qui la partagent s'attendent.
    await tx.select({ id: budgetBase.id }).from(budgetBase).where(eq(budgetBase.id, s.baseId)).for("update");
    await tx.delete(budgetScenario).where(eq(budgetScenario.id, scenarioId));
    const others = await tx.select({ id: budgetScenario.id }).from(budgetScenario).where(eq(budgetScenario.baseId, s.baseId)).limit(1);
    if (!others.length) await tx.delete(budgetBase).where(eq(budgetBase.id, s.baseId));
  });
}

// --- Budgets saisis (référence des comparaisons) : montants chargés globaux par mois d'une année ; un mois vide est n.d.
const year = z.string().regex(/^\d{4}$/);
// Plafond par mois (10^12 €) : la somme de 12 mois reste un entier exact.
export const MAX_MONTH_CENTS = 100_000_000_000_000;
export const amountsSchema = z.record(z.string().refine(isMonth), cents.nonnegative().max(MAX_MONTH_CENTS).nullable());
export type BudgetRow = typeof budgetReference.$inferSelect;

export async function listBudgets(workspaceId: string): Promise<BudgetRow[]> {
  return withWorkspace(workspaceId, (tx) => tx.select().from(budgetReference).orderBy(desc(budgetReference.year), asc(budgetReference.name)));
}

export async function getBudget(workspaceId: string, id: string): Promise<BudgetRow | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await withWorkspace(workspaceId, (tx) => tx.select().from(budgetReference).where(eq(budgetReference.id, id)));
  return row ?? null;
}

function checkAmounts(y: string, amounts: Record<string, number | null>) {
  year.parse(y);
  const parsed = amountsSchema.parse(amounts);
  if (Object.keys(parsed).some((m) => !m.startsWith(`${y}-`))) throw new BudgetError(`Montants hors de l'année ${y}.`);
  return parsed;
}

export async function saveBudget(workspaceId: string, actor: string, input: { id?: string; name: string; year: string; amounts: Record<string, number | null> }): Promise<string> {
  const amounts = checkAmounts(input.year, input.amounts);
  return withWorkspace(workspaceId, async (tx) => {
    if (input.id) {
      const done = await tx.update(budgetReference).set({ name: input.name, year: input.year, amounts, updatedBy: actor, updatedAt: new Date() }).where(eq(budgetReference.id, input.id)).returning({ id: budgetReference.id });
      if (!done.length) throw new BudgetError("Budget introuvable.");
      return done[0].id;
    }
    const [row] = await tx.insert(budgetReference).values({ workspaceId, name: input.name, year: input.year, amounts, currency: CURRENCY, createdBy: actor, updatedBy: actor }).returning({ id: budgetReference.id });
    return row.id;
  });
}

export async function deleteBudget(workspaceId: string, id: string): Promise<void> {
  const gone = await withWorkspace(workspaceId, (tx) => tx.delete(budgetReference).where(eq(budgetReference.id, id)).returning({ id: budgetReference.id }));
  if (!gone.length) throw new BudgetError("Budget introuvable.");
}
