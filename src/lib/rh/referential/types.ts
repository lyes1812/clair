import type { CollectionOutcome } from "@/lib/connectors/types";
import type { CoverageRow } from "@/lib/dsn/selection";

// Référentiel Collaborateurs : construit par source (PayFit ou DSN) à partir des seules lectures appliquées,
// jamais fusionné entre sources. Chaque champ porte sa provenance ou sa raison d'absence (« n.d. — raison »).
export type RhSource = "payfit" | "dsn";

export type Provenance = {
  syncId: string; // source_sync.id (lecture active PayFit, ou dépôt DSN portant la déclaration retenue)
  collection: string; // source_record.collection
  recordKey: string; // source_record.record_key
  period: string | null; // source_record.period
  path: string; // champ JSON PayFit (« endDate ») ou rubrique DSN (« S21.G00.62.001 »)
  declarationKey?: string; // DSN : clé de la déclaration retenue
  label: string; // texte affiché, ex. « PayFit · lecture du 21/10/2026 · contracts · TEST-A-CONTRACT-003 · endDate »
};

export type MissingCode =
  | "not-in-source" // la source ne porte pas ce champ (motif PayFit, équipe DSN, temps travaillé DSN…)
  | "not-provided" // champ présent mais nul (temps PayFit null, matricule nul, nature nulle)
  | "scope-missing" // droit PayFit non accordé à la clé
  | "source-unavailable" // collection contracts indisponible → référentiel indisponible
  | "no-time-line" // aucune ligne worked_time pour ce contrat dans un mois lu
  | "month-out-of-scope" // mois hors scope.months de la lecture PayFit
  | "no-activity" // aucun bloc S21.G00.53 de type 01 pour ce contrat ce mois
  | "no-payment" // aucun bloc 50/51 pour ce contrat ce mois
  | "mixed-units" // activités en unités hétérogènes
  | "month-not-covered" // aucune déclaration appliquée pour ce mois et ce SIRET
  | "coverage-incomplete" // fractions incomplètes
  | "coverage-blocked" // conflit d'ordre, chaîne 03/01 invalide, aucune déclaration éligible
  | "before-coverage" // date antérieure à la couverture
  | "after-reference" // date postérieure à la date de référence
  | "no-start-date"
  | "no-person"
  | "no-contract"
  | "disappeared"
  | "not-extracted";

export type FieldNd = { code: MissingCode; reason: string };
export type Traced = { fieldsNd: Record<string, FieldNd>; provenance: Record<string, Provenance> };
export type FieldView<T> = { value: T; provenance: Provenance | null; nd: null } | { value: null; provenance: Provenance | null; nd: FieldNd };

export function fieldView<T>(row: Traced, field: string, value: T | null | undefined): FieldView<T> {
  const provenance = row.provenance[field] ?? null;
  if (value === null || value === undefined) {
    return { value: null, provenance, nd: row.fieldsNd[field] ?? { code: "not-provided", reason: "valeur absente" } };
  }
  return { value, provenance, nd: null };
}

export type RhBuildInputs =
  | {
      source: "payfit";
      syncId: string;
      startedAt: string;
      decidedAt: string | null;
      contentHash: string | null;
      scopeMonths: string[];
      company: { id: string; name: string; identificationNumber: string | null } | null;
      collections: CollectionOutcome[];
    }
  | {
      source: "dsn";
      syncs: { id: string; contentHash: string | null; decidedAt: string | null }[];
      coverage: { siret: string; month: string; status: CoverageRow["status"]; selected: { key: string; sourceId: string; filename: string | null }[]; messages: string[] }[];
    };

export type RhBuildSummary = { persons: number; contracts: number; months: number; events: number; findings: number };

export type EndStatus = "known" | "none_cdi" | "none_other_nature" | "none_nature_nd" | "unpositioned" | "disappeared";
export type PresenceBasis = "dates" | "declared" | "not_declared";
export type PresenceStatus = "complete" | "lower_bound" | "incomplete" | "blocked" | "missing";
export type TimeStatus = "read" | "out_of_scope" | "unavailable" | "paid_only";
export type FindingSeverity = "info" | "check";
export type EventFlag = "future" | "pending" | "continuity_same_person" | "rehire" | "renumbered" | "lower_bound_window" | "provisional";
export type MonthFlag = "negative_time" | "time_missing" | "time_outside_contract" | "declared_before_start" | "declared_after_end" | "not_declared";

// Lignes produites par les constructeurs purs (sans id, espace ni build : ajoutés à l'insertion).
export type PersonDraft = Traced & {
  personKey: string;
  externalId: string;
  identifierKind: "payfit" | "nir" | "ntt";
  siren: string | null;
  establishmentIds: string[];
  familyName: string | null;
  givenNames: string | null;
  usageName: string | null;
  employeeNumber: string | null;
  teamName: string | null;
  hasContract: boolean;
  firstDeclaredMonth: string | null;
  lastDeclaredMonth: string | null;
};

export type ContractDraft = Traced & {
  contractKey: string;
  externalId: string;
  personKey: string | null;
  establishmentId: string | null;
  startDate: string | null;
  endDate: string | null;
  endReason: string | null;
  endStatus: EndStatus;
  nature: string | null;
  statusSource: string | null;
  fteAtRead: number | null;
  weeklyHoursAtRead: number | null;
  isFullTimeAtRead: boolean | null;
  modalityAtRead: string | null;
  executive: boolean | null;
  firstDeclaredMonth: string | null;
  lastDeclaredMonth: string | null;
};

export type ContractMonthDraft = Traced & {
  contractKey: string;
  month: string;
  establishmentId: string;
  presenceBasis: PresenceBasis;
  presentAnyDay: boolean;
  presentMonthEnd: boolean;
  nature: string | null;
  referenceQuota: number | null;
  contractQuota: number | null;
  quotaUnit: string | null;
  modality: string | null;
  paidTime: number | null;
  workedTime: number | null;
  timeUnit: string | null;
  paymentCount: number | null;
  flags: MonthFlag[];
};

export type EventDraft = Traced & {
  kind: "entry" | "exit";
  date: string;
  month: string;
  contractKey: string;
  personKey: string | null;
  establishmentId: string | null;
  nature: string | null;
  endReason: string | null;
  flags: EventFlag[];
};

export type CoverageDraft = {
  establishmentId: string;
  month: string;
  presenceStatus: PresenceStatus;
  presenceReason: string | null;
  timeStatus: TimeStatus;
  timeReason: string | null;
  declarationKeys: string[];
  provenance: Record<string, Provenance>;
};

export type FindingDraft = {
  code: string;
  severity: FindingSeverity;
  personKeys: string[];
  contractKeys: string[];
  month: string | null;
  message: string;
  detail: Record<string, unknown>;
  provenance: Record<string, Provenance>;
};

export type BuildHeader = {
  source: RhSource;
  builderVersion: number;
  inputsHash: string;
  inputs: RhBuildInputs;
  referenceDate: string | null;
  presenceFrom: string | null;
  presenceTo: string | null;
  summary: RhBuildSummary;
  unavailableReason: string | null;
};

// Données d'un référentiel telles que consommées par les règles d'effectif et les écrans : le résultat d'un
// constructeur pur (tests) ou les lignes relues en base (loadRhBuild) ont cette forme.
export type RhBuildData = {
  build: { source: RhSource; referenceDate: string | null; presenceFrom: string | null; presenceTo: string | null; unavailableReason: string | null };
  persons: PersonDraft[];
  contracts: ContractDraft[];
  months: ContractMonthDraft[];
  events: EventDraft[];
  coverage: CoverageDraft[];
  findings: FindingDraft[];
};

export type RhBuildResult = RhBuildData & { build: BuildHeader };

export const nd = (code: MissingCode, reason: string): FieldNd => ({ code, reason });

// Absence PayFit telle que conservée dans source_record (collection « absences ») ; aucune durée n'est fournie.
export type AbsenceRow = {
  id: string;
  contractId: string;
  type: string;
  status: string | null;
  start: { date: string | null; moment: string | null };
  end: { date: string | null; moment: string | null };
};

// Lecture tolérante d'un enregistrement « absences » : un champ inattendu devient null, jamais une valeur inventée.
export function absenceRowOf(key: string, data: Record<string, unknown>): AbsenceRow {
  const bound = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return { date: typeof o.date === "string" ? o.date : null, moment: typeof o.moment === "string" ? o.moment : null };
  };
  return {
    id: key,
    contractId: String(data.contractId ?? ""),
    type: String(data.type ?? "n.d."),
    status: typeof data.status === "string" ? data.status : null,
    start: bound(data.start),
    end: bound(data.end),
  };
}

export const absenceOrder = (a: AbsenceRow, b: AbsenceRow) => (a.start.date ?? "").localeCompare(b.start.date ?? "") || a.id.localeCompare(b.id);
