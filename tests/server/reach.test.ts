import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { accounts, notifications } from "@/db/schema";
import { bundle, inQuietHours, planningWeekKey, weekAheadDue } from "@/domain/reach";
import { processOutbox } from "@/server/outbox";
import { sendWeeklyDigests } from "@/server/reach/digest";
import { setEmailTransport, type Email } from "@/server/reach/email";
import { deliverPushes, setPushSender } from "@/server/reach/push";
import { newWorld, timed } from "./harness";

const TZ = "Europe/London";
const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" });

afterEach(() => {
  setPushSender(null);
  setEmailTransport(null);
});

describe("reaching people outside the app (spec 13.2)", () => {
  it("quiet hours span midnight and the planning week turns over on Friday", () => {
    expect(inQuietHours("22:15", "21:00", "07:00")).toBe(true);
    expect(inQuietHours("06:59", "21:00", "07:00")).toBe(true);
    expect(inQuietHours("07:00", "21:00", "07:00")).toBe(false);
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(planningWeekKey(Date.parse("2026-10-08T12:00:00Z"), TZ)).toBe("2026-10-05");
    expect(planningWeekKey(Date.parse("2026-10-09T12:00:00Z"), TZ)).toBe("2026-10-12");
    expect(weekAheadDue(Date.parse("2026-10-11T15:59:00Z"), TZ)).toBeNull();
    expect(weekAheadDue(Date.parse("2026-10-11T16:00:00Z"), TZ)).toBe("2026-10-12");
    expect(bundle([{ text: "A", url: "/a" }, { text: "B", url: "/b" }])).toMatchObject({ body: "2 updates. B", url: "/today" });
  });

  it("pushes an invitation to the partner's phone, bundled, outside quiet hours only", async () => {
    const w = await newWorld();
    const sent: { endpoint: string; body: string }[] = [];
    setPushSender(async (t, m) => {
      sent.push({ endpoint: t.endpoint, body: m.body });
      return t.endpoint.endsWith("gone") ? 410 : 201;
    });
    await w.run(w.sam, "SavePushSubscription", sub("sam-phone"), { householdId: undefined });
    await w.run(w.sam, "SavePushSubscription", sub("sam-gone"), { householdId: undefined });
    const people = [w.alex.accountId, w.sam.accountId];
    for (const title of ["Dinner", "Walk"]) {
      const m = await w.run(w.alex, "CreateMoment", { kind: "us", title, span: timed(title === "Dinner" ? "2030-10-11" : "2030-10-12", "19:00", "21:00"), participantIds: people });
      await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    }
    await processOutbox(w.db, new Date());

    // Quiet hours: nothing goes.
    const created = await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId));
    expect(created).toHaveLength(2);
    const winterNight = new Date(Math.max(...created.map((c) => c.createdAt.getTime())) + 60_000);
    await w.db.update(accounts).set({ quietStart: "00:00", quietEnd: "23:59" }).where(eq(accounts.id, w.sam.accountId));
    expect((await deliverPushes(w.db, winterNight)).deferred).toBe(2);
    expect(sent).toHaveLength(0);

    await w.db.update(accounts).set({ quietStart: "21:00", quietEnd: "21:00" }).where(eq(accounts.id, w.sam.accountId));
    const stats = await deliverPushes(w.db, winterNight);
    expect(stats.sent).toBe(1);
    expect(sent.map((s) => s.body)).toEqual(["2 updates. Alex invited you to a plan.", "2 updates. Alex invited you to a plan."]);
    // The dead device was dropped; nothing is pushed twice.
    expect((await deliverPushes(w.db, winterNight)).sent).toBe(0);
    await deliverPushes(w.db, winterNight);
    expect(sent).toHaveLength(2);
  });

  it("never pushes to someone who turned it off, or old news", async () => {
    const w = await newWorld();
    let calls = 0;
    setPushSender(async () => {
      calls++;
      return 201;
    });
    await w.run(w.sam, "SavePushSubscription", sub("sam"), { householdId: undefined });
    await w.run(w.sam, "UpdateReachSettings", { pushEnabled: false, weeklyEmail: true, quietStart: "21:00", quietEnd: "21:00" }, { householdId: undefined });
    await w.run(w.sam, "SendTestNotification", {}, { householdId: undefined });
    await deliverPushes(w.db, new Date());
    expect(calls).toBe(0);
    await w.run(w.sam, "UpdateReachSettings", { pushEnabled: true, weeklyEmail: true, quietStart: "21:00", quietEnd: "21:00" }, { householdId: undefined });
    await w.run(w.sam, "SendTestNotification", {}, { householdId: undefined });
    await deliverPushes(w.db, new Date(Date.now() + 17 * 3_600_000));
    expect(calls).toBe(0);
    await w.run(w.sam, "SendTestNotification", {}, { householdId: undefined });
    await deliverPushes(w.db, new Date());
    expect(calls).toBe(1);
  });

  it("sends one Sunday week-ahead email per adult per week, built from what they can see", async () => {
    const w = await newWorld();
    await w.db.update(accounts).set({ email: "alex@example.com" }).where(eq(accounts.id, w.alex.accountId));
    await w.db.update(accounts).set({ email: "sam@example.com", weeklyEmail: false }).where(eq(accounts.id, w.sam.accountId));
    const people = [w.alex.accountId, w.sam.accountId];
    const m = await w.run(w.sam, "CreateMoment", { kind: "us", title: "Theatre", span: timed("2030-10-11", "19:00", "22:00"), participantIds: people });
    await w.run(w.sam, "ShareMoment", { momentId: m.momentId, version: m.version });
    const me = await w.run(w.sam, "CreateMoment", { kind: "me", title: "Secret climbing", span: timed("2030-10-09", "18:00", "20:00"), participantIds: [w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: me.momentId, version: me.version });

    const mail: Email[] = [];
    setEmailTransport(async (e) => {
      mail.push(e);
      return true;
    });
    const sunday = new Date("2030-10-06T17:30:00Z");
    expect(await sendWeeklyDigests(w.db, new Date("2030-10-06T12:00:00Z"))).toEqual({ sent: 0, failed: 0 });
    expect(await sendWeeklyDigests(w.db, sunday)).toEqual({ sent: 1, failed: 0 });
    expect(await sendWeeklyDigests(w.db, sunday)).toEqual({ sent: 0, failed: 0 });
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe("alex@example.com");
    expect(mail[0].text).toContain("Waiting for your answer");
    expect(mail[0].text).toContain("Theatre");
    expect(mail[0].text).toContain("Sam: time for themselves");
    expect(mail[0].text).not.toContain("climbing");
    expect(mail[0].text).toContain("/plan");
  });
});
