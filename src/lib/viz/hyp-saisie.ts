import { toCents } from "@/lib/money";

// Logique pure des écrans de saisie des hypothèses budgétaires : recherche « toutes les colonnes », pagination, années d'une
// grille mensuelle, outils de copie d'une grille (« Copier vers la droite », « Copier vers le bas », « Remplir la ligne ») et
// lecture de l'état d'une saisie. Aucun calcul métier : on range et on relit des valeurs déjà saisies ou déjà calculées.
// Les outils de grille tournent dans le navigateur (GridTools) ; leur logique est ici pour être testée sans navigateur.

// Texte comparable : sans accents ni majuscules.
export const fold = (t: string): string => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Recherche « toutes les colonnes » : chaque mot saisi doit se retrouver dans au moins une colonne de la ligne.
// Une recherche vide retient toutes les lignes.
export function matchesQuery(columns: (string | null | undefined)[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(columns.filter((c): c is string => typeof c === "string" && c !== "").join(" \u0001 "));
  return words.every((w) => haystack.includes(w));
}

// --- Pagination (la page courante est portée par l'adresse)
export const pageNumber = (raw: string | undefined | null): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};
export type Paged<T> = { page: number; pages: number; total: number; from: number; to: number; items: T[] };
export function paginate<T>(items: T[], page: number, size: number): Paged<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  return { page: p, pages, total: items.length, from: items.length === 0 ? 0 : start + 1, to: Math.min(items.length, start + size), items: items.slice(start, start + size) };
}

// --- Mois et dates
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// « janv. » ; « janv. 26 » quand la grille couvre plusieurs années.
export const monthColumnLabel = (m: string, withYear: boolean): string => `${SHORT[Number(m.slice(5, 7)) - 1] ?? m}${withYear ? ` ${m.slice(2, 4)}` : ""}`;
// AAAA-MM-JJ → JJ/MM/AAAA ; toute autre valeur est rendue telle quelle (jamais transformée en date inventée).
export const dateFr = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export type YearGroup = { year: string; months: string[] };
// Mois d'une grille regroupés par année, dans l'ordre : le commutateur d'année n'existe que si la grille couvre plusieurs années.
export function yearGroups(months: string[]): YearGroup[] {
  const out: YearGroup[] = [];
  for (const m of months) {
    const year = m.slice(0, 4);
    const last = out.at(-1);
    if (last && last.year === year) last.months.push(m);
    else out.push({ year, months: [m] });
  }
  return out;
}

// --- Outils d'une grille : cellules dans l'ordre du document (ligne par ligne).
export type GridCell = { row: string; col: string; visible: boolean };

// Copier vers la droite : les cellules visibles de la même ligne, après la cellule active.
export function rightTargets(cells: GridCell[], active: number): number[] {
  const a = cells[active];
  if (!a) return [];
  return cells.flatMap((c, i) => (i > active && c.row === a.row && c.visible ? [i] : []));
}

// Copier vers le bas : les cellules visibles de la même colonne, dans les lignes situées sous la ligne active.
export function downTargets(cells: GridCell[], active: number): number[] {
  const a = cells[active];
  if (!a) return [];
  const rank = new Map<string, number>();
  for (const c of cells) if (!rank.has(c.row)) rank.set(c.row, rank.size);
  const ar = rank.get(a.row)!;
  return cells.flatMap((c, i) => (c.col === a.col && rank.get(c.row)! > ar && c.visible ? [i] : []));
}

// Cellule voisine dans la colonne (dir 1 : ligne du dessous, -1 : ligne du dessus), pour naviguer au clavier comme dans un
// tableur ; -1 s'il n'y en a pas.
export function neighborInColumn(cells: GridCell[], active: number, dir: 1 | -1): number {
  const a = cells[active];
  if (!a) return -1;
  const rank = new Map<string, number>();
  for (const c of cells) if (!rank.has(c.row)) rank.set(c.row, rank.size);
  const from = rank.get(a.row)!;
  let best = -1;
  let bestRank = dir === 1 ? Infinity : -Infinity;
  cells.forEach((c, i) => {
    if (c.col !== a.col || !c.visible) return;
    const r = rank.get(c.row)!;
    if (dir === 1 ? r > from && r < bestRank : r < from && r > bestRank) {
      best = i;
      bestRank = r;
    }
  });
  return best;
}

// Remplir la ligne : toutes les cellules visibles de la ligne de la cellule active (elle comprise).
export function rowTargets(cells: GridCell[], active: number): number[] {
  const a = cells[active];
  if (!a) return [];
  return cells.flatMap((c, i) => (c.row === a.row && c.visible ? [i] : []));
}

// Reporter (bouton de fin de ligne) : la première valeur renseignée de la ligne est recopiée sur toutes les cellules suivantes.
export function reportTargets(values: string[]): { from: number; value: string; targets: number[] } | null {
  const first = values.findIndex((v) => v.trim() !== "");
  if (first < 0) return null;
  return { from: first, value: values[first], targets: values.map((_, i) => i).filter((i) => i > first) };
}

// Valeur à reporter sur une ligne : aucune valeur n'est proposée ; vide ou illisible, rien n'est rempli.
// La lecture est celle du serveur (toCents) : ce que l'écran accepte, l'enregistrement l'accepte aussi.
export type FillCheck = "vide" | "illisible" | "ok";
export const checkFill = (raw: string): FillCheck => (raw.trim() === "" ? "vide" : toCents(raw) === null ? "illisible" : "ok");

// --- État d'une saisie : modifications non enregistrées et valeurs illisibles
export type FieldState = { label: string; raw: string; changed: boolean; numeric: boolean };
export type Unreadable = { label: string; raw: string };
export function scanFields(fields: FieldState[]): { changed: number; unreadable: Unreadable[] } {
  return {
    changed: fields.filter((f) => f.changed).length,
    unreadable: fields.filter((f) => f.numeric && f.raw.trim() !== "" && toCents(f.raw) === null).map((f) => ({ label: f.label, raw: f.raw })),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export function dirtyText(changed: number, unreadable: Unreadable[]): string {
  const base = changed === 0 ? "Aucune modification non enregistrée" : `${plural(changed, "modification non enregistrée", "modifications non enregistrées")}`;
  if (unreadable.length === 0) return `${base}.`;
  const first = unreadable[0];
  return `${base} · ${plural(unreadable.length, "valeur illisible", "valeurs illisibles")} à corriger (${first.label} : « ${first.raw.trim()} »${unreadable.length > 1 ? ", …" : ""}).`;
}

// --- Années d'une grille : colonnes masquées par le commutateur (data-yi = rang de l'année), étiquettes des mois, nombre de
// cellules renseignées par année. Une grille d'une seule année n'a ni commutateur ni rang.
export const countByYear = (months: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const m of months) out[m.slice(0, 4)] = (out[m.slice(0, 4)] ?? 0) + 1;
  return out;
};
export function gridYears(months: string[], counts: Record<string, number> = {}) {
  const groups = yearGroups(months);
  const multi = groups.length > 1;
  return {
    multi,
    index: (m: string): number | undefined => (multi ? groups.findIndex((g) => g.year === m.slice(0, 4)) : undefined),
    label: (m: string): string => monthColumnLabel(m, multi),
    tabs: multi ? groups.map((g) => ({ label: g.year, count: counts[g.year] || undefined })) : undefined,
  };
}
