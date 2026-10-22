import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { budgetBase, budgetHypothesis, budgetScenario } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { isMonth } from "@/lib/connectors/months";
import { hireKey } from "./engine";
import { CURRENCY, type BaseSnapshot, type Conventions, type Hypothesis } from "./types";

// Stockage des scénarios (module 5). Une base figée n'est jamais modifiée ; un scénario figé n'accepte plus
// d'hypothèse ; chaque écriture vérifie l'espace (RLS) et l'état du scénario.

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
    grossFullTimeCents: cents.positive(), quotaBps: z.number().int().min(1).max(10_000), chargesBps: bps.min(0), counted: z.boolean(), replaces: id.nullable(),
  }),
  z.object({ id, kind: z.literal("depart"), label, contractKey: z.string().min(1).max(300), lastPaidDate: date, exitCost: amount.nullable() }),
  z.object({ id, kind: z.literal("ponctuel"), label, month, amount, service: z.string().min(1).max(200).nullable() }),
  z.object({ id, kind: z.literal("base"), label, contractKey: z.string().min(1).max(300), salaryCents: cents.positive(), chargesBps: bps.min(0) }),
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

// Duplication : même base figée, hypothèses recopiées avec de nouveaux identifiants (liens remplacés en conséquence).
export async function duplicateScenario(workspaceId: string, actor: string, scenarioId: string, name: string): Promise<string | null> {
  const src = await getScenario(workspaceId, scenarioId);
  if (!src) return null;
  const ids = new Map(src.hypotheses.map((h) => [h.id, randomUUID()]));
  const remap = (h: Hypothesis): Hypothesis => {
    const n = { ...h, id: ids.get(h.id)! } as Hypothesis;
    if (n.kind === "embauche" && n.replaces) n.replaces = ids.get(n.replaces) ?? null;
    if (n.kind === "augmentation" && n.scope.kind === "contrat" && n.scope.key.startsWith("embauche:")) n.scope = { kind: "contrat", key: hireKey(ids.get(n.scope.key.slice(9)) ?? n.scope.key.slice(9)) };
    return n;
  };
  return withWorkspace(workspaceId, async (tx) => {
    const s = src.scenario;
    const [row] = await tx
      .insert(budgetScenario)
      .values({ workspaceId, baseId: s.baseId, name, kind: s.kind, firstMonth: s.firstMonth, lastMonth: s.lastMonth, conventions: s.conventions, status: "brouillon", duplicatedFrom: s.id, createdBy: actor })
      .returning({ id: budgetScenario.id });
    const copies = src.hypotheses.map(remap);
    if (copies.length) await tx.insert(budgetHypothesis).values(copies.map((h) => ({ id: h.id, workspaceId, scenarioId: row.id, kind: h.kind, data: h, currency: CURRENCY, createdBy: actor })));
    return row.id;
  });
}

async function draft(workspaceId: string, scenarioId: string) {
  const [s] = await withWorkspace(workspaceId, (tx) => tx.select({ status: budgetScenario.status }).from(budgetScenario).where(eq(budgetScenario.id, scenarioId)));
  if (!s) throw new Error("Scénario introuvable.");
  if (s.status !== "brouillon") throw new Error("Scénario figé : ses hypothèses ne peuvent plus changer (dupliquez-le pour une variante).");
}

export async function addHypothesis(workspaceId: string, actor: string, scenarioId: string, h: Hypothesis): Promise<void> {
  await draft(workspaceId, scenarioId);
  const parsed = hypothesisSchema.parse(h);
  await withWorkspace(workspaceId, (tx) => tx.insert(budgetHypothesis).values({ id: parsed.id, workspaceId, scenarioId, kind: parsed.kind, data: parsed, currency: CURRENCY, createdBy: actor }));
}

export async function deleteHypothesis(workspaceId: string, scenarioId: string, hypothesisId: string): Promise<void> {
  await draft(workspaceId, scenarioId);
  const full = await getScenario(workspaceId, scenarioId);
  const users = full?.hypotheses.filter((h) => (h.kind === "embauche" && h.replaces === hypothesisId) || (h.kind === "augmentation" && h.scope.kind === "contrat" && h.scope.key === hireKey(hypothesisId))) ?? [];
  if (users.length) throw new Error(`Hypothèse utilisée par ${users.map((u) => `« ${u.label} »`).join(", ")} : supprimez d'abord ces hypothèses.`);
  await withWorkspace(workspaceId, (tx) => tx.delete(budgetHypothesis).where(and(eq(budgetHypothesis.scenarioId, scenarioId), eq(budgetHypothesis.id, hypothesisId))));
}

export async function freezeScenario(workspaceId: string, actor: string, scenarioId: string): Promise<void> {
  await draft(workspaceId, scenarioId);
  await withWorkspace(workspaceId, (tx) => tx.update(budgetScenario).set({ status: "fige", frozenBy: actor, frozenAt: new Date() }).where(eq(budgetScenario.id, scenarioId)));
}

export async function deleteScenario(workspaceId: string, scenarioId: string): Promise<void> {
  await draft(workspaceId, scenarioId);
  await withWorkspace(workspaceId, (tx) => tx.delete(budgetScenario).where(eq(budgetScenario.id, scenarioId)));
}
