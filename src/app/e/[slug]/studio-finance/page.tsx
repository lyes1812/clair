import { loadFinanceContext } from "@/lib/finance/context";
import { savePlanAction, duplicatePlanAction, saveMappingsAction } from "./actions";
import { FinanceView } from "./FinanceView";

export const dynamic = "force-dynamic";
export default async function FinancePage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const query = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
  const context = await loadFinanceContext(slug, query);
  return <FinanceView {...context} savePlan={savePlanAction.bind(null, slug)} duplicatePlan={duplicatePlanAction.bind(null, slug)} saveMappings={saveMappingsAction.bind(null, slug)} />;
}
