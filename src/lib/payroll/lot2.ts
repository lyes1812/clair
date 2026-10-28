import { confidentialiteSettingReason, personsOfContracts, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting, type MaskCell, type MaskStatus, type PersonLink } from "@/lib/confidentialite";
import { columnStatus, maskColumn, windowStatus, type ColumnEntry } from "@/lib/confidentialite/columns";
import { groupInput } from "@/lib/confidentialite/groups";
import { monthPayroll, serviceOf, windowPayroll, type JournalInput, type LedgerLine } from "./engine";
import { monthBounds, monthRange } from "@/lib/connectors/months";
import { classify, gridRubrics, type AccountGrid, type RubricId } from "./grid";
import { hiddenReason, serviceLabel, worstGuard, type ServiceGuard } from "./service-rows";

// Lot 2 de la Masse salariale : fixe et variable par libellé de paie, provision de congés payés, rapprochement avec la
// comptabilité. Calculs purs sur les lignes du journal de paie (et de la comptabilité), en centimes, débit − crédit.

const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const balance = (l: LedgerLine) => (l.debitCents ?? 0) - (l.creditCents ?? 0);
const inService = (input: JournalInput, l: LedgerLine) => !input.serviceFilter || serviceOf(l, input.serviceAxis) === input.serviceFilter.value;

// --- Fixe et variable : soldes par rubrique du brut et par libellé de ligne PayFit (ex. « Primes sur objectif »).
// Clé de regroupement : rubrique + libellé sans accents ni casse (« Prime d'été » = « Prime d'ete »).
export type LabelTotal = { rubric: RubricId; key: string; label: string; cents: number };
export const labelKey = (rubric: RubricId, label: string): string => `${rubric}\u0000${norm(label)}`;
const labelOf = (l: LedgerLine): string => (l.accountName ?? "").trim() || `compte ${l.accountId}`;
// Lignes du brut d'un mois de la fenêtre, dans le service filtré, avec leur rubrique : mêmes lignes pour les totaux et les contrats.
function brutLines(input: JournalInput, months: string[]): { line: LedgerLine; rubric: RubricId }[] {
  const rubrics = gridRubrics(input.grid);
  const out: { line: LedgerLine; rubric: RubricId }[] = [];
  for (const l of input.lines) {
    if (!months.includes(l.month) || !inService(input, l)) continue;
    const c = classify(l.accountId, rubrics);
    if (!c.rubric || c.rubric.role !== "brut") continue;
    out.push({ line: l, rubric: c.rubric.id });
  }
  return out;
}
export function labelTotals(input: JournalInput, months: string[]): LabelTotal[] {
  const out = new Map<string, LabelTotal>();
  for (const { line: l, rubric } of brutLines(input, months)) {
    const label = labelOf(l);
    const k = labelKey(rubric, label);
    const t = out.get(k) ?? { rubric, key: k, label, cents: 0 };
    t.cents += balance(l);
    out.set(k, t);
  }
  return [...out.values()].sort((a, b) => a.rubric.localeCompare(b.rubric) || a.label.localeCompare(b.label));
}

// Contrats distincts (identifiant de la source) qui portent une ligne de chaque libellé du brut sur les mois donnés : mêmes lignes
// que labelTotals (clé identique). Une ligne sans contrat n'apporte aucun contrat. Sert au seuil de confidentialité par libellé.
export function labelContracts(input: JournalInput, months: string[]): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const { line: l, rubric } of brutLines(input, months)) {
    const k = labelKey(rubric, labelOf(l));
    let s = sets.get(k);
    if (!s) sets.set(k, (s = new Set()));
    if (l.contractId) s.add(l.contractId);
  }
  return new Map([...sets].map(([k, s]) => [k, [...s].sort()]));
}

// --- Provision de congés payés à fin de mois (méthode PayFit d'extourne mensuelle) : chaque mois, la provision du mois
// passé est reprise et le stock du mois est doté. Stock fin de mois = solde des lignes de dotation « Mois courant » des
// comptes de la rubrique « Provisions de congés payés » : 6412 = congés payés, autres préfixes = charges sociales.
// Une part (congés ou charges) sans ligne de dotation dans le mois, ou non ventilée sur l'axe quand un service est
// filtré, est n.d. (null) avec sa raison ; le total est alors n.d. aussi, jamais complété par un 0.
export const PROVISION_MARKER = "mois courant";
export const CONGES_PREFIX = "6412";
export type ProvisionMonth =
  | { month: string; kind: "value"; conges: number | null; charges: number | null; total: number | null; missing: string[] }
  | { month: string; kind: "nd"; reason: string };
export function provisionMonth(input: JournalInput, month: string): ProvisionMonth {
  // Mêmes contrôles que la synthèse : mois lu, journal renvoyé, aucune ligne sans montant (dans le service filtré).
  const base = monthPayroll(input, month);
  if (base.kind === "nd") return { month, kind: "nd", reason: base.nd.reason };
  const rubrics = gridRubrics(input.grid);
  const lines = input.lines.filter((l) => l.month === month && classify(l.accountId, rubrics).rubric?.id === "provisions-cp");
  const dotation = lines.filter((l) => norm(l.accountName).includes(PROVISION_MARKER));
  if (!dotation.length) return { month, kind: "nd", reason: lines.length ? `aucune ligne de dotation « Mois courant » en ${month} (méthode de provision non reconnue)` : `aucune ligne de provision de congés payés en ${month}` };
  const f = input.serviceFilter;
  const missing: string[] = [];
  const part = (name: string, accounts: string, pick: (l: LedgerLine) => boolean): number | null => {
    const all = dotation.filter(pick);
    if (!all.length) {
      missing.push(`${name} : aucune ligne ${accounts} « Mois courant » en ${month}`);
      return null;
    }
    // Service nommé et aucune ligne de la part ne porte l'axe : la part n'est pas ventilée (tout est « Non ventilé »).
    if (f && f.value !== null && all.every((l) => serviceOf(l, input.serviceAxis) === null)) {
      missing.push(`${name} : lignes ${month} sans code analytique ${input.serviceAxis ?? ""}, non ventilées par service`);
      return null;
    }
    return all.filter((l) => inService(input, l)).reduce((s, l) => s + balance(l), 0);
  };
  const conges = part("congés payés", CONGES_PREFIX, (l) => l.accountId.startsWith(CONGES_PREFIX));
  const charges = part("charges sociales", `hors ${CONGES_PREFIX}`, (l) => !l.accountId.startsWith(CONGES_PREFIX));
  return { month, kind: "value", conges, charges, total: conges !== null && charges !== null ? conges + charges : null, missing };
}

// Contrats distincts qui portent une ligne de dotation « Mois courant » de la provision du mois, dans le service filtré (mêmes
// lignes que provisionMonth). Sert au seuil de confidentialité de la provision par service.
export function provisionContracts(input: JournalInput, month: string): string[] {
  const rubrics = gridRubrics(input.grid);
  const ids = new Set<string>();
  for (const l of input.lines) {
    if (l.month !== month || !l.contractId || !inService(input, l)) continue;
    if (classify(l.accountId, rubrics).rubric?.id !== "provisions-cp" || !norm(l.accountName).includes(PROVISION_MARKER)) continue;
    ids.add(l.contractId);
  }
  return [...ids].sort();
}

// --- Seuil de confidentialité : libellés de paie, familles de prime, provision par service (règle de src/lib/confidentialite).
// Chaque montant d'une répartition décrit les personnes reliées aux contrats qui portent ses lignes (groupes et entrée de masquage du
// module partagé src/lib/confidentialite/groups.ts : groupInput, valeur absolue, membres non transmis pour une cellule n.d. ou non
// dénombrée) ; une cellule de 1 à (seuil − 1) personnes est n.d. STATUT CANONIQUE (src/lib/confidentialite/columns.ts) : la cellule
// d'un mois se juge sur la seule colonne de son mois (maskColumn : total du mois publié et fixe, groupes dans l'ordre canonique de leur
// libellé, groupe vide hors de la colonne et affiché à 0) ; une période, un N-1 ou un cumul n'a AUCUNE relation propre et se déduit de
// ses mois (windowStatus : n.d. dès qu'un de ses mois est masqué). Le statut d'une cellule ne dépend donc ni de l'écran, ni de la
// période choisie, ni de l'ordre d'affichage. Seuil absent ou illisible : toute la répartition est n.d. avec la raison du paramètre.
// Les fonctions rendent, pour chaque cellule, la raison du n.d. ou null (affichée). Exportées pour l'onglet, son export et la Masse
// salariale croisée (04 et 07).

// Cellule de masquage d'un montant porté par des contrats du journal (libellé, provision) : personnes reliées, valeur absolue.
const cellOf = (contracts: Iterable<string>, value: number | null, link: PersonLink, seuil: number, nonZero?: boolean): MaskCell => {
  const v = value === null ? null : Math.abs(value);
  return groupInput(personsOfContracts(contracts, link), seuil, v, nonZero ?? (v !== null && v !== 0));
};

// Colonnes d'un mois des libellés du brut. Le total de CHAQUE rubrique du brut est publié chaque mois (onglet et croisée 04 : Fixe =
// Salaires et appointements, « dont primes », Gratifications de stage, et Indemnités et avantages = Variable − primes) ; le brut du mois
// est leur somme. Chaque rubrique d'un mois est donc UNE colonne, dont le total publié est la rubrique du mois ; la colonne des Primes
// est celle des familles de prime (total publié : les primes du mois). Un libellé appartient à une seule rubrique : il n'a qu'un statut
// par mois, qu'il soit lu dans le tableau par libellé ou dans celui des familles, et le brut du mois ne découvre rien de plus (les
// cellules masquées d'une colonne y comptent déjà « seuil » personnes). Cellule : contrats qui portent les lignes du libellé ce mois-là
// (mêmes lignes que labelTotals et labelContracts), reliés à leur personne ; valeur |solde du libellé|. Ordre canonique : la clé du
// libellé (rubrique + libellé sans accents ni casse), indépendante de la période qui fournit le libellé affiché.
type LabelMonthCell = { rubric: RubricId; cents: number; contracts: Set<string> };
function labelCellsByMonth(input: JournalInput, months: readonly string[]): Map<string, Map<string, LabelMonthCell>> {
  const out = new Map<string, Map<string, LabelMonthCell>>(months.map((m) => [m, new Map()]));
  for (const { line: l, rubric } of brutLines(input, [...months])) {
    const byKey = out.get(l.month)!;
    const k = labelKey(rubric, labelOf(l));
    let c = byKey.get(k);
    if (!c) byKey.set(k, (c = { rubric, cents: 0, contracts: new Set() }));
    c.cents += balance(l);
    if (l.contractId) c.contracts.add(l.contractId);
  }
  return out;
}

// Statut canonique de chaque libellé du brut (et donc de chaque famille de prime) pour chacun des mois demandés, dans le journal reçu
// (restreint au service filtré, le cas échéant : les colonnes sont alors celles du service, dont les totaux par rubrique sont publiés
// sous le filtre). Un libellé sans ligne ce mois-là (ou sans contrat ni montant) est hors de la colonne : 0, affiché. Mois n.d.
// (monthPayroll) : « nd », le mois garde sa propre raison. Un mois non demandé : erreur de l'appelant.
export function labelMonthStatus(input: JournalInput, months: readonly string[], link: PersonLink, seuil: number): (key: string, month: string) => MaskStatus {
  const cells = labelCellsByMonth(input, months);
  const columns = new Map<string, Map<string, MaskStatus> | null>();
  for (const m of months) {
    if (monthPayroll(input, m).kind !== "value") {
      columns.set(m, null);
      continue;
    }
    const byRubric = new Map<RubricId, ColumnEntry<string>[]>();
    for (const [key, c] of cells.get(m)!) {
      const list = byRubric.get(c.rubric) ?? [];
      list.push({ key, label: key, cell: cellOf(c.contracts, c.cents, link, seuil) });
      byRubric.set(c.rubric, list);
    }
    const col = new Map<string, MaskStatus>();
    for (const entries of byRubric.values()) for (const [k, s] of maskColumn(entries, seuil, true)) col.set(k, s);
    columns.set(m, col);
  }
  return (key, month) => {
    const col = columns.get(month);
    if (col === undefined) throw new Error(`labelMonthStatus : mois ${month} non demandé`);
    return col === null ? "nd" : columnStatus(col, key, cells.get(month)!.get(key)?.cents ?? 0);
  };
}

// Fixe & variable (onglet, croisée 04 et leurs exports) : brut par libellé (colonnes N et N-1) et primes par famille (chaque mois et la
// période ; la cellule de période d'une famille est sa cellule N du tableau par libellé). Chaque mois reçoit son statut canonique
// (labelMonthStatus) ; la cellule N, la cellule N-1 et la période d'une famille se déduisent de leurs mois (windowStatus), sans relation
// propre : une même prime d'un mois a le même statut quelle que soit la période choisie. Les familles sont les libellés de la rubrique
// « Primes » ; leur liste (celle de l'écran) ne change aucun statut.
export type LabelMask = {
  labels: Record<string, { cur: string | null; prev: string | null }>; // par clé de libellé (labelKey)
  families: Record<string, (string | null)[]>; // par clé de famille, une raison (ou null) par mois de la période
};
export function maskLabels(p: { input: JournalInput; months: string[]; prevMonths: string[]; keys: readonly string[]; families: readonly string[]; link: PersonLink; conf: ConfidentialiteSetting; prevNd: boolean }): LabelMask {
  const { input, months, prevMonths, families, link, prevNd } = p;
  const keys = [...new Set([...p.keys, ...families])];
  if (p.conf.kind !== "set") {
    const reason = confidentialiteSettingReason(p.conf) ?? SEUIL_NON_VERIFIABLE;
    return {
      labels: Object.fromEntries(keys.map((k) => [k, { cur: reason, prev: reason }])),
      families: Object.fromEntries(families.map((f) => [f, months.map(() => reason)])),
    };
  }
  const seuil = p.conf.value;
  // N-1 n.d. : sa colonne affiche sa propre raison, aucun statut n'y est lu.
  const at = labelMonthStatus(input, [...new Set([...months, ...(prevNd ? [] : prevMonths)])], link, seuil);
  const windowReason = (k: string, ms: readonly string[]): string | null => {
    const st = ms.map((m) => at(k, m));
    return hiddenReason(windowStatus(st, st.includes("nd")), seuil);
  };
  return {
    labels: Object.fromEntries(keys.map((k) => [k, { cur: windowReason(k, months), prev: prevNd ? null : windowReason(k, prevMonths) }])),
    families: Object.fromEntries(families.map((f) => [f, months.map((m) => hiddenReason(at(f, m), seuil))])),
  };
}

// Provision de congés payés par service, à chaque fin de mois demandée (journal entier, un journal par service) : la somme des
// services d'un mois est la provision de l'entreprise, publiée (tuile, tableau mensuel). Statut canonique : la colonne de la fin de mois
// (maskColumn, ordre canonique des libellés de service, « Non ventilé » en dernier ; un service sans dotation ni montant ce mois-là est
// hors de la colonne et affiché à 0) ; il ne dépend donc ni des services que la période choisie fait lister, ni de l'écran (onglet
// Paie & comptabilité, son export, croisée 07). La provision d'un service sur plusieurs fins de mois (garde du filtre) se déduit de ses
// mois (provisionGuard : n.d. dès qu'une fin de mois l'est).
// RÈGLE DE VALEUR (la même pour l'onglet Paie & comptabilité, son export et la croisée 07) : la valeur de la cellule est le TOTAL de la
// provision (congés payés + charges sociales) ; quand le total est n.d. parce qu'une part manque, la PART CONNUE (congés payés, à
// défaut charges sociales) est la valeur : elle est affichée dans la colonne de sa part, elle est donc masquable comme le total. Une
// provision entièrement n.d. (mois n.d., aucune part) garde sa raison et n'est ni masquée ni protectrice. Le groupe compté est
// l'ensemble des contrats qui portent une ligne de dotation « Mois courant » dans le mois ; nonZero : une part non nulle.
export type ProvisionMask = Record<string, Record<string, string | null>>; // clé de service (« __nv__ » : non ventilé) → mois → raison ou null
export type ProvisionStatus = Record<string, Record<string, MaskStatus>>; // même clé → mois → statut du moteur
export const provisionServiceKey = (s: string | null): string => s ?? "__nv__";
export const provisionValue = (x: ProvisionMonth): number | null => (x.kind === "nd" ? null : (x.total ?? x.conges ?? x.charges));
export function provisionCell(input: JournalInput, month: string, link: PersonLink, seuil: number): MaskCell {
  const x = provisionMonth(input, month);
  const nonZero = x.kind === "value" && ((x.conges ?? 0) !== 0 || (x.charges ?? 0) !== 0);
  return cellOf(provisionContracts(input, month), provisionValue(x), link, seuil, nonZero);
}
export function maskProvisionStatus(p: { inputs: { value: string | null; input: JournalInput }[]; months: string[]; link: PersonLink; seuil: number }): ProvisionStatus {
  const { inputs, months, link, seuil } = p;
  const byMonth = months.map((m) => {
    const entries = inputs.map((s): ColumnEntry<string> => ({ key: provisionServiceKey(s.value), label: serviceLabel(s.value), cell: provisionCell(s.input, m, link, seuil) }));
    const col = maskColumn(entries, seuil, true);
    return new Map(entries.map((e) => [e.key, columnStatus(col, e.key, e.cell.value)]));
  });
  return Object.fromEntries(inputs.map((s) => [provisionServiceKey(s.value), Object.fromEntries(months.map((m, j) => [m, byMonth[j].get(provisionServiceKey(s.value))!]))]));
}
export function maskProvisionServices(p: { inputs: { value: string | null; input: JournalInput }[]; months: string[]; link: PersonLink; conf: ConfidentialiteSetting }): ProvisionMask {
  const { inputs, months, link } = p;
  if (p.conf.kind !== "set") {
    const reason = confidentialiteSettingReason(p.conf) ?? SEUIL_NON_VERIFIABLE;
    return Object.fromEntries(inputs.map((s) => [provisionServiceKey(s.value), Object.fromEntries(months.map((m) => [m, reason]))]));
  }
  const seuil = p.conf.value;
  const st = maskProvisionStatus({ inputs, months, link, seuil });
  return Object.fromEntries(Object.entries(st).map(([k, byMonth]) => [k, Object.fromEntries(Object.entries(byMonth).map(([m, s]) => [m, hiddenReason(s, seuil)]))]));
}

// Sous le filtre Service, la provision du service retenu est n.d. dans son ensemble dès qu'une de ses fins de mois (période ou N-1)
// est masquée dans la provision par service (masquage secondaire compris), ou que le seuil n'est pas défini. Raison nue du moteur,
// comme serviceGuard ; la mention du service retenu va dans le titre du bloc n.d. null : affichée.
export function provisionGuard(mask: ProvisionMask, value: string | null, months: readonly string[], conf: ConfidentialiteSetting): ServiceGuard | null {
  const settingNd = confidentialiteSettingReason(conf);
  if (settingNd !== null || conf.kind !== "set") return { cause: "parametre", reason: settingNd ?? SEUIL_NON_VERIFIABLE };
  const byMonth = mask[provisionServiceKey(value)] ?? {};
  return worstGuard(months.map((m): ServiceGuard | null => (byMonth[m] ? { cause: "seuil", reason: byMonth[m] } : null)), conf.value);
}

// --- Rapprochement avec la comptabilité (FEC ou API Pennylane) : mêmes rubriques (même grille), mêmes mois.
export type ComptaLine = { month: string; accountId: string; debitCents: number | null; creditCents: number | null };
export type ReconRow = { rubric: RubricId | "non-classe"; journal: number; compta: number; ecart: number };
export type Reconciliation = { kind: "value"; rows: ReconRow[]; journal: number; compta: number; ecart: number; months: { month: string; journal: number; compta: number }[] } | { kind: "nd"; reason: string };

const payrollKey = (accountId: string, grid: AccountGrid): RubricId | "non-classe" | null => {
  const c = classify(accountId, gridRubrics(grid));
  return c.rubric ? c.rubric.id : c.payroll ? "non-classe" : null;
};

// Mois comptables exploitables. Pennylane : mois de la lecture, sauf ceux non terminés à la date de lecture.
// FEC : mois des exercices déposés (première → dernière écriture) ; un mois couvert par deux fichiers est en double, un
// mois postérieur à la clôture ou le dernier mois d'un FEC arrêté en cours de mois (clôture inconnue ou postérieure) est
// incomplet. Les mois écartés sont n.d. avec leur raison.
export type ComptaCoverage = { months: string[]; nd: Record<string, string> };
export function pennylaneCoverage(scope: string[], readOn: string): ComptaCoverage {
  const nd: Record<string, string> = {};
  const months: string[] = [];
  for (const m of [...scope].sort()) {
    if (readOn <= monthBounds(m).end) nd[m] = `mois non terminé à la lecture Pennylane du ${readOn}`;
    else months.push(m);
  }
  return { months, nd };
}
export function fecCoverage(exercises: { filename: string; firstDate: string; lastDate: string; closingDate: string | null }[]): ComptaCoverage {
  const nd: Record<string, string> = {};
  const files = new Map<string, string[]>();
  const afterClosing = new Map<string, string>();
  for (const e of exercises) {
    const lastMonth = e.lastDate.slice(0, 7);
    const endOfMonth = e.lastDate === monthBounds(lastMonth).end;
    if (!endOfMonth && !e.closingDate) nd[lastMonth] = `FEC ${e.filename} : dernière écriture au ${e.lastDate}, date de clôture inconnue (nom de fichier hors norme) : mois peut-être incomplet`;
    else if (!endOfMonth && e.closingDate && e.lastDate < e.closingDate) nd[lastMonth] = `FEC ${e.filename} arrêté au ${e.lastDate} (exercice clos le ${e.closingDate}) : mois incomplet`;
    for (const m of monthRange(e.firstDate.slice(0, 7), lastMonth)) {
      files.set(m, [...(files.get(m) ?? []), e.filename]);
      if (e.closingDate && m > e.closingDate.slice(0, 7)) afterClosing.set(m, `FEC ${e.filename} : écritures postérieures à la clôture du ${e.closingDate}`);
    }
  }
  for (const [m, f] of files) if (f.length > 1) nd[m] = `FEC en double (${f.join(", ")})`;
  for (const [m, r] of afterClosing) nd[m] = r;
  return { months: [...files.keys()].filter((m) => !nd[m]).sort(), nd };
}

// Un mois couvert sans aucune écriture de classe 6 ou 7 lue n'est pas saisi : n.d., jamais 0.
export function withEntries(cov: ComptaCoverage, lines: ComptaLine[]): ComptaCoverage {
  const has = new Set(lines.map((l) => l.month));
  const nd = { ...cov.nd };
  for (const m of cov.months) if (!has.has(m)) nd[m] = "aucune écriture de charges ou de produits (classes 6 et 7) lue pour ce mois";
  return { months: cov.months.filter((m) => has.has(m)), nd };
}

// Mois de la période sans comptabilité exploitable, regroupés par raison (non lue, FEC en double, mois incomplet…).
export function comptaGap(comptaMonths: string[], comptaNd: Record<string, string>, months: string[]): string | null {
  const byReason = new Map<string, string[]>();
  for (const m of months) {
    if (comptaMonths.includes(m)) continue;
    const r = comptaNd[m] ?? "comptabilité non lue";
    byReason.set(r, [...(byReason.get(r) ?? []), m]);
  }
  return byReason.size ? [...byReason].map(([r, ms]) => `${r} pour ${ms.join(", ")}`).join(" ; ") : null;
}

export function reconcile(input: JournalInput, compta: ComptaLine[], comptaMonths: string[], months: string[], comptaNd: Record<string, string> = {}): Reconciliation {
  // Journal : mêmes contrôles que la synthèse (mois lu, journal renvoyé, aucune ligne sans montant).
  const w = windowPayroll(input, months);
  if (w.kind === "nd") return { kind: "nd", reason: `journal de paie : ${w.nd.reason}` };
  const gap = comptaGap(comptaMonths, comptaNd, months);
  if (gap) return { kind: "nd", reason: gap };
  const rows = new Map<string, ReconRow>();
  const perMonth = new Map(months.map((m) => [m, { month: m, journal: 0, compta: 0 }]));
  const add = (key: RubricId | "non-classe", side: "journal" | "compta", month: string, cents: number) => {
    const r = rows.get(key) ?? { rubric: key, journal: 0, compta: 0, ecart: 0 };
    r[side] += cents;
    r.ecart = r.journal - r.compta;
    rows.set(key, r);
    perMonth.get(month)![side] += cents;
  };
  for (const l of input.lines) {
    if (!months.includes(l.month)) continue;
    const k = payrollKey(l.accountId, input.grid);
    if (k) add(k, "journal", l.month, balance(l));
  }
  for (const l of compta) {
    if (!months.includes(l.month)) continue;
    const k = payrollKey(l.accountId, input.grid);
    if (k) add(k, "compta", l.month, (l.debitCents ?? 0) - (l.creditCents ?? 0));
  }
  const order = gridRubrics(input.grid).map((r) => r.id as string);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const list = [...rows.values()].sort((a, b) => rank(a.rubric) - rank(b.rubric));
  const journal = list.reduce((s, r) => s + r.journal, 0);
  const comptaTotal = list.reduce((s, r) => s + r.compta, 0);
  return { kind: "value", rows: list, journal, compta: comptaTotal, ecart: journal - comptaTotal, months: [...perMonth.values()] };
}

// Produits d'exploitation (comptes 70 à 75), solde crédit − débit, depuis la comptabilité.
export function operatingRevenue(compta: ComptaLine[], months: string[]): number {
  return compta.filter((l) => months.includes(l.month) && /^7[0-5]/.test(l.accountId)).reduce((s, l) => s + (l.creditCents ?? 0) - (l.debitCents ?? 0), 0);
}
