import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __formwatchDb?: Db };

/**
 * Lazy singleton against the Supabase transaction pooler. Returns null when
 * DATABASE_URL is unset so pages can render their offline/empty states
 * (including at build time) instead of crashing on import.
 */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__formwatchDb) {
    // pgbouncer transaction mode cannot host prepared statements
    const client = postgres(url, { prepare: false });
    globalForDb.__formwatchDb = drizzle(client, { schema });
  }
  return globalForDb.__formwatchDb;
}
