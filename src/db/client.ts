import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbOrTx = Db | Tx;

/**
 * One connection per process. Kept on globalThis because Next can load this
 * module more than once (route handlers and pages are separate bundles), and
 * two embedded databases on one directory would not see each other's writes.
 */
const store = globalThis as typeof globalThis & { __moreDb?: Promise<Db> | null };

/**
 * Production and preview use Postgres through DATABASE_URL. Local
 * development without a URL uses an embedded PGlite database on disk, so
 * the app runs with no external accounts.
 */
export function getDb(): Promise<Db> {
  store.__moreDb ??= connect().catch((err) => {
    // Don't cache a failed connection; the next request tries again.
    store.__moreDb = null;
    throw err;
  });
  return store.__moreDb;
}

/** For tests: use a specific database instance. */
export function setDb(db: Db | null): void {
  store.__moreDb = db ? Promise.resolve(db) : null;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 5, prepare: false });
    return drizzle(client, { schema }) as unknown as Db;
  }
  // A throwaway demo deployment may use the embedded database in /tmp:
  // data lives only as long as the server instance and can reset at any time.
  const demo = process.env.MORE_DEMO_DB === "1";
  if (process.env.NODE_ENV === "production" && !demo) {
    throw new Error("DATABASE_URL is required in production");
  }
  const { createPgliteDb } = await import("./pglite");
  return createPgliteDb(process.env.PGLITE_DIR ?? (demo ? "/tmp/more-pglite" : ".data/pglite"));
}
