/**
 * Take a logical backup of DATABASE_URL.
 *   pnpm db:backup [out-file]
 * Encrypted when BACKUP_PASSPHRASE is set. Prints table counts only, never rows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { takeBackup } from "@/server/ops/backup";
import { encodeBackup } from "@/server/ops/backup-file";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (the direct or session-pooler connection string).");
  process.exit(1);
}
const passphrase = process.env.BACKUP_PASSPHRASE || undefined;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = process.argv[2] ?? path.join("backups", `more-${stamp}.json.gz${passphrase ? ".enc" : ""}`);

const client = postgres(url, { max: 1, prepare: false });
try {
  const backup = await takeBackup(drizzle(client, { schema }) as unknown as Db);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, encodeBackup(backup, passphrase), { mode: 0o600 });
  const rows = Object.values(backup.tables).reduce((s, t) => s + t.length, 0);
  console.log(`Backed up ${rows} rows from ${Object.keys(backup.tables).length} tables to ${out}${passphrase ? " (encrypted)" : ""}.`);
} finally {
  await client.end();
}
