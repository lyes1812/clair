import "@/styles/masse-salariale.css";
import "@/styles/charts.css";
import "@/styles/suivi-budget.css";
import { requireWorkspace } from "@/lib/workspace";
import { MsHeader, MsTabs } from "../EcartParts";
import { loadSuivi } from "./suivi-data";
import { SuiviView } from "./SuiviView";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;

export default async function SuiviPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  await requireWorkspace(slug);
  const model = await loadSuivi(slug, sp);
  return <>
    <MsHeader title="Masse salariale" />
    <MsTabs slug={slug} current="suivi" />
    <SuiviView model={model} />
  </>;
}
