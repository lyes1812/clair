import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import type { SourceResolution } from "@/lib/sources";

// Source et date de lecture ; la raison ne complète le bandeau que si elle apporte une limite utile.
export function SourceBadge({ resolution, slug, compact = false }: { resolution: SourceResolution; slug: string; compact?: boolean }) {
  const automaticConfirmation = resolution.mode === "auto" && (resolution.chosen === "payfit" || resolution.chosen === "pennylane")
    && resolution.apiApplied && !resolution.filesApplied && !!resolution.appliedAt
    && resolution.reason === "API connectée et appliquée.";
  const manualConfirmation = !!resolution.chosen && (
    (resolution.mode === "api" && resolution.apiApplied && resolution.reason === "Lecture API appliquée.")
    || (resolution.mode === "files" && resolution.filesApplied && resolution.reason === "Fichiers appliqués.")
  );
  return (
    <p className="source-badge" data-testid={`source-badge-${resolution.domain}`}>
      <span>Source :</span>
      {resolution.chosen ? (
        <strong>
          {compact ? <a href={`/e/${slug}/donnees`}>{PROVIDER_LABELS[resolution.chosen]}</a> : PROVIDER_LABELS[resolution.chosen]}
          {resolution.appliedAt ? ` — lecture appliquée le ${dateTimeFmt.format(resolution.appliedAt)}` : ""}
        </strong>
      ) : (
        <strong>n.d.</strong>
      )}
      {(!compact || !resolution.chosen) && !automaticConfirmation && !manualConfirmation && <span>
        — {resolution.reason}
      </span>}
      {(!compact || !resolution.chosen) && <a href={`/e/${slug}/donnees`}>Données</a>}
    </p>
  );
}
