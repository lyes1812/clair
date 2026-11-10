import { isIsoDate, isMonth, monthBounds } from "@/lib/connectors/months";
import { absenceTypeText } from "@/lib/viz/kpi";
import { ABSENCE_MOMENT_LABELS, ABSENCE_STATUS_LABELS } from "./labels";
import type { AbsenceInput } from "./kpi/types";
import type { AbsenceRow } from "./referential/types";
import type { ExplorationModel, ExplorationRow } from "./exploration";

// Lecture documentaire des événements d'absence. Le transport ne porte aucune
// durée officielle : ni différence de temps, ni nombre de jours n'en est déduit.
export type ExplorationAbsenceBound = { date: string | null; moment: string | null; momentLabel: string };
export type ExplorationAbsenceEvent = {
  id: string;
  contractKey: string | null;
  personKey: string | null;
  personName: string | null;
  contractLabel: string | null;
  sourceContractId: string;
  context: "observed" | "outside-observed" | "unlinked";
  type: string;
  typeLabel: string;
  status: string | null;
  statusLabel: string;
  start: ExplorationAbsenceBound;
  end: ExplorationAbsenceBound;
  position: "overlap" | "unpositioned";
  notes: string[];
};
export type ExplorationContractAbsences = {
  contractKey: string;
  kind: "value" | "uncertain" | "nd";
  reason: string | null;
  count: number | null;
  label: string;
  events: ExplorationAbsenceEvent[];
  unpositioned: ExplorationAbsenceEvent[];
};
export type ExplorationAbsencesModel = {
  source: ExplorationModel["source"];
  month: string;
  kind: "value" | "nd";
  reason: string | null;
  syncId: string | null;
  contracts: ExplorationContractAbsences[];
  unlinked: ExplorationAbsenceEvent[];
  unpositioned: ExplorationAbsenceEvent[];
  notices: string[];
};
export type ExplorationAbsencesUniverse = { knownContractKeys: string[]; observedContractKeys: string[] };

function unavailable(model: ExplorationModel, reason: string): ExplorationAbsencesModel {
  return { source: model.source, month: model.month, kind: "nd", reason, syncId: null,
    contracts: [...new Set(model.rows.map((r) => r.contractKey))].map((contractKey) => ({ contractKey, kind: "nd", reason,
      count: null, label: "n.d.", events: [], unpositioned: [] })),
    unlinked: [], unpositioned: [], notices: [...model.notices] };
}

const cleanDate = (value: string | null) => isIsoDate(value) ? value : null;
function bound(value: AbsenceRow["start"]): ExplorationAbsenceBound {
  return { date: cleanDate(value.date), moment: value.moment,
    momentLabel: value.moment === null ? "Moment non renseigné" : ABSENCE_MOMENT_LABELS[value.moment] ?? `Moment non interprété (${value.moment})` };
}
function sourceFingerprint(row: AbsenceRow): string {
  return JSON.stringify([row.contractId, row.type, row.status, row.start.date, row.start.moment, row.end.date, row.end.moment]);
}

export function buildExplorationAbsences(model: ExplorationModel, input: AbsenceInput | null, expectedSyncId: string | null, universe?: ExplorationAbsencesUniverse): ExplorationAbsencesModel {
  if (model.source !== "payfit") return unavailable(model, "Absences et arrêts non extraits de la DSN.");
  if (!isMonth(model.month)) return unavailable(model, "Mois invalide : absences non positionnables.");
  if (!input) return unavailable(model, "Absences non disponibles dans le contexte de lecture.");
  if (input.status !== "read") return unavailable(model, input.nd.reason);
  if (!expectedSyncId || input.syncId !== expectedSyncId) return unavailable(model, "La lecture des absences ne correspond pas au référentiel RH. Recharge la page.");
  if (!input.months.includes(model.month)) return unavailable(model, "Absences non lues pour ce mois dans la lecture appliquée.");
  if (model.gate) return unavailable(model, model.gate.reason);

  const visible = new Map<string, ExplorationRow>();
  for (const row of model.rows) if (!visible.has(row.contractKey)) visible.set(row.contractKey, row);
  const known = new Set(universe?.knownContractKeys ?? visible.keys());
  const observed = new Set(universe?.observedContractKeys ?? visible.keys());
  const contracts = new Map<string, ExplorationContractAbsences>([...visible.keys()].map((contractKey) => [contractKey,
    { contractKey, kind: "value", reason: null, count: 0, label: "Aucune absence remontée", events: [], unpositioned: [] }]));
  const unlinked: ExplorationAbsenceEvent[] = [];
  const unpositioned: ExplorationAbsenceEvent[] = [];
  const { begin, end } = monthBounds(model.month);

  // Une seule occurrence par identifiant source. Une contradiction ne sélectionne
  // pas arbitrairement une des versions : elle devient non positionnable.
  const source = new Map<string, AbsenceRow>();
  const conflicting = new Set<string>();
  for (const row of input.rows) {
    const prior = source.get(row.id);
    if (prior && sourceFingerprint(prior) !== sourceFingerprint(row)) conflicting.add(row.id);
    else if (!prior) source.set(row.id, row);
  }
  for (const row of source.values()) {
    const key = row.contractId ? `payfit:${row.contractId}` : null;
    // Un contrat observé ce mois, mais absent de la liste filtrée, est hors du
    // périmètre demandé. Il ne doit pas réapparaître comme un contrat inconnu.
    if (key && known.has(key) && observed.has(key) && !visible.has(key)) continue;
    const selected = key ? visible.get(key) : undefined;
    const start = bound(row.start), finish = bound(row.end);
    const conflict = conflicting.has(row.id);
    const invalidOrder = start.date !== null && finish.date !== null && start.date > finish.date;
    const positionable = !conflict && !invalidOrder && start.date !== null && finish.date !== null;
    if (!conflict && !invalidOrder) {
      if (start.date && start.date > end || finish.date && finish.date < begin) continue;
    }
    const notes: string[] = [];
    if (row.start.date !== null && start.date === null) notes.push("Date de début invalide dans la source.");
    if (row.end.date !== null && finish.date === null) notes.push("Date de fin invalide dans la source.");
    if (start.date === null || finish.date === null) notes.push("Date de début ou de fin absente : présence dans le mois incertaine.");
    if (invalidOrder) notes.push("Dates contradictoires : fin antérieure au début.");
    if (conflict) notes.push("Plusieurs versions contradictoires pour le même identifiant source : événement non positionnable.");
    if (!row.start.moment || !ABSENCE_MOMENT_LABELS[row.start.moment]) notes.push("Moment de début absent ou non interprété.");
    if (!row.end.moment || !ABSENCE_MOMENT_LABELS[row.end.moment]) notes.push("Moment de fin absent ou non interprété.");
    if (row.status === null) notes.push("Statut non renseigné dans la source.");
    const order = ["beginning-of-day", "middle-of-day", "end-of-day"];
    if (start.date && start.date === finish.date && row.start.moment && row.end.moment && order.indexOf(row.start.moment) >= 0 && order.indexOf(row.end.moment) >= 0 && order.indexOf(row.start.moment) > order.indexOf(row.end.moment)) {
      notes.push("Moments contradictoires sur la même journée ; aucune durée n’est déduite.");
    }
    const context: ExplorationAbsenceEvent["context"] = selected ? "observed" : key && known.has(key) ? "outside-observed" : "unlinked";
    if (context === "outside-observed") notes.push("Contrat connu hors des contrats observés ce mois : rattachement mensuel à vérifier.");
    if (context === "unlinked") notes.push("Contrat source non rattaché au référentiel ; aucun collaborateur n’est déduit.");
    const event: ExplorationAbsenceEvent = {
      id: row.id, contractKey: selected?.contractKey ?? null, personKey: selected?.personKey ?? null,
      personName: selected?.personName ?? null, contractLabel: selected?.contractLabel ?? null,
      sourceContractId: row.contractId, context, type: row.type, typeLabel: absenceTypeText(row.type),
      status: row.status, statusLabel: row.status === null ? "Statut n.d." : ABSENCE_STATUS_LABELS[row.status] ?? row.status,
      start: conflict ? { date: null, moment: null, momentLabel: "Versions contradictoires" } : start,
      end: conflict ? { date: null, moment: null, momentLabel: "Versions contradictoires" } : finish,
      position: positionable ? "overlap" : "unpositioned", notes,
    };
    if (event.position === "unpositioned") {
      unpositioned.push(event);
      if (selected) contracts.get(selected.contractKey)!.unpositioned.push(event);
    } else if (selected) contracts.get(selected.contractKey)!.events.push(event);
    else unlinked.push(event);
  }
  for (const contract of contracts.values()) {
    if (contract.unpositioned.length) {
      contract.kind = "uncertain";
      contract.reason = "Des événements ne sont pas positionnables avec certitude dans le mois.";
      contract.count = null;
      contract.label = "n.d. — événements non positionnables";
    } else {
      contract.count = contract.events.length;
      contract.label = contract.count ? `${contract.count} événement${contract.count > 1 ? "s" : ""} remonté${contract.count > 1 ? "s" : ""}` : "Aucune absence remontée";
    }
  }
  return { source: model.source, month: model.month, kind: "value", reason: null, syncId: input.syncId, contracts: [...contracts.values()], unlinked, unpositioned,
    notices: [...new Set([...model.notices,
      "Événements d’absence tels que remontés, tous statuts ; aucun nombre de jours ni durée officielle n’est fourni par cette lecture.",
      "Aucune absence remontée pour un contrat ne prouve pas l’absence d’absences. Le temps payé ou travaillé ne permet pas de les déduire."])] };
}

export function explorationAbsencesForContract(model: ExplorationAbsencesModel | undefined, contractKey: string): ExplorationContractAbsences {
  return model?.contracts.find((c) => c.contractKey === contractKey) ?? { contractKey, kind: "nd", reason: model?.reason ?? "Absences non disponibles pour ce contrat dans le périmètre affiché.", count: null, label: "n.d.", events: [], unpositioned: [] };
}
