import { loadRestructuringContext } from "@/lib/restructuring/context";
import { loadCrisisContext } from "@/lib/restructuring/crisis/context";
import { RestructuringView } from "./RestructuringView";
import { loadCashContext } from "@/lib/restructuring/crisis/cash-context";
import { CrisisView } from "./CrisisView";
import { CashPlanView } from "./CashPlanView";
import { addCashFlowAction, deleteCashFlowAction, saveCashStartAction, saveCrisisRanksAction, saveExitAction } from "./actions";
import { canonicalJson, sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export default async function RestructuringPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  // Cap 13 lit le FEC, pas les scénarios RH : son contexte est chargé seul.
  if (query.vue === "crisis") {
    const crisis = await loadCrisisContext(slug, query);
    return <CrisisView {...crisis} saveRanks={crisis.canEdit ? saveCrisisRanksAction.bind(null, slug) : undefined} />;
  }
  if (query.vue === "cash") {
    const cash = await loadCashContext(slug, query);
    const editable = cash.canEdit && !cash.settingsUnreadable;
    return <CashPlanView {...cash} addFlow={editable ? addCashFlowAction.bind(null, slug) : undefined} saveStart={editable ? saveCashStartAction.bind(null, slug) : undefined}
      deleteFlow={editable ? Object.fromEntries(cash.settings.flows.map((flow) => [flow.id, deleteCashFlowAction.bind(null, slug, flow.id)])) : undefined} />;
  }
  const context = await loadRestructuringContext(slug, query);
  const versions = Object.fromEntries(context.proposal?.hypotheses.filter((h) => h.kind === "depart").map((h) => [h.id, sha256(canonicalJson(h))]) ?? []);
  const saveExit = context.canEdit && context.proposal?.status === "brouillon" ? saveExitAction.bind(null, slug, context.proposal.id, versions) : undefined;
  return <RestructuringView {...context} saveExit={saveExit} />;
}
