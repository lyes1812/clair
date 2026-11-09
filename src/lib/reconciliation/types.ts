// Les identifiants de contrôle sont opaques. Aucun NIR, NTT, SIRET, clé brute ou payload de source.
export type Source = "dsn" | "payfit";
export type EntityKind = "person" | "contract";
export type PersonField = "familyName" | "givenNames";
export type ContractField = "startDate" | "endDate" | "nature";
export type Field = PersonField | ContractField;
export type MissingReason =
  | "not-provided" | "not-in-source" | "not-extracted" | "source-unavailable" | "scope-missing"
  | "outside-period" | "coverage-incomplete" | "coverage-blocked" | "parent-missing" | "invalid-value";
export type Provenance = {
  recordId: string; recordHash: string; syncId: string; path: string; period: string | null;
};
export type Cell =
  | { kind: "value"; value: string; provenance: Provenance[] }
  | { kind: "nd"; reason: MissingReason; provenance: Provenance[] }
  | { kind: "conflict"; values: string[]; missingReasons?: MissingReason[]; provenance: Provenance[] };
export type Person = { id: string; origin: "source" | "contract-reference"; fields: Record<PersonField, Cell> };
export type Contract = {
  id: string;
  // Référence opaque vers une personne du même snapshot ; une contradiction reste un conflit explicite.
  personId: Cell;
  periodRelation: "in-period" | "outside-period" | "unknown" | "conflict";
  fields: Record<ContractField, Cell>;
};
export type SourceSnapshot = {
  source: Source; version: string; period: string | null; referenceDate: string | null;
  coverage: "complete" | "incomplete" | "blocked" | "missing";
  historyLimited?: boolean;
  collectionsMissing?: ("persons" | "contracts")[]; persons: Person[]; contracts: Contract[];
};
export type Snapshot = { schemaVersion: 1; inputHash: string; dsn: SourceSnapshot; payfit: SourceSnapshot };
export type Link = { dsnId: string; payfitId: string; revision: number };
export type EntityTarget = { entity: EntityKind; source: Source; id: string };
export type FieldTarget = { entity: EntityKind; dsnId: string; payfitId: string; field: Field };
export type Unmatched = EntityTarget & { comment: string; revision: number };
export type Resolution = FieldTarget & {
  disposition: "explained" | "correction-requested"; comment: string; revision: number; fingerprint: string;
};
export type State = {
  inputHash: string; revision: number; personLinks: Link[]; contractLinks: Link[];
  unmatched: Unmatched[]; resolutions: Resolution[];
};
export type Action =
  | { kind: "link-person" | "link-contract"; dsnId: string; payfitId: string; fingerprint: string }
  | { kind: "unlink-person" | "unlink-contract"; dsnId: string; payfitId: string; fingerprint: string; comment: string }
  | { kind: "mark-unmatched"; target: EntityTarget; fingerprint: string; comment: string }
  | { kind: "reopen-unmatched"; target: EntityTarget; fingerprint: string; comment: string }
  | { kind: "resolve-field"; target: FieldTarget; fingerprint: string; disposition: "explained" | "correction-requested"; comment: string }
  | { kind: "reopen-field"; target: FieldTarget; fingerprint: string; comment: string };
export type Decision = { revision: number; inputHash: string; actorId: string; createdAt: string; action: Action };
export type DecisionError =
  | "stale-source" | "invalid-revision" | "invalid-decision" | "invalid-comment" | "unknown-target"
  | "stale-fingerprint" | "already-linked" | "not-linked" | "wrong-parent" | "not-unmatched" | "not-resolved";
export type ReduceResult = { ok: true; state: State } | { ok: false; reason: DecisionError };
export type ComparisonStatus = "equal" | "different" | "nd" | "conflict" | "not-comparable";
export type RowStatus = "to-reconcile" | "linked" | "unmatched" | "explained" | "correction-requested";
export type ComparedField = {
  field: Field; dsn: Cell; payfit: Cell; status: ComparisonStatus; fingerprint: string;
  resolution: Resolution | null;
};
export type ComparedRow = {
  entity: EntityKind; dsnId: string | null; payfitId: string | null; status: RowStatus;
  fields: ComparedField[]; fingerprint: string; unmatched: Unmatched | null;
};
export type Comparison = {
  inputHash: string; revision: number; temporal: "same-date" | "different-dates" | "unknown";
  coverage: { dsn: SourceSnapshot["coverage"]; payfit: SourceSnapshot["coverage"] };
  persons: ComparedRow[]; contracts: ComparedRow[];
};
export const RECONCILIATION_VERSION = 1;
export const PERSON_FIELDS: readonly PersonField[] = ["familyName", "givenNames"];
export const CONTRACT_FIELDS: readonly ContractField[] = ["startDate", "endDate", "nature"];
export const FIELD_LABELS: Record<Field, string> = {
  familyName: "Nom", givenNames: "Prénoms", startDate: "Début du contrat", endDate: "Fin du contrat", nature: "Nature du contrat",
};
export const MISSING_LABELS: Record<MissingReason, string> = {
  "not-provided": "Valeur non renseignée", "not-in-source": "Champ absent de cette source", "not-extracted": "Champ non extrait",
  "source-unavailable": "Source indisponible", "scope-missing": "Droit de lecture absent", "outside-period": "Hors période déclarée",
  "coverage-incomplete": "Couverture incomplète", "coverage-blocked": "Couverture bloquée", "parent-missing": "Personne non référencée",
  "invalid-value": "Valeur inexploitable",
};
export const ERROR_LABELS: Record<DecisionError, string> = {
  "stale-source": "Les sources ont changé. Ouvre un nouveau contrôle.", "invalid-revision": "Le contrôle a été modifié. Recharge la page.",
  "invalid-decision": "Décision invalide.", "invalid-comment": "Un commentaire de 1 à 500 caractères est requis.",
  "unknown-target": "La ligne visée est absente du contrôle.", "stale-fingerprint": "La ligne a changé. Recharge la page.",
  "already-linked": "Une des lignes est déjà liée.", "not-linked": "Les lignes ne sont pas liées.",
  "wrong-parent": "Lie d’abord les personnes correspondantes.", "not-unmatched": "Cette ligne n’est pas marquée sans correspondance.",
  "not-resolved": "Ce champ ne porte pas de décision à rouvrir.",
};
