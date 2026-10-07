import { and, arrayContains, desc, eq, gte, ilike, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { journalEntries } from "@/db/schema";
import type { Actor } from "../auth";

/**
 * Account-scoped journal reads (spec 12.2 GET /me/journal). Independent of
 * household membership; only the owner can ever reach these rows.
 */

export interface JournalQuery {
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  /** Cursor: "<entryDate>|<id>" of the last row on the previous page. */
  cursor?: string;
  limit?: number;
}

export async function listJournal(db: Db, actor: Actor, query: JournalQuery) {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const conds = [eq(journalEntries.accountId, actor.accountId), isNull(journalEntries.deletedAt)];
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(journalEntries.body, like), ilike(journalEntries.title, like))!);
  }
  if (query.tag) conds.push(arrayContains(journalEntries.tags, [query.tag.toLowerCase()]));
  if (query.from) conds.push(gte(journalEntries.entryDate, query.from));
  if (query.to) conds.push(lte(journalEntries.entryDate, query.to));
  if (query.cursor) {
    const [d, id] = query.cursor.split("|");
    if (d && id) conds.push(or(lt(journalEntries.entryDate, d), and(eq(journalEntries.entryDate, d), lt(journalEntries.id, id)))!);
  }
  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(...conds))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const tags = await db
    .select({ tag: sql<string>`unnest(${journalEntries.tags})`.as("tag") })
    .from(journalEntries)
    .where(and(eq(journalEntries.accountId, actor.accountId), isNull(journalEntries.deletedAt)));
  return {
    entries: page.map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      title: e.title,
      body: e.body,
      tags: e.tags,
      version: e.version,
      updatedAt: e.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${last.entryDate}|${last.id}` : null,
    allTags: [...new Set(tags.map((t) => t.tag))].sort(),
  };
}
