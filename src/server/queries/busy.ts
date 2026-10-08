import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { careArrangements, eventExceptions, events, moments, reservations, trips } from "@/db/schema";
import type { Busy } from "@/domain/availability";
import type { Interval } from "@/domain/intervals";
import { expand, type SeriesException } from "@/domain/recurrence";
import { withheldFromOthers } from "@/domain/moments";
import { seriesOf } from "../commands/schedule";

export interface EventOccurrence {
  eventId: string;
  recurrenceId: string | null;
  start: number;
  end: number;
  row: typeof events.$inferSelect;
}

/** How many exception rows the last load read, for the BR-18 bound. */
export const loaderStats = { lastExceptionsRead: 0 };

/**
 * Event occurrences overlapping a horizon. Reads are bounded by the
 * horizon, not by lifetime history (INV-13).
 */
export async function loadEventOccurrences(db: DbOrTx, householdId: string, horizon: Interval): Promise<EventOccurrence[]> {
  const from = new Date(horizon.start - 86_400_000);
  const to = new Date(horizon.end + 86_400_000);
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.householdId, householdId),
        isNull(events.cancelledAt),
        lt(events.startAt, to),
        or(
          and(isNull(events.rule), gt(events.endAt, from)),
          and(isNotNull(events.rule), or(isNull(events.seriesEndAt), gt(events.seriesEndAt, from))),
        ),
      ),
    );
  const seriesIds = rows.filter((r) => r.rule).map((r) => r.id);
  // Only the exceptions that can matter here (BR-18): those whose original
  // slot is near the horizon (local ids, with room for 14-day events and any
  // time zone), and those moved into it. A long series' history stays unread.
  const idFrom = new Date(horizon.start - 16 * 86_400_000).toISOString().slice(0, 16);
  const idTo = new Date(horizon.end + 2 * 86_400_000).toISOString().slice(0, 16);
  const exRows = seriesIds.length
    ? await db
        .select()
        .from(eventExceptions)
        .where(
          and(
            inArray(eventExceptions.eventId, seriesIds),
            or(
              and(gte(eventExceptions.recurrenceId, idFrom), lt(eventExceptions.recurrenceId, idTo)),
              and(eq(eventExceptions.kind, "moved"), lt(eventExceptions.startAt, to), gt(eventExceptions.endAt, from)),
            ),
          ),
        )
    : [];
  loaderStats.lastExceptionsRead = exRows.length;
  const exBy = new Map<string, SeriesException[]>();
  for (const e of exRows) {
    const list = exBy.get(e.eventId) ?? [];
    list.push(
      e.kind === "cancelled"
        ? { recurrenceId: e.recurrenceId, kind: "cancelled" }
        : { recurrenceId: e.recurrenceId, kind: "moved", start: e.startAt!.getTime(), end: e.endAt!.getTime() },
    );
    exBy.set(e.eventId, list);
  }

  const out: EventOccurrence[] = [];
  for (const row of rows) {
    if (!row.rule) {
      if (row.endAt.getTime() > horizon.start && row.startAt.getTime() < horizon.end) {
        out.push({ eventId: row.id, recurrenceId: null, start: row.startAt.getTime(), end: row.endAt.getTime(), row });
      }
      continue;
    }
    for (const o of expand(seriesOf(row), horizon, exBy.get(row.id) ?? [])) {
      out.push({ eventId: row.id, recurrenceId: o.recurrenceId, start: o.start, end: o.end, row });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Everything that occupies an adult within the horizon. */
export async function loadBusy(db: DbOrTx, householdId: string, horizon: Interval): Promise<Busy[]> {
  const busy: Busy[] = [];
  for (const o of await loadEventOccurrences(db, householdId, horizon)) {
    for (const personId of o.row.adultIds) {
      busy.push({
        personId,
        start: o.start,
        end: o.end,
        travelBeforeMinutes: o.row.travelBeforeMinutes,
        travelAfterMinutes: o.row.travelAfterMinutes,
        sourceType: "event",
        sourceId: o.eventId,
        occurrenceId: o.recurrenceId ?? undefined,
        ownerId: o.row.ownerId,
        visibility: o.row.visibility,
        title: o.row.title,
        childIds: o.row.childIds,
      });
    }
  }

  const res = await db
    .select({ r: reservations, m: { title: moments.title, organiserId: moments.organiserId, sharing: moments.sharing, kind: moments.kind, surprise: moments.surprise, lifecycle: moments.lifecycle }, c: { providerName: careArrangements.providerName } })
    .from(reservations)
    .leftJoin(moments, and(eq(reservations.sourceType, "moment"), eq(moments.id, reservations.sourceId)))
    .leftJoin(careArrangements, and(eq(reservations.sourceType, "care"), eq(careArrangements.id, reservations.sourceId)))
    .where(
      and(
        eq(reservations.householdId, householdId),
        lt(reservations.startAt, new Date(horizon.end + 86_400_000)),
        gt(reservations.endAt, new Date(horizon.start - 86_400_000)),
      ),
    );
  for (const { r, m } of res) {
    const isMoment = r.sourceType === "moment";
    if (r.sourceType === "drop_off" || r.sourceType === "collect") {
      // A named handover: the journey to take or collect the children.
      busy.push({
        personId: r.accountId,
        start: r.startAt.getTime(),
        end: r.endAt.getTime(),
        sourceType: "handover",
        sourceId: r.sourceId,
        ownerId: r.accountId,
        visibility: "shared",
        title: r.sourceType === "drop_off" ? "Drop-off" : "Collection",
      });
      continue;
    }
    busy.push({
      personId: r.accountId,
      start: r.startAt.getTime(),
      end: r.endAt.getTime(),
      sourceType: isMoment ? "date" : "care",
      sourceId: r.sourceId,
      ownerId: isMoment ? (m?.organiserId ?? r.accountId) : r.accountId,
      // Me-time and an unfinished surprise are the organiser's business: the
      // time is shared, so it clashes as busy, but the title is not.
      visibility: isMoment && m && withheldFromOthers(m) ? "busy_only" : "shared",
      title: isMoment ? (m?.title ?? "Plan") : "Looking after the children",
    });
  }
  // Time away: each traveller is away for the whole trip.
  for (const t of await loadTrips(db, householdId, horizon)) {
    for (const personId of t.travellerIds) {
      busy.push({
        personId,
        start: t.startAt.getTime(),
        end: t.endAt.getTime(),
        sourceType: "trip",
        sourceId: t.id,
        ownerId: t.organiserId,
        visibility: "shared",
        title: `Away: ${t.title}`,
      });
    }
  }
  return busy;
}

/** Trips overlapping a horizon (with a day's margin either side). */
export async function loadTrips(db: DbOrTx, householdId: string, horizon: Interval) {
  return db
    .select()
    .from(trips)
    .where(and(eq(trips.householdId, householdId), isNull(trips.cancelledAt), lt(trips.startAt, new Date(horizon.end + 86_400_000)), gt(trips.endAt, new Date(horizon.start - 86_400_000))))
    .orderBy(trips.startAt);
}
