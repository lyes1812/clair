import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.SCALINGO_POSTGRESQL_URL;
  if (!url) throw new Error("DATABASE_URL manquante");
  return url;
}

const globalForDb = globalThis as unknown as { clairPool?: Pool };

export const pool =
  globalForDb.clairPool ?? new Pool({ connectionString: databaseUrl(), max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.clairPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
