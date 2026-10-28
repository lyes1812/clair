export const RESTRUCTURING_VIEWS = [
  { id: "overview", label: "Vue d’ensemble" },
  { id: "measures", label: "Mesures" },
  { id: "monthly", label: "Impacts mensuels" },
] as const;
export type RestructuringViewId = typeof RESTRUCTURING_VIEWS[number]["id"];
