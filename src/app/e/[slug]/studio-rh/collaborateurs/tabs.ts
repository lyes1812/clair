// Entrées de la famille Collaborateurs, dans l'ordre du cahier ; « Mouvements » (entrées et sorties datées) est conservé.
// Une entrée « Prévu » est visible mais n'a pas encore de comportement établi.
export const TABS = [
  { id: "fiche", label: "Fiche collaborateur", path: "/fiche" },
  { id: "tree", label: "Tree-View", path: "/tree", soon: false },
  { id: "mois", label: "Liste mensuelle des collaborateurs", path: "" },
  { id: "annee", label: "Liste annuelle des collaborateurs", path: "/annee" },
  { id: "rubrique", label: "Collaborateurs par rubrique de paie", path: "/rubrique", soon: false },
  { id: "pointage", label: "Pointage des collaborateurs", path: "/pointage", soon: false },
  { id: "pivot", label: "Pivot · liste mensuelle", path: "/pivot", soon: false },
  { id: "mouvements", label: "Mouvements", path: "/mouvements" },
] as const;
export type TabId = (typeof TABS)[number]["id"];
