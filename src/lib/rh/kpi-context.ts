import { formatDate } from "@/lib/dates";
import { getKpiSettings, type KpiSettings } from "@/lib/rh-kpi-settings";
import { loadAbsencesOfSync, loadAbsenceTypes, loadPayrollOpenMonths } from "./referential/store";
import { nd } from "./referential/types";
import type { AbsenceInput, KpiInput, KpiScope } from "./kpi/types";
import { loadCollabContext, type CollabContext } from "./view";

// Contexte de l'écran KPI : référentiel de la source retenue, paramètres de l'espace, absences de la lecture PayFit active.
export type KpiContext = { collab: CollabContext; settings: KpiSettings; input: KpiInput | null; readTypes: { type: string; count: number }[] };

export async function loadKpiContext(slug: string, scope: KpiScope): Promise<KpiContext> {
  const collab = await loadCollabContext(slug);
  const settings = await getKpiSettings(collab.workspace.id);
  const d = collab.data;
  if (!d) return { collab, settings, input: null, readTypes: [] };
  let absences: AbsenceInput;
  let readTypes: { type: string; count: number }[] = [];
  if (d.build.inputs.source === "dsn") {
    absences = { status: "not-extracted", nd: nd("not-extracted", "arrêts non extraits de la DSN") };
  } else {
    const inputs = d.build.inputs;
    const outcome = inputs.collections.find((c) => c.collection === "absences");
    if (!outcome) absences = { status: "unavailable", nd: nd("not-provided", `collection absences absente de la lecture du ${formatDate(d.build.referenceDate)}`) };
    else if (outcome.status === "unavailable") absences = { status: "unavailable", nd: nd("scope-missing", outcome.reason) };
    else {
      absences = { status: "read", syncId: inputs.syncId, rows: await loadAbsencesOfSync(collab.workspace.id, inputs.syncId), months: inputs.scopeMonths };
      readTypes = await loadAbsenceTypes(collab.workspace.id, inputs.syncId);
    }
  }
  const openMonths = d.build.inputs.source === "payfit" ? await loadPayrollOpenMonths(collab.workspace.id, d.build.inputs.syncId) : [];
  const input: KpiInput = { data: d, absences, params: { ...settings.values, natures: collab.natures.codes }, scope, openMonths };
  return { collab, settings, input, readTypes };
}
