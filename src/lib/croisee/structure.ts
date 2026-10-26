import type { ContractDraft } from "@/lib/rh/referential/types";

// Structure de l'effectif salarié (Masse salariale croisée, chapitre 02) : répartition des contrats comptés dans l'effectif de fin de
// mois selon trois caractéristiques que la source RH fournit à la date de lecture (temps plein ou partiel, modalité du temps de
// travail, cadre dirigeant). Fonction pure, sans base ni horloge. Les valeurs ne sont pas historisées : elles valent à la date de
// lecture de la source, ce que l'écran écrit sous le tableau.
//
// Seuil de confidentialité (paramètre d'espace, sans valeur par défaut) : sans seuil défini, toute la structure est n.d. avec la
// raison ; avec un seuil, un groupe qui compte au moins une personne et moins de personnes que le seuil est n.d. ; le total n'est
// jamais modifié. Un groupe vide (aucune personne) reste affiché à 0 : il ne désigne personne.

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

export const confidentialiteReason = (seuil: number): string => `groupe de moins de ${seuil} personne${seuil > 1 ? "s" : ""} : non affiché (seuil de confidentialité)`;

// Personnes distinctes d'un groupe : un contrat sans personne rattachée compte pour une personne (jamais fusionné avec un autre).
const persons = (list: StructureContract[]): number => new Set(list.map((c) => c.personKey ?? `contrat:${c.contractKey}`)).size;

export function effectifStructure(p: { contracts: StructureContract[]; confidentialite: Confidentialite }): Structure {
  if (p.confidentialite.kind === "nd") return { kind: "nd", reason: p.confidentialite.reason };
  const seuil = p.confidentialite.value;
  if (!Number.isSafeInteger(seuil) || seuil < 1) return { kind: "nd", reason: "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)" };
  const all = p.contracts;
  const cell = (members: StructureContract[]): StructureCell => {
    const n = persons(members);
    return n > 0 && n < seuil ? { kind: "nd", reason: confidentialiteReason(seuil) } : { kind: "value", contracts: members.length };
  };
  const dimensions = STRUCTURE_DIMENSIONS.map((d): StructureDimension => {
    const missing = all.filter((c) => c[d.field] === null);
    // Aucune valeur lue pour toute la population : la caractéristique est n.d. avec la raison de la source (droit non accordé,
    // champ non porté par la DSN…), jamais une répartition « tout non renseigné ».
    if (all.length > 0 && missing.length === all.length) {
      const reason = all.map((c) => c.fieldsNd?.[d.field]?.reason).find((r): r is string => Boolean(r)) ?? "valeur non renseignée dans la source";
      return { key: d.key, label: d.label, groups: [], nd: reason };
    }
    const groups: StructureGroup[] = d.groups.map((g) => ({ key: g.key, label: g.label, cell: cell(all.filter((c) => g.test(c[d.field]))) }));
    if (missing.length > 0) groups.push({ key: "non-renseigne", label: d.missing, cell: cell(missing) });
    return { key: d.key, label: d.label, groups, nd: null };
  });
  return { kind: "value", total: all.length, seuil, dimensions };
}
