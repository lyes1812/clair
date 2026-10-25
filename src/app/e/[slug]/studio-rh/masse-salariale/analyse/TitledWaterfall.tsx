import type { CSSProperties, ReactNode } from "react";
import { Money } from "@/components/Money";
import { niceTicks } from "@/components/charts/scale";
import { WaterfallChart, type WaterfallProps } from "@/components/charts";
import { waterfallAxisBadge } from "@/lib/viz/waterfall-axis";

// Cascade avec son titre et sa mention d'axe : le badge « Axe tronqué à X » est écrit à côté du titre, suivi de son « ? » vers le
// glossaire (rendu par le serveur : ce fichier ne tire pas le glossaire dans le navigateur). Sur petit écran, le tracé garde une
// largeur minimale par barre et défile horizontalement : les valeurs et les libellés des barres ne se chevauchent jamais ; le
// titre reste fixe, hors de la zone qui défile. La phrase d'axe du composant partagé répète le badge : elle reste lue par les
// lecteurs d'écran seulement (voir ecart.css).
const BAR_PX = 58;
const EDGE_PX = 56; // marge d'axe à gauche et à droite
export const waterfallMinWidth = (steps: number) => (steps + 2) * BAR_PX + EDGE_PX;

export type TitledWaterfallProps = Omit<WaterfallProps, "title" | "note"> & { title: string; note?: string; axisHelp?: ReactNode };

export function TitledWaterfall({ title, note, axisHelp, ...chart }: TitledWaterfallProps) {
  const badge = waterfallAxisBadge(chart);
  // La borne reste en centimes exacts ; seul le libellé suit le choix € / k€.
  let monetaryFrom: number | null = null;
  if (badge && chart.unit === "eur") {
    const levels = [chart.start];
    for (const step of chart.steps) levels.push(levels.at(-1)! + step.value);
    const top = Math.max(1, chart.start, chart.end, ...levels);
    const bottom = Math.min(chart.start, chart.end, ...levels);
    const lo = Math.max(0, bottom - (top - bottom) * 0.5);
    monetaryFrom = Math.round(niceTicks(lo, top + (top - lo) * 0.06, 5).min);
  }
  const min = waterfallMinWidth(chart.steps.length);
  const titleId = `${chart.testid}-titre`;
  return (
    <div className="wf-card" role="group" aria-labelledby={titleId} data-testid={`${chart.testid}-card`}>
      <div className="wf-head">
        <h3 className="chart-title" id={titleId}>{title}</h3>
        {badge && <span className="wf-badge" data-testid={`${chart.testid}-axe`}>{monetaryFrom === null ? badge : <>Axe tronqué à <Money cents={monetaryFrom} /></>}</span>}
        {badge && axisHelp}
      </div>
      <div className="wf-scroll">
        <div className="wf-inner" style={{ "--wf-min": `${min}px` } as CSSProperties}>
          <WaterfallChart {...chart} />
        </div>
      </div>
      {note && <p className="chart-note">{note}</p>}
    </div>
  );
}
