import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { invitations, memberships, reservations } from "@/db/schema";
import { accountFor, type Actor } from "@/server/auth";
import { executeCommand } from "@/server/commands";

/**
 * BR-17: two people acting at the same moment, each on their own database
 * session, under a real Postgres server. Same set-up as races.test.ts.
 */
const url = process.env.PG_RACE_URL;

describe.skipIf(!url)("BR-17 household races on real Postgres sessions", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(() => {
    client = postgres(url!, { max: 10, prepare: false });
    db = drizzle(client, { schema }) as unknown as Db;
    setDb(db);
  });
  afterAll(async () => {
    setDb(null);
    await client.end();
  });

  const person = (name: string) => accountFor(db, { subject: `race:${randomUUID()}`, displayName: name });
  const run = async (actor: Actor, command: string, payload: unknown, householdId?: string) => (await executeCommand(actor, { command, householdId, idempotencyKey: randomUUID(), payload })).result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- command-specific results
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  const codes = (rs: PromiseSettledResult<unknown>[]) => rs.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code ?? String(r.reason)));

  async function household() {
    const alex = await person("Alex");
    const { householdId } = await run(alex, "CreateHousehold", { name: "Race house" });
    const { token, invitationId } = await run(alex, "CreateInvite", {}, householdId);
    return { alex, householdId: householdId as string, token: token as string, invitationId: invitationId as string };
  }
  const adultsIn = async (householdId: string) => (await db.select().from(memberships).where(and(eq(memberships.householdId, householdId), isNull(memberships.endsAt)))).length;

  it("two overlapping plans accepted at once: one is agreed, the other is refused, nobody is double-booked", async () => {
    for (let round = 0; round < 5; round++) {
      const { alex, householdId, token } = await household();
      const sam = await person("Sam");
      await run(sam, "JoinHousehold", { token });
      const plan = async (title: string, start: string) => {
        const { momentId } = await run(alex, "CreateMoment", { kind: "us", title, span: { allDay: false, startDate: "2030-10-11", startTime: start, endDate: "2030-10-11", endTime: "22:00" }, participantIds: [alex.accountId, sam.accountId] }, householdId);
        await run(alex, "ShareMoment", { momentId, version: 1 }, householdId);
        return momentId as string;
      };
      const a = await plan("Dinner", "19:00");
      const b = await plan("Cinema", "20:00");
      const results = await settle([a, b].map((momentId) => run(sam, "RespondToMoment", { momentId, materialVersion: 1, decision: "accepted" }, householdId)));
      const agreed = results.filter((r) => r.status === "fulfilled" && (r.value as { reserved: boolean }).reserved);
      expect(agreed).toHaveLength(1);
      expect(codes(results).filter((c) => c !== "ok")).toEqual(["CONFLICT"]);
      const held = await db.select().from(reservations).where(eq(reservations.householdId, householdId));
      // One plan, both adults, no overlaps for either.
      expect(held).toHaveLength(2);
      expect(new Set(held.map((r) => r.sourceId)).size).toBe(1);
    }
  });

  it("an invitation revoked while someone joins with it: exactly one wins", async () => {
    const tally = { joined: 0, revoked: 0 };
    for (let round = 0; round < 6; round++) {
      const { alex, householdId, token, invitationId } = await household();
      const sam = await person("Sam");
      const [join, revoke] = await settle([run(sam, "JoinHousehold", { token }), run(alex, "RevokeInvite", { invitationId }, householdId)]);
      expect([join.status, revoke.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId));
      if (join.status === "fulfilled") {
        tally.joined++;
        expect([inv.acceptedBy, inv.revokedAt]).toEqual([sam.accountId, null]);
        expect(await adultsIn(householdId)).toBe(2);
      } else {
        tally.revoked++;
        expect(codes([join])).toEqual(["INVITE_INVALID"]);
        expect(inv.acceptedAt).toBeNull();
        expect(await adultsIn(householdId)).toBe(1);
      }
    }
    expect(tally.joined + tally.revoked).toBe(6);
  });

  it("two people joining with the same link at once: only one gets in", async () => {
    for (let round = 0; round < 5; round++) {
      const { householdId, token } = await household();
      const [sam, jo] = [await person("Sam"), await person("Jo")];
      const results = await settle([run(sam, "JoinHousehold", { token }), run(jo, "JoinHousehold", { token })]);
      expect(codes(results).sort()).toEqual(["INVITE_INVALID", "ok"]);
      expect(await adultsIn(householdId)).toBe(2);
    }
  });

  it("a partner leaving while the other accepts their plan never leaves time held for someone who left", async () => {
    for (let round = 0; round < 5; round++) {
      const { alex, householdId, token } = await household();
      const sam = await person("Sam");
      await run(sam, "JoinHousehold", { token });
      const { momentId } = await run(alex, "CreateMoment", { kind: "us", title: "Dinner", span: { allDay: false, startDate: "2030-10-11", startTime: "19:00", endDate: "2030-10-11", endTime: "21:00" }, participantIds: [alex.accountId, sam.accountId] }, householdId);
      await run(alex, "ShareMoment", { momentId, version: 1 }, householdId);
      await settle([run(sam, "RespondToMoment", { momentId, materialVersion: 1, decision: "accepted" }, householdId), run(alex, "LeaveHousehold", { confirm: true }, householdId)]);
      const held = await db.select().from(reservations).where(eq(reservations.householdId, householdId));
      expect(held.filter((r) => r.accountId === alex.accountId)).toEqual([]);
    }
  });
});
