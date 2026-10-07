import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, calendarExports } from "@/db/schema";
import { buildCalendar, type OutEvent } from "@/domain/ics-out";
import { addDays, instantToLocalDate } from "@/domain/time";
import type { Actor } from "../auth";
import { hashCalendarToken } from "../commands/calendar-out";
import { appUrl } from "../reach/email";
import { getProjection, householdFor, type ArrangementView } from "./week";

/**
 * The "plans in your own calendar" feed. It is built from the same
 * viewer-specific projection as the app, so everything hidden in More stays
 * hidden here: a partner's Me time is only "time for themselves" and a
 * surprise keeps its secret. Imported calendars are never echoed back.
 */

const BACK_DAYS = 14;
const AHEAD_DAYS = 90;

export async function calendarLinkFor(db: Db, actor: Actor) {
  const [row] = await db.select().from(calendarExports).where(eq(calendarExports.accountId, actor.accountId));
  return row ? { createdAt: row.createdAt.toISOString(), lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null } : null;
}

export async function calendarFeed(db: Db, token: string, now = new Date()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [link] = await db.select().from(calendarExports).where(eq(calendarExports.tokenHash, hashCalendarToken(token)));
  if (!link) return null;
  const [account] = await db.select().from(accounts).where(eq(accounts.id, link.accountId));
  if (!account || account.closedAt) return null;
  const actor: Actor = { accountId: account.id, displayName: account.displayName };
  const household = await householdFor(db, actor);
  if (!link.lastFetchedAt || now.getTime() - link.lastFetchedAt.getTime() > 3_600_000) {
    await db.update(calendarExports).set({ lastFetchedAt: now }).where(eq(calendarExports.accountId, account.id));
  }
  if (!household) return buildCalendar("More", []);

  const today = instantToLocalDate(now.getTime(), household.timeZone);
  const view = await getProjection(db, actor, addDays(today, -BACK_DAYS), BACK_DAYS + AHEAD_DAYS, now);
  const me = actor.accountId;
  const base = appUrl();
  const childName = (id: string) => view.children.find((c) => c.id === id)?.preferredName ?? "the children";
  const names = (ids: string[]) => {
    const n = ids.map(childName);
    return n.length <= 1 ? (n[0] ?? "the children") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
  };
  const events: OutEvent[] = [];

  for (const m of view.moments) {
    if (m.lifecycle !== "planned" && m.lifecycle !== "completed") continue;
    const mine = m.participantIds.includes(me) || m.organiserId === me;
    if (!mine && !(m.momentKind === "me" && m.sharing === "shared")) continue;
    const waiting = m.sharing === "shared" && !m.agreed && m.lifecycle === "planned";
    const lines = [
      ...(m.detailsHidden || !m.notes ? [] : [m.notes]),
      ...(waiting ? ["Waiting for everyone to agree in More."] : []),
      `Open in More: ${base}/week`,
    ];
    events.push({
      uid: `moment-${m.id}@more`,
      start: m.start,
      end: m.end,
      summary: m.title,
      description: lines.join("\n\n"),
      location: m.detailsHidden ? undefined : m.location || undefined,
      status: waiting ? "TENTATIVE" : "CONFIRMED",
      sequence: m.materialVersion,
      stamp: now.getTime(),
    });
  }

  const seen = new Set<string>();
  const arrangements: ArrangementView[] = [...view.care.flatMap((d) => d.groups.flatMap((g) => g.arrangements)), ...view.careAwaitingMe];
  for (const a of arrangements) {
    if (seen.has(a.id) || a.state === "declined") continue;
    seen.add(a.id);
    const myTurn = a.kind === "parent" && a.responsibleAccountId === me;
    const helper = a.kind === "external" && a.state === "confirmed";
    if (!myTurn && !helper) continue;
    events.push({
      uid: `care-${a.id}@more`,
      start: a.start,
      end: a.end,
      summary: myTurn ? `Looking after ${names(a.childIds)}` : `${a.providerName ?? "A helper"} has ${names(a.childIds)}`,
      description: `${a.state === "proposed" ? "Not confirmed yet.\n\n" : ""}Open in More: ${base}/holidays`,
      status: a.state === "confirmed" ? "CONFIRMED" : "TENTATIVE",
      sequence: a.version,
      stamp: now.getTime(),
    });
  }

  events.sort((x, y) => x.start - y.start);
  return buildCalendar(`More: ${household.name}`, events);
}
