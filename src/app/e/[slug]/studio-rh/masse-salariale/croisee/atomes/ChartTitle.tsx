import type { ReactNode } from "react";
import type { ChartSeries } from "@/components/charts";
import { hasData, seriesReasons } from "@/lib/viz/masse";
import { NdState } from "../../components";

// Titre visible d'un graphique dans son bloc. Le bloc porte déjà son titre (h3 et « ? » du glossaire) : un graphique dont le titre est
// le même ne le répète pas en texte visible (il garde son libellé accessible, l'aria-label du SVG). Un titre différent reste affiché en
// sous-titre : c'est le cas d'un bloc à plusieurs graphiques, qui doivent se distinguer. La comparaison ignore la casse, les espaces
// (insécables compris) et la ponctuation finale, jamais un mot.
const norm = (s: string) => s.replace(/[\s  ]+/g, " ").trim().replace(/\s*[:.?!…]+$/u, "").toLowerCase();
export const sameTitle = (a: string, b: string): boolean => norm(a) === norm(b);
export const chartTitle = (block: string | undefined, chart: string): string | undefined => (block !== undefined && sameTitle(block, chart) ? undefined : chart);

// Graphique sans aucune valeur connue : non tracé, la raison écrite (un axe à zéro ferait croire à des valeurs nulles), comme
// ChartGuard de la Masse salariale ; `heading` est le titre visible du graphique (celui de chartTitle), donc absent quand le bloc
// porte déjà ce titre. Au-delà de trois raisons, le nombre des autres est dit.
export function ChartNd({ testid, heading, series, children }: { testid: string; heading?: string; series: ChartSeries[]; children: ReactNode }) {
  if (hasData(series)) return <>{children}</>;
  const reasons = seriesReasons(series);
  const shown = reasons.slice(0, 3);
  return <NdState testid={`${testid}-vide`} heading={heading} reason="Aucune valeur connue sur la période : graphique non tracé." reasons={shown} more={reasons.length - shown.length} />;
}
