import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { calendarFeeds, events } from "@/db/schema";
import { normaliseFeedUrl, syncFeed } from "@/server/calendar-sync";
import { expectCode, newWorld, timed } from "./harness";

const NOW = new Date("2030-10-01T12:00:00Z");
const WEEK = "2030-10-07";
const feedOf = (...events: string[]) => async () =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//T//EN", ...events.flatMap((e) => e.trim().split("\n").map((l) => l.trim())), "END:VCALENDAR"].join("\r\n");
const vevent = (uid: string, title: string, start: string, end: string, extra = "") => `
  BEGIN:VEVENT
  UID:${uid}
  SUMMARY:${title}
  DTSTART;TZID=Europe/London:${start}
  DTEND;TZID=Europe/London:${end}
  ${extra}
  END:VEVENT`.replace(/\n\s*\n/g, "\n");

async function connected() {
  const w = await newWorld();
  const { feedId } = await w.run(w.alex, "AddCalendarFeed", { label: "Work", url: "webcal://calendar.example.com/private-abc/basic.ics" });
  return { w, feedId: feedId as string };
}

describe("read-only calendar import (spec 8.11)", () => {
  it("imports busy time the partner sees only as Busy, and blocks a clashing agreement", async () => {
    const { w, feedId } = await connected();
    const r = await syncFeed(w.db, feedId, feedOf(vevent("a", "Board meeting with Acme", "20301008T140000", "20301008T160000"), vevent("b", "Gym", "20301009T070000", "20301009T080000", "RRULE:FREQ=DAILY;COUNT=3")), NOW);
    expect(r).toEqual({ ok: true, imported: 4 });

    const alexWeek = await w.week(w.alex, WEEK, NOW);
    const board = alexWeek.events.find((e) => e.title === "Board meeting with Acme")!;
    expect(board.importedFrom).toBe("Work");
    expect(alexWeek.calendars[0]).toMatchObject({ label: "Work", stale: false, eventCount: 4 });

    const samWeek = await w.week(w.sam, WEEK, NOW);
    const samJson = JSON.stringify(samWeek);
    for (const secret of ["Acme", "Board", "Gym", "Work", "private-abc"]) expect(samJson).not.toContain(secret);
    expect(samWeek.events.filter((e) => e.title === "Busy")).toHaveLength(4);

    await expectCode(w.run(w.alex, "DeleteEvent", { eventId: board.id, version: board.version }), "CONFLICT");
    const m = await w.run(w.sam, "CreateMoment", { kind: "us", title: "Lunch", span: timed("2030-10-08", "15:00", "16:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.sam, "ShareMoment", { momentId: m.momentId, version: m.version });
    await expectCode(w.run(w.alex, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" }), "CONFLICT");
  });

  it("follows the provider on re-sync: moved items update, removed ones go", async () => {
    const { w, feedId } = await connected();
    await syncFeed(w.db, feedId, feedOf(vevent("a", "Call", "20301008T140000", "20301008T150000"), vevent("b", "Dentist", "20301009T100000", "20301009T110000")), NOW);
    const [before] = await w.db.select().from(events).where(eq(events.externalId, "a"));
    await syncFeed(w.db, feedId, feedOf(vevent("a", "Call", "20301008T160000", "20301008T170000")), NOW);
    const rows = await w.db.select().from(events).where(eq(events.feedId, feedId));
    expect(rows.map((r) => [r.externalId, r.startAt.toISOString()])).toEqual([["a", "2030-10-08T15:00:00.000Z"]]);
    expect(rows[0].id).toBe(before.id);
  });

  it("keeps the last good copy when a sync fails and says it is out of date", async () => {
    const { w, feedId } = await connected();
    await syncFeed(w.db, feedId, feedOf(vevent("a", "Call", "20301008T140000", "20301008T150000")), NOW);
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    expect(await syncFeed(w.db, feedId, async () => "<html>login</html>", later)).toMatchObject({ ok: false, error: "not_calendar" });
    const week = await w.week(w.alex, WEEK, later);
    expect(week.events).toHaveLength(1);
    expect(week.calendars[0]).toMatchObject({ stale: true, lastError: "not_calendar" });
    expect(week.attention.some((a) => a.action === "calendar")).toBe(true);
    expect((await w.week(w.sam, WEEK, later)).calendars[0].lastError).toBeNull();
  });

  it("refuses internal addresses and plain http links", async () => {
    expect(() => normaliseFeedUrl("http://example.com/a.ics")).toThrow();
    expect(normaliseFeedUrl("webcal://example.com/a.ics")).toBe("https://example.com/a.ics");
    const w = await newWorld();
    const { feedId } = await w.run(w.alex, "AddCalendarFeed", { label: "Sneaky", url: "https://127.0.0.1/admin" });
    expect(await syncFeed(w.db, feedId)).toMatchObject({ ok: false, error: "blocked_address" });
  });

  it("disconnecting, or leaving the household, removes the imported copies", async () => {
    const { w, feedId } = await connected();
    await syncFeed(w.db, feedId, feedOf(vevent("a", "Call", "20301008T140000", "20301008T150000")), NOW);
    const [feed] = await w.db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feedId));
    await w.run(w.alex, "UpdateCalendarFeed", { feedId, version: feed.version, label: "Work", visibility: "shared" });
    expect((await w.week(w.sam, WEEK, NOW)).events[0].title).toBe("Call");
    await w.run(w.alex, "LeaveHousehold", { confirm: true });
    expect(await w.db.select().from(events).where(eq(events.feedId, feedId))).toHaveLength(0);
    expect(await w.db.select().from(calendarFeeds)).toHaveLength(0);
  });
});
