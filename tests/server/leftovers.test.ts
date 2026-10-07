import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications } from "@/db/schema";
import { nextUp } from "@/domain/next-up";
import { queueLeaveReminders } from "@/server/leave-by";
import { processOutbox } from "@/server/outbox";
import { deliverPushes, setPushSender } from "@/server/reach/push";
import { accounts } from "@/db/schema";
import { newWorld, timed } from "./harness";

const WEEK = "2030-10-07"; // Monday; London is on BST (UTC+1)

async function withFootball() {
  const w = await newWorld();
  const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
  const fields = { title: "Mia's football", span: timed("2030-10-11", "17:30", "18:30"), adultIds: [w.alex.accountId], childIds: [childId], travelBeforeMinutes: 20, rule: { freq: "WEEKLY", byDay: ["FR"] } };
  const { eventId } = await w.run(w.alex, "AddEvent", fields);
  return { w, childId: childId as string, eventId: eventId as string, fields };
}

const told = async (w: Awaited<ReturnType<typeof withFootball>>["w"], accountId: string) =>
  (await w.db.select().from(notifications).where(eq(notifications.accountId, accountId))).map((n) => n.text);

describe("leave-by reminders", () => {
  it("tells the adult on a pickup when to set off, once, about twenty minutes before", async () => {
    const { w } = await withFootball();
    expect(await queueLeaveReminders(w.db, new Date("2030-10-11T14:00:00Z"))).toEqual({ queued: 1 });
    expect(await queueLeaveReminders(w.db, new Date("2030-10-11T14:15:00Z"))).toEqual({ queued: 0 });

    await processOutbox(w.db, new Date("2030-10-11T15:00:00Z"));
    expect(await told(w, w.alex.accountId)).toEqual([]);
    await processOutbox(w.db, new Date("2030-10-11T15:51:00Z"));
    expect(await told(w, w.alex.accountId)).toEqual(["Leave by 17:10 for Mia's football."]);
    // Sam isn't down for it.
    expect(await told(w, w.sam.accountId)).toEqual([]);
  });

  it("drops a reminder when the pickup changes, and queues the new one", async () => {
    const { w, eventId, fields } = await withFootball();
    await queueLeaveReminders(w.db, new Date("2030-10-11T14:00:00Z"));
    await w.run(w.alex, "UpdateEvent", { eventId, version: 1, fields: { ...fields, travelBeforeMinutes: 40 } });
    await processOutbox(w.db, new Date("2030-10-11T15:51:00Z"));
    expect(await told(w, w.alex.accountId)).toEqual([]);
    expect(await queueLeaveReminders(w.db, new Date("2030-10-11T15:00:00Z"))).toEqual({ queued: 1 });
    await processOutbox(w.db, new Date("2030-10-11T15:31:00Z"));
    expect(await told(w, w.alex.accountId)).toEqual(["Leave by 16:50 for Mia's football."]);
  });

  it("BR-15: a late run never sends a leave-by notice after the time to leave", async () => {
    const { w } = await withFootball();
    const pushed: string[] = [];
    setPushSender(async (_t, m) => (pushed.push(m.body), 201));
    await w.run(w.alex, "SavePushSubscription", { endpoint: "https://push.example.com/a", p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" }, { householdId: undefined });
    await w.db.update(accounts).set({ quietStart: "21:00", quietEnd: "21:00" });
    await queueLeaveReminders(w.db, new Date("2030-10-11T14:00:00Z"));
    await processOutbox(w.db, new Date("2030-10-11T15:51:00Z"));
    // The scheduler stalls until after 17:10 local (16:10Z): the notice expires unsent.
    expect((await deliverPushes(w.db, new Date("2030-10-11T16:11:00Z"))).expired).toBe(1);
    expect(pushed).toEqual([]);
    setPushSender(null);
  });

  it("stays quiet during quiet hours and for plans without travel time", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    await w.run(w.alex, "AddEvent", { title: "Breakfast club", span: timed("2030-10-11", "07:30", "08:30"), adultIds: [w.alex.accountId], childIds: [childId], travelBeforeMinutes: 20 });
    await w.run(w.alex, "AddEvent", { title: "Swimming", span: timed("2030-10-11", "10:00", "11:00"), adultIds: [w.alex.accountId], childIds: [childId] });
    expect(await queueLeaveReminders(w.db, new Date("2030-10-11T04:00:00Z"))).toEqual({ queued: 0 });
  });

  it("puts a pickup you're down for in Up next, with when to leave", async () => {
    const { w, childId } = await withFootball();
    const now = Date.parse("2030-10-11T12:00:00Z");
    const week = await w.week(w.alex, WEEK, new Date(now));
    const next = nextUp({ me: w.alex.accountId, now, moments: [], events: week.events });
    expect(next).toMatchObject({ kind: "duty", title: "Mia's football", leaveBy: Date.parse("2030-10-11T16:10:00Z"), childIds: [childId] });
    expect(nextUp({ me: w.sam.accountId, now, moments: [], events: (await w.week(w.sam, WEEK, new Date(now))).events })).toBeNull();
    // An agreed plan that comes sooner wins.
    const soon = { id: "m1", title: "Lunch", start: now + 3_600_000, end: now + 7_200_000, travelBeforeMinutes: 0 };
    expect(nextUp({ me: w.alex.accountId, now, moments: [soon], events: week.events })).toMatchObject({ kind: "moment", title: "Lunch", leaveBy: null });
  });
});
