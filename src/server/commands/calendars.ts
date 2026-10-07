import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { calendarFeeds, events } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { normaliseFeedUrl } from "../calendar-sync";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { requiredText } from "./helpers";

/**
 * Connect, adjust and disconnect read-only calendar links (spec 8.11).
 * Fetching happens after the command commits (see the sync route), so a slow
 * provider never holds the household lock.
 */

const visibility = z.enum(["shared", "busy_only", "private"]);
const MAX_FEEDS = 5;

async function ownFeed(ctx: CommandContext, feedId: string, version: number) {
  const [feed] = await ctx.tx
    .select()
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.id, feedId), eq(calendarFeeds.householdId, ctx.household.id), eq(calendarFeeds.accountId, ctx.actor.accountId)));
  assertVersion(feed, version, "This calendar");
  return feed;
}

export const addCalendarFeed = defineCommand({
  name: "AddCalendarFeed",
  scope: "household",
  payload: z.object({ label: requiredText(60, "A name"), url: z.string().max(2000), visibility: visibility.default("busy_only") }),
  async handler(ctx, p) {
    const url = normaliseFeedUrl(p.url);
    const [{ n }] = await ctx.tx.select({ n: count() }).from(calendarFeeds).where(eq(calendarFeeds.accountId, ctx.actor.accountId));
    if (n >= MAX_FEEDS) throw new DomainError("VALIDATION", `You can connect up to ${MAX_FEEDS} calendars.`);
    const [feed] = await ctx.tx
      .insert(calendarFeeds)
      .values({ householdId: ctx.household.id, accountId: ctx.actor.accountId, label: p.label, url, visibility: p.visibility })
      .returning({ id: calendarFeeds.id });
    await ctx.audit("calendar.connect", "calendar_feed", feed.id);
    await ctx.track("calendar_connected", p.visibility);
    return { feedId: feed.id };
  },
});

export const updateCalendarFeed = defineCommand({
  name: "UpdateCalendarFeed",
  scope: "household",
  payload: z.object({ feedId: z.uuid(), version: z.number().int(), label: requiredText(60, "A name"), visibility }),
  async handler(ctx, p) {
    const feed = await ownFeed(ctx, p.feedId, p.version);
    await ctx.tx.update(calendarFeeds).set({ label: p.label, visibility: p.visibility, version: feed.version + 1 }).where(eq(calendarFeeds.id, feed.id));
    // Sharing applies to everything already imported, not only future syncs.
    await ctx.tx.update(events).set({ visibility: p.visibility }).where(eq(events.feedId, feed.id));
    await ctx.bumpSchedule();
    return { feedId: feed.id };
  },
});

export async function disconnectFeed(ctx: Pick<CommandContext, "tx">, feedId: string): Promise<void> {
  await ctx.tx.delete(events).where(eq(events.feedId, feedId));
  await ctx.tx.delete(calendarFeeds).where(eq(calendarFeeds.id, feedId));
}

export const removeCalendarFeed = defineCommand({
  name: "RemoveCalendarFeed",
  scope: "household",
  payload: z.object({ feedId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const feed = await ownFeed(ctx, p.feedId, p.version);
    // Removes More's copies only; nothing changes in the provider's calendar.
    await disconnectFeed(ctx, feed.id);
    await ctx.bumpSchedule();
    await ctx.audit("calendar.disconnect", "calendar_feed", feed.id);
    return { removed: true };
  },
});
