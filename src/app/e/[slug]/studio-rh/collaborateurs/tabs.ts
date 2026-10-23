// Entrées de la famille Collaborateurs, dans l'ordre du cahier ; « Mouvements » (entrées et sorties datées) est conservé.
// Une entrée « Prévu » est visible mais n'a pas encore de comportement établi.
export const TABS = [
  { id: "fiche", label: "Fiche collaborateur", path: "/fiche" },
  { id: "tree", label: "Tree-View", path: "/tree", soon: true },
  { id: "mois", label: "Liste mensuelle des collaborateurs", path: "" },
  { id: "annee", label: "Liste annuelle des collaborateurs", path: "/annee" },
  { id: "rubrique", label: "Collaborateurs par rubrique de paie", path: "/rubrique", soon: true },
  { id: "pointage", label: "Pointage des collaborateurs", path: "/pointage", soon: true },
  { id: "pivot", label: "Pivot · liste mensuelle", path: "/pivot", soon: true },
  { id: "mouvements", label: "Mouvements", path: "/mouvements" },
] as const;
export type TabId = (typeof TABS)[number]["id"];
