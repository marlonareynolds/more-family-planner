import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, children, highlights, memberships, moments } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { hiddenReason } from "@/domain/moments";
import { instantToLocalDate, startOfLocalDate } from "@/domain/time";
import type { Actor } from "../auth";
import { householdFor } from "./week";

/**
 * "Your October" (spec 3.4, 8.10): what the household made time for in a
 * month, told as memories rather than metrics. Viewer-filtered like every
 * other read: a partner's Me time is counted, never described.
 */

export interface LookBack {
  month: string;
  label: string;
  counts: { me: number; us: number; family: number };
  meHours: { id: string; name: string; hours: number }[];
  ritualsKept: number;
  moments: {
    id: string;
    kind: "me" | "us" | "family";
    title: string;
    date: string;
    chosenBy: string | null;
    highlights: { author: string; text: string }[];
  }[];
  oneToOne: { adultId: string; adultName: string; childId: string; childName: string; lastDate: string | null }[];
  hasEarlier: boolean;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthBounds(month: string): { first: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { first, next };
}

export async function lookBackFor(db: Db, actor: Actor, month: string, now = new Date()): Promise<LookBack> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError("VALIDATION", "Choose a month like 2026-10.");
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household.");
  const tz = household.timeZone;
  const { first, next } = monthBounds(month);
  const range = { start: startOfLocalDate(first, tz), end: Math.min(startOfLocalDate(next, tz), now.getTime()) };
  const adults = await db
    .select({ id: accounts.id, name: accounts.displayName })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(eq(memberships.householdId, household.id), isNull(memberships.endsAt)));
  const kids = await db.select({ id: children.id, name: children.preferredName }).from(children).where(and(eq(children.householdId, household.id), isNull(children.archivedAt)));

  const rows = await db
    .select()
    .from(moments)
    .where(and(eq(moments.householdId, household.id), eq(moments.lifecycle, "completed"), eq(moments.sharing, "shared"), gte(moments.startAt, new Date(range.start)), lt(moments.startAt, new Date(range.end))))
    .orderBy(moments.startAt);
  const hl = rows.length ? await db.select().from(highlights).where(inArray(highlights.momentId, rows.map((r) => r.id))).orderBy(highlights.createdAt) : [];
  const ritualCount = rows.filter((r) => r.ritualId).length;

  const meHours = adults.map((a) => ({
    id: a.id,
    name: a.name,
    hours: Math.round((rows.filter((r) => r.kind === "me" && r.participantIds.includes(a.id)).reduce((s, r) => s + (r.endAt.getTime() - r.startAt.getTime()), 0) / 3_600_000) * 2) / 2,
  }));

  // One-to-one time: one adult, one child, a family plan, ever (so far).
  const pairsRows = await db
    .select({ participantIds: moments.participantIds, childIds: moments.childIds, startAt: moments.startAt })
    .from(moments)
    .where(and(eq(moments.householdId, household.id), eq(moments.kind, "family"), inArray(moments.lifecycle, ["planned", "completed"]), lt(moments.startAt, now)));
  const oneToOne = adults.flatMap((a) =>
    kids.map((k) => {
      const last = pairsRows
        .filter((r) => r.participantIds.length === 1 && r.participantIds[0] === a.id && r.childIds.length === 1 && r.childIds[0] === k.id)
        .map((r) => r.startAt.getTime())
        .sort((x, y) => y - x)[0];
      return { adultId: a.id, adultName: a.name, childId: k.id, childName: k.name, lastDate: last ? instantToLocalDate(last, tz) : null };
    }),
  );

  const [earliest] = await db.select({ startAt: moments.startAt }).from(moments).where(and(eq(moments.householdId, household.id), eq(moments.lifecycle, "completed"))).orderBy(moments.startAt).limit(1);
  const [y, m] = month.split("-").map(Number);
  return {
    month,
    label: `${MONTHS[m - 1]} ${y}`,
    counts: { me: rows.filter((r) => r.kind === "me").length, us: rows.filter((r) => r.kind === "us").length, family: rows.filter((r) => r.kind === "family").length },
    meHours,
    ritualsKept: ritualCount,
    moments: rows.map((r) => {
      const hidden = hiddenReason(r, actor.accountId);
      const canSeeHighlights = !hidden && (r.participantIds.includes(actor.accountId) || r.kind === "family");
      const organiser = adults.find((a) => a.id === r.organiserId)?.name ?? "Your partner";
      return {
        id: r.id,
        kind: r.kind,
        title: hidden === "me_time" ? `${organiser}: time for themselves` : hidden ? `A surprise from ${organiser}` : r.title,
        date: instantToLocalDate(r.startAt.getTime(), tz),
        chosenBy: hidden ? null : (kids.find((k) => k.id === r.chosenByChildId)?.name ?? null),
        highlights: canSeeHighlights ? hl.filter((h) => h.momentId === r.id).map((h) => ({ author: adults.find((a) => a.id === h.accountId)?.name ?? "Someone", text: h.text })) : [],
      };
    }),
    oneToOne,
    hasEarlier: !!earliest && earliest.startAt.getTime() < range.start,
  };
}

