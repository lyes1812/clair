import { workspaceDisplayName } from "@/lib/workspace";
import "@/styles/reporting-social.css";
import "@/styles/publisher.css";
import { FamilyTabs } from "@/components/FamilyTabs";
import { loadPayrollContext } from "@/lib/payroll/context";
import { publisherReportOf, publisherSelection } from "@/lib/reporting/publisher";
import type { SocialSearch } from "@/lib/reporting/social";
import { KpiHeader } from "./components";
import { PublisherView } from "./PublisherView";
import { kpiSuiviOf } from "./suivi-data";
import { KPI_VUES } from "./tabs";

export async function PublisherPage({ slug, search }: { slug: string; search: SocialSearch }) {
  const ctx = await loadPayrollContext(slug);
  // Même période que KPI RH, et périmètre global explicite. Aucun filtre individuel
  // libre ni choix d'un autre écran ne peut modifier en silence ce rapport interne.
  const period = kpiSuiviOf(ctx.kpi, { vue: "suivi", mode: search.mode, fin: search.fin, annee: search.annee });
  const report = publisherReportOf(ctx, period, publisherSelection(search));
  return <div className="rs-page publisher-page" data-testid="publisher-page">
    <KpiHeader ctx={ctx.kpi} closedMonth={period.kind === "ready" ? period.last : null} bare>
      <FamilyTabs label="Entrées KPI RH" testid="kpi-tabs" current="publisher" tabs={KPI_VUES.map((v) => ({ key: v.key, label: v.label, href: v.key === "suivi" ? "?" : `?vue=${v.key}`, soon: "soon" in v ? v.soon : false }))} />
      <PublisherView report={report} slug={slug} workspaceName={workspaceDisplayName(ctx.kpi.collab.workspace)} />
    </KpiHeader>
  </div>;
}
