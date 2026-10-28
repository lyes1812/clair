import { loadRestructuringContext } from "@/lib/restructuring/context";
import { RestructuringView } from "./RestructuringView";
import { saveExitAction } from "./actions";
import { canonicalJson, sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export default async function RestructuringPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const context = await loadRestructuringContext(slug, query);
  const versions = Object.fromEntries(context.proposal?.hypotheses.filter((h) => h.kind === "depart").map((h) => [h.id, sha256(canonicalJson(h))]) ?? []);
  const saveExit = context.canEdit && context.proposal?.status === "brouillon" ? saveExitAction.bind(null, slug, context.proposal.id, versions) : undefined;
  return <RestructuringView {...context} saveExit={saveExit} />;
}
