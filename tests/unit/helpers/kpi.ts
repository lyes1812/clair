import { createPayFitClient, readPayFit } from "@/lib/connectors/payfit/client";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { KPI_DEFAULTS } from "@/lib/rh-kpi-settings";
import type { AbsenceInput, KpiInput, KpiParams, KpiScope } from "@/lib/rh/kpi/types";
import { absenceOrder, absenceRowOf, nd, type AbsenceRow, type RhBuildData } from "@/lib/rh/referential/types";
import { PAYFIT_MONTHS } from "./rh";

// Aides des tests KPI : absences du transport PayFit fictif, entrées du moteur, absences construites à la main.
export const TYPES_3 = ["test_maternity", "test_paid_leave", "test_sickness"];
export const TEST_PARAMS: KpiParams = { ...KPI_DEFAULTS, natures: ["01", "02"], absenceTypes: TYPES_3 };
export const DSN_ABSENCES: AbsenceInput = { status: "not-extracted", nd: nd("not-extracted", "arrêts non extraits de la DSN") };

export async function fixtureAbsences(key = "fixture-A-1", months = PAYFIT_MONTHS): Promise<AbsenceInput> {
  const r = await readPayFit(createPayFitClient(key, { fetchImpl: createFixtureFetch(key), minIntervalMs: 0 }), months);
  const rows = r.records.filter((x) => x.collection === "absences").map((x) => absenceRowOf(x.key, x.data)).sort(absenceOrder);
  return { status: "read", syncId: `sync-${key}`, rows, months };
}

export function kpiInput(data: RhBuildData, absences: AbsenceInput, overrides: Partial<KpiParams> = {}, scope: KpiScope = {}): KpiInput {
  return { data, absences, params: { ...TEST_PARAMS, ...overrides }, scope };
}

export const readAbsences = (rows: AbsenceRow[], months = PAYFIT_MONTHS): AbsenceInput => ({ status: "read", syncId: "sync-test", rows: [...rows].sort(absenceOrder), months });

export function absence(id: string, contract: string, start: string | null, startMoment: string | null, end: string | null, endMoment: string | null, extra: { type?: string; status?: string | null } = {}): AbsenceRow {
  return {
    id,
    contractId: contract.startsWith("TEST-") || contract.startsWith("C-") ? contract : `TEST-A-CONTRACT-${contract}`,
    type: extra.type ?? "test_sickness",
    status: extra.status === undefined ? "approved" : extra.status,
    start: { date: start, moment: startMoment },
    end: { date: end, moment: endMoment },
  };
}
