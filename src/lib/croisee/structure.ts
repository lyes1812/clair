import type { ContractDraft } from "@/lib/rh/referential/types";

// Structure de l'effectif salarié (Masse salariale croisée, chapitre 02) : répartition des contrats comptés dans l'effectif de fin de
// mois selon trois caractéristiques que la source RH fournit à la date de lecture (temps plein ou partiel, modalité du temps de
// travail, cadre dirigeant). Fonction pure, sans base ni horloge. Les valeurs ne sont pas historisées : elles valent à la date de
// lecture de la source, ce que l'écran écrit sous le tableau.
//
// Seuil de confidentialité (paramètre d'espace, sans valeur par défaut) : sans seuil défini, toute la structure est n.d. avec la
// raison. Avec un seuil, un groupe qui compte au moins une personne et moins de personnes que le seuil est masqué ; si c'est le seul
// groupe masqué d'un ensemble dont le total est affiché, le plus petit groupe affiché l'est aussi (masquage secondaire), pour
// qu'aucune valeur masquée ne se retrouve par différence. Le total n'est jamais modifié. Un groupe vide (aucune personne) reste à 0,
// sauf s'il est retenu par le masquage secondaire.

export type StructureField = "isFullTimeAtRead" | "modalityAtRead" | "executive";
export type StructureContract = Pick<ContractDraft, "contractKey" | "personKey" | StructureField> & {
  fieldsNd?: Partial<Record<StructureField, { reason: string }>>; // raison d'une valeur absente, telle que la source l'écrit
};
export type Confidentialite = { kind: "set"; value: number } | { kind: "nd"; reason: string };

export type StructureCell = { kind: "value"; contracts: number } | { kind: "nd"; reason: string };
export type StructureGroup = { key: string; label: string; cell: StructureCell };
export type StructureDimension = { key: "temps" | "modalite" | "statut"; label: string; groups: StructureGroup[]; nd: string | null };
export type Structure = { kind: "value"; total: number; seuil: number; dimensions: StructureDimension[] } | { kind: "nd"; reason: string };

type Value = ContractDraft[StructureField];
type DimensionDef = {
  key: StructureDimension["key"];
  label: string;
  field: StructureField;
  groups: { key: string; label: string; test: (v: Value) => boolean }[];
  missing: string; // libellé du groupe « valeur non renseignée »
};

// Codes de la source : `isFullTime` et `executive` (booléens PayFit), `workingTimeModality` (« forfait_jours » : code PayFit du forfait
// en jours). Aucune autre valeur n'est interprétée : toute autre modalité connue est « autre modalité ».
export const STRUCTURE_DIMENSIONS: DimensionDef[] = [
  {
    key: "temps",
    label: "Temps de travail",
    field: "isFullTimeAtRead",
    groups: [
      { key: "plein", label: "Temps plein", test: (v) => v === true },
      { key: "partiel", label: "Temps partiel", test: (v) => v === false },
    ],
    missing: "Temps de travail non renseigné",
  },
  {
    key: "modalite",
    label: "Modalité du temps de travail",
    field: "modalityAtRead",
    groups: [
      { key: "forfait-jours", label: "Forfait jours", test: (v) => v === "forfait_jours" },
      { key: "autres", label: "Autres modalités du temps de travail", test: (v) => typeof v === "string" && v !== "forfait_jours" },
    ],
    missing: "Modalité non renseignée",
  },
  {
    key: "statut",
    label: "Statut de cadre dirigeant",
    field: "executive",
    groups: [
      { key: "dirigeants", label: "Cadres dirigeants", test: (v) => v === true },
      { key: "autres", label: "Salariés hors cadres dirigeants", test: (v) => v === false },
    ],
    missing: "Statut non renseigné",
  },
];

// Raison d'une cellule masquée : la même pour le masquage principal et le masquage secondaire (deux raisons différentes diraient
// laquelle des deux cellules est sous le seuil).
export const confidentialiteReason = (seuil: number): string => `non affiché (seuil de confidentialité : ${seuil} personne${seuil > 1 ? "s" : ""})`;
// Groupe dont l'effectif n'est pas dénombré : le seuil ne peut pas être vérifié, la valeur n'est pas affichée.
export const SEUIL_NON_VERIFIABLE = "effectif du groupe non dénombré : seuil de confidentialité non vérifiable";

// --- Masquage d'un ensemble de groupes (fonction pure partagée par les tableaux du chapitre) --------------------------------------

// size : personnes (ou contrats) que décrit la cellule, null s'il n'est pas dénombré ; value : valeur affichée (nombre de la cellule),
// null si la cellule est déjà n.d. pour une autre raison.
export type MaskInput = { size: number | null; value: number | null };
// shown : affichée ; masked : de 1 à (seuil − 1) personnes ; secondary : masquée pour protéger une autre cellule ; unverifiable :
// effectif inconnu ; nd : déjà n.d. (raison propre).
export type MaskStatus = "shown" | "masked" | "secondary" | "unverifiable" | "nd";

// Un ensemble de cellules dont le total est affiché (totalShown) : si une seule d'entre elles est masquée (ou non vérifiable), la plus
// petite cellule affichée est masquée aussi (à égalité, la première dans l'ordre) ; sans autre cellule affichée, rien de plus n'est
// masqué (la cellule vaut alors le total, déjà publié). Un groupe vide (0) n'est jamais masqué au premier tour.
export function maskGroups(groups: readonly MaskInput[], seuil: number, totalShown: boolean): MaskStatus[] {
  const out = groups.map((g): MaskStatus => (g.value === null ? "nd" : g.size === null ? "unverifiable" : g.size > 0 && g.size < seuil ? "masked" : "shown"));
  const hidden = out.filter((s) => s !== "shown").length;
  const protect = out.filter((s) => s === "masked" || s === "unverifiable").length;
  if (!totalShown || hidden !== 1 || protect !== 1) return out;
  let pick = -1;
  out.forEach((s, i) => {
    if (s === "shown" && (pick < 0 || (groups[i].value as number) < (groups[pick].value as number))) pick = i;
  });
  if (pick >= 0) out[pick] = "secondary";
  return out;
}

export const isHidden = (s: MaskStatus): boolean => s === "masked" || s === "secondary" || s === "unverifiable";
export const maskReason = (s: MaskStatus, seuil: number): string | null => (s === "masked" || s === "secondary" ? confidentialiteReason(seuil) : s === "unverifiable" ? SEUIL_NON_VERIFIABLE : null);

// --- Structure ---------------------------------------------------------------------------------------------------------------------

// Personnes distinctes d'un groupe : un contrat sans personne rattachée compte pour une personne (jamais fusionné avec un autre).
const persons = (list: StructureContract[]): number => new Set(list.map((c) => c.personKey ?? `contrat:${c.contractKey}`)).size;

export function effectifStructure(p: { contracts: StructureContract[]; confidentialite: Confidentialite }): Structure {
  if (p.confidentialite.kind === "nd") return { kind: "nd", reason: p.confidentialite.reason };
  const seuil = p.confidentialite.value;
  if (!Number.isSafeInteger(seuil) || seuil < 1) return { kind: "nd", reason: "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)" };
  const all = p.contracts;
  const dimensions = STRUCTURE_DIMENSIONS.map((d): StructureDimension => {
    const missing = all.filter((c) => c[d.field] === null);
    // Aucune valeur lue pour toute la population : la caractéristique est n.d. avec la raison de la source (droit non accordé,
    // champ non porté par la DSN…), jamais une répartition « tout non renseigné ».
    if (all.length > 0 && missing.length === all.length) {
      const reason = all.map((c) => c.fieldsNd?.[d.field]?.reason).find((r): r is string => Boolean(r)) ?? "valeur non renseignée dans la source";
      return { key: d.key, label: d.label, groups: [], nd: reason };
    }
    const members = d.groups.map((g) => ({ key: g.key, label: g.label, list: all.filter((c) => g.test(c[d.field])) }));
    if (missing.length > 0) members.push({ key: "non-renseigne", label: d.missing, list: missing });
    // Le total de la caractéristique (tous les contrats comptés) est affiché : masquage secondaire dans la caractéristique.
    const status = maskGroups(
      members.map((m) => ({ size: persons(m.list), value: m.list.length })),
      seuil,
      true,
    );
    const groups: StructureGroup[] = members.map((m, i) => ({ key: m.key, label: m.label, cell: isHidden(status[i]) ? { kind: "nd", reason: maskReason(status[i], seuil)! } : { kind: "value", contracts: m.list.length } }));
    return { key: d.key, label: d.label, groups, nd: null };
  });
  return { kind: "value", total: all.length, seuil, dimensions };
}
