import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://clair:clair@localhost:5432/clair" },
  migrations: { table: "clair_migrations", schema: "public" },
});
