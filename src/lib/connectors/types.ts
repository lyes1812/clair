// Un enregistrement normalisé, tel que stocké dans source_record.
export type SourceRecordInput = {
  collection: string;
  key: string;
  period: string | null;
  data: Record<string, unknown>;
};

export type CollectionOutcome =
  | { collection: string; status: "read"; count: number }
  | { collection: string; status: "unavailable"; reason: string };

export type ProviderReadResult = {
  records: SourceRecordInput[];
  collections: CollectionOutcome[];
  warnings: string[];
};

export type ProviderId = "payfit" | "pennylane";
