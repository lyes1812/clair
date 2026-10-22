import { canonicalJson, sha256 } from "@/lib/crypto";
import type { RhSource } from "./types";

// Version des règles de construction : tout changement de règle force une reconstruction après déploiement.
export const RH_BUILDER_VERSION = 4; // 3 : revue 2d (mois charnière, lignes de temps hors période ou sans contrat, fractions, couverture multi-SIRET) ; 4 : nature DSN des événements = nature déclarée à l'entrée et à la sortie

// Empreinte des entrées d'un référentiel : lectures appliquées (identifiant + contenu) et, pour la DSN, les
// paires (dépôt, déclaration) retenues ; indépendante de l'ordre.
export function rhInputsHash(parts: { source: RhSource; syncs: { id: string; contentHash: string | null }[]; selected?: { syncId: string; key: string }[] }): string {
  const syncs = [...parts.syncs].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ id: s.id, contentHash: s.contentHash }));
  const selected = [...(parts.selected ?? [])].sort((a, b) => a.syncId.localeCompare(b.syncId) || a.key.localeCompare(b.key));
  return sha256(canonicalJson({ builderVersion: RH_BUILDER_VERSION, source: parts.source, syncs, selected }));
}
