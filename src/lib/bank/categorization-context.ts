import { iaConfigured } from "@/lib/ia/client";
import { categorizationStats, categorize, emptyCategorization, type CategorizationSettings, type CategorizedFlow } from "./categories";
import { CategorizationError, getCategorization } from "./categorization-store";
import { readBankLedger } from "./store";

/** Flux de tous les comptes appliqués, catégorisés selon les saisies de l'espace (lecture seule). */
export async function loadCategorization(workspaceId: string): Promise<{ flows: CategorizedFlow[]; settings: CategorizationSettings; unreadable: boolean; iaReady: boolean; stats: ReturnType<typeof categorizationStats> }> {
  const ledger = await readBankLedger(workspaceId);
  let settings = emptyCategorization();
  let unreadable = false;
  try { settings = await getCategorization(workspaceId); }
  catch (error) { if (!(error instanceof CategorizationError)) throw error; unreadable = true; }
  const movements = ledger.flatMap((a) => a.movements).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.key.localeCompare(b.key));
  const flows = categorize(movements, unreadable ? emptyCategorization() : settings);
  return { flows, settings, unreadable, iaReady: iaConfigured() && !settings.noAi && !unreadable, stats: categorizationStats(flows) };
}
