import type { ContractDraft } from "@/lib/rh/referential/types";

// Structure de l'effectif salarié (Masse salariale croisée, chapitre 02) : répartition des contrats comptés dans l'effectif de fin de
// mois selon trois caractéristiques que la source RH fournit à la date de lecture (temps plein ou partiel, modalité du temps de
// travail, cadre dirigeant). Fonction pure, sans base ni horloge. Les valeurs ne sont pas historisées : elles valent à la date de
// lecture de la source, ce que l'écran écrit sous le tableau.
//
// Seuil de confidentialité (paramètre d'espace, sans valeur par défaut) : sans seuil défini, toute la structure est n.d. avec la
// raison. Avec un seuil, un groupe qui compte au moins une personne et moins de personnes que le seuil est masqué ; le total de la
// caractéristique étant affiché, les groupes masqués doivent compter ensemble au moins « seuil » personnes distinctes (masquage
// secondaire, maskRelations), pour qu'aucune valeur masquée ne se retrouve par différence ; un groupe vide ne protège personne. Le
// total n'est jamais modifié. Un groupe vide (aucune personne) reste à 0, sauf quand toute la caractéristique doit être masquée.

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
// laquelle des deux cellules est sous le seuil). Une seule formulation, avec l'unité réellement comptée : « N personnes » quand le
// groupe est compté en personnes distinctes, « N contrats » quand il est compté en contrats.
export type SeuilUnite = "personnes" | "contrats";
const uniteText = (seuil: number, unite: SeuilUnite): string => (unite === "personnes" ? (seuil > 1 ? "personnes" : "personne") : seuil > 1 ? "contrats" : "contrat");
export const confidentialiteReason = (seuil: number, unite: SeuilUnite = "personnes"): string => `non affiché (seuil de confidentialité : ${seuil} ${uniteText(seuil, unite)})`;
// Groupe dont l'effectif n'est pas dénombré : le seuil ne peut pas être vérifié, la valeur n'est pas affichée.
export const SEUIL_NON_VERIFIABLE = "effectif du groupe non dénombré : seuil de confidentialité non vérifiable";

// --- Masquage (fonctions pures partagées par les tableaux de la page croisée) --------------------------------------------------------

// size : personnes (ou contrats) que décrit la cellule, null s'il n'est pas dénombré ; value : valeur affichée (nombre de la cellule),
// null si la cellule est déjà n.d. pour une autre raison. members : les personnes (ou contrats) décrits, sous une forme opaque (jeton,
// numéro d'ordre) ; fournis, ils servent à compter une personne une seule fois d'une cellule masquée à l'autre ; absents, les tailles
// des cellules masquées sont additionnées.
export type MaskInput = { size: number | null; value: number | null; members?: readonly (string | number)[] };
// exempt : valeur publiée ailleurs, jamais masquée, hors des relations. onlyAsTotal : somme publiée (taux tous motifs, par exemple),
// jamais masquée pour elle-même ni retenue comme cellule secondaire ordinaire : elle n'est masquée que comme total d'une relation
// qu'aucune autre cellule ne peut protéger. block : cellules masquées d'un bloc (les valeurs d'une même ligne qui se déduisent l'une de
// l'autre, par exemple nombre, N-1, N et écart) : dès que l'une est masquée, les autres le sont aussi.
export type MaskCell = MaskInput & { exempt?: boolean; onlyAsTotal?: boolean; block?: string | number };
// Relation : cellules dont la somme est publiée. total : indice de la cellule qui porte cette somme quand elle est elle-même affichée et
// masquable (total d'une ligne, taux tous motifs) ; absent, la somme est fixe : total de toute l'entreprise, ou valeur publiée ailleurs
// (tuile Absentéisme, tableau mensuel), jamais masquée ici.
export type MaskRelation = { cells: readonly number[]; total?: number };
// shown : affichée ; masked : de 1 à (seuil − 1) personnes ; secondary : masquée pour protéger une autre cellule ; unverifiable :
// effectif inconnu ; nd : déjà n.d. (raison propre).
export type MaskStatus = "shown" | "masked" | "secondary" | "unverifiable" | "nd";

const protects = (s: MaskStatus): boolean => s === "masked" || s === "secondary" || s === "unverifiable";

// Règle (celle de maskServices, Paie & comptabilité, étendue à plusieurs relations) :
// 1. Masquage principal : une cellule de 1 à (seuil − 1) personnes est masquée ; une cellule dont l'effectif n'est pas dénombré est
//    non vérifiable (masquée aussi). Une cellule vide (0) ne désigne personne : jamais masquée au premier tour.
// 2. Relation dont la somme est publiée (somme fixe, ou total affiché) et qui contient une cellule masquée, non vérifiable ou
//    secondaire : l'ensemble masqué de la relation doit compter AU MOINS « seuil » personnes (ou contrats) distinctes, et au moins
//    deux cellules qui peuvent décrire quelqu'un (sinon une cellule secondaire seule se lirait par différence). Une cellule de taille 0
//    (groupe vide, lignes sans contrat) n'apporte personne : elle ne suffit jamais à en protéger une autre ; une cellule n.d. ou non
//    dénombrée n'apporte aucune personne comptée. Tant que ce n'est pas le cas, la plus petite cellule affichée qui apporte une
//    personne (ou, pour la seconde cellule, qui décrit quelqu'un) est masquée à son tour (à égalité, la première dans l'ordre).
// 3. Impossible (même toutes les cellules de la relation ne suffisent pas) : le total est masqué quand c'est une cellule masquable ;
//    sinon (total de toute l'entreprise, ou publié ailleurs) toute la relation est masquée.
// 4. Relation dont le total est masqué : la somme n'est plus publiée ; il suffit qu'aucune cellule masquée n'y reste seule, le total
//    compris : un total à protéger dont toutes les cellules sont affichées se lirait par leur somme, la plus petite cellule qui décrit
//    quelqu'un (à défaut, la plus petite) est alors masquée.
// La règle est reprise relation par relation jusqu'à ce que plus rien ne change : une cellule masquée dans une relation peut en
// découvrir une autre dans une seconde relation. Les relations sont lues dans l'ordre donné : l'appelant passe d'abord celles dont
// le total est une cellule masquable (lignes), pour qu'elles soient protégées tant que leur total est encore affiché.
export function maskRelations(cells: readonly MaskCell[], relations: readonly MaskRelation[], seuil: number): MaskStatus[] {
  const st: MaskStatus[] = cells.map((c) =>
    c.value === null ? "nd" : c.exempt || c.onlyAsTotal ? "shown" : c.size === null ? "unverifiable" : c.size > 0 && c.size < seuil ? "masked" : "shown",
  );
  // Personnes distinctes décrites par des cellules : réunion des membres fournis, plus la taille de celles qui n'en donnent pas (non
  // dénombrée : 0).
  const covered = (idx: readonly number[]): number => {
    const ids = new Set<string>();
    let others = 0;
    for (const i of idx) {
      const c = cells[i];
      if (c.members) for (const m of c.members) ids.add(String(m));
      else others += c.size ?? 0;
    }
    return ids.size + others;
  };
  const describes = (i: number): boolean => cells[i].size !== 0; // taille inconnue : peut décrire quelqu'un
  const enough = (idx: readonly number[]): boolean => covered(idx) >= seuil && idx.filter(describes).length >= 2;
  const smallest = (cand: readonly number[], ok: (i: number) => boolean): number => {
    let pick = -1;
    for (const i of cand) if (ok(i) && (pick < 0 || (cells[i].value as number) < (cells[pick].value as number))) pick = i;
    return pick;
  };
  // Cellules d'un même bloc : masquées ensemble (la raison reste celle du seuil, principal ou secondaire).
  const mates = new Map<string | number, number[]>();
  cells.forEach((c, i) => {
    if (c.block !== undefined) mates.set(c.block, [...(mates.get(c.block) ?? []), i]);
  });
  const hideBlock = (i: number) => {
    const b = cells[i].block;
    if (b !== undefined) for (const j of mates.get(b)!) if (st[j] === "shown" && !cells[j].exempt) st[j] = "secondary";
  };
  st.forEach((s, i) => {
    if (protects(s)) hideBlock(i);
  });
  const hide = (i: number): boolean => {
    if (i < 0 || st[i] !== "shown" || cells[i].exempt) return false;
    st[i] = "secondary";
    hideBlock(i);
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of relations) {
      const members = r.cells.filter((i) => !cells[i].exempt && !cells[i].onlyAsTotal);
      if (members.length === 0) continue;
      const total = r.total !== undefined && !cells[r.total].exempt ? r.total : null;
      const hidden = members.filter((i) => st[i] !== "shown");
      const shown = members.filter((i) => st[i] === "shown");
      if (total !== null && st[total] !== "shown") {
        // Somme non publiée (total masqué ou n.d.) : seul un total à protéger, dont toutes les cellules sont affichées, se lirait.
        if (protects(st[total]) && hidden.length === 0) {
          const pick = smallest(shown, describes);
          if (hide(pick >= 0 ? pick : smallest(shown, () => true))) changed = true;
        }
        continue;
      }
      if (!hidden.some((i) => protects(st[i])) || enough(hidden)) continue;
      if (!enough([...hidden, ...shown])) {
        // Impossible : le total masquable est masqué ; une somme fixe fait masquer toute la relation.
        if (total !== null) changed = hide(total) || changed;
        else for (const i of shown) changed = hide(i) || changed;
        continue;
      }
      for (;;) {
        const sel = members.filter((i) => st[i] !== "shown");
        if (enough(sel)) break;
        const base = covered(sel);
        const short = base < seuil;
        const pick = smallest(
          members.filter((i) => st[i] === "shown"),
          (i) => (short ? covered([...sel, i]) > base : describes(i)),
        );
        if (!hide(pick)) break; // garde-fou : la faisabilité est vérifiée ci-dessus
        changed = true;
      }
    }
  }
  return st;
}

// Un seul ensemble de groupes dont le total est affiché (totalShown) et fixe (total de l'entreprise) : maskRelations sur cette seule
// relation. Sans total affiché, seul le masquage principal s'applique.
export function maskGroups(groups: readonly MaskInput[], seuil: number, totalShown: boolean): MaskStatus[] {
  return maskRelations(groups, totalShown ? [{ cells: groups.map((_, i) => i) }] : [], seuil);
}

export const isHidden = (s: MaskStatus): boolean => s === "masked" || s === "secondary" || s === "unverifiable";
export const maskReason = (s: MaskStatus, seuil: number, unite: SeuilUnite = "personnes"): string | null =>
  s === "masked" || s === "secondary" ? confidentialiteReason(seuil, unite) : s === "unverifiable" ? SEUIL_NON_VERIFIABLE : null;

// --- Effectif d'un groupe en personnes distinctes -----------------------------------------------------------------------------------

// Personne d'un contrat : la clé de personne du référentiel RH ; à défaut, le contrat lui-même (un contrat sans personne rattachée
// compte pour une personne, jamais fusionné avec un autre).
export const personOf = (c: { contractKey: string; personKey: string | null }): string => c.personKey ?? `contrat:${c.contractKey}`;

// Effectif de chaque groupe en personnes distinctes : une personne qui a plusieurs contrats dans un même groupe y compte une fois.
// C'est cette taille que reçoit le masquage (maskGroups), jamais le nombre de contrats affiché.
export function personsByGroup(members: readonly { group: string; person: string }[]): Record<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const m of members) {
    let s = sets.get(m.group);
    if (!s) sets.set(m.group, (s = new Set()));
    s.add(m.person);
  }
  return Object.fromEntries([...sets].map(([g, s]) => [g, s.size]));
}

// --- Structure ---------------------------------------------------------------------------------------------------------------------

const persons = (list: StructureContract[]): number => new Set(list.map(personOf)).size;

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
      members.map((m) => ({ size: persons(m.list), value: m.list.length, members: [...new Set(m.list.map(personOf))] })),
      seuil,
      true,
    );
    const groups: StructureGroup[] = members.map((m, i) => ({ key: m.key, label: m.label, cell: isHidden(status[i]) ? { kind: "nd", reason: maskReason(status[i], seuil)! } : { kind: "value", contracts: m.list.length } }));
    return { key: d.key, label: d.label, groups, nd: null };
  });
  return { kind: "value", total: all.length, seuil, dimensions };
}
