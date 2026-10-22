import { desc, eq, sql } from "drizzle-orm";
import { workspaceEvent } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { getHeadcountNatures, type HeadcountNatures } from "@/lib/rh-settings";
import { resolveSource, type SourceResolution } from "@/lib/sources";
import { requireWorkspace, type WorkspaceAccess } from "@/lib/workspace";
import type { Count, HeadcountResult } from "./headcount";
import { ensureRhBuild, loadRhBuild, type RhBuildRow, type RhBuildState } from "./referential/store";
import type { EventFlag, MonthFlag, PersonDraft, RhBuildData, RhSource } from "./referential/types";

// Contexte commun des écrans Collaborateurs : source retenue, référentiel à jour, natures comptées, établissements.
export const KEY_RE = /^(payfit|dsn):[A-Za-z0-9_-]{1,128}$/;
export const SWITCH_NOTICE_DAYS = 30;

export type Establishment = { id: string; label: string };
export type CollabContext = {
  slug: string;
  workspace: WorkspaceAccess;
  userId: string;
  source: SourceResolution;
  chosen: RhSource | null;
  natures: HeadcountNatures;
  state: RhBuildState | null;
  data: (RhBuildData & { build: RhBuildRow }) | null;
  switchedAt: Date | null;
  establishments: Establishment[];
};

export async function loadCollabContext(slug: string): Promise<CollabContext> {
  const { session, workspace } = await requireWorkspace(slug);
  const [source, natures, lastSwitch] = await Promise.all([
    resolveSource(workspace.id, "rh"),
    getHeadcountNatures(workspace.id),
    withWorkspace(workspace.id, (tx) =>
      tx
        .select({ at: workspaceEvent.occurredAt })
        .from(workspaceEvent)
        .where(sql`${workspaceEvent.kind} = 'setting.changed' and ${workspaceEvent.detail}->>'key' = 'source.rh.mode'`)
        .orderBy(desc(workspaceEvent.occurredAt))
        .limit(1),
    ),
  ]);
  const chosen: RhSource | null = source.chosen === "payfit" || source.chosen === "dsn" ? source.chosen : null;
  const state = chosen ? await ensureRhBuild(workspace.id, chosen, session.user.id) : null;
  const data = state?.kind === "ready" ? await loadRhBuild(workspace.id, state.build.id) : null;
  const switchedAt = lastSwitch[0] && Date.now() - lastSwitch[0].at.getTime() < SWITCH_NOTICE_DAYS * 86_400_000 ? lastSwitch[0].at : null;
  const establishments: Establishment[] = data
    ? [...new Set(data.coverage.map((c) => c.establishmentId))].sort().map((id) => ({
        id,
        label: data.build.source === "payfit" ? `Société PayFit : ${(data.build.inputs.source === "payfit" && data.build.inputs.company?.name) || id}` : `SIRET ${id}`,
      }))
    : [];
  return { slug, workspace, userId: session.user.id, source, chosen, natures, state, data, switchedAt, establishments };
}

// --- Libellés d'affichage

export const personLabel = (p: PersonDraft | null | undefined): string | null => {
  if (!p) return null;
  const s = [p.familyName, p.givenNames].filter(Boolean).join(" ").trim();
  return s || null;
};

const numFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
export const fmtNumber = (v: number) => numFmt.format(v);
export const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR").format(v);

export function timeUnitLabel(unit: string | null, source: RhSource): string {
  if (unit === null) return "";
  if (source === "payfit") return unit === "hours" ? "h" : unit === "days" ? "j" : unit;
  return unit === "10" ? "h" : unit === "12" ? "j" : `(unité ${unit})`;
}

export const MONTH_FLAG_LABELS: Record<MonthFlag, string> = {
  negative_time: "temps négatif",
  time_missing: "sans ligne de temps",
  time_outside_contract: "temps hors période du contrat",
  declared_before_start: "déclaré avant le début",
  declared_after_end: "déclaré après la fin",
  not_declared: "non déclaré",
};
export const EVENT_FLAG_LABELS: Record<EventFlag, string> = {
  future: "à venir",
  pending: "en attente",
  continuity_same_person: "contrat continu",
  rehire: "réembauche",
  renumbered: "renuméroté",
  lower_bound_window: "mois en borne basse",
  provisional: "provisoire",
};
export const END_STATUS_LABELS = {
  known: "fin connue",
  none_cdi: "sans terme (CDI)",
  none_other_nature: "fin non renseignée",
  none_nature_nd: "fin et nature non renseignées",
  unpositioned: "non positionnable (sans date de début)",
  disappeared: "disparu des déclarations sans fin déclarée",
} as const;
export const IDENTIFIER_LABELS = { payfit: "identifiant collaborateur PayFit", nir: "NIR (empreinte)", ntt: "identifiant temporaire (NTT) — à vérifier" } as const;

export type Shown = { text: string; kind: "value" | "lower" | "nd"; foot?: string };

// Tuiles : la raison détaillée d'une borne basse est dans le bandeau de couverture ; la tuile reste courte.
export function showHeadcount(r: HeadcountResult, field: "persons" | "contracts" | "allContracts"): Shown {
  if (r.kind === "nd") return { text: `n.d. — ${r.nd.reason}`, kind: "nd" };
  const n = fmtInt(r[field]);
  const after = r.declaredAfterEnd > 0 && field !== "allContracts" ? `${r.declaredAfterEnd} déclaré(s) après leur fin, non compté(s)` : null;
  if (r.kind === "lower_bound") return { text: `≥ ${n}`, kind: "lower", foot: ["borne basse (voir la couverture du mois)", after].filter(Boolean).join(" · ") };
  return { text: n, kind: "value", foot: after ?? undefined };
}

export function showCount(c: Count): Shown {
  if (c.kind === "nd") return { text: `n.d. — ${c.nd.reason}`, kind: "nd" };
  if (c.kind === "lower_bound") return { text: `≥ ${fmtInt(c.value)}`, kind: "lower", foot: c.qualifiers.join(" · ") || "au moins" };
  return { text: fmtInt(c.value), kind: "value", foot: c.qualifiers.join(" · ") || undefined };
}
