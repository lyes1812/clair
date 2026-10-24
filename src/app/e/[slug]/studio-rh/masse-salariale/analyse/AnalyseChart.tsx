"use client";
import { useId, useState, type ReactNode } from "react";
import type { WaterfallData } from "@/lib/viz/ecart";
import { TitledWaterfall } from "./TitledWaterfall";

// Cascade de l'analyse des écarts : une rubrique à la fois (ETP ou masse salariale chargée), choisie sans recharger la page ;
// le choix est reporté dans l'adresse. Chaque cascade est la lecture graphique du tableau exact placé dessous ; sa lecture est au
// glossaire. « cost » : cascade en euros (hausse de coût rouge, baisse verte) ; « neutral » : cascade d'ETP (bleu et gris).
export type AnalyseItem = { label: string; title: string; ariaLabel: string; startLabel: string; endLabel: string; note?: string; trend?: "cost" | "neutral"; data: WaterfallData };
export type AnalyseChartProps = { initial: string; options: { key: string; label: string }[]; items: Record<string, AnalyseItem>; axisHelp?: ReactNode };

export function AnalyseChart(p: AnalyseChartProps) {
  const uid = useId();
  const [rub, setRub] = useState(p.items[p.initial] ? p.initial : (p.options[0]?.key ?? ""));
  const item = p.items[rub];

  const pick = (key: string) => {
    setRub(key);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("rub", key);
      window.history.replaceState(null, "", u);
    } catch {
      // Adresse non modifiable (aperçu, navigateur restreint) : le choix reste valable à l'écran.
    }
  };

  return (
    <div className="ecart-chart" data-testid="analyse-graph-zone">
      {p.options.length > 1 && (
        <div className="ecart-chart-controls">
          <div className="field-row">
            <label htmlFor={`${uid}-rub`}>Rubrique analysée</label>
            <select className="select" id={`${uid}-rub`} value={rub} onChange={(e) => pick(e.target.value)} data-testid="analyse-rubrique">
              {p.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}
      {!item ? null : item.data.kind === "nd" ? (
        <div className="ecart-nd-block" data-testid="analyse-graph-nd">
          <p className="nd">n.d. — {item.data.reason}</p>
        </div>
      ) : (
        <TitledWaterfall
          testid={`wf-${rub}`}
          label={item.ariaLabel}
          title={item.title}
          startLabel={item.startLabel}
          endLabel={item.endLabel}
          start={item.data.start}
          end={item.data.end}
          steps={item.data.steps}
          unit={item.data.unit}
          note={item.note}
          trend={item.trend}
          axisHelp={p.axisHelp}
        />
      )}
    </div>
  );
}
