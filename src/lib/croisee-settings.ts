import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { getSettingsMeta, setSetting } from "./settings";

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
  seuilsEffectif: SeuilEffectif[]; // seuils suivis (libellé + effectif), triés par valeur croissante ; liste vide = non définis
  margeAlerte: number; // écart maximal (≤), en salariés, au prochain seuil en deçà duquel un repère est émis (entier ≥ 0)
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
  // Liste explicite de { libelle, valeur } ; libellé non vide, valeur entière ≥ 1, valeurs distinctes. Une liste vide est lisible
  // mais ne définit aucun seuil : settingValue la renvoie null et croiseeSettingReason donne « seuils d'effectif non définis ».
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

// Une valeur enregistrée qui ne définit rien : la liste vide (seuils d'effectif). Elle vaut « non défini », jamais « aucun seuil ».
const emptyList = (s: CroiseeSetting<unknown>): boolean => s.kind === "set" && Array.isArray(s.value) && s.value.length === 0;

// Valeur utilisable, ou null (absente, illisible ou liste vide : la raison est donnée par croiseeSettingReason).
type SetValue<S> = S extends { kind: "set"; value: infer V } ? V : never;
export const settingValue = <S extends CroiseeSetting<unknown>>(s: S): SetValue<S> | null => (s.kind === "set" && !emptyList(s) ? (s as { value: SetValue<S> }).value : null);

const NAMES: Record<CroiseeSettingKey, { absent: string; invalid: string }> = {
  confidentialite: { absent: "seuil de confidentialité non défini (Paramètres)", invalid: "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)" },
  seuilsEffectif: { absent: "seuils d'effectif non définis (Paramètres)", invalid: "seuils d'effectif illisibles : à ré-enregistrer (Paramètres)" },
  margeAlerte: { absent: "marge d'alerte des seuils d'effectif non définie (Paramètres)", invalid: "marge d'alerte des seuils d'effectif illisible : à ré-enregistrer (Paramètres)" },
  horizonEcheances: { absent: "horizon des échéances non défini (Paramètres)", invalid: "horizon des échéances illisible : à ré-enregistrer (Paramètres)" },
};

// Raison d'un n.d. dû à un paramètre (null quand la valeur est définie ; une liste vide vaut « non défini »).
export function croiseeSettingReason(key: CroiseeSettingKey, s: CroiseeSetting<unknown>): string | null {
  if (emptyList(s)) return NAMES[key].absent;
  return s.kind === "set" ? null : NAMES[key][s.kind];
}

// Lignes du bloc « Sources et hypothèses de travail » : chaque paramètre, sa valeur écrite ou n.d. avec la raison (jamais de défaut).
export const CROISEE_SETTING_LABELS: Record<CroiseeSettingKey, string> = {
  confidentialite: "Seuil de confidentialité",
  seuilsEffectif: "Seuils d'effectif suivis",
  margeAlerte: "Marge d'alerte des seuils d'effectif",
  horizonEcheances: "Horizon des échéances de contrat",
};
const count = new Intl.NumberFormat("fr-FR");
const many = (n: number, one: string, more: string) => `${count.format(n)} ${n > 1 ? more : one}`;
export type CroiseeSettingLine = { key: CroiseeSettingKey; label: string; text: string | null; reason: string | null };
export function croiseeSettingLines(settings: CroiseeSettings): CroiseeSettingLine[] {
  const text: { [K in CroiseeSettingKey]: (v: CroiseeSettingValues[K]) => string } = {
    confidentialite: (v) => many(v, "personne", "personnes"),
    seuilsEffectif: (v) => v.map((x) => `« ${x.libelle} » : ${many(x.valeur, "salarié", "salariés")}`).join(" ; "),
    margeAlerte: (v) => many(v, "salarié", "salariés"),
    horizonEcheances: (v) => many(v, "jour", "jours"),
  };
  const line = <K extends CroiseeSettingKey>(key: K): CroiseeSettingLine => {
    const s = settings[key];
    const reason = croiseeSettingReason(key, s);
    return { key, label: CROISEE_SETTING_LABELS[key], text: reason === null && s.kind === "set" ? text[key](s.value as CroiseeSettingValues[K]) : null, reason };
  };
  return KEYS.map(line);
}

// Lien vers la section des Paramètres où ces règles se saisissent.
export const croiseeSettingsHref = (slug: string) => `/e/${slug}/parametres#croisee`;

// --- Écriture (Paramètres, administrateur) ---------------------------------------------------------------------------------------

// Valeurs à enregistrer : une valeur pour définir le réglage, null pour le supprimer (retour à « non défini »), clé omise = inchangée.
export type CroiseeWrite = { [K in CroiseeSettingKey]?: CroiseeSettingValues[K] | null };

// Suppression d'un réglage, tracée comme une modification (valeur null). Les modules de base de données sont chargés à la demande :
// la lecture et les analyseurs de ce fichier restent utilisables sans connexion.
async function deleteSetting(workspaceId: string, key: string, actorUserId: string): Promise<void> {
  const [{ withWorkspace }, { recordEvent }] = await Promise.all([import("@/db/workspace-scope"), import("./events")]);
  await withWorkspace(workspaceId, (tx) => tx.delete(workspaceSetting).where(and(eq(workspaceSetting.workspaceId, workspaceId), eq(workspaceSetting.key, key))));
  await recordEvent(workspaceId, actorUserId, "setting.changed", { key, value: null });
}

// Enregistre les réglages fournis. Toutes les valeurs passent d'abord par leur analyseur : une seule valeur illisible refuse tout
// l'enregistrement, sans rien écrire. null (ou une liste de seuils vide) supprime le réglage, jamais remplacé par 0 ou par un défaut.
// Seules les clés dont la valeur change sont écrites, chacune tracée par un événement setting.changed. Renvoie les clés écrites.
export async function setCroiseeSettings(workspaceId: string, next: CroiseeWrite, actorUserId: string): Promise<CroiseeSettingKey[]> {
  const plan: { key: CroiseeSettingKey; value: unknown }[] = [];
  for (const k of KEYS) {
    const v = next[k];
    if (v === undefined) continue;
    if (v === null || (Array.isArray(v) && v.length === 0)) {
      plan.push({ key: k, value: null });
      continue;
    }
    const parsed = CROISEE_PARSERS[k](v);
    if (parsed === null) throw new Error(`Valeur invalide pour ${CROISEE_KEYS[k]}.`);
    plan.push({ key: k, value: parsed });
  }
  if (plan.length === 0) return [];
  const current = await getCroiseeSettings(workspaceId);
  const written: CroiseeSettingKey[] = [];
  for (const { key, value } of plan) {
    const cur = current[key];
    if (value === null) {
      if (cur.kind === "absent") continue;
      await deleteSetting(workspaceId, CROISEE_KEYS[key], actorUserId);
    } else {
      if (cur.kind === "set" && JSON.stringify(cur.value) === JSON.stringify(value)) continue;
      await setSetting(workspaceId, CROISEE_KEYS[key], value, actorUserId);
    }
    written.push(key);
  }
  return written;
}
