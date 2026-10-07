/**
 * Restore a backup into an isolated embedded database and verify it.
 *   pnpm db:rehearse <backup-file> [--summary report.md]
 * Exits non-zero if any check fails. Prints checks, never rows.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createPgliteDb } from "@/db/pglite";
import { relinkReadiness, restoreBackup, verifyRestore } from "@/server/ops/backup";
import { decodeBackup } from "@/server/ops/backup-file";

const [file, flag, summary] = process.argv.slice(2);
if (!file) {
  console.error("Usage: pnpm db:rehearse <backup-file> [--summary report.md]");
  process.exit(1);
}
const started = Date.now();
const backup = decodeBackup(readFileSync(file), process.env.BACKUP_PASSPHRASE || undefined);
const db = await createPgliteDb();
await restoreBackup(db, backup, { relink: true });
const checks = [...(await verifyRestore(db, backup)), await relinkReadiness(db)];
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const ok = checks.every((c) => c.ok);

const lines = [
  `Restore rehearsal of the backup taken ${backup.takenAt}: ${ok ? "PASSED" : "FAILED"} in ${seconds}s`,
  ...checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`),
];
console.log(lines.join("\n"));
if (flag === "--summary" && summary) {
  appendFileSync(summary, [`### ${lines[0]}`, "", "| | Check | Result |", "| --- | --- | --- |", ...checks.map((c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail} |`), ""].join("\n"));
}
process.exit(ok ? 0 : 1);
