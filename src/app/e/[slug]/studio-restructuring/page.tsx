import { loadRestructuringContext } from "@/lib/restructuring/context";
import { RestructuringView } from "./RestructuringView";

export const dynamic = "force-dynamic";
export default async function RestructuringPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return <RestructuringView {...await loadRestructuringContext(slug, query)} />;
}
