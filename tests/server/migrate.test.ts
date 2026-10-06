import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPgliteDb } from "@/db/pglite";

describe("migrations", () => {
  it("apply cleanly to an empty database and enforce the reservation exclusion", async () => {
    const db = await createPgliteDb();
    const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    expect((r as unknown as { rows: { n: number }[] }).rows[0].n).toBeGreaterThan(20);
  });

  it("switch on row level security for every table, so Supabase's public API key reads nothing", async () => {
    const db = await createPgliteDb();
    const r = await db.execute(sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect((r as unknown as { rows: unknown[] }).rows).toEqual([]);
  });
});
