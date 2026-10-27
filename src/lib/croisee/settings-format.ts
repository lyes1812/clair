import { CONFIDENTIALITE_KEY, confidentialiteHref, SEUIL_ILLISIBLE, SEUIL_NON_DEFINI } from "@/lib/confidentialite";

// Réglages de la Masse salariale croisée : clés, types et mises en forme pures, sans lecture ni écriture en base. Les chapitres
// (src/lib/viz/croisee-*.ts, src/lib/croisee/*) et les exports les importent d'ici, ce qui leur évite de tirer le client de base de
// données à l'import ; src/lib/croisee-settings.ts les ré-exporte et garde les analyseurs, la lecture et l'écriture en base.
// Le seuil de confidentialité n'est plus propre à la croisée : c'est le paramètre de toute l'application (src/lib/confidentialite,
// clé rh.confidentialite.seuil, avec repli sur l'ancienne clé rh.croisee.confidentialite) ; il garde ici sa place parmi les
// réglages de la croisée, avec la même forme, pour que les chapitres et les exports ne changent pas.

// Règles de gestion que le rapport d'origine codait en dur, devenues des paramètres de l'espace SANS valeur par défaut. Chaque clé est
// lue en trois états : absente (rien d'enregistré), définie (valeur lisible) ou illisible (valeur enregistrée qui ne passe pas
// l'analyseur : jamais remplacée par une valeur de repli).
export const CROISEE_KEYS = {
  confidentialite: CONFIDENTIALITE_KEY,
  seuilsEffectif: "rh.croisee.seuilsEffectif",
  margeAlerte: "rh.croisee.margeAlerte",
  horizonEcheances: "rh.croisee.horizonEcheances",
} as const;
export type CroiseeSettingKey = keyof typeof CROISEE_KEYS;
export const CROISEE_SETTING_KEYS = Object.keys(CROISEE_KEYS) as CroiseeSettingKey[];

export type SeuilEffectif = { libelle: string; valeur: number };
export type CroiseeSettingValues = {
  confidentialite: number; // nombre minimal de personnes distinctes d'un groupe affiché (entier ≥ 1) : paramètre de toute l'application
  seuilsEffectif: SeuilEffectif[]; // seuils suivis (libellé + effectif), triés par valeur croissante ; liste vide = non définis
  margeAlerte: number; // écart maximal (≤), en salariés, au prochain seuil en deçà duquel un repère est émis (entier ≥ 0)
  horizonEcheances: number; // horizon des échéances de contrat, en jours (entier ≥ 1)
};

export type CroiseeSetting<T> = { kind: "absent" } | { kind: "set"; value: T; updatedAt: Date | null; updatedBy: string | null } | { kind: "invalid"; raw: unknown };
export type CroiseeSettings = { [K in CroiseeSettingKey]: CroiseeSetting<CroiseeSettingValues[K]> };

// Une valeur enregistrée qui ne définit rien : la liste vide (seuils d'effectif). Elle vaut « non défini », jamais « aucun seuil ».
const emptyList = (s: CroiseeSetting<unknown>): boolean => s.kind === "set" && Array.isArray(s.value) && s.value.length === 0;

// Valeur utilisable, ou null (absente, illisible ou liste vide : la raison est donnée par croiseeSettingReason).
type SetValue<S> = S extends { kind: "set"; value: infer V } ? V : never;
export const settingValue = <S extends CroiseeSetting<unknown>>(s: S): SetValue<S> | null => (s.kind === "set" && !emptyList(s) ? (s as { value: SetValue<S> }).value : null);

const NAMES: Record<CroiseeSettingKey, { absent: string; invalid: string }> = {
  confidentialite: { absent: SEUIL_NON_DEFINI, invalid: SEUIL_ILLISIBLE },
  seuilsEffectif: { absent: "seuils d'effectif non définis (Paramètres)", invalid: "seuils d'effectif illisibles : à ré-enregistrer (Paramètres)" },
  margeAlerte: { absent: "marge d'alerte des seuils d'effectif non définie (Paramètres)", invalid: "marge d'alerte des seuils d'effectif illisible : à ré-enregistrer (Paramètres)" },
  horizonEcheances: { absent: "horizon des échéances non défini (Paramètres)", invalid: "horizon des échéances illisible : à ré-enregistrer (Paramètres)" },
};

// Raison d'un n.d. dû à un paramètre (null quand la valeur est définie ; une liste vide vaut « non défini »).
export function croiseeSettingReason(key: CroiseeSettingKey, s: CroiseeSetting<unknown>): string | null {
  if (emptyList(s)) return NAMES[key].absent;
  return s.kind === "set" ? null : NAMES[key][s.kind];
}

// Lignes du bloc « Sources et hypothèses de travail » (et de la feuille « Filtres » des exports) : chaque paramètre, sa valeur écrite
// ou n.d. avec la raison (jamais de défaut).
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
  return CROISEE_SETTING_KEYS.map(line);
}

// Lien vers la section des Paramètres où ces règles se saisissent ; le seuil de confidentialité a sa propre section (#confidentialite).
export const croiseeSettingsHref = (slug: string, key?: CroiseeSettingKey): string => (key === "confidentialite" ? confidentialiteHref(slug) : `/e/${slug}/parametres#croisee`);
