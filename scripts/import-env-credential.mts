// Importe une clé API déjà présente en variable d'environnement dans un espace, chiffrée, après vérification
// auprès du fournisseur. N'affiche jamais la clé. Usage (conteneur ponctuel) :
//   npx tsx scripts/import-env-credential.mts <slug-espace> payfit [NOM_VARIABLE]
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { member, organization } from "@/db/schema";
import { saveCredential, verifyPayFitKey } from "@/lib/connectors/sync";

const [slug, provider, variable = "PAYFIT_API_KEY"] = process.argv.slice(2);
if (!slug || provider !== "payfit") {
  console.error("Usage : import-env-credential.mts <slug-espace> payfit [NOM_VARIABLE]");
  process.exit(2);
}
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
  const verified = await verifyPayFitKey(key);
  await saveCredential(ws.id, "payfit", key, verified, admin.userId);
  console.log(`[import] Espace « ${ws.name} » : PayFit connecté (${verified.companyName}), droits : ${verified.scopes.join(", ") || "aucun"}.`);
} catch (e) {
  console.error(`[import] Échec : ${e instanceof Error ? e.message : "erreur"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
