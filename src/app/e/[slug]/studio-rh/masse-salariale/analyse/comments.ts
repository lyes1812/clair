import type { StepId } from "@/lib/budget/cascade";

// Commentaires du tableau d'ETP de l'analyse des écarts : la version 1 est le départ, la version 2 l'arrivée (comme dans les
// champs de choix des versions et les titres de la page). Aucune lettre A / B : le lecteur n'a pas à deviner la correspondance.
export const STEP_COMMENTS: Record<StepId, string> = {
  "entrees-new": "Salariés présents dans la version 2 et jamais présents dans la version 1.",
  "entrees-report": "Salariés présents dans les deux versions, avec plus de mois de présence dans la version 2 que dans la version 1 : effet en année pleine d'une entrée survenue pendant la période de la version 1.",
  sorties: "Salariés présents dans la version 1 et jamais présents dans la version 2.",
  "sorties-deport": "Salariés présents dans les deux versions, avec moins de mois de présence dans la version 2 que dans la version 1 : sortie survenue pendant la période de la version 2.",
  "etp-change": "Salariés présents dans les deux versions dont la quotité moyenne diffère, pondérée par leur présence dans la version 2.",
};
