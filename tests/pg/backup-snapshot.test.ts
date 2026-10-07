import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createPgliteDb } from "@/db/pglite";
import * as schema from "@/db/schema";
import { accounts, journalEntries } from "@/db/schema";
import { restoreBackup, takeBackup, verifyRestore } from "@/server/ops/backup";

/**
 * BR-07: a backup taken while people keep writing is one consistent moment.
 * Runs against a real Postgres server (PG_RACE_URL) so the writer and the
 * backup are separate sessions.
 */
const url = process.env.PG_RACE_URL;

describe.skipIf(!url)("backup snapshot on real Postgres", () => {
  let backupClient: ReturnType<typeof postgres>;
  let writerClient: ReturnType<typeof postgres>;

  beforeAll(() => {
    backupClient = postgres(url!, { max: 1, prepare: false });
    writerClient = postgres(url!, { max: 1, prepare: false });
  });
  afterAll(async () => {
    await backupClient.end();
    await writerClient.end();
  });

  it("BR-07: rows written during the backup never leave dangling references", async () => {
    const source = drizzle(backupClient, { schema }) as unknown as Db;
    const writer = drizzle(writerClient, { schema }) as unknown as Db;
    let writing = true;
    let written = 0;
    // A new person signs up and writes in their journal, over and over, while the backup runs.
    const writes = (async () => {
      while (writing) {
        const [a] = await writer.insert(accounts).values({ identitySubject: `snap:${randomUUID()}`, displayName: "New" }).returning({ id: accounts.id });
        await writer.insert(journalEntries).values({ accountId: a.id, entryDate: "2030-10-07", body: "written mid-backup" });
        written++;
      }
    })();
    try {
      for (let round = 0; round < 3; round++) {
        const backup = await takeBackup(source);
        const restored = await createPgliteDb();
        await restoreBackup(restored, backup);
        const refs = (await verifyRestore(restored, backup)).find((c) => c.name === "References");
        expect(refs?.detail).toMatch(/no orphans/);
      }
    } finally {
      writing = false;
      await writes;
    }
    expect(written).toBeGreaterThan(0);
  }, 120_000);
});
