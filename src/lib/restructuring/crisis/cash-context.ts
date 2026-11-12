import { requireWorkspace } from "@/lib/workspace";
import { buildCashPlan, buildScenarioPlan, emptyCashPlan, FLOW_CATEGORIES, MAX_AMOUNT_CENTS, openSupplierItems, type CashPlanSettings, type FlowCategoryId, type OpenItems, type PlanStart } from "./cashplan";
import { readCrisis, type CrisisQuery } from "./context";
import type { DebtNatureId } from "./model";
import { CashPlanError, getCashPlan, readSupplierLines } from "./store";

/** Catégorie de flux proposée pour une nature de dette du lot 1 (simple pré-remplissage, modifiable à la saisie). */
const CATEGORY_OF: Record<DebtNatureId, FlowCategoryId> = { suppliers: "suppliers", staff: "payroll", social: "social", tax: "tax", financial: "loans", banks: "loans", partners: "other", other: "other" };
export type Prefill = { label: string; amountCents: number; category: FlowCategoryId };
export type ToPlan = { label: string; cents: number; category: FlowCategoryId };

function prefillOf(query: CrisisQuery): Prefill | null {
  const label = (query.pl ?? "").trim();
  const cents = Number(query.pm);
  const category = FLOW_CATEGORIES.find((c) => c.id === query.pc)?.id;
  if (!label || label.length > 120 || !category || !Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return { label, amountCents: cents, category };
}

// Trésorerie à 13 semaines : le FEC n'est pas obligatoire. Avec un solde saisi et daté, le plan se calcule sans lui.
export async function loadCashContext(slug: string, query: CrisisQuery) {
  const { workspace } = await requireWorkspace(slug);
  const crisis = await readCrisis(workspace, slug, query);
  const notices = [...crisis.notices];
  let settings: CashPlanSettings = emptyCashPlan();
  let settingsUnreadable = false;
  try { settings = await getCashPlan(workspace.id); }
  catch (error) {
    if (!(error instanceof CashPlanError)) throw error;
    settingsUnreadable = true;
    notices.push("Plan de trésorerie enregistré illisible : rien n’est affiché ni remplacé. Contacte l’administrateur de l’espace.");
  }
  const position = crisis.position;
  const fecStart = position.kind === "value" && position.cash.net.cents !== null && crisis.asOf ? { date: crisis.asOf, cents: position.cash.net.cents } : null;
  const fecReason = position.kind === "nd" ? position.reason : position.cash.net.reason ?? "Solde bancaire non calculable depuis le FEC.";
  const start: PlanStart | null = settingsUnreadable ? null : settings.start ? { ...settings.start, source: "saisi" } : fecStart ? { ...fecStart, source: "fec" } : null;
  const startReason = settingsUnreadable ? "Plan de trésorerie enregistré illisible." : `Aucun solde de départ : ${fecReason} Saisis un solde bancaire daté pour calculer le plan.`;

  // Aide à la saisie : dettes du lot 1 à la date d'arrêté du FEC. Montants proposés, dates jamais déduites.
  const toPlan: ToPlan[] = position.kind === "value"
    ? position.natures.filter((n) => n.id !== "suppliers" && n.debt.cents !== null && n.debt.cents > 0).map((n) => ({ label: n.label, cents: n.debt.cents!, category: CATEGORY_OF[n.id] }))
    : [];
  let openItems: OpenItems = { kind: "nd", reason: "Aucun FEC appliqué : pas de facture à proposer." };
  if (crisis.source && crisis.asOf) openItems = openSupplierItems(await readSupplierLines(workspace.id, crisis.source.syncId, crisis.source.filename, crisis.asOf), crisis.asOf);
  const suppliers = position.kind === "value" ? position.natures.find((n) => n.id === "suppliers") ?? null : null;
  const supplierNet = suppliers && suppliers.debt.cents !== null && suppliers.debitBalances.cents !== null ? suppliers.debt.cents - suppliers.debitBalances.cents : null;

  const plan = buildCashPlan(start, startReason, settings);
  // Scénario explicitement choisi : aucun scénario n'est affiché par défaut.
  const scenario = query.scenario ? settings.scenarios.find((item) => item.id === query.scenario) ?? null : null;
  if (query.scenario && !scenario) notices.push("Scénario demandé indisponible dans cet espace : le plan de base est affiché.");

  const { source: _source, ...shown } = crisis;
  return {
    ...shown, notices, settings, settingsUnreadable, fecStart, fecReason,
    plan, scenarioPlan: scenario ? buildScenarioPlan(plan, settings, scenario) : null,
    toPlan, openItems, supplierNet, prefill: prefillOf(query),
  };
}
export type CashContext = Awaited<ReturnType<typeof loadCashContext>>;
