import { LineChart } from "@/components/charts";
import { formatMonth } from "@/lib/dates";
import type { SuiviModel } from "@/lib/viz/suivi-budget";

const shortMonth = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

/** Seules les séries agrégées et les raisons publiques des mois n.d. passent au graphique client. */
export function SuiviChart({ model }: { model: Pick<SuiviModel, "chart" | "rows" | "reference" | "state"> }) {
  const rows = new Map(model.rows.map((row) => [row.month, row]));
  const reasons = (field: "actual" | "reference") => model.chart.months.map((month) => {
    const value = rows.get(month)?.[field];
    return value?.kind === "nd" ? value.reason : null;
  });
  return (
    <LineChart
      testid="suivi-chart"
      label={`Masse salariale chargée mensuelle ${model.state.annee}, réel et référence, en euros`}
      title={`Masse chargée · ${model.state.annee} (€)`}
      categories={model.chart.months.map((month) => shortMonth.format(new Date(`${month}-01T00:00:00Z`)))}
      categoryTitles={model.chart.months.map(formatMonth)}
      series={[
        { key: "actual", name: "Réel PayFit", values: model.chart.actual, reasons: reasons("actual"), color: "var(--chart-1)" },
        { key: "reference", name: model.reference?.label ?? "Référence non choisie", values: model.chart.reference, reasons: reasons("reference"), dashed: true, color: "var(--chart-5)" },
      ]}
      unit="eur"
      zero
      height={270}
    />
  );
}
