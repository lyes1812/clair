import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import type { SourceResolution } from "@/lib/sources";

// Affiché sur chaque écran qui dépend d'une source : laquelle fait foi, et pourquoi.
export function SourceBadge({ resolution, slug, compact = false }: { resolution: SourceResolution; slug: string; compact?: boolean }) {
  const routineReason = resolution.mode === "auto" && (resolution.chosen === "payfit" || resolution.chosen === "pennylane")
    && resolution.apiApplied && !resolution.filesApplied && !!resolution.appliedAt
    && resolution.reason === "API connectée et appliquée.";
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
      {(!compact || !resolution.chosen) && !routineReason && <span>
        — {resolution.reason}
        {resolution.mode !== "auto" && resolution.modeSetAt ? ` Choix forcé par l'administrateur le ${dateTimeFmt.format(resolution.modeSetAt)}.` : ""}
      </span>}
      {(!compact || !resolution.chosen) && <a href={`/e/${slug}/donnees`}>Données</a>}
    </p>
  );
}
