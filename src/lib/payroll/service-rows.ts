import { confidentialiteReason, confidentialiteSettingReason, isHidden, maskGroups, maskReason, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { maskColumn, stockColumn, stockGroups, windowStatus, type StockGroup } from "@/lib/confidentialite/columns";
import { groupCell, masseWindow } from "@/lib/confidentialite/groups";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { evolution, monthPayroll, serviceOf, servicesOf, windowPayroll, withService, type Evolution, type JournalInput, type LedgerLine, type MonthPayroll, type PayrollWindow } from "./engine";
import { classify, gridRubrics } from "./grid";
import { buildContractServiceMap } from "./service-map";

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

// --- Statut canonique d'un mois d'un service (une seule règle pour tous les écrans qui publient la masse d'un service) ---------------
// La masse d'un service pour un mois est publiée par la Masse salariale (Synthèse, export, croisée 01 et 05), par KPI RH › Effectifs
// mensuels (mesure masse, axe service) et, sous le filtre Service, par l'Écart budgétaire, l'Analyse des écarts et les chapitres de la
// croisée. Son statut se calcule SEULEMENT sur sa colonne de mois : tous les services qui portent une ligne de masse (rubrique de rôle
// brut ou cotisations) ce mois-là dans le journal complet ; cellule de chaque service : groupe de masseWindow (contrats qui portent une
// ligne de masse, reliés à leur personne), valeur |masse du moteur de paie| (monthPayroll du journal restreint au service) ; relation :
// la colonne avec le total de l'entreprise du mois (fixe) quand il est publié ; ordre canonique des services (maskColumn : par libellé,
// « Non ventilé » en dernier). Le statut ne dépend donc ni de l'écran, ni de la fenêtre choisie, ni de l'ordre d'affichage. Un service
// sans ligne de masse ce mois-là vaut 0 (affiché, il ne désigne personne) ; un mois n.d. garde sa raison.
const monthJournal = (journal: JournalInput, month: string): JournalInput => ({ ...journal, serviceFilter: undefined, lines: journal.lines.filter((l) => l.month === month) });
// Mémo par lecture (mêmes lignes, même lien) : la même colonne sert à toutes les fenêtres et à tous les écrans d'une requête.
const columnMemo = new WeakMap<readonly LedgerLine[], WeakMap<PersonLink, Map<string, Map<string | null, MaskStatus>>>>();
export function serviceMonthMask(journal: JournalInput, month: string, link: PersonLink, seuil: number): Map<string | null, MaskStatus> {
  let byLink = columnMemo.get(journal.lines);
  if (!byLink) columnMemo.set(journal.lines, (byLink = new WeakMap()));
  let byKey = byLink.get(link);
  if (!byKey) byLink.set(link, (byKey = new Map()));
  const key = JSON.stringify([month, seuil, journal.serviceAxis ?? null, journal.months.includes(month), journal.grid]);
  const hit = byKey.get(key);
  if (hit) return hit;
  const col = computeServiceMonthMask(journal, month, link, seuil);
  byKey.set(key, col);
  return col;
}
function computeServiceMonthMask(journal: JournalInput, month: string, link: PersonLink, seuil: number): Map<string | null, MaskStatus> {
  const full = monthJournal(journal, month); // mêmes lignes du mois : monthPayroll et masseContracts n'en lisent pas d'autres
  const rubrics = gridRubrics(full.grid);
  const services = new Set<string | null>();
  for (const l of full.lines) {
    const role = classify(l.accountId, rubrics).rubric?.role;
    if (role === "brut" || role === "cotisations") services.add(serviceOf(l, full.serviceAxis));
  }
  const entries = [...services].map((v) => {
    const si = withService(full, v);
    const mp = monthPayroll(si, month);
    return { key: v, label: serviceLabel(v), cell: groupCell(masseWindow(si, [month], link).months[0], seuil, mp.kind === "value" ? mp.masse : null) };
  });
  return maskColumn(entries, seuil, monthPayroll(full, month).kind === "value");
}

// Statuts du seuil pour des fenêtres de mois par service. Chaque mois reçoit son statut canonique (serviceMonthMask, colonne du mois
// dans le journal complet : input est le journal restreint au service, withService) ; une fenêtre n'ajoute AUCUNE relation : son
// statut se déduit de ses mois (windowStatus : n.d. avec sa propre raison si sa valeur l'est ; sinon n.d. dès qu'un mois est masqué,
// non vérifiable si seuls des mois non vérifiables le sont, affichée sinon). Les fenêtres et les services sont indépendants entre eux.
export type WindowStatus = { window: MaskStatus; months: MaskStatus[] };
export function maskServiceWindows(services: readonly { input: JournalInput; windows: readonly PayrollWindow[] }[], link: PersonLink, seuil: number): WindowStatus[][] {
  const monthStatus = (input: JournalInput, m: MonthPayroll): MaskStatus => {
    if (m.kind !== "value") return "nd";
    const f = input.serviceFilter;
    if (!f) return "shown"; // journal entier : total de l'entreprise, jamais masqué
    const st = serviceMonthMask(input, m.month, link, seuil).get(f.value);
    if (st !== undefined) return st;
    // Service sans ligne de masse ce mois-là (hors de la colonne) : masquage principal seul de sa propre cellule (0 : affiché).
    return maskGroups([groupCell(masseWindow(input, [m.month], link).months[0], seuil, m.masse)], seuil, false)[0];
  };
  return services.map((s) =>
    s.windows.map((w) => {
      const months = w.months.map((m) => monthStatus(s.input, m));
      return { window: windowStatus(months, w.kind !== "value"), months };
    }),
  );
}

// --- Statut canonique du stock de fin de mois d'un service (ETP et effectif) ----------------------------------------------------------
// L'ETP de fin de mois d'un service pour un mois réel est publié par KPI RH › Effectifs mensuels (ETP × service) et la croisée 02 (axe
// service), et, sous le filtre Service, par la Synthèse de la Masse salariale (ETP fin de mois, N-1, coût par ETP, export), l'Écart
// budgétaire et l'Analyse des écarts (ligne ETP des versions réelles), les croisées 01 (coût par ETP-mois) et 08 (ETP des versions
// réelles). Son statut est celui de la colonne des stocks du mois (stockColumn : valeur d'ordre l'effectif, jamais l'ETP ; effectif et
// ETP masqués ensemble ; total de l'entreprise publié), formée des mêmes groupes que la croisée 02 (serviceSizes) et que les Effectifs
// mensuels (realMembers, ETP × service) : contrats qui portent l'ETP de fin de mois (contributions de etpMonthEnd), rangés par le
// service de leurs lignes de paie du mois (buildContractServiceMap, la règle de l'ETP par service ; sans ligne : « Non ventilé »),
// reliés à leur personne par le référentiel. Tout service qui porte un ETP non nul y a donc son groupe. Ce n'est pas la colonne de
// masse (serviceMonthMask) : groupes et valeur d'ordre diffèrent, un service peut être affiché dans l'une et masqué dans l'autre.
export type ServiceStocks = { kpi: KpiInput | null; journal: JournalInput };
// Service d'un contrat pour un mois (mémo par lecture : la même table sert à tous les mois et à tous les écrans d'une requête).
const serviceMapMemo = new WeakMap<readonly LedgerLine[], Map<string, Map<string, string | null>>>();
function contractServices(journal: JournalInput): Map<string, string | null> | null {
  const axis = journal.serviceAxis;
  if (!axis) return null;
  let byKey = serviceMapMemo.get(journal.lines);
  if (!byKey) serviceMapMemo.set(journal.lines, (byKey = new Map()));
  const key = JSON.stringify([axis, journal.grid]);
  let map = byKey.get(key);
  if (!map) byKey.set(key, (map = buildContractServiceMap(journal.lines, journal.grid, axis)));
  return map;
}
// Groupes de la fin de mois, par libellé de service ; null : stock non dénombré (ETP de fin de mois n.d. ou en borne basse, référentiel
// ou axe de service absent) : aucun ETP par service n'est publié pour ce mois.
export function serviceStockGroups(stocks: ServiceStocks, month: string, link: PersonLink): Record<string, StockGroup> | null {
  const map = contractServices(stocks.journal);
  if (!stocks.kpi || !map) return null;
  const e = etpMonthEnd(stocks.kpi, month);
  if (e.kind !== "exact") return null;
  return stockGroups(e.contributions.map((c) => ({ group: serviceLabel(map.get(`${month}|${c.externalId}`) ?? null), contract: c.externalId, person: link.get(c.externalId) ?? null })));
}
// Colonne des stocks de la fin de mois : statut de chaque libellé de service ; null : stock non dénombré.
export function serviceStockMask(stocks: ServiceStocks, month: string, link: PersonLink, seuil: number): Map<string, MaskStatus> | null {
  const groups = serviceStockGroups(stocks, month, link);
  return groups ? stockColumn(groups, seuil) : null;
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
// le tableau cache), ou que le seuil n'est pas défini (lien vers les Paramètres). L'écran qui publie aussi l'ETP de fin de mois du
// service (stock : ETP du mois, N-1, coût par ETP, ETP d'une version) le rend n.d. de même dès que le service est masqué, pour un de ces
// mois, dans la colonne des stocks (serviceStockMask), comme KPI RH › Effectifs mensuels et la croisée 02 : chaque mois porte le pire de
// ses deux statuts, masse et stock. La raison est celle du moteur, nue, la même que celle de toute cellule masquée ; la mention du
// service retenu va dans le titre du bloc n.d., pas dans la raison. null : affiché. Un service absent des lignes (aucune ligne sur la
// période ni sur N-1) ne décrit personne ; hors de la colonne des stocks d'un mois, il n'y porte aucun contrat (ETP 0, affiché).
export type ServiceGuard = { cause: "parametre" | "seuil"; reason: string };
// Mois réels dont l'écran publie l'ETP de fin de mois du service retenu, et la source de leurs stocks (référentiel, journal complet).
export type ServiceStockCheck = ServiceStocks & { months: readonly string[]; link: PersonLink };
export function serviceGuard(rows: MaskedServiceRow[], value: string | null, conf: ConfidentialiteSetting, stock?: ServiceStockCheck): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null) return { cause: "parametre", reason: settingNd };
  const row = rows.find((r) => r.value === value);
  const masse: ServiceGuard | null = !row || !row.hidden || row.reason === null ? null : { cause: "seuil", reason: row.reason };
  return withStockGuard(masse, stock, value, conf);
}

// Garde de la colonne des stocks sur les mois de stock.months : n.d. dès qu'un mois y masque le service (principal ou secondaire),
// non vérifiable si seul un mois non dénombré pour le seuil l'est (windowStatus) ; un mois dont le stock n'est pas dénombré ne publie
// aucun ETP par service. Ajoutée à la garde de masse (worstGuard) ; inutile quand celle-ci masque déjà avec la raison du seuil.
function withStockGuard(masse: ServiceGuard | null, stock: ServiceStockCheck | undefined, value: string | null, conf: ConfidentialiteSetting): ServiceGuard | null {
  if (!stock || conf.kind !== "set") return masse;
  const seuil = conf.value;
  if (masse?.reason === confidentialiteReason(seuil)) return masse;
  const label = serviceLabel(value);
  const st = windowStatus([...new Set(stock.months)].map((m): MaskStatus => {
    const col = serviceStockMask(stock, m, stock.link, seuil);
    return col === null ? "nd" : (col.get(label) ?? "shown");
  }));
  const own: ServiceGuard | null =
    st === "masked" || st === "secondary" ? { cause: "seuil", reason: confidentialiteReason(seuil) } : st === "unverifiable" ? { cause: "seuil", reason: SEUIL_NON_VERIFIABLE } : null;
  return worstGuard([masse, own], seuil);
}

// La garde la plus grave de plusieurs : le paramètre absent, puis un masquage (principal ou secondaire : la raison du seuil), puis un
// effectif non dénombré ; null si aucune.
export function worstGuard(guards: readonly (ServiceGuard | null)[], seuil: number): ServiceGuard | null {
  const list = guards.filter((g): g is ServiceGuard => g !== null);
  return list.find((g) => g.cause === "parametre") ?? list.find((g) => g.reason === confidentialiteReason(seuil)) ?? list[0] ?? null;
}

// Même garde sur des fenêtres de mois réels quelconques (versions comparées de l'Écart budgétaire et de l'Analyse des écarts, mois
// d'un chapitre de la croisée) : les lignes par service sont formées sur chaque fenêtre (tout le journal, comme le tableau Services)
// et masquées par le moteur unique ; le service retenu est n.d. dès qu'une fenêtre le masque. Sans fenêtre : rien à protéger. stock :
// l'écran publie aussi l'ETP de fin de mois du service sur stock.months (versions réelles de l'Écart et de l'Analyse, coût par ETP-mois
// de la croisée 01, ETP des versions de la croisée 08) : colonne des stocks de ces mois en plus (serviceGuard), même journal, même lien.
export function serviceGuardOnWindows(
  journal: JournalInput, windows: readonly (readonly string[])[], value: string | null, link: PersonLink, conf: ConfidentialiteSetting, stock?: { kpi: KpiInput | null; months: readonly string[] },
): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null || conf.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_VERIFIABLE };
  const guards = windows.filter((ms) => ms.length > 0).map((ms) => serviceGuard(maskServiceRows(serviceRows(journal, [...ms], []), link, conf), value, conf));
  return withStockGuard(worstGuard(guards, conf.value), stock && { kpi: stock.kpi, journal, months: stock.months, link }, value, conf);
}
