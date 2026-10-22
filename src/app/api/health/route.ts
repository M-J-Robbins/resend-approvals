import { count, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { drafts } from "@/db/schema";

// Always hit the database; never serve a cached result.
export const dynamic = "force-dynamic";

/** Liveness check: proves the app can reach Postgres and the schema is applied. */
export async function GET() {
  try {
    const db = getDb();
    const [{ now }] = await db.execute<{ now: string }>(sql`select now()::text as now`);
    const [{ drafts: draftCount }] = await db.select({ drafts: count() }).from(drafts);
    return Response.json({ ok: true, database: { now, drafts: draftCount } });
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "database_unavailable",
          message: "Could not query the database.",
          hint: "Check DATABASE_URL in .env.local and run `npm run db:push` if the tables are missing.",
        },
      },
      { status: 503 },
    );
  }
}
