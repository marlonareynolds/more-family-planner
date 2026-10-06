import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { careArrangements, eventExceptions, events, moments, reservations } from "@/db/schema";
import type { Busy } from "@/domain/availability";
import type { Interval } from "@/domain/intervals";
import { expand, type SeriesException } from "@/domain/recurrence";
import { seriesOf } from "../commands/schedule";

export interface EventOccurrence {
  eventId: string;
  recurrenceId: string | null;
  start: number;
  end: number;
  row: typeof events.$inferSelect;
}

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
  const exRows = seriesIds.length ? await db.select().from(eventExceptions).where(inArray(eventExceptions.eventId, seriesIds)) : [];
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
      });
    }
  }

  const res = await db
    .select({ r: reservations, m: { title: moments.title, organiserId: moments.organiserId, sharing: moments.sharing, kind: moments.kind }, c: { providerName: careArrangements.providerName } })
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
    busy.push({
      personId: r.accountId,
      start: r.startAt.getTime(),
      end: r.endAt.getTime(),
      sourceType: isMoment ? "date" : "care",
      sourceId: r.sourceId,
      ownerId: isMoment ? (m?.organiserId ?? r.accountId) : r.accountId,
      // Me-time is the owner's business; its existence is shared, its title is not.
      visibility: isMoment && m?.kind === "me" ? "busy_only" : "shared",
      title: isMoment ? (m?.title ?? "Plan") : "Looking after the children",
    });
  }
  return busy;
}
