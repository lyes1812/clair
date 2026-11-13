import { DEBT_NATURES, RANKS, type DebtNatureId, type RankId, type RankSettings } from "./model";

// Rang des dettes par nature : un choix de l'utilisateur, enregistré dans les paramètres de l'espace.
// Clair ne qualifie aucune créance : sans choix, il n'y a pas de rang et la répartition est n.d.
export const CRISIS_RANKS_KEY = "restructuring.crisis.ranks";

const NATURE_IDS = new Set<string>(DEBT_NATURES.map((n) => n.id));
const RANK_IDS = new Set<string>(RANKS.map((r) => r.id));

/** Lecture stricte du paramètre stocké : une clé ou une valeur inconnue rend l'ensemble illisible (null). */
export function parseRanks(value: unknown): RankSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out: RankSettings = {};
  for (const [nature, rank] of Object.entries(value)) {
    if (!NATURE_IDS.has(nature) || typeof rank !== "string" || !RANK_IDS.has(rank)) return null;
    out[nature as DebtNatureId] = rank as RankId;
  }
  return out;
}

/** Formulaire : un champ `rank-<nature>` par nature ; une valeur vide retire le rang de cette nature. */
export function ranksFromForm(form: FormData): RankSettings {
  const out: RankSettings = {};
  for (const nature of DEBT_NATURES) {
    const value = String(form.get(`rank-${nature.id}`) ?? "").trim();
    if (!value) continue;
    if (!RANK_IDS.has(value)) throw new Error(`Rang inconnu pour ${nature.label}.`);
    out[nature.id] = value as RankId;
  }
  return out;
}
