import "@/styles/salary-analysis.css";
import { FamilyTabs } from "@/components/FamilyTabs";
import { KpiHeader } from "./components";
import { loadSalaryAnalysis } from "./salary-analysis-data";
import { SalaryAnalysisView } from "./SalaryAnalysisView";
import { KPI_VUES } from "./tabs";

export async function SalaryAnalysisPage({ slug, search }: { slug: string; search: Record<string, string | string[] | undefined> }) {
  const data = await loadSalaryAnalysis(slug, search);
  return <KpiHeader ctx={data.ctx} closedMonth={null} bare>
    <FamilyTabs label="Entrées KPI RH" testid="kpi-tabs" current="salaires" tabs={KPI_VUES.map((v) => ({ key: v.key, label: v.label, href: v.key === "suivi" ? "?" : `?vue=${v.key}`, soon: "soon" in v ? v.soon : false }))} />
    <SalaryAnalysisView slug={slug} {...data} />
  </KpiHeader>;
}
