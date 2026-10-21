import { and, eq } from "drizzle-orm";
import { sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { activeSync } from "./connectors/sync";
import type { SourceId } from "./connectors/types";
import { getSetting, setSetting } from "./settings";

// Source retenue par domaine (règle validée par Lyes) : l'API fait foi si elle est connectée et qu'une lecture est
// appliquée, sinon les fichiers ; l'administrateur peut forcer le choix ; la source retenue est affichée sur chaque écran.
export type SourceDomain = "rh" | "accounting";
export type SourceMode = "auto" | "api" | "files";

export const DOMAINS: Record<SourceDomain, { label: string; api: SourceId; files: SourceId; settingKey: string }> = {
  rh: { label: "Ressources humaines", api: "payfit", files: "dsn", settingKey: "source.rh.mode" },
  accounting: { label: "Comptabilité", api: "pennylane", files: "fec", settingKey: "source.accounting.mode" },
};

export const SOURCE_MODE_LABELS: Record<SourceMode, string> = { auto: "Automatique (API si disponible, sinon fichiers)", api: "API uniquement", files: "Fichiers uniquement" };

export type SourceResolution = {
  domain: SourceDomain;
  mode: SourceMode;
  chosen: SourceId | null;
  // Explication affichée à l'écran : pourquoi cette source, ou pourquoi aucune (« n.d. »).
  reason: string;
  apiApplied: boolean;
  filesApplied: boolean;
  appliedAt: Date | null;
};

export function isSourceMode(v: unknown): v is SourceMode {
  return v === "auto" || v === "api" || v === "files";
}

// Règle pure, testée à la main : quel fournisseur retenir selon le mode et les lectures appliquées.
export function resolveSourceMode(mode: SourceMode, apiApplied: boolean, filesApplied: boolean): { pick: "api" | "files" | null; reason: string } {
  if (mode === "api") return apiApplied ? { pick: "api", reason: "API choisie par l'administrateur." } : { pick: null, reason: "API choisie par l'administrateur, mais aucune lecture API appliquée." };
  if (mode === "files") return filesApplied ? { pick: "files", reason: "Fichiers choisis par l'administrateur." } : { pick: null, reason: "Fichiers choisis par l'administrateur, mais aucun dépôt appliqué." };
  if (apiApplied) return { pick: "api", reason: filesApplied ? "API connectée et appliquée : elle fait foi (des fichiers sont aussi appliqués, non utilisés)." : "API connectée et appliquée." };
  if (filesApplied) return { pick: "files", reason: "Aucune lecture API appliquée : les fichiers déposés font foi." };
  return { pick: null, reason: "Aucune source appliquée pour ce domaine." };
}

export async function resolveSource(workspaceId: string, domain: SourceDomain): Promise<SourceResolution> {
  const d = DOMAINS[domain];
  const [mode, api, files] = await Promise.all([
    getSetting(workspaceId, d.settingKey, (v) => (isSourceMode(v) ? v : null)),
    activeSync(workspaceId, d.api),
    withWorkspace(workspaceId, (tx) =>
      tx.select({ decidedAt: sourceSync.decidedAt }).from(sourceSync).where(and(eq(sourceSync.provider, d.files), eq(sourceSync.status, "applied"))).limit(1),
    ),
  ]);
  const effectiveMode = mode ?? "auto";
  const { pick, reason } = resolveSourceMode(effectiveMode, Boolean(api), files.length > 0);
  return {
    domain,
    mode: effectiveMode,
    chosen: pick === "api" ? d.api : pick === "files" ? d.files : null,
    reason,
    apiApplied: Boolean(api),
    filesApplied: files.length > 0,
    appliedAt: pick === "api" ? (api?.decidedAt ?? null) : null,
  };
}

export async function chooseSourceMode(workspaceId: string, domain: SourceDomain, mode: SourceMode, actorUserId: string): Promise<void> {
  await setSetting(workspaceId, DOMAINS[domain].settingKey, mode, actorUserId);
}
