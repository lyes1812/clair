import { monthRanges, type Count, type EventRow, type HeadcountResult } from "@/lib/rh/headcount";
import type { AbsenceRow, CoverageDraft, FieldNd, MissingCode, Provenance, RhBuildData } from "@/lib/rh/referential/types";

// KPI RH : calculs purs sur le référentiel Collaborateurs (aucune base, aucune horloge). Chaque chiffre est exact,
// en borne basse (« ≥ x ») ou n.d. avec sa raison, et porte la liste de ce qui a été compté.
export type Ratio = { num: number; den: number }; // entiers sûrs, den > 0
export type Kind = "exact" | "lower_bound";
export type DayBasis = "calendar" | "weekdays";
export type TurnoverFormula = "half_sum" | "exits_over_start";
export type AbsenceStatus = "approved" | "pending_approval" | "declined" | "cancelled" | "pending_cancellation";

export type KpiParams = {
  natures: string[]; // rh.headcount.natures
  fullTimeIsOne: boolean;
  capAtOne: boolean;
  forfaitJoursIsOne: boolean; // PayFit : forfait jours sans quotité ni indicateur temps plein = 1 ETP
  etpDecimals: 2 | 3 | 4;
  turnoverFormula: TurnoverFormula;
  excludedExitNatures: string[];
  neutralizeContinuity: boolean;
  absenceTypes: string[];
  absenceStatuses: AbsenceStatus[];
  dayBasis: DayBasis;
};

export type AbsenceInput =
  | { status: "read"; syncId: string; rows: AbsenceRow[]; months: string[] } // PayFit : lecture active, months = mois lus
  | { status: "unavailable"; nd: FieldNd } // PayFit : collection absences non lue
  | { status: "not-extracted"; nd: FieldNd }; // DSN
export type KpiScope = { establishments?: string[]; nature?: string };
// openMonths : mois dont la paie n'est pas clôturée à la lecture (PayFit, statut de paie lu) ; ils ne sont pas clos.
export type KpiInput = { data: RhBuildData; absences: AbsenceInput; params: KpiParams; scope: KpiScope; openMonths?: string[] };

export type KpiNdCode =
  | MissingCode
  | "quota-missing"
  | "quota-inconsistent"
  | "absence-types-unset"
  | "absences-unavailable"
  | "absence-date-nd"
  | "absence-unknown-contract"
  | "period-not-closed"
  | "month-nd"
  | "month-lower-bound"
  | "denominator-zero"
  | "current-not-exact"
  | "previous-nd"
  | "previous-lower-bound";
export type KpiNd = { code: KpiNdCode; reason: string; months?: string[]; keys?: string[] };

export type Window = { mode: "month" | "rolling" | "civil"; from: string; to: string; months: string[]; label: string };

// ETP
export type EtpBasis = "payfit_full_time" | "payfit_fte" | "payfit_forfait_jours" | "dsn_full_time_modality" | "dsn_ratio";
export type EtpSource =
  | { source: "payfit"; fteAtRead: number | null; isFullTimeAtRead: boolean | null; weeklyHoursAtRead: number | null; modalityAtRead: string | null }
  | { source: "dsn"; month: string; establishmentId: string; contractQuota: number | null; referenceQuota: number | null; quotaUnit: string | null; modality: string | null };
export type ContractRef = { contractKey: string; externalId: string; personKey: string | null; establishmentId: string | null; nature: string | null };
export type EtpContribution = ContractRef & { kind: "etp"; etp4: number; basis: EtpBasis; source: EtpSource; checks: string[]; provenance: Provenance | null };
export type EtpMissing = ContractRef & { kind: "missing"; source: EtpSource | null; nd: KpiNd };
export type EtpMonthEnd =
  | { month: string; kind: Kind; etp4: number; contributions: EtpContribution[]; missing: EtpMissing[]; headcount: Extract<HeadcountResult, { kind: Kind }>; qualifiers: string[] }
  | { month: string; kind: "nd"; nd: KpiNd; missing: EtpMissing[] };

// Moyennes
export type MonthValue = { month: string; kind: Kind | "nd"; value: number | null; nd: KpiNd | null; qualifiers: string[] };
export type Average =
  | { kind: "exact"; unit: "etp" | "persons"; ratio: Ratio; months: MonthValue[]; qualifiers: string[] }
  | { kind: "nd"; unit: "etp" | "persons"; nd: KpiNd; months: MonthValue[] };

// Turnover
export type EventWhy = "counted" | "out-of-scope" | "future" | "neutralized" | "excluded-nature" | "continuity-unknown";
export type EventContribution = { row: EventRow; why: EventWhy; label: string; partner: { contractKey: string; date: string } | null };
export type MonthMovements = { month: string; entries: Count; exits: Count; events: EventContribution[] };
export type MovementTotal = { kind: Kind; value: number } | { kind: "nd"; nd: KpiNd };
export type TurnoverBase =
  | { kind: "average"; average: Extract<Average, { kind: "exact" }> }
  | { kind: "start"; date: string; persons: number; contractKeys: string[] };
export type Turnover =
  | { kind: "exact"; formula: TurnoverFormula; ratio: Ratio; entries: number | null; exits: number; base: TurnoverBase; months: MonthMovements[]; qualifiers: string[] } // entries null : non exactes (variante sorties ÷ début seulement)
  | { kind: "nd"; formula: TurnoverFormula; nd: KpiNd; months: MonthMovements[] };

// Absentéisme (en demi-journées)
export type SlotKey = string; // « 2026-03-02#0 » matin, « 2026-03-02#1 » après-midi
export type TheoreticalContribution = ContractRef & { from: string; to: string; days: number; half: number; provenance: Provenance | null };
export type TheoreticalMonth = { month: string; kind: "exact"; half: number; contributions: TheoreticalContribution[] } | { month: string; kind: "nd"; nd: KpiNd };
// Jours théoriques d'une fenêtre : somme exacte des mois, ou n.d. dès qu'un mois l'est (indépendant des absences).
export type TheoreticalWindow = { kind: "exact"; half: number; months: TheoreticalMonth[] } | { kind: "nd"; nd: KpiNd; months: TheoreticalMonth[] };
export type AbsenceSlice = {
  absenceId: string;
  contractKey: string;
  externalId: string;
  personKey: string | null;
  type: string;
  status: string | null;
  start: AbsenceRow["start"];
  end: AbsenceRow["end"];
  from: string; // bornes appliquées dans le mois et le contrat
  to: string;
  half: number; // créneaux ajoutés à l'union du contrat par cette absence
  overlap: number; // créneaux déjà couverts par une absence précédente du même contrat
  uncertain: number; // créneaux incertains (moment absent ou non interprété, bornes incohérentes)
  outsideContract: number; // jours de l'absence dans le mois hors de la période du contrat (non comptés)
  notes: string[];
};
export type AbsenceExcluded = {
  absenceId: string;
  contractId: string;
  type: string;
  status: string | null;
  why: "type" | "status" | "status-nd" | "contract-out-of-scope" | "date-nd-covered";
  label: string;
  uncertain: number;
};
export type AbsenteeismMonth =
  | { month: string; kind: Kind; ratio: Ratio; theoretical: TheoreticalContribution[]; slices: AbsenceSlice[]; excluded: AbsenceExcluded[]; qualifiers: string[] }
  | { month: string; kind: "nd"; nd: KpiNd };
export type Absenteeism = { kind: Kind; ratio: Ratio; months: AbsenteeismMonth[]; qualifiers: string[] } | { kind: "nd"; nd: KpiNd; months: AbsenteeismMonth[] };

// N-1
export type DeltaUnit = "etp" | "persons" | "points";
export type Delta = { kind: "exact"; unit: DeltaUnit; value: Ratio } | { kind: "nd"; nd: KpiNd };
export type Compared<T> = { window: Window; current: T; previousWindow: Window; previous: T; delta: Delta };

// Écran
export type KpiRow = {
  month: string;
  coverage: CoverageDraft[];
  headcount: HeadcountResult;
  etp: EtpMonthEnd;
  movements: MonthMovements;
  theoretical: TheoreticalMonth;
  absenteeism: AbsenteeismMonth;
  previous: { month: string; etp: EtpMonthEnd; absenteeism: AbsenteeismMonth };
};
export type AbsenceTypeChoice = { type: string; count: number; chosen: boolean; inRead: boolean };
export type KpiDashboard = {
  closedMonth: string | null;
  window: Window;
  previousWindow: Window;
  params: KpiParams;
  scope: KpiScope;
  tiles: { etpEnd: Compared<EtpMonthEnd>; etpAverage: Compared<Average>; headcountAverage: Compared<Average>; turnover: Compared<Turnover>; absenteeism: Compared<Absenteeism> };
  rows: KpiRow[];
  theoretical: TheoreticalWindow;
  movements: { entries: MovementTotal; exits: MovementTotal };
  absenceTypes: AbsenceTypeChoice[];
};
export type KpiDetailId = "etp-end" | "headcount" | "entries" | "exits" | "theoretical" | "absenteeism" | "etp-avg" | "headcount-avg" | "turnover";
export type KpiDetail =
  | { id: "etp-end"; month: string; value: EtpMonthEnd }
  | { id: "headcount"; month: string; value: HeadcountResult }
  | { id: "entries" | "exits"; month: string; value: MonthMovements }
  | { id: "theoretical" | "absenteeism"; month: string; value: AbsenteeismMonth; theoretical: TheoreticalMonth }
  | { id: "absenteeism-window"; month: null; window: Window; value: Absenteeism; theoretical: TheoreticalWindow }
  | { id: "etp-avg" | "headcount-avg"; window: Window; value: Average }
  | { id: "turnover"; window: Window; value: Turnover };

export const kpiNd = (code: KpiNdCode, reason: string, extra: { months?: string[]; keys?: string[] } = {}): KpiNd => ({ code, reason, ...extra });

// Raison d'un KPI de période n.d. : les mois en cause, puis la raison du premier (une seule fois s'il n'y en a qu'un).
export function periodReason(months: string[], first: string, reason: string): string {
  if (months.length === 1) return `${first} : ${reason}`;
  return `${months.length} mois n.d. (${monthRanges(months)}) ; ${first} : ${reason}`;
}
