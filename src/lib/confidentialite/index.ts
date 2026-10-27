// Règle de confidentialité de l'application (un seul paramètre d'espace, une seule unité : les personnes distinctes, un seul moteur
// de masquage). Les écrans et les exports importent d'ici ; le moteur maskGroups / maskRelations de src/lib/croisee/structure.ts est
// la seule implémentation du masquage (principal et secondaire) : aucune autre n'est recodée. Aucun module de base de données n'est
// chargé à l'import (lecture et écriture en base à la demande, voir setting.ts).
export {
  confidentialiteReason,
  isHidden,
  maskGroups,
  maskReason,
  maskRelations,
  membersByGroup,
  personOf,
  SEUIL_NON_VERIFIABLE,
  type MaskCell,
  type MaskInput,
  type MaskRelation,
  type MaskStatus,
  type SeuilUnite,
} from "@/lib/croisee/structure";
export * from "./persons";
export * from "./setting";

// Identifiant de l'entrée générale du glossaire qui décrit la règle (famille Données ou KPI RH) : réservé, l'entrée est écrite par
// le glossaire ; tant qu'elle n'existe pas, GlossaryLink ne rend aucun lien.
export const CONFIDENTIALITE_TERM = "confidentialite";
