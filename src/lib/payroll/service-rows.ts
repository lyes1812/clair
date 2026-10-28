import { confidentialiteReason, confidentialiteSettingReason, isHidden, maskRelations, maskReason, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskCell, type MaskRelation, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { groupCell, masseWindow } from "@/lib/confidentialite/groups";
import { evolution, servicesOf, windowPayroll, withService, type Evolution, type JournalInput, type MonthPayroll, type PayrollWindow } from "./engine";

// Lignes par service de la masse salariale : une seule règle pour l'écran Masse salariale (tableau « Services » et son export
// Excel, via syntheseOf) et pour la Masse salariale croisée (chapitres 01 et 05). Toujours calculées sur tout le journal : la somme
// des services, non ventilé compris, égale le total. Pour chaque service présent sur la période ou sur N-1 : masse de la période,
// masse de N-1 et évolution de la masse ; classement par coût de la période décroissant (un service n.d. après les services
// de coût positif ou nul), « Non ventilé » toujours en dernier. Aucun autre calcul que ceux du moteur de paie.

// input : le journal restreint au service (withService), celui que le seuil de confidentialité lit pour former ses groupes.
export type ServiceRow = { value: string | null; cur: PayrollWindow; prev: PayrollWindow; evo: Evolution; input: JournalInput };

// Libellé d'un service : son code analytique, ou « Non ventilé » pour les lignes sans code de l'axe.
export const serviceLabel = (v: string | null): string => (v === null ? "Non ventilé" : v);

// Sans axe de service dans le journal (aucun code analytique retenu) : aucune ligne.
export function serviceRows(journal: JournalInput, months: string[], prevMonths: string[]): ServiceRow[] {
  if (!journal.serviceAxis) return [];
  const rows = servicesOf(journal, [...months, ...prevMonths]).map((v): ServiceRow => {
    const si = withService(journal, v);
    const c = windowPayroll(si, months);
    const p = windowPayroll(si, prevMonths);
    return { value: v, cur: c, prev: p, evo: evolution(c, p, (w) => w.masse), input: si };
  });
  const masseOf = (w: PayrollWindow) => (w.kind === "value" ? w.masse : -1);
  return rows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : masseOf(b.cur) - masseOf(a.cur)));
}

// --- Seuil de confidentialité sur le journal de paie ------------------------------------------------------------------------------
// Unité : les personnes distinctes du référentiel Collaborateurs (src/lib/confidentialite), reliées contrat par contrat (identifiant
// de contrat des lignes du journal → clé de personne). Les groupes sont ceux de src/lib/confidentialite/groups.ts (une seule
// convention : contrats qui portent une ligne de masse, brut ou cotisations) ; le moteur maskRelations est la seule implémentation.

// Raison d'un masquage (principal et secondaire : la même) ou d'un effectif non dénombré ; null si la cellule est affichée.
export const hiddenReason = (s: MaskStatus, seuil: number): string | null => (isHidden(s) ? maskReason(s, seuil) : null);

// Statuts du seuil pour des fenêtres de mois par service, par le moteur unique. Cellules : la masse de chaque fenêtre de chaque
// service, et la masse de chacun de ses mois (groupes de masseWindow : contrats qui portent une ligne de masse, reliés à leur
// personne ; valeur n.d. quand la fenêtre ou le mois l'est). Relations, dans l'ordre : les mois d'une fenêtre d'un service somment
// vers sa fenêtre (total masquable) ; puis, pour chaque fenêtre, la colonne des services (total de l'entreprise, jamais masqué) ;
// puis, pour chaque rang de mois de chaque fenêtre, la colonne des services (total du mois, jamais masqué). Les fenêtres sont
// indépendantes entre elles : les masquer ensemble ou une à une donne le même résultat.
export type WindowStatus = { window: MaskStatus; months: MaskStatus[] };
export function maskServiceWindows(services: readonly { input: JournalInput; windows: readonly PayrollWindow[] }[], link: PersonLink, seuil: number): WindowStatus[][] {
  const cells: MaskCell[] = [];
  const relations: MaskRelation[] = [];
  const add = (c: MaskCell) => cells.push(c) - 1;
  const idx = services.map((s) =>
    s.windows.map((w) => {
      const g = masseWindow(s.input, w.months.map((m) => m.month), link);
      const cell = add(groupCell(g.window, seuil, w.kind === "value" ? w.masse : null));
      const months = w.months.map((m, j) => add(groupCell(g.months[j], seuil, m.kind === "value" ? m.masse : null)));
      return { cell, months };
    }),
  );
  for (const s of idx) for (const w of s) relations.push({ cells: w.months, total: w.cell });
  const windowCount = Math.max(0, ...idx.map((s) => s.length));
  for (let j = 0; j < windowCount; j++) {
    const column = idx.flatMap((s) => (s[j] === undefined ? [] : [s[j]]));
    relations.push({ cells: column.map((w) => w.cell) });
    const monthCount = Math.max(0, ...column.map((w) => w.months.length));
    for (let k = 0; k < monthCount; k++) relations.push({ cells: column.flatMap((w) => (w.months[k] === undefined ? [] : [w.months[k]])) });
  }
  const st = maskRelations(cells, relations, seuil);
  return idx.map((s) => s.map((w) => ({ window: st[w.cell], months: w.months.map((c) => st[c]) })));
}

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

// Fenêtre après seuil : chaque mois masqué porte sa raison ; la fenêtre masquée est n.d. avec la seule raison du seuil ; une fenêtre
// ou un mois déjà n.d. (mois hors journal) garde sa raison.
function maskedWindow(w: PayrollWindow, st: WindowStatus, seuil: number): MaskedWindow {
  const months = w.months.map((m, j) => {
    const r = hiddenReason(st.months[j], seuil);
    return r === null ? m : ndMonth(m, r);
  });
  const r = hiddenReason(st.window, seuil);
  if (r !== null) return { kind: "nd", nd: { reason: r }, months };
  return w.kind === "value" ? { ...w, months } : { kind: "nd", nd: { reason: w.nd.reason }, months };
}

// Lignes par service après application du seuil de confidentialité, dans l'ordre reçu (maskServiceWindows sur deux fenêtres par
// service : la période et N-1). L'évolution d'une valeur masquée est masquée. Seuil absent ou illisible : toutes les valeurs sont
// n.d. avec la raison du paramètre, les totaux restent affichés.
export function maskServiceRows(rows: ServiceRow[], link: PersonLink, conf: ConfidentialiteSetting): MaskedServiceRow[] {
  if (conf.kind !== "set") {
    const reason = confidentialiteSettingReason(conf) ?? SEUIL_NON_VERIFIABLE;
    const nd = (w: PayrollWindow): MaskedWindow => ({ kind: "nd", nd: { reason }, months: w.months.map((m) => ndMonth(m, reason)) });
    return rows.map((r) => ({ value: r.value, cur: nd(r.cur), prev: nd(r.prev), evo: { kind: "nd", nd: { reason } }, hidden: true, reason }));
  }
  const seuil = conf.value;
  const st = maskServiceWindows(rows.map((r) => ({ input: r.input, windows: [r.cur, r.prev] })), link, seuil);
  return rows.map((r, k) => {
    const [c, p] = st[k];
    const all = [c.window, p.window, ...c.months, ...p.months];
    const hidden = all.some(isHidden);
    const reason = all.some((s) => s === "masked" || s === "secondary") ? confidentialiteReason(seuil) : all.some((s) => s === "unverifiable") ? SEUIL_NON_VERIFIABLE : null;
    const cur = maskedWindow(r.cur, c, seuil);
    const prev = maskedWindow(r.prev, p, seuil);
    const evoNd = hiddenReason(c.window, seuil) ?? hiddenReason(p.window, seuil);
    const evo: MaskedEvolution = evoNd !== null ? { kind: "nd", nd: { reason: evoNd } } : r.evo;
    return { value: r.value, cur, prev, evo, hidden, reason };
  });
}

// --- Garde du filtre Service (la seule, pour tous les écrans qui filtrent sur un service) -------------------------------------------
// Sous le filtre Service, tous les chiffres de l'écran décrivent le service retenu : il est n.d. dans son ensemble dès que sa ligne
// est masquée sans filtre (période, N-1 ou un mois, masquage secondaire compris : sinon le filtre révélerait par différence ce que
// le tableau cache), ou que le seuil n'est pas défini (lien vers les Paramètres). La raison est celle du moteur, nue, la même que
// celle de toute cellule masquée ; la mention du service retenu va dans le titre du bloc n.d., pas dans la raison. null : affiché.
// Un service absent des lignes (aucune ligne sur la période ni sur N-1) ne décrit personne.
export type ServiceGuard = { cause: "parametre" | "seuil"; reason: string };
export function serviceGuard(rows: MaskedServiceRow[], value: string | null, conf: ConfidentialiteSetting): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null) return { cause: "parametre", reason: settingNd };
  const row = rows.find((r) => r.value === value);
  if (!row || !row.hidden || row.reason === null) return null;
  return { cause: "seuil", reason: row.reason };
}

// La garde la plus grave de plusieurs : le paramètre absent, puis un masquage (principal ou secondaire : la raison du seuil), puis un
// effectif non dénombré ; null si aucune.
export function worstGuard(guards: readonly (ServiceGuard | null)[], seuil: number): ServiceGuard | null {
  const list = guards.filter((g): g is ServiceGuard => g !== null);
  return list.find((g) => g.cause === "parametre") ?? list.find((g) => g.reason === confidentialiteReason(seuil)) ?? list[0] ?? null;
}

// Même garde sur des fenêtres de mois réels quelconques (versions comparées de l'Écart budgétaire et de l'Analyse des écarts, mois
// d'un chapitre de la croisée) : les lignes par service sont formées sur chaque fenêtre (tout le journal, comme le tableau Services)
// et masquées par le moteur unique ; le service retenu est n.d. dès qu'une fenêtre le masque. Sans fenêtre : rien à protéger.
export function serviceGuardOnWindows(journal: JournalInput, windows: readonly (readonly string[])[], value: string | null, link: PersonLink, conf: ConfidentialiteSetting): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null || conf.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_VERIFIABLE };
  const guards = windows.filter((ms) => ms.length > 0).map((ms) => serviceGuard(maskServiceRows(serviceRows(journal, [...ms], []), link, conf), value, conf));
  return worstGuard(guards, conf.value);
}
