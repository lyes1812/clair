export type MsTab = "synthese" | "fixe-variable" | "paie-compta" | "croisee" | "organisation" | "reel" | "suivi" | "ecart" | "analyse";

// Entrées de la famille Masse salariale : les trois écrans existants, puis les entrées du cahier dans son ordre. Source unique de
// l'onglet, du menu général et de la page Prévu : `soon` dit si l'entrée est encore « Prévu » (visible, sans comportement établi ;
// sa page dit où trouver l'existant et ce qui reste à préciser). « Masse salariale croisée » a sa propre page (croisee/).
export const MS_PREVU = [
  { key: "croisee", label: "Masse salariale croisée", path: "/croisee", soon: false },
  { key: "organisation", label: "MS par organisation", path: "/organisation", soon: true },
  { key: "reel", label: "Écart réel", path: "/reel", soon: true },
  { key: "suivi", label: "Suivi réel / budget", path: "/suivi", soon: true },
] as const;
