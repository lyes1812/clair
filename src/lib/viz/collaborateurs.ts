import type { ChartSeries } from "@/components/charts/shared";
import { addMonths, monthEnd } from "@/lib/dates";

// Aides pures des écrans Collaborateurs : entrées et sorties par mois (série de graphique), pagination par l'adresse,
// recherche sur toutes les colonnes, frise de présence. Aucun calcul métier : chaque valeur vient d'un résultat déjà calculé
// (monthlyList) ; un n.d. reste n.d. (null + raison), une borne basse n'est jamais tracée comme une valeur exacte (la valeur
// « ≥ x » est dans le tableau), rien n'est ramené à zéro. Les séries sont sérialisables (composants client) : jamais de fonction.

// --- Mois
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const idx = (m: string) => Number(m.slice(5, 7)) - 1;
export const monthShortLabel = (m: string): string => SHORT[idx(m)] ?? m;
export const monthLongLabel = (m: string): string => (LONG[idx(m)] ? `${LONG[idx(m)]} ${m.slice(0, 4)}` : m);

// Étiquettes d'axe : « janv. » seul dans une même année, « oct. 25 » dès que les mois couvrent deux années.
export function monthAxis(months: string[]): { categories: string[]; titles: string[] } {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return {
    categories: months.map((m) => (years.size > 1 ? `${monthShortLabel(m)} ${m.slice(2, 4)}` : monthShortLabel(m))),
    titles: months.map(monthLongLabel),
  };
}

// « oct. 2026 » : un seul format de mois en clair pour les listes, tableaux et titres (jamais « 2026-10 »).
export const monthLabel = (m: string): string => (SHORT[idx(m)] ? `${SHORT[idx(m)]} ${m.slice(0, 4)}` : m);

// Plages de mois contiguës en clair : « oct. à déc. 2026 », « nov. 2025 à févr. 2026 », « janv. 2026, oct. à déc. 2026 ».
// Jamais une plage reconstituée entre deux mois isolés : un trou de mois coupe la plage.
export function monthRangeLabel(months: readonly string[]): string {
  const sorted = [...new Set(months)].sort();
  const runs: string[][] = [];
  for (const m of sorted) {
    const run = runs[runs.length - 1];
    if (run && addMonths(run[run.length - 1], 1) === m) run.push(m);
    else runs.push([m]);
  }
  return runs
    .map((r) => {
      const a = r[0];
      const b = r[r.length - 1];
      if (a === b) return monthLabel(a);
      return a.slice(0, 4) === b.slice(0, 4) ? `${monthShortLabel(a)} à ${monthLabel(b)}` : `${monthLabel(a)} à ${monthLabel(b)}`;
    })
    .join(", ");
}

// Mois ISO d'un texte du moteur (« 2026-11 → 2026-12 », « 2026-10 ») écrits en clair ; les dates complètes (2026-10-24) restent intactes.
export function clearMonths(text: string): string {
  return text.replace(/(?<![\d-])(\d{4}-\d{2})(?: → (\d{4}-\d{2}))?(?![\d-])/g, (_all, a: string, b?: string) => (b ? (b >= a ? monthRangeLabel(monthsFromTo(a, b)) : `${monthLabel(a)} → ${monthLabel(b)}`) : monthLabel(a)));
}
function monthsFromTo(a: string, b: string): string[] {
  const out: string[] = [];
  for (let m = a, i = 0; m <= b && i < 600; m = addMonths(m, 1), i++) out.push(m);
  return out;
}

// Mois affiché par défaut : le dernier mois dont le dernier jour est couvert par la date de référence (le mois en cours à
// cette date est incomplet, donc sans effectif de fin de mois). À défaut (aucun mois clos, date absente) : le repli donné.
export function defaultMonth(months: readonly string[], referenceDate: string | null | undefined, fallback: string | null): string | null {
  if (!referenceDate) return fallback;
  const closed = months.filter((m) => monthEnd(m) <= referenceDate);
  return closed.length ? closed[closed.length - 1] : fallback;
}

// « ≥ 6 » écrit en toutes lettres (« au moins 6 ») : en grand, « ≥ 0 » se lirait comme un zéro.
export const atLeast = (text: string): string => (text.startsWith("≥ ") ? `au moins ${text.slice(2)}` : text);

// Pied de tuile : la donnée qui qualifie le chiffre (borne basse, mois couverts, déclarés après leur fin), mois en clair, sans le renvoi
// narratif « (voir la couverture du mois) » ; « au moins » seul (marqueur interne du moteur) n'est pas un pied. null s'il ne reste rien.
export function tileFoot(foot: string | undefined): string | null {
  if (!foot || foot === "au moins") return null;
  const t = clearMonths(foot.replace(/\s*\((?:voir|cf\.)[^)]*\)/gi, "")).trim();
  return t || null;
}

// Raisons n.d. identiques regroupées : une ligne par raison, avec les mois concernés en plage (« oct. à déc. 2026 »).
export type MonthReason = { month: string; reason: string };
export function groupMonthReasons(items: readonly MonthReason[]): { months: string[]; label: string; reason: string }[] {
  const by = new Map<string, string[]>();
  for (const it of items) by.set(it.reason, [...(by.get(it.reason) ?? []), it.month]);
  return [...by].map(([reason, months]) => ({ reason, months: [...months].sort(), label: monthRangeLabel(months) }));
}

// Notes sous un tableau : une même raison n.d. n'est écrite qu'une fois, avec les colonnes concernées (dans l'ordre d'apparition).
export function collectNotes(entries: readonly { column: string; reason: string }[]): { reason: string; columns: string[] }[] {
  const by = new Map<string, string[]>();
  for (const e of entries) {
    const cols = by.get(e.reason) ?? [];
    if (!cols.includes(e.column)) cols.push(e.column);
    by.set(e.reason, cols);
  }
  return [...by].map(([reason, columns]) => ({ reason, columns }));
}

// Mois d'une liste du moteur (« 2026-01, 2026-03 → 2026-05 », plages développées) ; null si le texte n'a pas ce format.
export function monthsOfRanges(text: string): string[] | null {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const m = /^(\d{4}-\d{2})(?: → (\d{4}-\d{2}))?$/.exec(part.trim());
    if (!m || (m[2] && m[2] < m[1])) return null;
    out.push(...(m[2] ? monthsFromTo(m[1], m[2]) : [m[1]]));
  }
  return out;
}

// Qualificatif de borne basse d'un total annuel : la partie « ; n.d. : <mois> » n'est retirée que si chacun de ces mois a déjà sa
// raison écrite ailleurs sur l'écran (« said ») ; sinon elle reste : aucun mois n.d. n'est passé sous silence.
export function shortQualifier(q: string, said: readonly string[] = []): string {
  const m = /^(.*?)\s*;\s*n\.d\. : (.*)$/.exec(q);
  if (!m) return q;
  const months = monthsOfRanges(m[2]);
  if (!months || months.length === 0) return q;
  return months.every((x) => said.includes(x)) ? m[1] : q;
}

// « 1 comptée sur 3 » : accord du participe et de « aucune » (les titres ne portent plus de « (s) »).
export function countedPhrase(counted: number, total: number): string {
  if (total === 0) return "aucune sur la période";
  if (counted === 0) return `aucune comptée sur ${total}`;
  return `${counted} ${counted === 1 ? "comptée" : "comptées"} sur ${total}`;
}

// « 1 ligne », « 7 lignes », « 0 ligne » : accord du nom (zéro et un au singulier) ; jamais de « (s) ».
export const plural = (n: number, noun: string, pluralNoun = `${noun}s`): string => `${nf.format(n)} ${n < 2 ? noun : pluralNoun}`;

// Période d'un titre : « oct. 2026 » ou « nov. 2025 → oct. 2026 ».
export const periodLabel = (from: string, to: string): string => (from === to ? monthLabel(from) : `${monthLabel(from)} → ${monthLabel(to)}`);

// --- Entrées et sorties par mois
type Nd = { nd: { reason: string } };
export type CountIn = { kind: "exact" | "lower_bound"; value: number; qualifiers?: string[] } | ({ kind: "nd" } & Nd);
export type MonthCountsIn = { month: string; entries: CountIn; exits: CountIn };

const nf = new Intl.NumberFormat("fr-FR");
const LOWER = "source incomplète, non tracée comme valeur exacte";
type Point = { value: number | null; reason: string | null };
// Borne basse : non tracée ; la raison reprend les qualificatifs du moteur (mois en cours, source incomplète…), à défaut la formule générale.
// Les mois ISO du texte du moteur sont écrits en clair et « ≥ n » en « au moins n » (infobulle du graphique).
const lowerReason = (c: { value: number; qualifiers?: string[] }): string =>
  c.qualifiers?.length
    ? `borne basse (au moins ${nf.format(c.value)}) : ${clearMonths(c.qualifiers.join(" · "))} — non tracée comme valeur exacte`
    : `borne basse (au moins ${nf.format(c.value)}) : ${LOWER}`;
const point = (c: CountIn): Point => (c.kind === "nd" ? { value: null, reason: clearMonths(c.nd.reason) } : c.kind === "lower_bound" ? { value: null, reason: lowerReason(c) } : { value: c.value, reason: null });

// Une série « Entrées » et une série « Sorties », un point par mois (unité : nombre de contrats).
export function movementSeries(months: MonthCountsIn[]): ChartSeries[] {
  const build = (key: string, name: string, pick: (m: MonthCountsIn) => CountIn): ChartSeries => {
    const pts = months.map((m) => point(pick(m)));
    return { key, name, values: pts.map((p) => p.value), reasons: pts.map((p) => p.reason) };
  };
  return [build("entrees", "Entrées", (m) => m.entries), build("sorties", "Sorties", (m) => m.exits)];
}

// Série entièrement absente : le graphique est remplacé par la raison (une rangée de colonnes hachurées ne dirait rien).
// null dès qu'une valeur est connue.
export function ndSummary(list: ChartSeries[]): string | null {
  if (list.some((s) => s.values.some((v) => v !== null && v !== undefined))) return null;
  const reasons = [...new Set(list.flatMap((s) => (s.reasons ?? []).filter((r): r is string => !!r)))];
  return reasons.length ? reasons.slice(0, 3).join(" ; ") + (reasons.length > 3 ? ` ; … (${reasons.length} raisons)` : "") : "aucune valeur disponible";
}

// --- Pagination par l'adresse : page et taille (20, 50 ou 100 lignes)
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export function pageSizeOf(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

// Numéro de page demandé : entier ≥ 1, sinon 1 (le plafond est appliqué par paginate).
export function pageOf(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function paginate<T>(items: readonly T[], requested: number, size: number): { items: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pages);
  return { items: items.slice((page - 1) * size, page * size), page, pages, total };
}

// Adresse relative d'une page de liste : seuls les paramètres renseignés sont écrits, la page 1 n'est pas écrite.
export function pageHref(params: Record<string, string | undefined>, page = 1): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, v);
  if (page > 1) u.set("page", String(page));
  return `?${u.toString()}`;
}

// --- Recherche sur toutes les colonnes : insensible à la casse et aux accents, tous les mots doivent se trouver (dans une
// même colonne chacun ; un mot ne chevauche jamais deux colonnes).
export const fold = (t: string): string => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function matchesQuery(cells: ReadonlyArray<string | number | null | undefined>, query: string): boolean {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = fold(cells.filter((c) => c !== null && c !== undefined && c !== "").join("\n"));
  return tokens.every((t) => hay.includes(t));
}

// --- Frise de présence en fin de mois (liste annuelle)
export type StripCellIn = { month: string; state: "present" | "absent" | "nd"; reason: string | null };

export const stripCellTitle = (c: StripCellIn): string => {
  const why = c.reason ? clearMonths(c.reason) : null;
  return `${monthLabel(c.month)} : ${c.state === "present" ? "présent en fin de mois" : c.state === "absent" ? (why ? `absent (${why})` : "absent") : why ? `n.d. — ${why}` : "n.d."}`;
};

// Lecture à voix haute : « janv. présent, févr. absent, mars n.d. … ».
export const stripLabel = (cells: StripCellIn[]): string => `Présence en fin de mois : ${cells.map((c) => `${monthShortLabel(c.month)} ${c.state === "present" ? "présent" : c.state === "absent" ? "absent" : "n.d."}`).join(", ")}`;

// Trimestres (groupes de trois mois) : la frise se lit par blocs.
export function quarters<T>(cells: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cells.length; i += 3) out.push(cells.slice(i, i + 3));
  return out;
}
