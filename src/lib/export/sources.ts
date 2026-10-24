import { PROVIDER_LABELS } from "@/lib/connectors/labels";
import { activeSync, lastSync, SYNC_STATUS_LABELS, type SyncStatus } from "@/lib/connectors/sync";
import type { SourceId } from "@/lib/connectors/types";
import { formatParis, type SourceSpec } from "./xlsx";

// Onglet « Sources » d'un export : d'où viennent les chiffres et quand la source a été lue pour la dernière fois.

// Données déjà lues sur une source : dernière lecture terminée (statut en toutes lettres, instant ISO) et lecture appliquée (celle
// dont les chiffres sont tirés). `neverStatus` : statut d'une entrée qui n'a pas de synchronisation (par exemple une saisie dans Clair).
export type SourceInput = {
  label: string;
  usage: string; // ce que l'export tire de cette source
  last: { statusLabel: string; at: string } | null;
  applied: { at: string } | null;
  neverStatus?: string;
};

// Fonction pure : une ligne de l'onglet par source. Jamais synchronisée : date n.d. (l'onglet écrit « n.d. » et sa raison).
export function sourceRows(inputs: SourceInput[]): SourceSpec[] {
  return inputs.map((s) => ({
    label: s.label,
    detail: s.applied ? `${s.usage} · lecture appliquée le ${formatParis(s.applied.at)}` : s.neverStatus ? s.usage : `${s.usage} · aucune lecture appliquée`,
    syncedAt: s.last?.at ?? null,
    status: s.last?.statusLabel ?? s.neverStatus ?? "Jamais synchronisée",
  }));
}

export type SourceRequest = { provider: SourceId; usage: string; label?: string };

// Chargeur mince : dernière lecture (lastSync) et lecture appliquée (activeSync) de chaque source, pour l'espace donné (la
// lecture passe par withWorkspace : isolement par espace).
export async function loadSourceInputs(workspaceId: string, requests: SourceRequest[]): Promise<SourceInput[]> {
  return Promise.all(
    requests.map(async (r) => {
      const [last, active] = await Promise.all([lastSync(workspaceId, r.provider), activeSync(workspaceId, r.provider)]);
      return {
        label: r.label ?? PROVIDER_LABELS[r.provider],
        usage: r.usage,
        last: last ? { statusLabel: SYNC_STATUS_LABELS[last.status as SyncStatus] ?? last.status, at: (last.finishedAt ?? last.startedAt).toISOString() } : null,
        applied: active?.decidedAt ? { at: active.decidedAt.toISOString() } : null,
      };
    }),
  );
}

export async function loadSourceRows(workspaceId: string, requests: SourceRequest[]): Promise<SourceSpec[]> {
  return sourceRows(await loadSourceInputs(workspaceId, requests));
}
