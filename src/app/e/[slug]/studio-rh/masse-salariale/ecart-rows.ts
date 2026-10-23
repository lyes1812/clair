import { aggregate, diff, ROW_LABELS, ROW_UNIT, type Agg, type Diff, type RowKey } from "@/lib/budget/versions";
import type { Loaded } from "./ecart-data";
import type { Unit } from "./EcartParts";

// Lignes du tableau d'écart : une valeur par version, puis l'écart de chaque version à la précédente.
export type EcartRow = { key: RowKey; label: string; unit: Unit; indent: number; aggs: Agg[]; gaps: Diff[] };
const SYNTHESE: [RowKey, number][] = [["etp", 0], ["headcount", 0], ["entrees", 0], ["sorties", 0], ["masse", 0], ["brut", 1], ["charges", 1]];
const DETAIL: [RowKey, number][] = [["etp", 0], ["headcount", 0], ["entrees", 0], ["sorties", 0], ["masse", 0], ["brut", 1], ["remun", 2], ["primes", 2], ["indemnites", 2], ["autres", 2], ["charges", 1], ["nonventile", 1]];

export function ecartRows(loaded: Loaded, vue: "synthese" | "detail"): EcartRow[] {
  return (vue === "detail" ? DETAIL : SYNTHESE).map(([key, indent]) => {
    const aggs = loaded.versions.map((v) => aggregate(v, loaded.months(v.year), key));
    return { key, label: ROW_LABELS[key], unit: ROW_UNIT[key], indent, aggs, gaps: aggs.slice(1).map((a, i) => diff(aggs[i], a)) };
  });
}
