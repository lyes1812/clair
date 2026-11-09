import "@/styles/donnees.css";
import "@/styles/reconciliation.css";
import { z } from "zod";
import { requireWorkspace } from "@/lib/workspace";
import { loadReconciliation } from "@/lib/reconciliation/store";
import { PageHead } from "../ui";
import { ReconciliationView } from "./ReconciliationView";
import { createReconciliationAction, decideReconciliationAction } from "./actions";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;

export default async function ReconciliationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  // Le contrôle et son historique contiennent des identités : aucun chargement pour un lecteur.
  const { workspace } = await requireWorkspace(slug, "editor");
  const sp = await searchParams;
  const raw = Array.isArray(sp.run) ? sp.run[0] : sp.run;
  const parsed = z.string().uuid().safeParse(raw);
  const unavailable = <><PageHead kicker="Données" title="Rapprochement DSN–PayFit" /><p className="notice" data-testid="reconciliation-unavailable">Contrôle indisponible dans cet espace.</p><a href={`/e/${slug}/donnees/rapprochement`}>Revenir aux contrôles</a></>;
  if (raw && !parsed.success) return unavailable;
  const runId = parsed.success ? parsed.data : undefined;
  let model: Awaited<ReturnType<typeof loadReconciliation>>;
  try { model = await loadReconciliation(workspace.id, runId); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "not_found") return unavailable;
    throw error;
  }
  return <ReconciliationView slug={slug} model={model} actions={{ create: createReconciliationAction.bind(null, slug), decide: decideReconciliationAction.bind(null, slug) }} />;
}
