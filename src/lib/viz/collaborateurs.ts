import type { ChartSeries } from "@/components/charts/shared";

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

// --- Entrées et sorties par mois
type Nd = { nd: { reason: string } };
export type CountIn = { kind: "exact" | "lower_bound"; value: number; qualifiers?: string[] } | ({ kind: "nd" } & Nd);
export type MonthCountsIn = { month: string; entries: CountIn; exits: CountIn };

const nf = new Intl.NumberFormat("fr-FR");
const LOWER = "source incomplète, non tracée comme valeur exacte";
type Point = { value: number | null; reason: string | null };
// Borne basse : non tracée ; la raison reprend les qualificatifs du moteur (mois en cours, source incomplète…), à défaut la formule générale.
const lowerReason = (c: { value: number; qualifiers?: string[] }): string =>
  c.qualifiers?.length ? `borne basse (≥ ${nf.format(c.value)}) : ${c.qualifiers.join(" · ")} — non tracée comme valeur exacte` : `borne basse (≥ ${nf.format(c.value)}) : ${LOWER}`;
const point = (c: CountIn): Point => (c.kind === "nd" ? { value: null, reason: c.nd.reason } : c.kind === "lower_bound" ? { value: null, reason: lowerReason(c) } : { value: c.value, reason: null });

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

export const stripCellTitle = (c: StripCellIn): string => `${c.month} : ${c.state === "present" ? "présent en fin de mois" : c.state === "absent" ? `absent (${c.reason})` : `n.d. — ${c.reason}`}`;

// Lecture à voix haute : « janv. présent, févr. absent, mars n.d. … ».
export const stripLabel = (cells: StripCellIn[]): string => `Présence en fin de mois : ${cells.map((c) => `${monthShortLabel(c.month)} ${c.state === "present" ? "présent" : c.state === "absent" ? "absent" : "n.d."}`).join(", ")}`;

// Trimestres (groupes de trois mois) : la frise se lit par blocs.
export function quarters<T>(cells: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cells.length; i += 3) out.push(cells.slice(i, i + 3));
  return out;
}
