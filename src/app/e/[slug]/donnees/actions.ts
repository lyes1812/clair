"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProviderError } from "@/lib/connectors/http";
import { isMonth, monthRange } from "@/lib/connectors/months";
import { isProviderId } from "@/lib/connectors/providers";
import { applySync, deleteCredential, discardSync, getSync, saveCredential, startSync, SyncError, verifyKey } from "@/lib/connectors/sync";
import type { ProviderId } from "@/lib/connectors/types";
import { safeFilename } from "@/lib/connectors/files";
import { importDsnFiles } from "@/lib/dsn/import";
import { DSN_MAX_BYTES, DsnError } from "@/lib/dsn/parser";
import { importFecFiles } from "@/lib/fec/import";
import { ensureRhBuild } from "@/lib/rh/referential/store";
import { FEC_MAX_BYTES, FecError } from "@/lib/fec/parser";
import { chooseSourceMode, DOMAINS, isSourceMode, type SourceDomain } from "@/lib/sources";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string } | undefined;

const MAX_MONTHS = 24;

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
}

function provider(value: string): ProviderId {
  if (!isProviderId(value)) throw new Error("Source inconnue");
  return value;
}

export async function connectSource(slug: string, source: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const p = provider(source);
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const key = String(formData.get("apiKey") ?? "").trim();
  const companyId = String(formData.get("companyId") ?? "").trim() || null;
  if (!key) return { error: "Saisissez la clé API." };
  if (companyId !== null && !/^[1-9]\d{0,29}$/.test(companyId)) return { error: "L'identifiant de société est un nombre." };
  try {
    const verified = await verifyKey(p, key, companyId);
    await saveCredential(workspace.id, p, key, verified, session.user.id);
  } catch (e) {
    return { error: e instanceof ProviderError ? e.message : "Vérification impossible. Réessayez." };
  }
  revalidatePath(`/e/${slug}/donnees`, "layout");
  return { ok: "Connexion vérifiée auprès du fournisseur." };
}

export async function disconnectSource(slug: string, source: string) {
  const p = provider(source);
  const { session, workspace } = await requireWorkspace(slug, "admin");
  await deleteCredential(workspace.id, p, session.user.id);
  revalidatePath(`/e/${slug}/donnees`, "layout");
}

export async function launchSync(slug: string, source: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const p = provider(source);
  const { session, workspace } = await requireWorkspace(slug, "editor");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!isMonth(from) || !isMonth(to)) return { error: "Choisissez un mois de début et un mois de fin." };
  if (from > to) return { error: "Le mois de début doit précéder le mois de fin." };
  if (to > currentMonth()) return { error: "Le mois de fin ne peut pas être dans le futur." };
  const months = monthRange(from, to);
  if (months.length > MAX_MONTHS) return { error: `${MAX_MONTHS} mois au plus par lecture.` };
  let id: string;
  try {
    id = await startSync(workspace.id, p, months, session.user.id);
  } catch (e) {
    return { error: e instanceof SyncError ? e.message : "Lecture impossible. Réessayez." };
  }
  redirect(`/e/${slug}/donnees/synchro/${id}`);
}

export async function decideSync(slug: string, syncId: string, decision: "apply" | "discard"): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  let provider: string | null = null;
  try {
    provider = (await getSync(workspace.id, syncId))?.provider ?? null;
    if (decision === "apply") await applySync(workspace.id, syncId, session.user.id);
    else await discardSync(workspace.id, syncId, session.user.id);
  } catch (e) {
    return { error: e instanceof SyncError ? e.message : "Opération impossible." };
  }
  // Référentiel Collaborateurs : reconstruit dès l'application d'une lecture RH (sinon à l'ouverture du module).
  let rhNote = "";
  if (decision === "apply" && (provider === "payfit" || provider === "dsn")) {
    try {
      const state = await ensureRhBuild(workspace.id, provider, session.user.id);
      if (state.kind === "unavailable") rhNote = ` Référentiel Collaborateurs indisponible : ${state.reason}.`;
    } catch (e) {
      console.error("[rh] reconstruction impossible", provider, e instanceof Error ? e.name : "inconnu");
      rhNote = " Le référentiel Collaborateurs n'a pas pu être reconstruit ; il le sera à l'ouverture du module.";
    }
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: decision === "apply" ? `Synchronisation appliquée : c'est désormais la source active.${rhNote}` : "Aperçu abandonné." };
}

const UPLOAD_KINDS = {
  dsn: { maxFiles: 24, maxBytes: DSN_MAX_BYTES, maxLabel: "4 Mo", run: importDsnFiles, isError: (e: unknown) => e instanceof DsnError },
  fec: { maxFiles: 6, maxBytes: FEC_MAX_BYTES, maxLabel: "32 Mo", run: importFecFiles, isError: (e: unknown) => e instanceof FecError },
} as const;

export async function uploadFiles(slug: string, kind: keyof typeof UPLOAD_KINDS, _prev: FormState, formData: FormData): Promise<FormState> {
  const rules = UPLOAD_KINDS[kind];
  if (!rules) return { error: "Type de fichier inconnu." };
  const { session, workspace } = await requireWorkspace(slug, "editor");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Choisissez au moins un fichier." };
  if (files.length > rules.maxFiles) return { error: `${rules.maxFiles} fichiers au plus par dépôt.` };
  const uploads = [];
  for (const f of files) {
    if (f.size > rules.maxBytes) return { error: `${f.name} : fichier trop volumineux (${rules.maxLabel} au plus).` };
    uploads.push({ filename: safeFilename(f.name, kind), bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  let id: string;
  try {
    id = await rules.run(workspace.id, uploads, session.user.id);
  } catch (e) {
    return { error: rules.isError(e) ? (e as Error).message : "Dépôt impossible. Réessayez." };
  }
  redirect(`/e/${slug}/donnees/synchro/${id}`);
}

export async function chooseSource(slug: string, domain: string, formData: FormData): Promise<void> {
  if (!(domain in DOMAINS)) return;
  const mode = formData.get("mode");
  if (!isSourceMode(mode)) return;
  const { session, workspace } = await requireWorkspace(slug, "admin");
  await chooseSourceMode(workspace.id, domain as SourceDomain, mode, session.user.id);
  revalidatePath(`/e/${slug}`, "layout");
}
