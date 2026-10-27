import { confidentialiteReason, confidentialiteSettingReason, isHidden, maskRelations, maskReason, maskSize, personsOfContracts, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskCell, type MaskRelation, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { evolution, servicesOf, windowPayroll, withService, type Evolution, type JournalInput, type MonthPayroll, type PayrollWindow } from "./engine";

// Lignes par service de la masse salariale : une seule règle pour l'écran Masse salariale (tableau « Services » et son export
// Excel, via syntheseOf) et pour la Masse salariale croisée (chapitres 01 et 05). Toujours calculées sur tout le journal : la somme
// des services, non ventilé compris, égale le total. Pour chaque service présent sur la période ou sur N-1 : masse de la période,
// masse de N-1 et évolution de la masse ; classement par coût de la période décroissant (un service n.d. après les services
// de coût positif ou nul), « Non ventilé » toujours en dernier. Aucun autre calcul que ceux du moteur de paie.

export type ServiceRow = { value: string | null; cur: PayrollWindow; prev: PayrollWindow; evo: Evolution };

// Libellé d'un service : son code analytique, ou « Non ventilé » pour les lignes sans code de l'axe.
export const serviceLabel = (v: string | null): string => (v === null ? "Non ventilé" : v);

// Sans axe de service dans le journal (aucun code analytique retenu) : aucune ligne.
export function serviceRows(journal: JournalInput, months: string[], prevMonths: string[]): ServiceRow[] {
  if (!journal.serviceAxis) return [];
  const rows = servicesOf(journal, [...months, ...prevMonths]).map((v): ServiceRow => {
    const si = withService(journal, v);
    const c = windowPayroll(si, months);
    const p = windowPayroll(si, prevMonths);
    return { value: v, cur: c, prev: p, evo: evolution(c, p, (w) => w.masse) };
  });
  const masseOf = (w: PayrollWindow) => (w.kind === "value" ? w.masse : -1);
  return rows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : masseOf(b.cur) - masseOf(a.cur)));
}

// --- Seuil de confidentialité sur le journal de paie ------------------------------------------------------------------------------
// Unité : les personnes distinctes du référentiel Collaborateurs (src/lib/confidentialite), reliées contrat par contrat (identifiant
// de contrat des lignes du journal → clé de personne). Une valeur (montant d'un service, d'un libellé, d'une provision) décrit les
// contrats qui portent ses lignes. Un contrat non relié ne protège jamais ; un montant non nul sans aucun contrat rattaché (lignes
// sans contrat) n'est pas dénombré : non vérifiable, quel que soit le seuil. Le moteur maskRelations est la seule implémentation.

// Cellule de masquage d'un montant : taille en personnes reliées (null : non dénombré), valeur (null : déjà n.d. pour une autre
// raison), personnes (comptées une fois d'une cellule masquée à l'autre).
export function journalCell(contracts: Iterable<string>, value: number | null, link: PersonLink, seuil: number): MaskCell {
  const g = personsOfContracts(contracts, link);
  let size = maskSize(g, seuil);
  if (size === 0 && value !== null && value !== 0) size = null;
  return { size, value, members: g.persons };
}

// Raison d'un masquage (principal et secondaire : la même) ou d'un effectif non dénombré ; null si la cellule est affichée.
export const hiddenReason = (s: MaskStatus, seuil: number): string | null => (isHidden(s) ? maskReason(s, seuil) : null);

// Mois et fenêtre après seuil : la forme du moteur (MonthPayroll, PayrollWindow) ou un n.d. qui porte seulement sa raison. Une
// valeur du moteur est assignable à la forme masquée : les écrans et les exports typés sur celle-ci lisent les deux.
export type MaskedMonth = Extract<MonthPayroll, { kind: "value" }> | { month: string; kind: "nd"; open: boolean; nd: { reason: string } };
export type MaskedWindow = (Omit<Extract<PayrollWindow, { kind: "value" }>, "months"> & { months: MaskedMonth[] }) | { kind: "nd"; nd: { reason: string }; months: MaskedMonth[] };
export type MaskedEvolution = Extract<Evolution, { kind: "value" }> | { kind: "nd"; nd: { reason: string } };
export type MaskedServiceRow = {
  value: string | null;
  cur: MaskedWindow;
  prev: MaskedWindow;
  evo: MaskedEvolution;
  hidden: boolean; // une valeur au moins masquée par le seuil (période, N-1, un mois de l'une ou de l'autre) : sous le filtre, le service est n.d.
  reason: string | null; // raison du masquage le plus grave (seuil, sinon non dénombré) ; null si rien n'est masqué
};

const ndMonth = (m: MonthPayroll, reason: string): MaskedMonth => ({ month: m.month, kind: "nd", open: m.open, nd: { reason } });
const contractsOf = (w: PayrollWindow): string[] => (w.kind === "value" ? w.months.flatMap((m) => (m.kind === "value" ? m.paidContracts : [])) : []);

// Lignes par service après application du seuil de confidentialité, dans l'ordre reçu. Chaque cellule affichée est un groupe de
// personnes : la masse du service sur la période (contrats rémunérés sur la période), sur N-1, et chaque mois de la période et de
// N-1 (contrats rémunérés dans le mois). Totaux publiés, qui portent le masquage secondaire : chaque colonne (période, N-1, chaque
// mois) somme sur tous les services vers le total de l'entreprise, jamais masqué ; les mois d'un service somment vers sa période,
// cellule masquable. Une période ou un mois déjà n.d. (mois hors journal) garde sa raison. L'évolution d'une valeur masquée est
// masquée. Seuil absent ou illisible : toutes les valeurs sont n.d. avec la raison du paramètre, les totaux restent affichés.
export function maskServiceRows(rows: ServiceRow[], link: PersonLink, conf: ConfidentialiteSetting): MaskedServiceRow[] {
  if (conf.kind !== "set") {
    const reason = confidentialiteSettingReason(conf) ?? SEUIL_NON_VERIFIABLE;
    const nd = (w: PayrollWindow): MaskedWindow => ({ kind: "nd", nd: { reason }, months: w.months.map((m) => ndMonth(m, reason)) });
    return rows.map((r) => ({ value: r.value, cur: nd(r.cur), prev: nd(r.prev), evo: { kind: "nd", nd: { reason } }, hidden: true, reason }));
  }
  const seuil = conf.value;
  const cells: MaskCell[] = [];
  const relations: MaskRelation[] = [];
  const add = (c: MaskCell) => cells.push(c) - 1;
  const winCell = (w: PayrollWindow) => add(journalCell(contractsOf(w), w.kind === "value" ? w.masse : null, link, seuil));
  const monthCells = (w: PayrollWindow) => w.months.map((m) => add(journalCell(m.kind === "value" ? m.paidContracts : [], m.kind === "value" ? m.masse : null, link, seuil)));
  const idx = rows.map((r) => {
    const cur = winCell(r.cur);
    const prev = winCell(r.prev);
    const curMonths = monthCells(r.cur);
    const prevMonths = monthCells(r.prev);
    return { cur, prev, curMonths, prevMonths };
  });
  // D'abord les relations dont le total est une cellule masquable (les mois d'un service → sa période), puis les colonnes à total fixe.
  for (const i of idx) {
    relations.push({ cells: i.curMonths, total: i.cur });
    relations.push({ cells: i.prevMonths, total: i.prev });
  }
  relations.push({ cells: idx.map((i) => i.cur) });
  relations.push({ cells: idx.map((i) => i.prev) });
  const monthCount = Math.max(0, ...idx.map((i) => i.curMonths.length));
  const prevCount = Math.max(0, ...idx.map((i) => i.prevMonths.length));
  for (let j = 0; j < monthCount; j++) relations.push({ cells: idx.flatMap((i) => (i.curMonths[j] === undefined ? [] : [i.curMonths[j]])) });
  for (let j = 0; j < prevCount; j++) relations.push({ cells: idx.flatMap((i) => (i.prevMonths[j] === undefined ? [] : [i.prevMonths[j]])) });
  const st = maskRelations(cells, relations, seuil);

  const window = (w: PayrollWindow, cell: number, monthIdx: number[]): MaskedWindow => {
    const months = w.months.map((m, j) => {
      const r = hiddenReason(st[monthIdx[j]], seuil);
      return r === null ? m : ndMonth(m, r);
    });
    const r = hiddenReason(st[cell], seuil);
    if (r !== null) return { kind: "nd", nd: { reason: r }, months };
    return w.kind === "value" ? { ...w, months } : { kind: "nd", nd: { reason: w.nd.reason }, months };
  };
  return rows.map((r, k) => {
    const i = idx[k];
    const all = [i.cur, i.prev, ...i.curMonths, ...i.prevMonths].map((c) => st[c]);
    const hidden = all.some(isHidden);
    const reason = all.some((s) => s === "masked" || s === "secondary") ? confidentialiteReason(seuil) : all.some((s) => s === "unverifiable") ? SEUIL_NON_VERIFIABLE : null;
    const cur = window(r.cur, i.cur, i.curMonths);
    const prev = window(r.prev, i.prev, i.prevMonths);
    const evoNd = hiddenReason(st[i.cur], seuil) ?? hiddenReason(st[i.prev], seuil);
    const evo: MaskedEvolution = evoNd !== null ? { kind: "nd", nd: { reason: evoNd } } : r.evo;
    return { value: r.value, cur, prev, evo, hidden, reason };
  });
}

// Sous le filtre Service, tous les chiffres de l'écran décrivent le service retenu : il est n.d. dans son ensemble dès que sa ligne
// est masquée sans filtre (période, N-1 ou un mois, masquage secondaire compris : sinon le filtre révélerait par différence ce que
// le tableau cache), ou que le seuil n'est pas défini (lien vers les Paramètres). null : affiché. Un service absent des lignes
// (aucune ligne sur la période ni sur N-1) ne décrit personne.
export type ServiceGuard = { cause: "parametre" | "seuil"; reason: string };
export function serviceGuard(rows: MaskedServiceRow[], value: string | null, conf: ConfidentialiteSetting): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null) return { cause: "parametre", reason: settingNd };
  const row = rows.find((r) => r.value === value);
  if (!row || !row.hidden || row.reason === null) return null;
  return { cause: "seuil", reason: `${row.reason} — service retenu par le filtre` };
}
