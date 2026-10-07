/**
 * Load a backup into a fresh, migrated, EMPTY database at DATABASE_URL, then verify it.
 *   pnpm db:restore <backup-file> [--keep-sign-ins]
 * Refuses a database that already has accounts. Rehearse first with db:rehearse.
 * By default every account waits to be reclaimed by its owner's next sign-in
 * with the same verified email (a new Supabase project has new user ids).
 * --keep-sign-ins keeps the old ids, for when Supabase Auth was restored too.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { relinkReadiness, restoreBackup, verifyRestore } from "@/server/ops/backup";
import { decodeBackup } from "@/server/ops/backup-file";

const [file, flag] = process.argv.slice(2);
const relink = flag !== "--keep-sign-ins";
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error("Usage: DATABASE_URL=… pnpm db:restore <backup-file>");
  process.exit(1);
}
const backup = decodeBackup(readFileSync(file), process.env.BACKUP_PASSPHRASE || undefined);
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client, { schema }) as unknown as Db;
try {
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from accounts`)) as unknown as { n: number }[];
  if (n > 0) throw new Error("The target database already has accounts. Restore only into a fresh, migrated database.");
  await restoreBackup(db, backup, { relink });
  const checks = await verifyRestore(db, backup);
  if (relink) checks.push(await relinkReadiness(db));
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await client.end();
}
