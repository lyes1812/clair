import { previousWindow } from "./period";
import { ratio, sub, times } from "./fraction";
import { kpiNd, type Compared, type Delta, type DeltaUnit, type Kind, type KpiInput, type KpiNd, type Ratio, type Window } from "./types";

// N-1 : même définition, même référentiel, période décalée de 12 mois ; l'écart n'existe qu'entre deux valeurs exactes.
export type Valued = { kind: Kind } | { kind: "nd"; nd: KpiNd };

export function delta<T extends Valued>(current: T, previous: T, valueOf: (t: Extract<T, { kind: Kind }>) => Ratio, unit: DeltaUnit, previousLabel: string): Delta {
  if (current.kind === "nd") return { kind: "nd", nd: kpiNd("current-not-exact", `valeur n.d. — ${(current as { nd: KpiNd }).nd.reason}`) };
  if (current.kind === "lower_bound") return { kind: "nd", nd: kpiNd("current-not-exact", "valeur en borne basse : écart non calculable") };
  if (previous.kind === "nd") return { kind: "nd", nd: kpiNd("previous-nd", `N-1 (${previousLabel}) : ${(previous as { nd: KpiNd }).nd.reason}`) };
  if (previous.kind === "lower_bound") return { kind: "nd", nd: kpiNd("previous-lower-bound", `N-1 (${previousLabel}) en borne basse (« ≥ ») : écart non calculable`) };
  const d = sub(valueOf(current as Extract<T, { kind: Kind }>), valueOf(previous as Extract<T, { kind: Kind }>));
  return { kind: "exact", unit, value: unit === "points" ? times(d, 100) : d };
}

export function compareWindows<T extends Valued>(input: KpiInput, w: Window, fn: (i: KpiInput, w: Window) => T, valueOf: (t: Extract<T, { kind: Kind }>) => Ratio, unit: DeltaUnit): Compared<T> {
  const current = fn(input, w);
  const pw = previousWindow(w);
  const previous = fn(input, pw);
  return { window: w, current, previousWindow: pw, previous, delta: delta(current, previous, valueOf, unit, pw.label) };
}

export const etpValue = (e: { etp4: number }): Ratio => ratio(e.etp4, 10000);
// ETP proratisé : la valeur est déjà une fraction exacte (quotité × jours ÷ jours du mois).
export const etpProratedValue = (e: { ratio: Ratio }): Ratio => e.ratio;
