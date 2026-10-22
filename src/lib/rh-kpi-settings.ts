import { ABSENCE_STATUSES } from "./connectors/payfit/client";
import type { AbsenceStatus, DayBasis, KpiParams, TurnoverFormula } from "./rh/kpi/types";
import { getSettingsMeta, setSetting } from "./settings";

// Définitions des KPI : paramètres de l'espace, chacun avec un défaut écrit et son origine affichée. Un paramètre
// présent mais illisible n'est jamais remplacé en silence par le défaut : l'écran KPI le signale et ne calcule rien.
export const KPI_KEYS = {
  fullTimeIsOne: "rh.kpi.etp.fullTimeIsOne",
  capAtOne: "rh.kpi.etp.capAtOne",
  forfaitJoursIsOne: "rh.kpi.etp.forfaitJoursIsOne",
  etpDecimals: "rh.kpi.etp.decimals",
  turnoverFormula: "rh.kpi.turnover.formula",
  excludedExitNatures: "rh.kpi.turnover.excludedExitNatures",
  neutralizeContinuity: "rh.kpi.turnover.neutralizeContinuity",
  absenceTypes: "rh.kpi.absence.types",
  absenceStatuses: "rh.kpi.absence.statuses",
  dayBasis: "rh.kpi.absence.dayBasis",
} as const;
export type KpiSettingKey = keyof typeof KPI_KEYS;
export type KpiSettingValues = Omit<KpiParams, "natures">;

export const KPI_DEFAULTS: KpiSettingValues = {
  fullTimeIsOne: true,
  capAtOne: true,
  forfaitJoursIsOne: true,
  etpDecimals: 4,
  turnoverFormula: "half_sum",
  excludedExitNatures: [],
  neutralizeContinuity: true,
  absenceTypes: ["fr_maladie_ordinaire"],
  absenceStatuses: ["approved"],
  dayBasis: "calendar",
};
// Défauts validés avec le plan du module 3 (22/10/2026) ou proposés par la spécification, à confirmer.
export const KPI_DEFAULTS_VALIDATED_ON = "2026-10-22";
export const KPI_DEFAULT_STATUS: Record<KpiSettingKey, "validated" | "proposed"> = {
  fullTimeIsOne: "validated",
  capAtOne: "validated",
  forfaitJoursIsOne: "validated",
  etpDecimals: "proposed",
  turnoverFormula: "validated",
  excludedExitNatures: "proposed",
  neutralizeContinuity: "proposed",
  absenceTypes: "validated",
  absenceStatuses: "validated",
  dayBasis: "validated",
};

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const sortedUnique = (v: unknown[]) => [...new Set(v as string[])].sort();
export const KPI_PARSERS: { [K in KpiSettingKey]: (v: unknown) => KpiSettingValues[K] | null } = {
  fullTimeIsOne: bool,
  capAtOne: bool,
  forfaitJoursIsOne: bool,
  etpDecimals: (v) => (v === 2 || v === 3 || v === 4 ? v : null),
  turnoverFormula: (v) => (v === "half_sum" || v === "exits_over_start" ? (v as TurnoverFormula) : null),
  excludedExitNatures: (v) => (Array.isArray(v) && v.every((x) => typeof x === "string" && /^\d{2}$/.test(x)) ? sortedUnique(v) : null),
  neutralizeContinuity: bool,
  absenceTypes: (v) => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 128 && !/\s/.test(x)) ? sortedUnique(v) : null),
  absenceStatuses: (v) => (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && ABSENCE_STATUSES.has(x)) ? (sortedUnique(v) as AbsenceStatus[]) : null),
  dayBasis: (v) => (v === "calendar" || v === "weekdays" ? (v as DayBasis) : null),
};

export type KpiOrigin = { origin: "default" } | { origin: "setting"; updatedAt: Date; updatedBy: string | null } | { origin: "invalid"; raw: unknown };
export type KpiSettings = { values: KpiSettingValues; origins: Record<KpiSettingKey, KpiOrigin>; invalid: KpiSettingKey[] };

const KEYS = Object.keys(KPI_KEYS) as KpiSettingKey[];

export async function getKpiSettings(workspaceId: string): Promise<KpiSettings> {
  const stored = await getSettingsMeta(workspaceId, KEYS.map((k) => KPI_KEYS[k]));
  const values = { ...KPI_DEFAULTS } as Record<KpiSettingKey, unknown>;
  const origins = {} as Record<KpiSettingKey, KpiOrigin>;
  const invalid: KpiSettingKey[] = [];
  for (const k of KEYS) {
    const row = stored.get(KPI_KEYS[k]);
    if (!row) {
      origins[k] = { origin: "default" };
      continue;
    }
    const parsed = KPI_PARSERS[k](row.value);
    if (parsed === null) {
      origins[k] = { origin: "invalid", raw: row.value };
      invalid.push(k);
      continue;
    }
    values[k] = parsed;
    origins[k] = { origin: "setting", updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
  return { values: values as KpiSettingValues, origins, invalid };
}

// N'écrit que les clés dont la valeur change (un événement setting.changed par clé) ; renvoie les clés écrites.
export async function setKpiSettings(workspaceId: string, next: KpiSettingValues, actorUserId: string): Promise<KpiSettingKey[]> {
  const current = await getKpiSettings(workspaceId);
  const written: KpiSettingKey[] = [];
  for (const k of KEYS) {
    const parsed = KPI_PARSERS[k](next[k]);
    if (parsed === null) throw new Error(`Valeur invalide pour ${KPI_KEYS[k]}.`);
    // Valeur identique à la valeur en vigueur (enregistrée ou défaut) : rien à écrire.
    if (current.origins[k].origin !== "invalid" && JSON.stringify(parsed) === JSON.stringify(current.values[k])) continue;
    await setSetting(workspaceId, KPI_KEYS[k], parsed, actorUserId);
    written.push(k);
  }
  return written;
}

// Origine affichée d'un paramètre (Paramètres et écran KPI RH) : modification datée, valeur illisible, défaut validé ou proposé.
export function kpiOriginText(key: KpiSettingKey, o: KpiOrigin, formatDateTime: (d: Date) => string): string {
  if (o.origin === "setting") return `Modifié le ${formatDateTime(o.updatedAt)} par un administrateur.`;
  if (o.origin === "invalid") return "Valeur enregistrée illisible : à ré-enregistrer (les KPI ne sont pas calculés d'ici là).";
  const [y, m, d] = KPI_DEFAULTS_VALIDATED_ON.split("-");
  return KPI_DEFAULT_STATUS[key] === "validated" ? `Valeur par défaut validée le ${d}/${m}/${y}.` : "Valeur par défaut proposée, à confirmer.";
}
