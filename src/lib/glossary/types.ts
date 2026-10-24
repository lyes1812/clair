// Glossaire de Clair : toutes les définitions (indicateurs, méthodes de calcul, conventions de lecture) en un seul endroit.
// Les écrans de chiffres n'expliquent plus : ils renvoient ici par un lien « ? » vers l'ancre #def-<id>.
export const GLOSSARY_FAMILIES = ["Lecture des écrans", "Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Écarts", "Données"] as const;
export type GlossaryFamily = (typeof GLOSSARY_FAMILIES)[number];
export type GlossaryEntry = {
  id: string; // identifiant d'ancre (#def-<id>) : stable, jamais réutilisé pour un autre sens
  term: string;
  family: GlossaryFamily;
  definition: string; // paragraphes séparés par une ligne vide
  formula?: string; // formule de calcul, une ligne
  see?: string[]; // identifiants d'entrées voisines, rappelées sous la définition (« Voir aussi »)
};
