import { confidentialiteSettingReason, maskReason, maskRelations, personsOfContracts, type ConfidentialiteSetting, type MaskCell, type MaskRelation, type PersonLink } from "@/lib/confidentialite";
import { groupInput } from "@/lib/confidentialite/groups";
import type { ActualEvent, ActualNonRecurring } from "./non-recurring";

// Seuil de confidentialité sur les éléments non récurrents du réel (Masse salariale, bloc « Éléments non récurrents du réel », et la
// feuille « Non récurrents réalisés » de son export) : la même règle et le même moteur que toute répartition de l'application.
// Une nature (licenciements, ruptures conventionnelles, tuilages, autres) est un groupe de personnes distinctes : les contrats déclarés
// sur ses éléments, reliés à leur personne par le référentiel ; un élément sans contrat est un contributeur non relié, qui ne protège
// jamais. Cellules : chaque nature (nombre d'éléments et coût déclaré, masqués ensemble) et chaque mois de chaque nature (export).
// Relations, dans l'ordre : les mois d'une nature somment vers la nature (total masquable) ; les natures somment vers les « Coûts
// identifiés » de la tuile (total publié, jamais masqué). Seuil absent ou illisible : toute nature qui porte un élément est n.d. avec la
// raison du paramètre. Aucune clé de contrat ni aucune note ne sort de ce module : seulement des raisons.

export const NON_RECURRING_KINDS: readonly ActualEvent["kind"][] = ["licenciement", "rupture-conventionnelle", "tuilage", "autre"];

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

// reason : null quand la nature est affichée ; sinon la raison de son n.d. (nombre et montant). months : même chose mois par mois.
export type NatureMask = { reason: string | null; months: Record<string, string | null> };
export type NonRecurringMask = Record<ActualEvent["kind"], NatureMask>;

type Row = ActualNonRecurring["rows"][number];

// Cellule d'un ensemble d'éléments : personnes reliées par leurs contrats, plus un contributeur non relié par élément sans contrat ;
// valeur d'ordre = |somme des montants connus| ; un montant manquant compte comme non nul (l'élément décrit peut-être quelqu'un).
function cellOf(rows: readonly Row[], link: PersonLink, seuil: number): MaskCell {
  if (rows.length === 0) return { size: 0, value: 0, members: [] };
  const g = personsOfContracts(rows.flatMap((r) => r.event.contractKeys), link);
  const unlinked = g.unlinked + rows.filter((r) => r.event.contractKeys.length === 0 && r.amount !== 0).length;
  const value = Math.abs(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  return groupInput({ persons: g.persons, unlinked }, seuil, value, rows.some((r) => r.amount !== 0));
}

export function maskNonRecurring(rows: readonly Row[], months: readonly string[], link: PersonLink, conf: ConfidentialiteSetting): NonRecurringMask {
  const byKind = (k: ActualEvent["kind"]) => rows.filter((r) => r.event.kind === k);
  const settingNd = confidentialiteSettingReason(conf);
  if (conf.kind !== "set" || settingNd !== null) {
    const reason = settingNd ?? "seuil de confidentialité non défini (Paramètres)";
    return Object.fromEntries(
      NON_RECURRING_KINDS.map((k) => {
        const sel = byKind(k);
        return [k, { reason: sel.length ? reason : null, months: Object.fromEntries(months.map((m) => [m, sel.some((r) => r.event.month === m) ? reason : null])) }];
      }),
    ) as NonRecurringMask;
  }
  const seuil = conf.value;
  const cells: MaskCell[] = [];
  const add = (c: MaskCell) => cells.push(c) - 1;
  const idx = NON_RECURRING_KINDS.map((k) => {
    const sel = byKind(k);
    const nature = add(cellOf(sel, link, seuil));
    const perMonth = months.map((m) => add(cellOf(sel.filter((r) => r.event.month === m), link, seuil)));
    return { k, nature, perMonth };
  });
  const relations: MaskRelation[] = [...idx.map((n) => ({ cells: n.perMonth, total: n.nature })), { cells: idx.map((n) => n.nature) }];
  const st = maskRelations(cells, relations, seuil);
  return Object.fromEntries(
    idx.map((n) => [n.k, { reason: maskReason(st[n.nature], seuil), months: Object.fromEntries(months.map((m, j) => [m, maskReason(st[n.perMonth[j]], seuil)])) }]),
  ) as NonRecurringMask;
}
