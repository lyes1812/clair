import { and, eq } from "drizzle-orm";
import { workspaceSetting } from "@/db/schema";
import { CONFIDENTIALITE_LEGACY_KEY, parseConfidentialite, readConfidentialite, setConfidentialite } from "./confidentialite";
import { CROISEE_KEYS, CROISEE_SETTING_KEYS as KEYS, type CroiseeSetting, type CroiseeSettingKey, type CroiseeSettings, type CroiseeSettingValues, type SeuilEffectif } from "./croisee/settings-format";
import { getSettingsMeta, setSetting } from "./settings";

// Paramètres de la Masse salariale croisée : règles de gestion que le rapport d'origine codait en dur, devenues des paramètres de
// l'espace SANS valeur par défaut (clés, types, raisons et lignes écrites : src/lib/croisee/settings-format.ts, sans base de données,
// ré-exportés ici). Ce fichier garde les analyseurs, la lecture et l'écriture en base. L'écran affiche n.d. avec la raison quand une
// valeur est absente ou illisible ; la saisie se fait dans les Paramètres (administrateur).
// Le seuil de confidentialité est le paramètre de toute l'application (src/lib/confidentialite) : il est lu ici par le module partagé
// (nouvelle clé, repli sur l'ancienne clé rh.croisee.confidentialite) et son écriture lui est déléguée ; settings.confidentialite
// garde la même forme pour les chapitres et les exports.
export {
  CROISEE_KEYS,
  CROISEE_SETTING_KEYS,
  CROISEE_SETTING_LABELS,
  croiseeSettingLines,
  croiseeSettingReason,
  croiseeSettingsHref,
  settingValue,
  type CroiseeSetting,
  type CroiseeSettingKey,
  type CroiseeSettingLine,
  type CroiseeSettings,
  type CroiseeSettingValues,
  type SeuilEffectif,
} from "./croisee/settings-format";

export const SEUILS_MAX = 20;
export const LIBELLE_MAX = 80;
const int = (v: unknown, min: number): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= min ? v : null);

// Analyseurs purs : une valeur est acceptée telle quelle ou refusée (null), jamais convertie (« 5 » en texte est refusé).
export const CROISEE_PARSERS: { [K in CroiseeSettingKey]: (v: unknown) => CroiseeSettingValues[K] | null } = {
  confidentialite: parseConfidentialite,
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

type Stored = Map<string, { value: unknown; updatedAt?: Date | null; updatedBy?: string | null }>;

function readOne<K extends CroiseeSettingKey>(key: K, stored: Stored): CroiseeSetting<CroiseeSettingValues[K]> {
  // Seuil de confidentialité : lecture du module partagé (nouvelle clé, puis repli sur l'ancienne clé tant qu'elle est absente).
  if (key === "confidentialite") return readConfidentialite(stored).setting as CroiseeSetting<CroiseeSettingValues[K]>;
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

// Une seule requête : les quatre clés de la croisée (dont la nouvelle clé du seuil) et l'ancienne clé du seuil, lue par repli.
export async function getCroiseeSettings(workspaceId: string): Promise<CroiseeSettings> {
  return readCroiseeSettings(await getSettingsMeta(workspaceId, [...KEYS.map((k) => CROISEE_KEYS[k]), CONFIDENTIALITE_LEGACY_KEY]));
}

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
// Le seuil de confidentialité est délégué à setConfidentialite (nouvelle clé seulement, mêmes règles d'écriture et d'audit).
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
    if (key === "confidentialite") {
      if ((await setConfidentialite(workspaceId, value as number | null, actorUserId)) !== "unchanged") written.push(key);
      continue;
    }
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
