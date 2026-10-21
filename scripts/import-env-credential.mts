// Importe une clé API déjà présente en variable d'environnement dans un espace, chiffrée, après vérification
// auprès du fournisseur. N'affiche jamais la clé. Usage (conteneur ponctuel) :
//   npx tsx scripts/import-env-credential.mts <slug-espace> payfit|pennylane [NOM_VARIABLE_CLE] [NOM_VARIABLE_SOCIETE]
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { member, organization } from "@/db/schema";
import { isProviderId } from "@/lib/connectors/providers";
import { saveCredential, verifyKey } from "@/lib/connectors/sync";

const [slug, provider, keyVar, companyVar] = process.argv.slice(2);
if (!slug || !isProviderId(provider)) {
  console.error("Usage : import-env-credential.mts <slug-espace> payfit|pennylane [NOM_VARIABLE_CLE] [NOM_VARIABLE_SOCIETE]");
  process.exit(2);
}
const variable = keyVar ?? (provider === "payfit" ? "PAYFIT_API_KEY" : "PENNYLANE_API_KEY");
const companyId = provider === "pennylane" ? process.env[companyVar ?? "PENNYLANE_COMPANY_ID"] ?? null : null;
const key = process.env[variable];
if (!key) {
  console.error(`Variable ${variable} absente.`);
  process.exit(2);
}
const [ws] = await db.select().from(organization).where(eq(organization.slug, slug));
if (!ws) {
  console.error("Espace introuvable.");
  process.exit(2);
}
const [admin] = await db.select().from(member).where(and(eq(member.organizationId, ws.id), eq(member.role, "admin"))).limit(1);
try {
  const verified = await verifyKey(provider, key, companyId);
  await saveCredential(ws.id, provider, key, verified, admin.userId);
  console.log(`[import] Espace « ${ws.name} » : ${provider} connecté (${verified.companyName}), droits : ${verified.scopes.join(", ") || "n.d."}.`);
} catch (e) {
  console.error(`[import] Échec : ${e instanceof Error ? e.message : "erreur"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
