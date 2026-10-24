import type { CSSProperties } from "react";
import { WaterfallChart, type WaterfallProps } from "@/components/charts";
import { waterfallAxisBadge } from "@/lib/viz/waterfall-axis";

// Cascade avec son titre et sa mention d'axe : le badge « Axe tronqué à X » est écrit à côté du titre (et non seulement dans la
// note sous le graphique). Sur petit écran, le tracé garde une largeur minimale par barre et défile horizontalement : les
// valeurs et les libellés des barres ne se chevauchent jamais ; le titre et la note restent fixes, hors de la zone qui défile.
const BAR_PX = 58;
const EDGE_PX = 56; // marge d'axe à gauche et à droite
export const waterfallMinWidth = (steps: number) => (steps + 2) * BAR_PX + EDGE_PX;

export type TitledWaterfallProps = Omit<WaterfallProps, "title" | "note"> & { title: string; note?: string };

export function TitledWaterfall({ title, note, ...chart }: TitledWaterfallProps) {
  const badge = waterfallAxisBadge(chart);
  const min = waterfallMinWidth(chart.steps.length);
  const titleId = `${chart.testid}-titre`;
  return (
    <div className="wf-card" role="group" aria-labelledby={titleId} data-testid={`${chart.testid}-card`}>
      <div className="wf-head">
        <h3 className="chart-title" id={titleId}>{title}</h3>
        {badge && <span className="wf-badge" data-testid={`${chart.testid}-axe`} title="L'axe vertical ne part pas de zéro : la hauteur d'une barre n'est pas proportionnelle à sa valeur.">{badge}</span>}
      </div>
      <div className="wf-scroll">
        <div className="wf-inner" style={{ "--wf-min": `${min}px` } as CSSProperties}>
          <WaterfallChart {...chart} />
        </div>
      </div>
      {chart.steps.length + 2 >= 5 && <p className="wf-hint">Si toutes les barres ne tiennent pas à l'écran, faire défiler le graphique horizontalement.</p>}
      {note && <p className="chart-note">{note}</p>}
    </div>
  );
}
