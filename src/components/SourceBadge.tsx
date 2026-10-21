import { dateTimeFmt, PROVIDER_LABELS } from "@/lib/connectors/labels";
import type { SourceResolution } from "@/lib/sources";

// Affiché sur chaque écran qui dépend d'une source : laquelle fait foi, et pourquoi.
export function SourceBadge({ resolution, slug }: { resolution: SourceResolution; slug: string }) {
  return (
    <p className="source-badge" data-testid={`source-badge-${resolution.domain}`}>
      <span>Source :</span>
      {resolution.chosen ? (
        <strong>{PROVIDER_LABELS[resolution.chosen]}{resolution.appliedAt ? ` — lecture appliquée le ${dateTimeFmt.format(resolution.appliedAt)}` : ""}</strong>
      ) : (
        <strong>n.d.</strong>
      )}
      <span>
        — {resolution.reason}
        {resolution.mode !== "auto" && resolution.modeSetAt ? ` Choix forcé par l'administrateur le ${dateTimeFmt.format(resolution.modeSetAt)}.` : ""}
      </span>
      <a href={`/e/${slug}/donnees`}>Données</a>
    </p>
  );
}
