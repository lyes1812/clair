// Diagnostic de format des réponses PayFit : n'affiche que des types et des effectifs, jamais de valeur.
// Usage (conteneur ponctuel) : npx tsx scripts/diagnose-payfit.mts <slug-espace> <AAAA-MM> [<AAAA-MM>…]
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { connectorCredential, organization } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { decryptSecret } from "@/lib/crypto";
import { payfitClientFor } from "@/lib/connectors/sync";

const [slug, ...months] = process.argv.slice(2);
const kind = (v: unknown): string => {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  if (typeof v === "number") return !Number.isFinite(v) ? "nombre-non-fini" : v < 0 ? "nombre<0" : Number.isInteger(v) ? "entier>=0" : "décimal>=0";
  if (typeof v === "string") return /^-?\d+([.,]\d+)?$/.test(v.trim()) ? "texte-numérique" : `texte(${v.length})`;
  if (Array.isArray(v)) return `tableau(${v.length})`;
  if (typeof v === "object") return `objet{${Object.keys(v as object).sort().join(",")}}`;
  return typeof v;
};

const [ws] = await db.select().from(organization).where(eq(organization.slug, slug));
const [cred] = await withWorkspace(ws.id, (tx) =>
  tx.select().from(connectorCredential).where(and(eq(connectorCredential.workspaceId, ws.id), eq(connectorCredential.provider, "payfit"))),
);
const client = payfitClientFor(decryptSecret(cred.sealedSecret, `${ws.id}:payfit`));
const { companyId } = await client.introspect();
for (const month of months) {
  const rows = await client.paginate(companyId, "contracts/time", "contracts", (r) => String(r.contractId), { date: month.replace("-", "") });
  const stats: Record<string, Record<string, number>> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) ((stats[k] ??= {})[kind(v)] = (stats[k][kind(v)] ?? 0) + 1);
  console.log(`[diag] ${month} contracts/time : ${rows.length} éléments`);
  for (const [k, s] of Object.entries(stats).sort()) if (k !== "contractId") console.log(`[diag]   ${k} → ${JSON.stringify(s)}`);
}
console.log("[diag] fin");
await pool.end();
