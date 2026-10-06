import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { hiddenReason } from "@/domain/moments";
import {
  accounts,
  careArrangements,
  checkins,
  trialResponses,
  children,
  events,
  expenses,
  feedback,
  holidayPeriods,
  journalEntries,
  moments,
  paymentTransactions,
  preferences,
} from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { Actor } from "../auth";
import { householdFor } from "./week";

/**
 * Exports obey the same permission rules as every other read (spec 8.12,
 * AT-13): an account export holds only the owner's private records; a
 * household export holds shared records plus the viewer's own private
 * items, and never another adult's private or busy-only details.
 */

export async function exportAccount(db: Db, actor: Actor) {
  const [account] = await db
    .select({ displayName: accounts.displayName, timeZone: accounts.timeZone, createdAt: accounts.createdAt })
    .from(accounts)
    .where(eq(accounts.id, actor.accountId));
  return {
    kind: "account",
    exportedAt: new Date().toISOString(),
    account,
    journal: await db
      .select({ entryDate: journalEntries.entryDate, title: journalEntries.title, body: journalEntries.body, tags: journalEntries.tags })
      .from(journalEntries)
      .where(and(eq(journalEntries.accountId, actor.accountId), isNull(journalEntries.deletedAt))),
    checkins: await db.select().from(checkins).where(eq(checkins.accountId, actor.accountId)),
    trialResponses: await db.select().from(trialResponses).where(eq(trialResponses.accountId, actor.accountId)),
    reflections: await db.select().from(feedback).where(eq(feedback.accountId, actor.accountId)),
    preferences: await db.select().from(preferences).where(eq(preferences.accountId, actor.accountId)),
  };
}

export async function exportHousehold(db: Db, actor: Actor) {
  const household = await householdFor(db, actor);
  if (!household) throw new DomainError("NOT_FOUND", "You are not in a household.");
  const viewer = actor.accountId;
  const ev = await db
    .select()
    .from(events)
    .where(and(eq(events.householdId, household.id), isNull(events.cancelledAt), or(eq(events.visibility, "shared"), eq(events.ownerId, viewer))));
  const ms = await db
    .select()
    .from(moments)
    .where(and(eq(moments.householdId, household.id), or(eq(moments.sharing, "shared"), eq(moments.organiserId, viewer))));
  const ex = await db.select().from(expenses).where(eq(expenses.householdId, household.id));
  const visibleMomentIds = new Set(ms.map((m) => m.id));
  const visibleExpenses = ex.filter((e) => e.sourceType !== "moment" || !e.sourceId || visibleMomentIds.has(e.sourceId));
  return {
    kind: "household",
    exportedAt: new Date().toISOString(),
    household: { name: household.name, timeZone: household.timeZone, currency: household.currency },
    children: await db
      .select({ preferredName: children.preferredName, ageBand: children.ageBand, needs: children.needs })
      .from(children)
      .where(eq(children.householdId, household.id)),
    events: ev.map((e) => ({
      title: e.title,
      notes: e.notes,
      location: e.location,
      allDay: e.allDay,
      start: e.startAt,
      end: e.endAt,
      timeZone: e.timeZone,
      rule: e.rule,
      visibility: e.visibility,
    })),
    moments: ms.map((m) => ({
      kind: m.kind,
      title: hiddenReason(m, viewer) === "me_time" ? "Time for themselves" : hiddenReason(m, viewer) ? "Surprise" : m.title,
      start: m.startAt,
      end: m.endAt,
      lifecycle: m.lifecycle,
      budgetMinor: m.budgetMinor,
    })),
    holidays: await db.select().from(holidayPeriods).where(eq(holidayPeriods.householdId, household.id)),
    care: await db.select().from(careArrangements).where(eq(careArrangements.householdId, household.id)),
    expenses: visibleExpenses,
    payments: visibleExpenses.length
      ? await db.select().from(paymentTransactions).where(inArray(paymentTransactions.expenseId, visibleExpenses.map((e) => e.id)))
      : [],
  };
}
