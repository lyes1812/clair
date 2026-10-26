import { getSettingsMeta } from "./settings";

// Paramètres de la Masse salariale croisée : règles de gestion que le rapport d'origine codait en dur, devenues des paramètres de
// l'espace SANS valeur par défaut. Chaque clé est lue en trois états : absente (rien d'enregistré), définie (valeur lisible) ou
// illisible (valeur enregistrée qui ne passe pas l'analyseur : jamais remplacée par une valeur de repli). L'écran affiche n.d. avec
// la raison dans les deux premiers cas qui le demandent ; la saisie (administrateur) viendra avec l'écran Paramètres.
export const CROISEE_KEYS = {
  confidentialite: "rh.croisee.confidentialite",
  seuilsEffectif: "rh.croisee.seuilsEffectif",
  margeAlerte: "rh.croisee.margeAlerte",
  horizonEcheances: "rh.croisee.horizonEcheances",
} as const;
export type CroiseeSettingKey = keyof typeof CROISEE_KEYS;

export type SeuilEffectif = { libelle: string; valeur: number };
export type CroiseeSettingValues = {
  confidentialite: number; // nombre minimal de personnes d'un groupe affiché (entier ≥ 1)
  seuilsEffectif: SeuilEffectif[]; // seuils suivis (libellé + effectif), triés par valeur croissante
  margeAlerte: number; // écart, en personnes, à partir duquel un seuil est signalé (entier ≥ 0)
  horizonEcheances: number; // horizon des échéances de contrat, en jours (entier ≥ 1)
};

export type CroiseeSetting<T> = { kind: "absent" } | { kind: "set"; value: T; updatedAt: Date | null; updatedBy: string | null } | { kind: "invalid"; raw: unknown };
export type CroiseeSettings = { [K in CroiseeSettingKey]: CroiseeSetting<CroiseeSettingValues[K]> };

export const SEUILS_MAX = 20;
export const LIBELLE_MAX = 80;
const int = (v: unknown, min: number): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= min ? v : null);

// Analyseurs purs : une valeur est acceptée telle quelle ou refusée (null), jamais convertie (« 5 » en texte est refusé).
export const CROISEE_PARSERS: { [K in CroiseeSettingKey]: (v: unknown) => CroiseeSettingValues[K] | null } = {
  confidentialite: (v) => int(v, 1),
  margeAlerte: (v) => int(v, 0),
  horizonEcheances: (v) => int(v, 1),
  // Liste explicite (éventuellement vide) de { libelle, valeur } ; libellé non vide, valeur entière ≥ 1, valeurs distinctes.
  seuilsEffectif: (v) => {
    if (!Array.isArray(v) || v.length > SEUILS_MAX) return null;
    const out: SeuilEffectif[] = [];
    for (const x of v) {
      if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
      const { libelle, valeur, ...rest } = x as Record<string, unknown>;
      if (Object.keys(rest).length > 0) return null;
      if (typeof libelle !== "string" || libelle.trim() === "" || libelle.trim().length > LIBELLE_MAX) return null;
      const n = int(valeur, 1);
      if (n === null) return null;
      out.push({ libelle: libelle.trim(), valeur: n });
    }
    if (new Set(out.map((s) => s.valeur)).size !== out.length) return null;
    return out.sort((a, b) => a.valeur - b.valeur);
  },
};

const KEYS = Object.keys(CROISEE_KEYS) as CroiseeSettingKey[];
type Stored = Map<string, { value: unknown; updatedAt?: Date | null; updatedBy?: string | null }>;

function readOne<K extends CroiseeSettingKey>(key: K, stored: Stored): CroiseeSetting<CroiseeSettingValues[K]> {
  const row = stored.get(CROISEE_KEYS[key]);
  if (!row) return { kind: "absent" };
  const value = CROISEE_PARSERS[key](row.value);
  if (value === null) return { kind: "invalid", raw: row.value };
  return { kind: "set", value, updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null };
}

// Lecture pure à partir des lignes enregistrées (clé complète → valeur) : une clé absente de la table est « absent ».
export function readCroiseeSettings(stored: Stored): CroiseeSettings {
  const out = {} as Record<CroiseeSettingKey, CroiseeSetting<unknown>>;
  for (const k of KEYS) out[k] = readOne(k, stored);
  return out as CroiseeSettings;
}

export async function getCroiseeSettings(workspaceId: string): Promise<CroiseeSettings> {
  return readCroiseeSettings(await getSettingsMeta(workspaceId, KEYS.map((k) => CROISEE_KEYS[k])));
}

// Valeur utilisable, ou null (absente ou illisible : la raison est donnée par croiseeSettingReason).
type SetValue<S> = S extends { kind: "set"; value: infer V } ? V : never;
export const settingValue = <S extends CroiseeSetting<unknown>>(s: S): SetValue<S> | null => (s.kind === "set" ? (s as { value: SetValue<S> }).value : null);

const NAMES: Record<CroiseeSettingKey, { absent: string; invalid: string }> = {
  confidentialite: { absent: "seuil de confidentialité non défini (Paramètres)", invalid: "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)" },
  seuilsEffectif: { absent: "seuils d'effectif non définis (Paramètres)", invalid: "seuils d'effectif illisibles : à ré-enregistrer (Paramètres)" },
  margeAlerte: { absent: "marge d'alerte des seuils d'effectif non définie (Paramètres)", invalid: "marge d'alerte des seuils d'effectif illisible : à ré-enregistrer (Paramètres)" },
  horizonEcheances: { absent: "horizon des échéances non défini (Paramètres)", invalid: "horizon des échéances illisible : à ré-enregistrer (Paramètres)" },
};

// Raison d'un n.d. dû à un paramètre (null quand la valeur est définie).
export function croiseeSettingReason(key: CroiseeSettingKey, s: CroiseeSetting<unknown>): string | null {
  return s.kind === "set" ? null : NAMES[key][s.kind];
}

// Lien vers la section des Paramètres où ces règles se saisissent.
export const croiseeSettingsHref = (slug: string) => `/e/${slug}/parametres#croisee`;
