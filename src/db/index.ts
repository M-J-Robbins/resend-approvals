import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Db };

/**
 * Lazy so that `next build` doesn't need env vars just to import this module.
 * `prepare: false` is required for Neon's pooled (pgbouncer) connections.
 */
export function getDb(): Db {
  if (!globalForDb.__db) {
    const client = postgres(env().DATABASE_URL, { prepare: false, max: 5 });
    globalForDb.__db = drizzle(client, { schema });
  }
  return globalForDb.__db;
}
