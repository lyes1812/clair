import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL ?? process.env.SCALINGO_POSTGRESQL_URL;
if (!url) throw new Error("DATABASE_URL manquante");

const pool = new Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), {
  migrationsFolder: "./drizzle",
  migrationsTable: "clair_migrations",
  migrationsSchema: "public",
});
await pool.end();
console.log("Migrations appliquées.");
