import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarFeeds, calendarPushes, events } from "@/db/schema";
import { clearPushedBusy, syncFeed } from "@/server/calendar-sync";
import type { HttpFetch } from "@/server/calendar-providers";
import { seal, signValue, unseal, verifySigned } from "@/server/secret-box";
import { newWorld } from "./harness";

const NOW = new Date("2030-10-01T09:00:00Z");
const WEEK = "2030-10-07";
const trip = { kind: "work", title: "Conference", destination: "Lisbon", startDate: "2030-10-08", startTime: "08:00", endDate: "2030-10-10", endTime: "20:00" };

/** A pretend Google Calendar: records every call, holds the events More wrote. */
function fakeGoogle(own: object[]) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const written = new Map<string, Record<string, unknown>>();
  let n = 0;
  const http: HttpFetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/events?")) return json({ items: [...own, ...[...written].map(([id, e]) => ({ id, ...e }))] });
    const id = decodeURIComponent(url.split("/events/")[1] ?? "");
    if (method === "POST") {
      const made = `more-${++n}`;
      written.set(made, body!);
      return json({ id: made });
    }
    if (method === "PATCH") {
      if (!written.has(id)) return new Response(null, { status: 404 });
      written.set(id, body!);
      return json({ id });
    }
    if (method === "DELETE") {
      written.delete(id);
      return new Response(null, { status: 204 });
    }
    return json({}, 500);
  };
  return { http, calls, written };
}

async function googleFeed() {
  const w = await newWorld();
  const tokens = { access: "at", refresh: "rt", expiresAt: NOW.getTime() + 3_600_000 };
  const [feed] = await w.db
    .insert(calendarFeeds)
    .values({ householdId: w.householdId, accountId: w.alex.accountId, label: "Google Calendar (alex@example.com)", url: "primary", visibility: "busy_only", provider: "google", credentials: seal(JSON.stringify(tokens)), writeBusy: true })
    .returning();
  return { w, feedId: feed.id };
}

describe("sealed secrets", () => {
  it("round-trips, refuses tampering and keeps purposes apart", () => {
    const sealed = seal("refresh-token-123");
    expect(sealed).not.toContain("refresh-token");
    expect(unseal(sealed)).toBe("refresh-token-123");
    const [v, iv, tag, body] = sealed.split(".");
    expect(() => unseal([v, iv, tag, `${body.slice(0, -2)}AA`].join("."))).toThrow();
    expect(() => unseal(sealed, "something-else")).toThrow();

    const signed = signValue("acct.google.123.nonce", "calendar-oauth");
    expect(verifySigned(signed, "calendar-oauth")).toBe("acct.google.123.nonce");
    expect(verifySigned(signed, "other")).toBeNull();
    expect(verifySigned(signed.replace("google", "micro"), "calendar-oauth")).toBeNull();
  });
});

describe("two-way calendar sync", () => {
  it("imports the adult's own events and writes More's plans back as private Busy blocks", async () => {
    const { w, feedId } = await googleFeed();
    const g = fakeGoogle([
      { id: "e1", summary: "Board meeting", start: { dateTime: "2030-10-14T09:00:00Z" }, end: { dateTime: "2030-10-14T11:00:00Z" } },
      { id: "e2", summary: "Lunch maybe", transparency: "transparent", start: { dateTime: "2030-10-14T12:00:00Z" }, end: { dateTime: "2030-10-14T13:00:00Z" } },
      { id: "e3", summary: "Declined", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2030-10-15T12:00:00Z" }, end: { dateTime: "2030-10-15T13:00:00Z" } },
    ]);
    await w.run(w.alex, "AddTrip", { ...trip, travellerIds: [w.alex.accountId] });

    expect(await syncFeed(w.db, feedId, undefined, NOW, g.http)).toEqual({ ok: true, imported: 1 });
    const imported = await w.db.select().from(events).where(eq(events.feedId, feedId));
    expect(imported.map((e) => e.title)).toEqual(["Board meeting"]);

    // The trip went out as one plain, private block; nothing about it leaks.
    expect(g.written.size).toBe(1);
    const [block] = [...g.written.values()];
    expect(block).toMatchObject({ summary: "Busy", visibility: "private", start: { dateTime: "2030-10-08T07:00:00.000Z" }, end: { dateTime: "2030-10-10T19:00:00.000Z" } });
    expect(JSON.stringify(block)).not.toMatch(/Conference|Lisbon/);

    // A second sync reads its own block back but doesn't import it, and doesn't rewrite it.
    const before = g.calls.length;
    expect(await syncFeed(w.db, feedId, undefined, NOW, g.http)).toEqual({ ok: true, imported: 1 });
    expect(g.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);

    // Partner sees Alex's work meeting only as Busy, as with any other calendar.
    const samWeek = await w.week(w.sam, "2030-10-14", NOW);
    expect(JSON.stringify(samWeek)).not.toContain("Board meeting");
  });

  it("moves the block when the plan moves, and removes it when the plan is cancelled", async () => {
    const { w, feedId } = await googleFeed();
    const g = fakeGoogle([]);
    const { tripId } = await w.run(w.alex, "AddTrip", { ...trip, travellerIds: [w.alex.accountId] });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    const [id] = [...g.written.keys()];

    const week = await w.week(w.alex, WEEK, NOW);
    const t = week.trips[0];
    await w.run(w.alex, "UpdateTrip", { ...trip, tripId, version: t.version, endTime: "12:00", travellerIds: [w.alex.accountId] });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    expect([...g.written.keys()]).toEqual([id]);
    expect(g.written.get(id)).toMatchObject({ end: { dateTime: "2030-10-10T11:00:00.000Z" } });

    await w.run(w.alex, "CancelTrip", { tripId, version: t.version + 1 });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    expect(g.written.size).toBe(0);
    expect(await w.db.select().from(calendarPushes)).toEqual([]);
  });

  it("writes nothing when the adult turns it off, and clears its blocks on disconnect", async () => {
    const { w, feedId } = await googleFeed();
    const g = fakeGoogle([]);
    await w.run(w.alex, "AddTrip", { ...trip, travellerIds: [w.alex.accountId] });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    expect(g.written.size).toBe(1);

    await clearPushedBusy(w.db, feedId, g.http, NOW);
    expect(g.written.size).toBe(0);
    const [feed] = await w.db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feedId));
    await w.run(w.alex, "UpdateCalendarFeed", { feedId, version: feed.version, label: feed.label, visibility: feed.visibility, writeBusy: false });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    expect(g.written.size).toBe(0);
    const view = await w.week(w.alex, WEEK, NOW);
    expect(view.calendars[0]).toMatchObject({ provider: "google", writeBusy: false });
  });

  it("asks the adult to reconnect when access has been withdrawn", async () => {
    const { w, feedId } = await googleFeed();
    const denied: HttpFetch = async () => new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });
    expect(await syncFeed(w.db, feedId, undefined, NOW, denied)).toMatchObject({ ok: false, error: "reconnect" });
    const view = await w.week(w.alex, WEEK, NOW);
    expect(view.calendars[0].lastError).toBe("reconnect");
  });

  it("refreshes an expiring token and keeps the new one sealed", async () => {
    const { w, feedId } = await googleFeed();
    await w.db.update(calendarFeeds).set({ credentials: seal(JSON.stringify({ access: "old", refresh: "rt", expiresAt: NOW.getTime() })) }).where(eq(calendarFeeds.id, feedId));
    const g = fakeGoogle([]);
    const http: HttpFetch = async (url, init) =>
      url.startsWith("https://oauth2.googleapis.com/token") ? new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 }) : g.http(url, init);
    expect((await syncFeed(w.db, feedId, undefined, NOW, http)).ok).toBe(true);
    const [feed] = await w.db.select().from(calendarFeeds).where(eq(calendarFeeds.id, feedId));
    expect(JSON.parse(unseal(feed.credentials!))).toMatchObject({ access: "new", refresh: "rt" });
  });
});

describe("Outlook", () => {
  it("reads busy time in UTC and skips free, declined, cancelled and More's own blocks", async () => {
    const { listBusy } = await import("@/server/calendar-providers");
    const seen: { url: string; prefer?: string }[] = [];
    const http: HttpFetch = async (url, init) => {
      seen.push({ url, prefer: (init?.headers as Record<string, string>)?.Prefer });
      return new Response(JSON.stringify({ value: [
        { id: "a", subject: "Standup", start: { dateTime: "2030-10-14T08:00:00.0000000" }, end: { dateTime: "2030-10-14T08:30:00.0000000" } },
        { id: "b", subject: "Focus", showAs: "free", start: { dateTime: "2030-10-14T09:00:00.0000000" }, end: { dateTime: "2030-10-14T10:00:00.0000000" } },
        { id: "c", subject: "Busy", categories: ["More"], start: { dateTime: "2030-10-14T18:00:00.0000000" }, end: { dateTime: "2030-10-14T21:00:00.0000000" } },
        { id: "d", subject: "Old", isCancelled: true, start: { dateTime: "2030-10-14T11:00:00.0000000" }, end: { dateTime: "2030-10-14T12:00:00.0000000" } },
        { id: "e", subject: "Nope", responseStatus: { response: "declined" }, start: { dateTime: "2030-10-14T13:00:00.0000000" }, end: { dateTime: "2030-10-14T14:00:00.0000000" } },
      ] }), { status: 200 });
    };
    const out = await listBusy("microsoft", "at", { start: Date.parse("2030-10-14T00:00:00Z"), end: Date.parse("2030-10-15T00:00:00Z") }, "Europe/London", http);
    expect(out.map((o) => [o.externalId, new Date(o.start).toISOString()])).toEqual([["microsoft:a", "2030-10-14T08:00:00.000Z"]]);
    expect(seen[0].prefer).toBe('outlook.timezone="UTC"');
  });
});

describe("R09 disconnect reports cleanup honestly (BR-13, BR-14)", () => {
  async function withBlocks(n = 2) {
    const { w, feedId } = await googleFeed();
    const g = fakeGoogle([]);
    for (let i = 0; i < n; i++) await w.run(w.alex, "AddTrip", { ...trip, title: `Trip ${i}`, startDate: `2030-10-1${i}`, endDate: `2030-10-1${i}`, endTime: "20:00", travellerIds: [w.alex.accountId] });
    await syncFeed(w.db, feedId, undefined, NOW, g.http);
    expect(g.written.size).toBe(n);
    return { w, feedId, g };
  }
  /** Wraps the fake so DELETE answers with `status` (0 = timeout). */
  const failingDeletes = (http: HttpFetch, status: number): HttpFetch => async (url, init) => {
    if ((init?.method ?? "GET") !== "DELETE") return http(url, init);
    if (status === 0) throw new DOMException("timed out", "TimeoutError");
    return new Response(null, { status });
  };

  it("a provider timeout leaves the blocks recorded and reported, not 'cleared'", async () => {
    const { w, feedId, g } = await withBlocks();
    const r = await clearPushedBusy(w.db, feedId, failingDeletes(g.http, 0), NOW);
    expect(r).toMatchObject({ removed: 0, reason: "provider" });
    expect(r.left).toHaveLength(2);
    expect(r.left[0].start).toBe(Date.parse("2030-10-10T07:00:00Z"));
    expect(await w.db.select().from(calendarPushes)).toHaveLength(2);
  });

  it("revoked permission reports every block as left, for manual removal", async () => {
    const { w, feedId, g } = await withBlocks();
    const r = await clearPushedBusy(w.db, feedId, failingDeletes(g.http, 401), NOW);
    expect(r).toMatchObject({ removed: 0, reason: "permission" });
    expect(r.left).toHaveLength(2);
  });

  it("a block already deleted at the provider counts as removed", async () => {
    const { w, feedId, g } = await withBlocks();
    const r = await clearPushedBusy(w.db, feedId, failingDeletes(g.http, 404), NOW);
    expect(r).toEqual({ removed: 2, left: [], reason: null });
  });

  it("a lost encryption key asks to reconnect rather than failing silently", async () => {
    const { w, feedId, g } = await withBlocks(1);
    await w.db.update(calendarFeeds).set({ credentials: "v1.bad.bad.bad" }).where(eq(calendarFeeds.id, feedId));
    expect(await syncFeed(w.db, feedId, undefined, NOW, g.http)).toMatchObject({ ok: false, error: "reconnect" });
    expect(await clearPushedBusy(w.db, feedId, g.http, NOW)).toMatchObject({ reason: "permission", left: [expect.any(Object)] });
  });

  it("BR-14: a block written while the calendar is being disconnected is taken back out", async () => {
    const { w, feedId } = await googleFeed();
    const g = fakeGoogle([]);
    await w.run(w.alex, "AddTrip", { ...trip, travellerIds: [w.alex.accountId] });
    // The disconnect lands between the provider accepting the block and More recording it.
    const racing: HttpFetch = async (url, init) => {
      const res = await g.http(url, init);
      if (init?.method === "POST") await w.db.delete(calendarFeeds).where(eq(calendarFeeds.id, feedId));
      return res;
    };
    await w.db.delete(events).where(eq(events.feedId, feedId));
    await syncFeed(w.db, feedId, undefined, NOW, racing).catch(() => null);
    expect(g.written.size).toBe(0);
  });
});
