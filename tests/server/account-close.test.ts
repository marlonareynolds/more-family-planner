import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, journalEntries, memberships } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { expectCode, newWorld } from "./harness";

describe("closing an account", () => {
  it("asks you to leave first, then erases what was only yours", async () => {
    const w = await newWorld();
    await w.run(w.sam, "SaveJournalEntry", { entryDate: "2030-10-07", title: "Note", body: "Only mine" });
    expect(await w.db.select().from(journalEntries).where(eq(journalEntries.accountId, w.sam.accountId))).toHaveLength(1);
    await expectCode(w.run(w.sam, "CloseAccount", { confirm: "close" }), "CONFLICT");
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    await w.run(w.sam, "CloseAccount", { confirm: "close" });

    const [sam] = await w.db.select().from(accounts).where(eq(accounts.id, w.sam.accountId));
    expect(sam).toMatchObject({ displayName: "Former member", email: null, identitySubject: `closed:${w.sam.accountId}` });
    expect(sam.closedAt).not.toBeNull();
    expect(await w.db.select().from(journalEntries).where(eq(journalEntries.accountId, w.sam.accountId))).toEqual([]);
    // Alex carries on in the household.
    const [alex] = await w.db.select().from(memberships).where(eq(memberships.accountId, w.alex.accountId));
    expect(alex.endsAt).toBeNull();
  });
});

describe("rate limits", () => {
  it("allows a burst up to the limit, then resets with the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("t:a", 3, 60_000, now)).toBe(true);
    expect(rateLimit("t:a", 3, 60_000, now + 1)).toBe(false);
    expect(rateLimit("t:b", 3, 60_000, now + 1)).toBe(true);
    expect(rateLimit("t:a", 3, 60_000, now + 60_000)).toBe(true);
  });
});
