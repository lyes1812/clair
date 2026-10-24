import { niceTicks } from "@/components/charts/scale";
import { unitFormat, type UnitName } from "@/components/charts/units";

// Module sans dépendance serveur : utilisé par un composant client (TitledWaterfall), il ne doit rien tirer de src/lib/budget.
// Axe d'une cascade : même règle que le composant WaterfallChart (axe tronqué quand les contributions pèsent moins de 30 % de la
// hauteur des totaux). Le composant n'expose pas l'état de son axe ; on le relit ici, avec les mêmes fonctions de graduation,
// pour écrire le badge « Axe tronqué à X » à côté du titre. Un test compare le badge à la note que le composant écrit lui-même.
export function waterfallAxisBadge(w: { start: number; end: number; steps: { value: number; label?: string }[]; unit: UnitName }): string | null {
  const levels: number[] = [w.start];
  for (const s of w.steps) levels.push(levels.at(-1)! + s.value);
  const top = Math.max(1, w.start, w.end, ...levels);
  const bottom = Math.min(w.start, w.end, ...levels);
  if (!(bottom > 0 && (top - bottom) / top < 0.3)) return null;
  const lo = Math.max(0, bottom - (top - bottom) * 0.5);
  const t = niceTicks(lo, top + (top - lo) * 0.06, 5);
  const from = unitFormat(w.unit).axis(Math.round(t.min));
  return `Axe tronqué à ${from}${w.unit === "etp" ? " ETP" : ""}`;
}
