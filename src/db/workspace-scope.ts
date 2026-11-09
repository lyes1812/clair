import { sql } from "drizzle-orm";
import { db } from "./client";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";

export type WorkspaceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Toute lecture ou écriture d'une table métier passe par ici : la transaction déclare l'espace,
// et les politiques RLS de PostgreSQL filtrent les lignes en conséquence.
export async function withWorkspace<T>(workspaceId: string, fn: (tx: WorkspaceTransaction) => Promise<T>, config?: PgTransactionConfig): Promise<T> {
  if (!workspaceId) throw new Error("Espace manquant");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  }, config);
}
