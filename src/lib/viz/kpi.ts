import type { ChartSeries } from "@/components/charts/shared";
import { confidentialiteSettingReason, isHidden, maskGroups, maskReason, maskRelations, maskSize, type ConfidentialiteSetting, type MaskCell, type MaskInput, type MaskRelation, type MaskStatus, type PersonsOfContracts } from "@/lib/confidentialite";
import { groupInput, unionGroups } from "@/lib/croisee/confidentialite";
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
export type CategoryMonthIn =
  | { kind: "value"; month: string; lowerBound: boolean; byCategory: Record<string, { headcount: number; etp4: number | null }> }
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
// n'est pas tracé ; un ETP n.d. (contrat sans quotité) reste n.d.
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

// --- Tableau par motif du détail de l'absentéisme (même règle que la croisée 03, colonne de la période de congesMask) -------------
// Cellule d'un motif : personnes comptées (une borne basse sans personne comptée n'est pas dénombrée : non vérifiable, comme
// congeSize) ; exempt : le seul motif retenu présent dans la lecture (sa ligne égale la tuile Absentéisme, déjà publiée). Relations
// dont la somme est publiée : les motifs retenus (tuile Absentéisme de la période) ; les autres motifs, dont la somme se déduit du
// taux tous motifs (cellule onlyAsTotal : masquée seulement quand rien d'autre ne protège un motif masqué).
export type MotifMaskLine = { chosen: boolean; kind: "exact" | "lower_bound" | "nd"; half: number | null; persons?: string[]; unlinked?: number };
export type MotifMask = { lines: MaskStatus[]; all: MaskStatus; exempt: number | null };
export function motifMask(lines: readonly MotifMaskLine[], published: { tile: boolean; all: boolean }, seuil: number): MotifMask {
  const chosen = lines.flatMap((l, i) => (l.chosen ? [i] : []));
  const exempt = chosen.length === 1 ? chosen[0] : null;
  const cells: MaskCell[] = lines.map((l, i): MaskCell => {
    if (l.kind === "nd" || l.half === null) return { size: null, value: null };
    const g: PersonsOfContracts = { persons: l.persons ?? [], unlinked: l.unlinked ?? 0 };
    const s = maskSize(g, seuil);
    const size = s === 0 && (l.half > 0 || l.kind === "lower_bound") ? null : s;
    return { size, value: l.half, members: size === null ? [] : g.persons, exempt: i === exempt };
  });
  const allAt = cells.length;
  cells.push({ size: null, value: published.all ? 0 : null, onlyAsTotal: true });
  const all = lines.map((_, i) => i);
  const others = all.filter((i) => !lines[i].chosen);
  const rel: MaskRelation[] = [];
  if (published.tile && published.all) rel.push({ cells: chosen }, { cells: others, total: allAt });
  else if (published.all) rel.push({ cells: all, total: allAt });
  else if (published.tile) rel.push({ cells: chosen });
  const st = maskRelations(cells, rel, seuil);
  return { lines: st.slice(0, allAt), all: st[allAt], exempt };
}

// Lignes du tableau par motif après masquage : une ligne masquée garde son motif et « retenu » ; ses quatre nombres (absences de la
// lecture et de la période, demi-journées, taux) sont n.d. avec la raison du seuil, jamais 0.
export type MaskedMotifRow = MotifRow & { masked: string | null };
export function maskMotifRows(rows: MotifRow[], mask: MotifMask | null, seuil: number | null, settingReason: string | null): MaskedMotifRow[] {
  return rows.map((r, i): MaskedMotifRow => {
    const reason = settingReason ?? (mask && seuil !== null && isHidden(mask.lines[i]) ? maskReason(mask.lines[i], seuil) : null);
    return reason ? { ...r, kind: "nd", halfText: "n.d.", rateText: "n.d.", reason, masked: reason } : { ...r, masked: null };
  });
}

// Nombre d'absences par motif de toute la lecture (bloc « Motifs de la lecture » de la tuile) : masquage principal seulement (aucun
// total publié), en personnes distinctes des contrats des absences. null : nombre affiché ; sinon la raison du n.d.
export function typeCountMask(sizes: Readonly<Record<string, PersonsOfContracts>>, type: string, count: number, seuil: number): string | null {
  const g = sizes[type] ?? { persons: [], unlinked: 0 };
  const [st] = maskGroups([groupInput(g, seuil, count)], seuil, false);
  return isHidden(st) ? maskReason(st, seuil) : null;
}

// --- Effectifs mensuels : cellules d'une répartition (groupe × mois), masquage secondaire par colonne (total du mois publié) ------
// sizes : personnes distinctes d'un groupe un mois donné (contrats reliés par le référentiel), null quand elles ne sont pas dénombrées.
export type GridSizes = (group: string, month: string) => PersonsOfContracts | null;
export type GridMask = Map<string, MaskStatus[]>; // mois → statut de chaque groupe (ordre de g.groups) ; mois absent : total n.d.
const sizeInput = (g: PersonsOfContracts | null, seuil: number, value: number | null): MaskInput => (g ? groupInput(g, seuil, value) : { size: null, value });
export function gridMask(g: GridIn, sizes: GridSizes, seuil: number): GridMask {
  const out: GridMask = new Map();
  for (const m of g.months) {
    if (g.total(m).kind !== "value") continue;
    const cells = g.groups.map((grp) => {
      const c = g.cell(grp, m);
      return sizeInput(sizes(grp, m), seuil, c.kind === "value" ? c.v : null);
    });
    out.set(m, maskGroups(cells, seuil, true));
  }
  return out;
}

// Grille après masquage : même forme, une cellule masquée est n.d. avec la raison du seuil ; le total du mois n'est jamais modifié.
// seuil null : toute cellule de groupe d'un mois connu est n.d. avec la raison du paramètre (reason).
export function maskedGrid<G extends GridIn>(g: G, mask: GridMask | null, seuil: number | null, reason: string | null): G {
  const cell = (grp: string, m: string): CellIn => {
    const c = g.cell(grp, m);
    if (c.kind !== "value") return c;
    if (seuil === null) return { kind: "nd", reason: reason ?? "seuil de confidentialité non défini (Paramètres)" };
    const st = mask?.get(m)?.[g.groups.indexOf(grp)];
    return st !== undefined && isHidden(st) ? { kind: "nd", reason: maskReason(st, seuil)! } : c;
  };
  return { ...g, cell } as G;
}

// Nombre de cellules masquées par le seuil (information de l'écran et de l'export).
export const maskedCount = (mask: GridMask | null): number => (mask ? [...mask.values()].reduce((n, st) => n + st.filter(isHidden).length, 0) : 0);

// Répartition par groupe après masquage : un stock se lit au dernier mois connu (mêmes cellules, même masquage que la colonne) ; un
// flux se cumule sur les mois connus, et le cumul d'un groupe est masqué selon les personnes distinctes de ces mois réunis (le total
// du cumul est publié : masquage secondaire). v null : n.d. avec sa raison. Sans seuil : chaque groupe est n.d. avec la raison du
// paramètre, le total reste.
export type MaskedRepartition = { known: string[]; used: string[]; items: { group: string; v: number | null; reason: string | null }[]; total: number };
export function repartitionMasked(g: GridIn, stock: boolean, sizes: GridSizes, seuil: number | null, reason: string | null): MaskedRepartition {
  const r = repartition(g, stock);
  if (seuil === null) return { ...r, items: r.items.map((it) => ({ group: it.group, v: null, reason: reason ?? "seuil de confidentialité non défini (Paramètres)" })) };
  const union = (group: string): PersonsOfContracts | null => {
    const parts = r.used.map((m) => sizes(group, m));
    return parts.some((p) => p === null) ? null : unionGroups(...(parts as PersonsOfContracts[]));
  };
  const st = maskGroups(
    r.items.map((it) => sizeInput(r.used.length ? union(it.group) : { persons: [], unlinked: 0 }, seuil, it.v)),
    seuil,
    true,
  );
  return { ...r, items: r.items.map((it, i) => (isHidden(st[i]) ? { group: it.group, v: null, reason: maskReason(st[i], seuil)! } : { group: it.group, v: it.v, reason: null })) };
}
