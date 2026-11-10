export type MsTab = "synthese" | "fixe-variable" | "paie-compta" | "croisee" | "organisation" | "reel" | "suivi" | "ecart" | "analyse";

// Entrées partagées par les onglets et le menu général. Les vues livrées gardent
// explicitement soon:false pour le contrat commun de navigation.
export const MS_PREVU = [
  { key: "croisee", label: "Masse salariale croisée", path: "/croisee", soon: false },
  { key: "organisation", label: "MS par organisation", path: "/organisation", soon: false },
  { key: "reel", label: "Écart réel", path: "/reel", soon: false },
  { key: "suivi", label: "Suivi réel / budget", path: "/suivi", soon: false },
] as const;
