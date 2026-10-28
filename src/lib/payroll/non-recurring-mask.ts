import { confidentialiteSettingReason, maskReason, maskRelations, personsOfContracts, type ConfidentialiteSetting, type MaskCell, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { canonicalCompare, windowStatus } from "@/lib/confidentialite/columns";
import { groupInput } from "@/lib/confidentialite/groups";
import type { ActualEvent } from "./non-recurring";

// Seuil de confidentialité sur les éléments non récurrents du réel : la même règle canonique (src/lib/confidentialite/columns.ts) et le
// même moteur que toute répartition de l'application. UNE SEULE fonction pour la Masse salariale (bloc « Éléments non récurrents du
// réel » et feuille « Non récurrents réalisés » de son export) et pour Hypothèses budgétaires › Résultat › Atterrissage (lignes
// « … réalisés », fenêtre janvier → mois de la base figée).
// Une nature (licenciements, ruptures conventionnelles, tuilages, autres) est un groupe de personnes distinctes : les contrats déclarés
// sur ses éléments, reliés à leur personne par le référentiel ; un élément sans contrat d'un montant non nul (ou non saisi) est un
// contributeur non relié, qui ne protège jamais.
// Statut canonique, indépendant de la fenêtre choisie : pour chaque mois, la colonne des natures du mois (nombre d'éléments et coût
// déclaré d'une nature, masqués ensemble), dans l'ordre canonique de leurs libellés, avec pour total publié fixe les « Coûts
// identifiés » du mois (tuile de la fenêtre d'un mois ; leur nombre d'éléments est publié même quand leur montant est n.d.), masquée
// par le moteur unique (maskRelations). Les natures sans élément restent dans la colonne, à l'inverse de la convention de maskColumn
// (comme les motifs d'absence, conges.ts) : les écrans listent les quatre natures (« Aucun élément identifié ») ; quand les natures
// d'un mois ne peuvent pas se protéger entre elles (une seule nature non vide sous le seuil, par exemple), toute la répartition du
// mois est n.d., zéros compris, sinon « Coûts identifiés du mois − 0 » redonnerait la nature masquée. Une nature vide n'apporte
// personne : elle n'est jamais masquée pour en protéger une autre. La cellule ne lit que les éléments du mois eux-mêmes (contrats,
// montant déclaré) : ni la fenêtre, ni la lecture, ni le filtre Service ne la changent.
// Une fenêtre (période, cumul janvier → mois de la base) n'a AUCUNE relation propre : le total d'une
// nature sur la fenêtre (nombre et coût) est n.d. dès qu'un de ses mois est masqué (windowStatus). Seuil absent ou illisible : toute
// nature qui porte un élément de la fenêtre est n.d. avec la raison du paramètre. Aucune clé de contrat ni aucune note ne sort de ce
// module : seulement des raisons.

export const NON_RECURRING_KINDS: readonly ActualEvent["kind"][] = ["licenciement", "rupture-conventionnelle", "tuilage", "autre"];
// Libellés qui fixent l'ordre canonique de la colonne d'un mois (ceux du tableau par nature de la Masse salariale) ; l'ordre est le
// même pour tous les écrans, quel que soit le libellé qu'ils affichent.
const NATURE_LABELS: Record<ActualEvent["kind"], string> = {
  licenciement: "Licenciements",
  "rupture-conventionnelle": "Ruptures conventionnelles",
  tuilage: "Tuilages passés",
  autre: "Autres éléments non récurrents",
};

// Lien contrat → personne pour les déclarations : la clé de contrat du référentiel (celle que retient le formulaire) et l'identifiant du
// contrat dans la source ; un contrat sans personne rattachée n'y figure pas.
export function declaredLink(contracts: readonly { contractKey: string; externalId?: string; personKey: string | null }[]): PersonLink {
  const link = new Map<string, string>();
  for (const c of contracts) {
    if (c.personKey === null) continue;
    link.set(c.contractKey, c.personKey);
    if (c.externalId) link.set(c.externalId, c.personKey);
  }
  return link;
}

// reason : null quand la nature est affichée sur la fenêtre ; sinon la raison de son n.d. (nombre et montant). months : statut de la
// nature dans la colonne de chaque mois de la fenêtre (null : affichée).
export type NatureMask = { reason: string | null; months: Record<string, string | null> };
export type NonRecurringMask = Record<ActualEvent["kind"], NatureMask>;

// Élément déclaré (une ligne de buildActualNonRecurring, ou l'événement seul) : seules ses données propres entrent dans le statut.
type Declared = { event: ActualEvent };

// Montant déclaré, utilisé seulement pour l'ordre du masquage secondaire (jamais publié d'ici) ; non saisi ou illisible : inconnu.
const declaredCents = (e: ActualEvent): number | null => (typeof e.chargedCents === "number" && Number.isFinite(e.chargedCents) ? e.chargedCents : null);

// Cellule d'une nature pour un mois : personnes reliées par les contrats de ses éléments, plus un contributeur non relié par élément
// sans contrat d'un montant non nul ou inconnu ; valeur d'ordre = |somme des montants déclarés connus| ; un montant inconnu compte comme
// non nul (l'élément décrit peut-être quelqu'un). Aucun élément : groupe vide (taille 0, valeur 0), qui ne désigne personne.
function cellOf(items: readonly Declared[], link: PersonLink, seuil: number): MaskCell {
  if (items.length === 0) return { size: 0, value: 0, members: [] };
  const g = personsOfContracts(items.flatMap((r) => r.event.contractKeys), link);
  const unlinked = g.unlinked + items.filter((r) => r.event.contractKeys.length === 0 && declaredCents(r.event) !== 0).length;
  const value = Math.abs(items.reduce((s, r) => s + (declaredCents(r.event) ?? 0), 0));
  return groupInput({ persons: g.persons, unlinked }, seuil, value, items.some((r) => declaredCents(r.event) !== 0));
}

// Colonne canonique d'un mois : statut de chaque nature, calculé sur les seuls éléments de ce mois (ceux des autres mois sont ignorés).
export function natureMonthMask(items: readonly Declared[], month: string, link: PersonLink, seuil: number): Map<ActualEvent["kind"], MaskStatus> {
  const inMonth = items.filter((r) => r.event.month === month);
  // Ordre canonique des libellés : le départage des égalités ne dépend pas de l'ordre d'un écran.
  const order = [...NON_RECURRING_KINDS].sort((a, b) => canonicalCompare(NATURE_LABELS[a], NATURE_LABELS[b]));
  const cells = order.map((k) => cellOf(inMonth.filter((r) => r.event.kind === k), link, seuil));
  const st = maskRelations(cells, [{ cells: cells.map((_, i) => i) }], seuil);
  return new Map(order.map((k, i) => [k, st[i]]));
}

// Statuts d'une fenêtre de mois : colonne de chaque mois, puis fenêtre déduite de ses mois. items : au moins tous les éléments des mois
// de la fenêtre (les autres sont ignorés).
export function maskNonRecurring(items: readonly Declared[], months: readonly string[], link: PersonLink, conf: ConfidentialiteSetting): NonRecurringMask {
  const settingNd = confidentialiteSettingReason(conf);
  if (conf.kind !== "set" || settingNd !== null) {
    const reason = settingNd ?? "seuil de confidentialité non défini (Paramètres)";
    const has = (k: ActualEvent["kind"], m: string) => items.some((r) => r.event.kind === k && r.event.month === m);
    return Object.fromEntries(
      NON_RECURRING_KINDS.map((k) => [k, { reason: months.some((m) => has(k, m)) ? reason : null, months: Object.fromEntries(months.map((m) => [m, has(k, m) ? reason : null])) }]),
    ) as NonRecurringMask;
  }
  const seuil = conf.value;
  const columns = months.map((m) => natureMonthMask(items, m, link, seuil));
  return Object.fromEntries(
    NON_RECURRING_KINDS.map((k) => {
      const st = columns.map((c) => c.get(k)!);
      return [k, { reason: maskReason(windowStatus(st), seuil), months: Object.fromEntries(months.map((m, j) => [m, maskReason(st[j], seuil)])) }];
    }),
  ) as NonRecurringMask;
}
