import { defineConfig } from "drizzle-kit";

/**
 * Introspection only — the schema is owned by the Python pipeline
 * (pipeline/migrations/*.sql, applied in the Supabase dashboard).
 * Never run generate/migrate from the app.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
