import type { ChartSeries } from "@/components/charts/shared";
import { confidentialiteSettingReason, isHidden, maskReason, maskRelations, SEUIL_NON_DEFINI, type ConfidentialiteSetting, type MaskCell, type MaskStatus } from "@/lib/confidentialite";
import type { AbsenceCountGroup, AbsencePeriodGroups } from "@/lib/rh/kpi/absence-motifs";
import { columnStatus, maskColumn, stockColumn, stockCount, windowStatus, type StockGroup } from "@/lib/confidentialite/columns";
import { groupInput, projectedGroupCell } from "@/lib/confidentialite/groups";
import { motifWindowMask, type MotifWindow } from "@/lib/croisee/conges";
import { fmtEtp4, fmtFixed, fmtFraction, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";

// Adaptateurs purs « résultat du moteur → séries de graphique » de l'écran KPI RH et des effectifs mensuels.
// Aucun calcul métier : chaque valeur vient d'un résultat déjà calculé ; un n.d. reste n.d. (null + raison), une borne
// basse n'est jamais tracée comme une valeur exacte (la valeur « ≥ x » est dans le tableau), rien n'est ramené à zéro.
// Les séries sont sérialisables (composants client) : jamais de fonction.

// --- Entrées minimales (les types du moteur y sont assignables)
type Nd = { nd: { reason: string } };
type Ratio = { num: number; den: number };
export type HeadcountIn = { kind: "exact" | "lower_bound"; persons: number } | ({ kind: "nd" } & Nd);
export type EtpIn = { kind: "exact" | "lower_bound"; etp4: number } | ({ kind: "nd" } & Nd);
export type CountIn = { kind: "exact" | "lower_bound"; value: number } | ({ kind: "nd" } & Nd);
export type RatioIn = { kind: "exact" | "lower_bound"; ratio: Ratio } | ({ kind: "nd" } & Nd);
// ETP proratisé : fraction exacte (quotité × jours sous contrat ÷ jours du mois), pas un stock en dix-millièmes.
export type EtpProratedIn = { kind: "exact" | "lower_bound"; ratio: Ratio } | ({ kind: "nd" } & Nd);
export type RowIn = {
  month: string;
  headcount: HeadcountIn;
  etp: EtpIn;
  etpProrated?: EtpProratedIn;
  movements: { entries: CountIn; exits: CountIn };
  absenteeism: RatioIn;
  previous: { month: string; etp: EtpIn; absenteeism: RatioIn };
};
// Cellule d'une catégorie un mois donné : effectif et ETP, ou n.d. avec sa raison (seuil de confidentialité) ; une catégorie sans contrat
// ce mois-là n'a pas de cellule (sans objet, jamais 0).
export type CategoryCellIn = { kind: "value"; headcount: number; etp4: number | null } | { kind: "nd"; reason: string };
export type CategoryMonthIn =
  | { kind: "value"; month: string; lowerBound: boolean; byCategory: Record<string, CategoryCellIn> }
  | { kind: "nd"; month: string; reason: string };
type CellIn = { kind: "value"; v: number } | { kind: "nd"; reason: string } | { kind: "na" };
export type GridIn = { months: string[]; groups: string[]; cell: (group: string, month: string) => CellIn; total: (month: string) => CellIn };

// --- Teintes et libellés
// Teintes de série de la charte (--chart-1 … --chart-8) : explicites, pour que l'anneau, les barres et les tableaux
// donnent la même teinte au même groupe, même quand un groupe à zéro disparaît de l'anneau.
export const groupColor = (i: number): string => `var(--chart-${(i % 8) + 1})`;

const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const idx = (m: string) => Number(m.slice(5, 7)) - 1;
export const monthShortLabel = (m: string): string => SHORT[idx(m)] ?? m;
export const monthLongLabel = (m: string): string => (LONG[idx(m)] ? `${LONG[idx(m)]} ${m.slice(0, 4)}` : m);

// Étiquettes d'axe : « janv. » seul dans une même année, « oct. 25 » dès que les mois couvrent deux années (12 mois glissants).
export function monthAxis(months: string[], previous?: string[]): { categories: string[]; titles: string[] } {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return {
    categories: months.map((m) => (years.size > 1 ? `${monthShortLabel(m)} ${m.slice(2, 4)}` : monthShortLabel(m))),
    titles: months.map((m, i) => (previous?.[i] ? `${monthLongLabel(m)} · N-1 : ${monthLongLabel(previous[i])}` : monthLongLabel(m))),
  };
}

// --- Points
type Point = { value: number | null; reason: string | null };
const known = (value: number): Point => ({ value, reason: null });
const absent = (reason: string): Point => ({ value: null, reason });
const LOWER = "source incomplète, non tracée comme valeur exacte";
const bound = (shown: string): Point => absent(`borne basse (≥ ${shown}) : ${LOWER}`);

const nf = new Intl.NumberFormat("fr-FR");

// Fraction exacte → points de base (1 pb = 0,01 %), arrondi au plus proche, demi vers le haut : l'arrondi de fmtPercent,
// donc l'infobulle affiche le même « 6,91 % » que le tableau.
export const ratioBps = (r: Ratio): number => Number(roundHalfUp({ num: r.num * 100, den: r.den }, 2));

// ETP proratisé : le graphique le lit en dix-millièmes d'ETP (unité « etp »), arrondi au plus proche, demi vers le haut ; la fraction exacte
// reste dans le tableau. Une borne basse n'est pas tracée ; un dénominateur nul n'est jamais tracé.
const etpRatioPoint = (e: EtpProratedIn): Point =>
  e.kind === "nd" ? absent(e.nd.reason) : e.ratio.den <= 0 ? absent("dénominateur nul : ETP proratisé non défini") : e.kind === "lower_bound" ? bound(`${fmtFixed(e.ratio)} ETP`) : known(Number(roundHalfUp(e.ratio, 4)));

// Les trois issues d'un résultat du moteur : exact (tracé), borne basse (non tracée, valeur dans la raison), n.d. (non tracé).
const headcountPoint = (h: HeadcountIn): Point => (h.kind === "nd" ? absent(h.nd.reason) : h.kind === "lower_bound" ? bound(nf.format(h.persons)) : known(h.persons));
const etpPoint = (e: EtpIn): Point => (e.kind === "nd" ? absent(e.nd.reason) : e.kind === "lower_bound" ? bound(`${fmtEtp4(e.etp4)} ETP`) : known(e.etp4));
const countPoint = (c: CountIn): Point => (c.kind === "nd" ? absent(c.nd.reason) : c.kind === "lower_bound" ? bound(nf.format(c.value)) : known(c.value));
// Un dénominateur nul n'est jamais tracé (le moteur le rend déjà n.d. ; la garde évite qu'un taux indéfini fasse échouer l'écran).
const ratePoint = (r: RatioIn): Point =>
  r.kind === "nd" ? absent(r.nd.reason) : r.ratio.den <= 0 ? absent("dénominateur nul : taux non défini") : r.kind === "lower_bound" ? bound(fmtPercent(r.ratio)) : known(ratioBps(r.ratio));

function series(key: string, name: string, points: Point[], extra: Partial<Pick<ChartSeries, "color" | "dashed" | "area">> = {}): ChartSeries {
  return { key, name, values: points.map((p) => p.value), reasons: points.map((p) => p.reason), ...extra };
}

// --- Écran KPI RH (une valeur par mois de la fenêtre ; N-1 = même mois un an plus tôt)
export const headcountSeries = (rows: RowIn[]): ChartSeries[] => [series("effectif", "Effectif fin de mois (personnes)", rows.map((r) => headcountPoint(r.headcount)))];

// Troisième série (ETP proratisé) seulement si au moins une ligne le porte : sans lui, les deux séries historiques sont inchangées.
export const etpSeries = (rows: RowIn[]): ChartSeries[] => [
  series("etp", "ETP fin de mois", rows.map((r) => etpPoint(r.etp))),
  series("etp-n1", "ETP N-1 (même mois un an plus tôt)", rows.map((r) => etpPoint(r.previous.etp)), { dashed: true }),
  ...(rows.some((r) => r.etpProrated) ? [series("etp-prorated", "ETP proratisé (quotité actuelle)", rows.map((r) => (r.etpProrated ? etpRatioPoint(r.etpProrated) : absent("ETP proratisé non calculé pour ce mois"))))] : []),
];

export const movementSeries = (rows: RowIn[]): ChartSeries[] => [
  series("entrees", "Entrées comptées", rows.map((r) => countPoint(r.movements.entries))),
  series("sorties", "Sorties comptées", rows.map((r) => countPoint(r.movements.exits))),
];

export const absenteeismSeries = (rows: RowIn[]): ChartSeries[] => [
  series("absenteisme", "Absentéisme du mois", rows.map((r) => ratePoint(r.absenteeism))),
  series("absenteisme-n1", "Absentéisme N-1 (même mois un an plus tôt)", rows.map((r) => ratePoint(r.previous.absenteeism)), { dashed: true }),
];

// Taux d'une période (turnover, absentéisme) : deux colonnes, la période précédente (N-1) puis la période affichée.
export function comparedRate(name: string, previous: { label: string; value: RatioIn }, current: { label: string; value: RatioIn }): { categories: string[]; titles: string[]; series: ChartSeries[] } {
  return {
    categories: ["N-1", "Période"],
    titles: [`N-1 : ${previous.label}`, `Période : ${current.label}`],
    series: [series("taux", name, [ratePoint(previous.value), ratePoint(current.value)])],
  };
}

// Effectif et ETP de fin de mois par catégorie (même calcul que l'ETP contractuel de fin de mois). Une catégorie absente
// d'un mois connu n'a aucun contrat ce mois-là : zéro réel, comme dans le tableau (« — »). Un mois n.d. ou en borne basse
// n'est pas tracé ; un ETP n.d. (contrat sans quotité) reste n.d. ; une cellule masquée par le seuil de confidentialité n'est
// pas tracée, sa raison est dans l'infobulle (jamais 0).
export function categorySeries(months: CategoryMonthIn[], keys: string[], labels: Record<string, string>, measure: "etp" | "headcount"): ChartSeries[] {
  const gate = (m: CategoryMonthIn): Point | null => (m.kind === "nd" ? absent(m.reason) : m.lowerBound ? absent(`borne basse : ${LOWER}`) : null);
  // Aucune catégorie lue : une série « Total » porte les raisons des mois n.d. (et 0 pour un mois connu sans contrat).
  if (keys.length === 0) return [series("total", "Total", months.map((m) => gate(m) ?? known(0)), { color: groupColor(0) })];
  return keys.map((k, i) => {
    const pts = months.map((m): Point => {
      const g = gate(m);
      if (g) return g;
      const x = m.kind === "value" ? m.byCategory[k] : undefined;
      if (!x) return known(0);
      if (x.kind === "nd") return absent(x.reason);
      if (measure === "headcount") return known(x.headcount);
      return x.etp4 === null ? absent("ETP n.d. : au moins un contrat de la catégorie sans quotité lisible") : known(x.etp4);
    });
    return series(k, labels[k] ?? k, pts, { color: groupColor(i) });
  });
}

// --- Effectifs mensuels (grille mesure × groupe × mois)
const cellPoint = (c: CellIn): Point => (c.kind === "value" ? known(c.v) : absent(c.kind === "nd" ? c.reason : "non applicable"));

// Une série par groupe, mois par mois, teinte du groupe. Sans aucun groupe (aucun mouvement sur l'année), une seule
// série « Total » porte les zéros réels des mois connus et les n.d. des autres.
export function gridSeries(g: GridIn): ChartSeries[] {
  if (g.groups.length === 0) return [series("total", "Total", g.months.map((m) => cellPoint(g.total(m))), { color: groupColor(0) })];
  return g.groups.map((grp, i) => series(grp, grp, g.months.map((m) => cellPoint(g.cell(grp, m))), { color: groupColor(i) }));
}

// Répartition : un stock se lit au dernier mois connu, un flux se cumule sur les mois connus (un mois n.d. n'est pas compté).
export function repartition(g: GridIn, stock: boolean): { known: string[]; used: string[]; items: { group: string; v: number }[]; total: number } {
  const knownMonths = g.months.filter((m) => g.total(m).kind === "value");
  const used = stock ? knownMonths.slice(-1) : knownMonths;
  const items = g.groups.map((group) => ({ group, v: used.reduce((s, m) => s + ((c) => (c.kind === "value" ? c.v : 0))(g.cell(group, m)), 0) }));
  return { known: knownMonths, used, items, total: items.reduce((s, x) => s + x.v, 0) };
}

// --- Libellés et typographie d'affichage (aucun calcul)

// Remarques de tuile qui changent la lecture d'un chiffre (borne basse, mouvements neutralisés ou exclus, absences incertaines).
// Les deux phrases d'explication du moteur (quotités à la date de lecture : bloc « Limites de la lecture » ; entrées et sorties en
// contrats : glossaire) ne s'affichent plus sur la tuile.
const EXPLANATORY_QUALIFIERS = [/^quotités à la date de lecture/, /^entrées et sorties en contrats, effectif en personnes/];
export const readingQualifiers = (qualifiers: string[]): string[] => [...new Set(qualifiers)].filter((q) => !EXPLANATORY_QUALIFIERS.some((re) => re.test(q)));

// Unité de la rubrique, dite dans la ligne de contexte des effectifs mensuels (« nombre » : entrées, sorties, inscrits).
export const unitLabel = (unit: "etp" | "nombre" | "eur"): string => (unit === "eur" ? "euros" : unit === "etp" ? "ETP" : "nombre");

// Légende d'une ligne sous les barres des effectifs mensuels : mois projetés, absence de groupe, teintes répétées.
export function barNote(projected: string[], nGroups: number): string | undefined {
  const list = projected.map(monthShortLabel).join(", ");
  const parts = [
    // Les mois abrégés finissent souvent par un point (« oct. ») : pas de second point.
    projected.length ? `Mois projetés (scénario) : ${list}${list.endsWith(".") ? "" : "."}` : null,
    nGroups === 0 ? "Aucune valeur sur les mois connus : total à 0." : null,
    nGroups > 8 ? "Plus de huit groupes : les teintes se répètent." : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? parts.join(" ") : undefined;
}

// Groupes à valeur nulle ou négative : présents dans le tableau, absents de l'anneau.
export const donutNote = (omitted: string[]): string | undefined => (omitted.length ? `Valeur nulle, absents de l'anneau : ${omitted.join(", ")}.` : undefined);

// Taux tous à zéro (tracés) : l'écran le dit en une phrase, sinon la courbe plate ou l'absence de barre se lirait comme une donnée manquante.
export const zeroRateNote = (list: ChartSeries[]): string | undefined => (allZero(list) ? "Tous les taux tracés valent 0,00 %." : undefined);

// Libellé français d'un motif d'absence PayFit déjà nommé par l'application (défaut validé des définitions des KPI : « maladie
// ordinaire »). Un autre code n'a pas de libellé connu : null, et l'écran le montre tel que reçu, sans le deviner.
const ABSENCE_TYPE_LABELS: Record<string, string> = { fr_maladie_ordinaire: "Maladie ordinaire" };
export const absenceTypeLabel = (code: string): string | null => ABSENCE_TYPE_LABELS[code] ?? null;
// Libellé suivi du code entre parenthèses (tableaux de paramètres) ; le code seul s'il n'a pas de libellé.
export const absenceTypeText = (code: string): string => {
  const label = absenceTypeLabel(code);
  return label ? `${label} (${code})` : code;
};

// Ligne courte sous la valeur de la tuile Absentéisme : les motifs que l'espace a retenus (Paramètres), avec leur libellé français quand
// il est connu. Aucun motif retenu : « aucun » (le moteur refuse alors de calculer et l'écran dit pourquoi).
export const motifsRetenusLine = (codes: string[]): string => `Motifs retenus : ${codes.length ? codes.map(absenceTypeText).join(", ") : "aucun"}`;

// Remarque de la tuile « ETP contractuel proratisé » : le qualifieur obligatoire du moteur, ramené à une ligne courte (la date de lecture
// est dite dans « Limites de la lecture » et au survol) ; les autres remarques du moteur (borne basse) sont conservées telles quelles.
const PRORATED_SHORT: [RegExp, string][] = [
  [/^ETP contractuel proratisé : quotité à la date de lecture/, "quotité à la date de lecture ; ni ETP payé ni historique exact"],
  [/^ETP contractuel proratisé : quotité déclarée dans la DSN du mois/, "quotité déclarée dans la DSN du mois ; ni ETP payé ni historique exact"],
];
export const etpProratedNotes = (qualifiers: string[]): string[] => readingQualifiers(qualifiers.map((q) => PRORATED_SHORT.find(([re]) => re.test(q))?.[1] ?? q));

// Tableau « par motif » du détail de l'absentéisme : une ligne par motif présent dans la lecture. Un n.d. reste n.d. (jamais 0), une borne
// basse garde son « ≥ ». `count` : absences de toute la lecture ; `inWindow` : absences qui touchent la période affichée.
export type MotifLineIn = { type: string; count: number; inWindow: number; chosen: boolean } & (
  | { kind: "exact" | "lower_bound"; half: number; ratio: Ratio }
  | { kind: "nd"; half: null; ratio: null; nd: { reason: string } }
);
export type MotifRow = { type: string; label: string | null; count: number; inWindow: number; retained: boolean; kind: "exact" | "lower_bound" | "nd"; halfText: string; rateText: string; reason: string | null };
export function motifRows(lines: MotifLineIn[]): MotifRow[] {
  return lines.map((l) => {
    const base = { type: l.type, label: absenceTypeLabel(l.type), count: l.count, inWindow: l.inWindow, retained: l.chosen };
    if (l.kind === "nd") return { ...base, kind: "nd", halfText: "n.d.", rateText: "n.d.", reason: l.nd.reason };
    const lower = l.kind === "lower_bound" ? "≥ " : "";
    return { ...base, kind: l.kind, halfText: `${lower}${l.half} (${fmtHalfDays(l.half)})`, rateText: `${lower}${fmtPercent(l.ratio)}`, reason: null };
  });
}

// Vrai signe moins (U+2212) dans une formule affichée : « = -42500/1079 » → « = −42500/1079 ». Un tiret d'un nom (« N-1 »)
// ou d'une date (« 2025-10 ») n'est pas touché : seul un tiret qui précède un chiffre en début de terme est remplacé.
export const typoMinus = (s: string): string => s.replace(/(^|[\s(=×÷])-(?=\d)/g, "$1\u2212");

// Écart exact en fractions, au survol de la ligne « Écart » d'une tuile : valeur − N-1 (× 100 pour un taux, écart en points).
// « delta » est l'écart déjà calculé par le moteur (en points pour un taux) : aucune opération n'est refaite ici.
export const deltaExact = (a: Ratio, b: Ratio, delta: Ratio, points = false): string => {
  const d = fmtFraction(delta);
  return typoMinus(points ? `(${fmtFraction(a)} − ${fmtFraction(b)}) × 100 = ${d}` : `${fmtFraction(a)} − ${fmtFraction(b)} = ${d}`);
};

// Libellé d'un axe de répartition « Catégorie (CDI, CDD, apprenti, stagiaire) » → nom court et précision (null sans parenthèse finale).
export function splitAxisLabel(label: string): { name: string; detail: string | null } {
  const i = label.indexOf(" (");
  if (i < 0 || !label.endsWith(")")) return { name: label, detail: null };
  return { name: label.slice(0, i), detail: label.slice(i + 2, -1) };
}

// Vrai si au moins une valeur est connue et que toutes les valeurs connues valent 0 (un taux nul : rien à tracer, mais ce n'est pas un n.d.).
export function allZero(list: ChartSeries[]): boolean {
  const known = list.flatMap((s) => s.values).filter((v): v is number => v !== null && v !== undefined);
  return known.length > 0 && known.every((v) => v === 0);
}

// Série entièrement absente : le graphique est remplacé par la raison (une ligne vide ou une rangée de colonnes hachurées
// ne dirait rien). null dès qu'une valeur est connue.
export function ndSummary(list: ChartSeries[]): string | null {
  if (list.some((s) => s.values.some((v) => v !== null && v !== undefined))) return null;
  const reasons = [...new Set(list.flatMap((s) => (s.reasons ?? []).filter((r): r is string => !!r)))];
  return reasons.length ? reasons.slice(0, 3).join(" ; ") + (reasons.length > 3 ? ` ; … (${reasons.length} raisons)` : "") : "aucune valeur disponible";
}

// --- Seuil de confidentialité (module partagé src/lib/confidentialite ; moteur maskGroups / maskRelations, jamais recodé) -----------
// Unité : personnes distinctes (clé de personne du référentiel). Un contrat non relié ne protège jamais (maskSize). Une valeur non
// nulle qui ne décrit aucune personne dénombrée est « non vérifiable » (groupInput). La raison d'un masquage principal ou secondaire
// est la même (maskReason). Paramètre absent ou illisible : n.d. avec la raison du paramètre (confidentialiteSettingReason).

// Seuil utilisable, ou la raison de son absence ; un paramètre non transmis par l'écran vaut « non défini » (jamais une valeur de repli).
export type SeuilRead = { seuil: number; reason: null } | { seuil: null; reason: string };
export function seuilOf(setting: ConfidentialiteSetting | undefined): SeuilRead {
  if (!setting) return { seuil: null, reason: confidentialiteSettingReason({ kind: "absent" })! };
  const reason = confidentialiteSettingReason(setting);
  return reason === null && setting.kind === "set" ? { seuil: setting.value, reason: null } : { seuil: null, reason: reason ?? confidentialiteSettingReason({ kind: "absent" })! };
}

// Ligne « Confidentialité : seuil de N personnes » (écran) ; valeur de la ligne « Confidentialité » d'un onglet Filtres (export).
export const seuilText = (setting: ConfidentialiteSetting | undefined): string =>
  setting?.kind === "set" ? `seuil de ${setting.value} ${setting.value > 1 ? "personnes" : "personne"}` : setting?.kind === "invalid" ? "seuil illisible, à ré-enregistrer" : "seuil non défini";
export const seuilFilterText = (setting: ConfidentialiteSetting | undefined): string =>
  setting?.kind === "set" ? `${seuilText(setting)} distinctes` : setting?.kind === "invalid" ? "seuil illisible : à ré-enregistrer (Paramètres)" : "seuil non défini (Paramètres)";

// --- Tableau par motif du détail de l'absentéisme : le total de la fenêtre de motifWindowMask (src/lib/croisee/conges.ts), la même
// fonction que la croisée 03 (période et N-1). Chaque mois d'un motif a le statut de la seule colonne de son mois (motifs retenus du
// mois → absentéisme du mois ; autres motifs du mois → taux tous motifs du mois ; ordre canonique des motifs) ; la ligne d'une fenêtre
// (période ou N-1) et le taux tous motifs se déduisent de leurs mois (windowStatus : n.d. dès qu'un mois est masqué). Le statut d'une
// ligne ne dépend donc ni de l'écran ni de la fenêtre choisie. Exception : le seul motif retenu présent dans la lecture (sa ligne égale
// la tuile Absentéisme, déjà publiée). cells : motifWindow(entrée, fenêtre), lu par la page dans le moteur ; lines[i] : statut du total
// de la ligne i (même ordre que les motifs d'absenceByMotif).
export type MotifMask = { lines: MaskStatus[]; all: MaskStatus; exempt: number | null };
export function motifMask(cells: MotifWindow, seuil: number): MotifMask {
  const m = motifWindowMask(cells, seuil);
  return { lines: m.total, all: m.all, exempt: m.exempt };
}

// Lignes du tableau par motif après masquage : une ligne masquée garde son motif et « retenu » ; ses demi-journées, son taux et ses
// absences de la période sont n.d. avec la raison du seuil, jamais 0. « Absences de la lecture » (countMasked) est la cellule que publie
// aussi la tuile Absentéisme (« Motifs de la lecture ») et Paramètres › Définitions des KPI : son statut est celui de typeCountMask, le
// même partout, quelle que soit la fenêtre. « Absences de la période » (inWindowMasked) : n.d. avec la ligne ; n.d. aussi quand le nombre
// de toute la lecture est masqué (ses absences en sont une partie) ; sinon le statut de ses propres personnes (periodCountMask : la
// période et ses mois, absences du motif qui touchent la fenêtre). sizes : nombre et personnes distinctes de chaque motif dans toute la
// lecture (absenceTypePersons) ; period : personnes des absences de la fenêtre (absenceByMotif.period). Absents, un nombre non nul n'est
// pas vérifiable (aucune valeur de repli).
export type MaskedMotifRow = MotifRow & { masked: string | null; countMasked: string | null; inWindowMasked: string | null };
export function maskMotifRows(rows: MotifRow[], mask: MotifMask | null, seuil: number | null, settingReason: string | null, sizes: AbsenceTypeGroups = {}, period?: AbsencePeriodGroups): MaskedMotifRow[] {
  const periodStatus = seuil === null ? null : periodCountMask(period, seuil);
  return rows.map((r, i): MaskedMotifRow => {
    const reason = settingReason ?? (mask && seuil !== null && isHidden(mask.lines[i]) ? maskReason(mask.lines[i], seuil) : null);
    const countMasked = settingReason ?? (seuil === null ? null : typeCountMask(sizes, r.type, r.count, seuil));
    const own = periodStatus === null || seuil === null ? null : maskReason(periodStatus(r.type, r.inWindow), seuil);
    const inWindowMasked = reason ?? (countMasked !== null && r.inWindow > 0 ? countMasked : null) ?? own;
    return reason ? { ...r, kind: "nd", halfText: "n.d.", rateText: "n.d.", reason, masked: reason, countMasked, inWindowMasked } : { ...r, masked: null, countMasked, inWindowMasked };
  });
}

// --- Nombres d'absences par motif (tuile Absentéisme « Motifs de la lecture », Paramètres › Définitions des KPI › Absentéisme,
// colonnes « Absences de la lecture » et « Absences de la période » du détail par motif) ------------------------------------------------
// Nombre et personnes distinctes de chaque motif (absenceTypePersons, absenceTypeGroups).
export type AbsenceTypeGroups = Readonly<Record<string, AbsenceCountGroup>>;
// Cellule de masquage d'un nombre d'absences : personnes reliées des contrats de ses absences (groupInput : un contrat non relié ne
// protège jamais ; non dénombrée quand des contrats non reliés laissent les personnes reliées sous le seuil), valeur = nombre d'absences
// (ordre du masquage secondaire).
const absenceCountCell = (g: AbsenceCountGroup, seuil: number): MaskCell => groupInput(g, seuil, g.count);

// Colonne « Absences de la lecture » : TOUS les motifs de la lecture (sizes), dans l'ordre canonique de leurs codes. Son total est publié
// par Données › lecture (nombre d'éléments de la collection absences : toutes les absences de la lecture, quel que soit leur motif) :
// masquage principal et secondaire (maskColumn, total fixe). Elle ne dépend d'aucune fenêtre.
export function typeCountColumn(sizes: AbsenceTypeGroups, seuil: number): Map<string, MaskStatus> {
  return maskColumn(Object.entries(sizes).map(([type, g]) => ({ key: type, label: type, cell: absenceCountCell(g, seuil) })), seuil, true);
}

// Statut du nombre d'absences d'un motif dans toute la lecture, lu dans sa colonne (typeCountColumn). Un nombre qui n'est pas celui de la
// colonne (motif absent de sizes, nombre différent) n'est pas vérifiable ; un motif sans absence (0) n'a rien à protéger. null : nombre
// affiché ; sinon la raison du n.d.
export function typeCountMask(sizes: AbsenceTypeGroups, type: string, count: number, seuil: number): string | null {
  const g = sizes[type];
  const st: MaskStatus = g === undefined || g.count !== count ? (count === 0 ? "shown" : "unverifiable") : typeCountColumn(sizes, seuil).get(type)!;
  return maskReason(st, seuil);
}

// Statut du nombre « Absences de la période » d'un motif (absences du motif qui touchent la fenêtre), sur ses propres personnes :
//   1. la période et le reste de la lecture (absences du motif qui ne touchent pas la fenêtre) somment au nombre de toute la lecture,
//      publié sur la même ligne : une période sous le seuil est masquée, et une période dont le reste décrit de 1 à (seuil − 1)
//      personnes, ou n'est pas dénombré, l'est en second (maskRelations : sinon « lecture − période » le publierait) ;
//   2. règle canonique des fenêtres : n.d. dès qu'un de ses mois est masqué (windowStatus). Mois : sa colonne, tous les motifs de la
//      lecture dans l'ordre canonique, cellule = absences du motif qui touchent le mois ; aucun total publié (le nombre d'absences d'un
//      mois, tous motifs, n'est affiché nulle part) : masquage principal seul (maskColumn).
// period non transmis, motif absent ou nombre différent de celui de la période : non vérifiable ; aucune absence : rien à protéger.
export function periodCountMask(period: AbsencePeriodGroups | undefined, seuil: number): (type: string, inWindow: number) => MaskStatus {
  const types = Object.entries(period?.types ?? {});
  const months = (period?.months ?? []).map((_, j) => maskColumn(types.map(([type, l]) => ({ key: type, label: type, cell: absenceCountCell(l.months[j], seuil) })), seuil, false));
  return (type, inWindow) => {
    const l = period?.types[type];
    if (inWindow === 0 && (l === undefined || l.window.count === 0)) return "shown";
    if (l === undefined || l.window.count !== inWindow || l.offMonths > 0) return "unverifiable";
    const [own] = maskRelations([absenceCountCell(l.window, seuil), absenceCountCell(l.rest, seuil)], [{ cells: [0, 1] }], seuil);
    return isHidden(own) ? own : windowStatus(months.map((col) => col.get(type) ?? "unverifiable"));
  };
}

// --- Effectifs mensuels : cellules d'une répartition (groupe × mois), une seule passe de masquage pour la grille ET la répartition ---
// sizes : personnes distinctes d'un groupe un mois donné (contrats reliés par le référentiel), null quand elles ne sont pas dénombrées ;
// contracts : nombre de contrats du groupe (l'effectif d'un stock, valeur d'ordre de son masquage) ; hires : embauches prévisionnelles
// d'un scénario qui portent la cellule. Une embauche prévue ne décrit aucune personne réelle (décision du lot 12, à confirmer par
// Lyes) : la cellule est celle de projectedGroupCell, la même que l'Écart budgétaire, l'Analyse des écarts et les croisées 06 et 08.
export type GridGroup = StockGroup;
export type GridSizes = (group: string, month: string) => GridGroup | null;
// months : mois connu (total publié) → statut de chaque groupe, dans l'ordre de g.groups ; mois absent : total n.d. share : statut du
// cumul de chaque groupe (répartition d'un flux) ; null pour un stock, dont la répartition lit la colonne du dernier mois connu.
export type GridMask = { months: Map<string, MaskStatus[]>; share: MaskStatus[] | null };
// Cellule d'un groupe un mois donné (valeur absolue, comme groupCell : elle ne sert qu'à l'ordre du masquage secondaire) ; null :
// effectif non dénombré.
const sizeInput = (g: GridGroup | null, seuil: number, value: number | null): MaskCell =>
  g === null ? { size: null, value: value === null ? null : Math.abs(value) } : projectedGroupCell(g, seuil, value);
// Statuts canoniques imposés pour un mois (libellé du groupe → statut), calculés par la fonction que partage l'autre écran qui publie
// la même cellule (masse × service des mois réels : serviceMonthMask de la Masse salariale) ; null : colonne calculée ici.
export type GridCanonical = (month: string) => ReadonlyMap<string, MaskStatus> | null;

// Statut d'un mois = sa SEULE colonne (total du mois publié, jamais masqué), formée dans l'ordre canonique des groupes (maskColumn) :
// - stock (ETP, inscrits) : stockColumn, la passe partagée avec le Suivi et la croisée 02 (valeur d'ordre : l'effectif, jamais l'ETP) ;
// - flux (entrées, sorties, masse) : la cellule de chaque groupe, valeur |valeur du mois| ;
// - mois dont la colonne est imposée (canonical) : ses statuts.
// Aucune relation « mois → cumul » : le cumul d'un flux (répartition) se déduit de ses mois (windowStatus : n.d. dès qu'un mois est
// masqué, non vérifiable si seuls des mois non vérifiables le sont, affiché sinon). Un stock n'a pas de cumul : sa répartition est la
// colonne du dernier mois connu.
export function gridMask(g: GridIn, sizes: GridSizes, seuil: number, stock: boolean, canonical?: GridCanonical): GridMask {
  const known = g.months.filter((m) => g.total(m).kind === "value");
  const value = (grp: string, m: string): number | null => {
    const c = g.cell(grp, m);
    return c.kind === "value" ? c.v : null;
  };
  const column = (m: string): MaskStatus[] => {
    const imposed = canonical?.(m) ?? null;
    if (imposed) return g.groups.map((grp) => columnStatus(imposed, grp, value(grp, m)));
    if (stock) {
      const groups: Record<string, StockGroup | null> = {};
      for (const grp of g.groups) {
        const s = sizes(grp, m);
        if (s === null ? value(grp, m) !== null : stockCount(s) > 0) groups[grp] = s;
      }
      const col = stockColumn(groups, seuil, g.groups.filter((grp) => (value(grp, m) ?? 0) !== 0));
      return g.groups.map((grp) => columnStatus(col, grp, value(grp, m)));
    }
    const col = maskColumn(g.groups.map((grp) => ({ key: grp, label: grp, cell: sizeInput(sizes(grp, m), seuil, value(grp, m)) })), seuil, true);
    return g.groups.map((grp) => col.get(grp)!);
  };
  const months = new Map(known.map((m) => [m, column(m)]));
  const share = stock || known.length === 0 ? null : g.groups.map((_, i) => windowStatus(known.map((m) => months.get(m)![i])));
  return { months, share };
}

// Grille après masquage : même forme, une cellule masquée est n.d. avec la raison du seuil ; le total du mois n'est jamais modifié.
// seuil null : toute cellule de groupe d'un mois connu est n.d. avec la raison du paramètre (reason).
export function maskedGrid<G extends GridIn>(g: G, mask: GridMask | null, seuil: number | null, reason: string | null): G {
  const cell = (grp: string, m: string): CellIn => {
    const c = g.cell(grp, m);
    if (c.kind !== "value") return c;
    if (seuil === null) return { kind: "nd", reason: reason ?? SEUIL_NON_DEFINI };
    const st = mask?.months.get(m)?.[g.groups.indexOf(grp)];
    return st !== undefined && isHidden(st) ? { kind: "nd", reason: maskReason(st, seuil)! } : c;
  };
  return { ...g, cell } as G;
}

// Nombre de cellules de la grille masquées par le seuil (information de l'écran et de l'export) ; les cumuls ne sont pas comptés.
export const maskedCount = (mask: GridMask | null): number => (mask ? [...mask.months.values()].reduce((n, st) => n + st.filter(isHidden).length, 0) : 0);

// Répartition par groupe après masquage, lue dans la même passe que la grille (gridMask) : un stock se lit au dernier mois connu
// (mêmes cellules, même statut que la colonne) ; un flux se cumule sur les mois connus et le cumul d'un groupe porte le statut de sa
// cellule de cumul (relation « ses mois → son cumul », puis colonne des cumuls au total publié). v null : n.d. avec sa raison. Sans
// seuil : chaque groupe est n.d. avec la raison du paramètre, le total reste.
export type GridRead = { seuil: number; mask: GridMask } | { seuil: null; reason: string };
export type MaskedRepartition = { known: string[]; used: string[]; items: { group: string; v: number | null; reason: string | null }[]; total: number };
export function repartitionMasked(g: GridIn, stock: boolean, read: GridRead): MaskedRepartition {
  const r = repartition(g, stock);
  if (read.seuil === null) return { ...r, items: r.items.map((it) => ({ group: it.group, v: null, reason: read.reason })) };
  const st = stock ? (r.used[0] === undefined ? undefined : read.mask.months.get(r.used[0])) : read.mask.share;
  return {
    ...r,
    items: r.items.map((it, i) => {
      const s = st?.[i];
      return s !== undefined && isHidden(s) ? { group: it.group, v: null, reason: maskReason(s, read.seuil)! } : { group: it.group, v: it.v, reason: null };
    }),
  };
}
