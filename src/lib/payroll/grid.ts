// Grille de comptes de la masse salariale : chaque rubrique regroupe des préfixes de comptes du journal de paie.
// Le compte d'une ligne est classé dans la rubrique dont un préfixe est le plus long. Les comptes des classes 63 et 64
// sans rubrique restent visibles comme « non classés » ; les autres classes (tiers 42/43, produits) sont des contreparties.
export type RubricRole = "brut" | "cotisations" | "hors-masse";
export type RubricId = "salaires" | "primes" | "stages" | "indemnites" | "cotisations" | "taxes" | "provisions-cp" | "autres-charges";
export type Rubric = { id: RubricId; label: string; role: RubricRole; prefixes: string[] };

// Rubriques et rôles fixes ; seuls les préfixes sont des paramètres de l'espace.
export const RUBRICS: Omit<Rubric, "prefixes">[] = [
  { id: "salaires", label: "Salaires et appointements", role: "brut" },
  { id: "primes", label: "Primes", role: "brut" },
  { id: "stages", label: "Gratifications de stage", role: "brut" },
  { id: "indemnites", label: "Indemnités et avantages", role: "brut" },
  { id: "cotisations", label: "Cotisations patronales", role: "cotisations" },
  { id: "taxes", label: "Taxes et contributions sur les salaires", role: "cotisations" },
  { id: "provisions-cp", label: "Provisions de congés payés", role: "hors-masse" },
  { id: "autres-charges", label: "Autres charges de personnel", role: "hors-masse" },
];

// Défaut validé par Lyes le 22/10/2026 (6414/6417 gardés dans le brut), recoupé avec son tableau de bord sur le journal PayFit du pilote (cotisations
// 645 + 63 et primes 6413 hors stages égaux à l'euro) : brut 641 (primes 6413, gratifications de stage 64137, indemnités
// et avantages 6414/6417), cotisations patronales 645 et taxes et contributions 63 ; provisions 6412/6485 et autres
// charges (titres-restaurant 6476…) hors masse.
export const DEFAULT_PREFIXES: Record<RubricId, string[]> = {
  salaires: ["641"],
  primes: ["6413"],
  stages: ["64137"],
  indemnites: ["6414", "6417"],
  cotisations: ["645"],
  taxes: ["63"],
  "provisions-cp": ["6412", "6485"],
  "autres-charges": ["646", "647", "648"],
};
export type AccountGrid = Record<RubricId, string[]>;

export function gridRubrics(grid: AccountGrid): Rubric[] {
  return RUBRICS.map((r) => ({ ...r, prefixes: grid[r.id] }));
}

// Préfixes : chiffres seulement, 2 à 10 caractères, un préfixe ne peut appartenir qu'à une rubrique.
export function parseGrid(value: unknown): AccountGrid | null {
  if (!value || typeof value !== "object") return null;
  const out = {} as AccountGrid;
  const seen = new Set<string>();
  for (const r of RUBRICS) {
    const list = (value as Record<string, unknown>)[r.id];
    if (!Array.isArray(list)) return null;
    const prefixes = [...new Set(list.map((p) => (typeof p === "string" ? p.trim() : "")))].sort();
    if (prefixes.some((p) => !/^\d{2,10}$/.test(p) || seen.has(p))) return null;
    prefixes.forEach((p) => seen.add(p));
    out[r.id] = prefixes;
  }
  return out;
}

export type Classified = { rubric: Rubric } | { rubric: null; payroll: boolean };

// Classement d'un compte : préfixe le plus long ; à défaut, compte de charges de personnel (63/64) non classé, ou contrepartie.
export function classify(accountId: string, rubrics: Rubric[]): Classified {
  let best: { rubric: Rubric; len: number } | null = null;
  for (const r of rubrics) for (const p of r.prefixes) if (accountId.startsWith(p) && (!best || p.length > best.len)) best = { rubric: r, len: p.length };
  if (best) return { rubric: best.rubric };
  return { rubric: null, payroll: /^6[34]/.test(accountId) };
}
