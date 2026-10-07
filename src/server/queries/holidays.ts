import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { holidayPeriods } from "@/db/schema";

/** Holiday periods, newest first, paged so a long history stays cheap (AT-17). */
export async function listHolidays(db: Db, householdId: string, opts: { archived: boolean; limit?: number; offset?: number }) {
  const limit = Math.min(opts.limit ?? 24, 50);
  const rows = await db
    .select()
    .from(holidayPeriods)
    .where(and(eq(holidayPeriods.householdId, householdId), opts.archived ? isNotNull(holidayPeriods.archivedAt) : isNull(holidayPeriods.archivedAt)))
    .orderBy(desc(holidayPeriods.startDate), desc(holidayPeriods.id))
    .limit(limit + 1)
    .offset(opts.offset ?? 0);
  return {
    holidays: rows.slice(0, limit).map((h) => ({
      id: h.id,
      name: h.name,
      startDate: h.startDate,
      endDate: new Date(Date.parse(`${h.endDateExclusive}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
      dailyStart: h.dailyStart,
      dailyEnd: h.dailyEnd,
      includeWeekends: h.includeWeekends,
      childIds: h.childIds,
      archived: !!h.archivedAt,
      version: h.version,
    })),
    hasMore: rows.length > limit,
  };
}

export type HolidayRow = Awaited<ReturnType<typeof listHolidays>>["holidays"][number];
