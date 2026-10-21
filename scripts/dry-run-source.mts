// Lecture complète à blanc d'une source connectée : exécute la même lecture que « Synchroniser » sans rien
// enregistrer, et n'affiche que les comptages par collection, les avertissements (montants masqués) ou le champ refusé.
// Usage (conteneur ponctuel) : npx tsx scripts/dry-run-source.mts <slug-espace> payfit|pennylane <AAAA-MM> […]
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { connectorCredential, organization } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { decryptSecret } from "@/lib/crypto";
import { isProviderId, PROVIDERS } from "@/lib/connectors/providers";

const [slug, provider, ...months] = process.argv.slice(2);
if (!slug || !isProviderId(provider) || months.length === 0) {
  console.error("Usage : dry-run-source.mts <slug-espace> payfit|pennylane <AAAA-MM> […]");
  process.exit(2);
}
const [ws] = await db.select().from(organization).where(eq(organization.slug, slug));
const [cred] = await withWorkspace(ws.id, (tx) =>
  tx.select().from(connectorCredential).where(and(eq(connectorCredential.workspaceId, ws.id), eq(connectorCredential.provider, provider))),
);
try {
  const r = await PROVIDERS[provider].read(decryptSecret(cred.sealedSecret, `${ws.id}:${provider}`), cred.externalCompanyId, months);
  for (const c of r.collections) console.log(`[dry] ${c.collection} : ${c.status === "read" ? `${c.count} lus` : `indisponible (${c.reason})`}`);
  console.log(`[dry] avertissements : ${r.warnings.length}`);
  for (const w of r.warnings) console.log(`[dry]   ${w.replace(/\d[\d\s.,]*(?= ?€)/g, "#")}`);
} catch (e) {
  console.log(`[dry] ÉCHEC : ${e instanceof Error ? e.message : "erreur"}`);
}
console.log("[dry] fin");
await pool.end();
