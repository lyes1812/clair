import "@/styles/masse-salariale.css";
import "@/styles/charts.css";
import "@/styles/payroll-exploration.css";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { loadPayrollContext } from "@/lib/payroll/context";
import { loadPayrollExplorationContext } from "@/lib/payroll/exploration-context";
import { buildActualGap, buildPayrollOrganisation, payrollExplorationAxes } from "@/lib/payroll/exploration";
import { payrollExplorationQuery } from "@/lib/payroll/exploration-query";
import { PayrollExplorationView } from "../ExplorationView";
import { MsHeader, MsTabs } from "../EcartParts";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;

export default async function PayrollExplorationPage({ params, searchParams }: {
  params: Promise<{ slug: string; vue: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug, vue } = await params;
  if (vue !== "organisation" && vue !== "reel") notFound();
  await requireWorkspace(slug);
  const ctx = await loadPayrollContext(slug);
  const input = await loadPayrollExplorationContext(ctx);
  const axes = payrollExplorationAxes(input);
  const q = payrollExplorationQuery(await searchParams, input.journal?.months ?? [], input.read?.closedMonths ?? [], axes);
  const options = { years: q.years, referenceYears: q.referenceYears, axes: axes.map((value) => ({ value, label: value })) };
  const organisation = vue === "organisation" ? buildPayrollOrganisation(input, { months: q.monthsA, axis: q.axis }) : undefined;
  const actualGap = vue === "reel" ? buildActualGap(input, { monthsA: q.monthsA, monthsB: q.monthsB }) : undefined;
  if (organisation) organisation.notices = [...new Set([...organisation.notices, ...q.notices.filter((n) => !n.startsWith("Année de référence"))])];
  if (actualGap) actualGap.notices = [...new Set([...actualGap.notices, ...q.notices.filter((n) => !n.startsWith("Axe analytique"))])];
  return <>
    <MsHeader title={vue === "organisation" ? "Masse salariale par organisation" : "Écart réel"} />
    <MsTabs slug={slug} current={vue} />
    <PayrollExplorationView slug={slug} mode={vue} filters={q.filters} options={options} organisation={organisation} actualGap={actualGap} />
  </>;
}
