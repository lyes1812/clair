export type MsTab = "synthese" | "fixe-variable" | "paie-compta" | "croisee" | "organisation" | "reel" | "suivi" | "ecart" | "analyse";

// Entrées de la famille Masse salariale : les trois écrans existants, puis les entrées du cahier dans son ordre. Une entrée
// « Prévu » est visible mais n'a pas encore de comportement établi : sa page dit où trouver l'existant et ce qui reste à préciser.
export const MS_PREVU = [
  { key: "croisee", label: "Masse salariale croisée", path: "/croisee" },
  { key: "organisation", label: "MS par organisation", path: "/organisation" },
  { key: "reel", label: "Écart réel", path: "/reel" },
  { key: "suivi", label: "Suivi réel / budget", path: "/suivi" },
] as const;
