import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { journalEntries } from "@/db/schema";
import { accountFor, type Actor } from "@/server/auth";
import { executeCommand } from "@/server/commands";

/**
 * Races against a real Postgres server with several independent sessions
 * (a connection pool), not the single-connection embedded database. Runs
 * when PG_RACE_URL points at a migrated, disposable database:
 *   PG_RACE_URL=postgres://postgres@localhost:55432/more_race pnpm vitest run tests/pg
 */
const url = process.env.PG_RACE_URL;

describe.skipIf(!url)("races on real Postgres sessions", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;
  let me: Actor;

  beforeAll(async () => {
    client = postgres(url!, { max: 10, prepare: false });
    db = drizzle(client, { schema }) as unknown as Db;
    setDb(db);
    me = await accountFor(db, { subject: `race:${randomUUID()}`, displayName: "Alex" });
  });
  afterAll(async () => {
    setDb(null);
    await client.end();
  });

  const run = (command: string, payload: unknown) => executeCommand(me, { command, idempotencyKey: randomUUID(), payload });
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);

  it("BR-02: ten saves from one version, exactly one lands and the rest get a conflict", async () => {
    const { result } = await run("SaveJournalEntry", { entryDate: "2030-10-07", body: "first" });
    const { entryId } = result as { entryId: string };
    const outcomes = await settle(Array.from({ length: 10 }, (_, i) => run("SaveJournalEntry", { entryId, version: 1, entryDate: "2030-10-07", body: `edit ${i}` })));
    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost.every((o) => o.reason.code === "STALE_VERSION")).toBe(true);
    const [row] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
    expect(row.version).toBe(2);
    const winner = outcomes.findIndex((o) => o.status === "fulfilled");
    expect(row.body).toBe(`edit ${winner}`);
  });

  it("BR-03: an edit racing a delete has one winner and never resurrects text", async () => {
    for (let round = 0; round < 5; round++) {
      const { result } = await run("SaveJournalEntry", { entryDate: "2030-10-07", body: "keep me safe" });
      const { entryId } = result as { entryId: string };
      const [save, del] = await settle([
        run("SaveJournalEntry", { entryId, version: 1, entryDate: "2030-10-07", body: "edited" }),
        run("DeleteJournalEntry", { entryId, version: 1 }),
      ]);
      expect([save.status, del.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      const [row] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
      if (del.status === "fulfilled") expect(row).toMatchObject({ body: "", deletedAt: expect.any(Date) });
      else expect(row).toMatchObject({ body: "edited", deletedAt: null });
    }
  });
});
