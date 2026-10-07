import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { careArrangements, careAsks, children, helpers, households, memberships, accounts, outbox } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { defineCommand, assertVersion } from "../pipeline";
import { assertPeople, requiredText, resolveSpan, shortText, spanSchema } from "./helpers";
import { track } from "../analytics";

/**
 * The village (spec 3.2, later segment kept minimal): saved helpers such as
 * grandparents or a sitter, and a one-off ask by text message. Helpers have
 * no account, nothing is harvested, and the ask link shows only the time,
 * the children's first names and a reply.
 */

const ASK_TTL_MS = 14 * 86_400_000;
export const hashAskToken = (t: string) => createHash("sha256").update(t).digest("hex");

const helperFields = z.object({
  name: requiredText(60, "A name"),
  relation: shortText(60).default(""),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + only.")
    .default(""),
});

export const addHelper = defineCommand({
  name: "AddHelper",
  scope: "household",
  payload: helperFields,
  async handler(ctx, p) {
    const count = await ctx.tx.$count(helpers, and(eq(helpers.householdId, ctx.household.id), isNull(helpers.archivedAt)));
    if (count >= 20) throw new DomainError("VALIDATION", "Up to twenty helpers can be saved.");
    const [h] = await ctx.tx.insert(helpers).values({ householdId: ctx.household.id, ...p }).returning();
    await ctx.audit("helper.add", "helper", h.id);
    return { helperId: h.id };
  },
});

export const updateHelper = defineCommand({
  name: "UpdateHelper",
  scope: "household",
  payload: helperFields.extend({ helperId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [h] = await ctx.tx.select().from(helpers).where(and(eq(helpers.id, p.helperId), eq(helpers.householdId, ctx.household.id)));
    assertVersion(h, p.version, "This helper");
    await ctx.tx
      .update(helpers)
      .set({ name: p.name, relation: p.relation, phone: p.phone, version: sql`${helpers.version} + 1` })
      .where(eq(helpers.id, h.id));
    return { helperId: h.id };
  },
});

export const archiveHelper = defineCommand({
  name: "ArchiveHelper",
  scope: "household",
  payload: z.object({ helperId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const [h] = await ctx.tx.select().from(helpers).where(and(eq(helpers.id, p.helperId), eq(helpers.householdId, ctx.household.id)));
    assertVersion(h, p.version, "This helper");
    // The phone number goes; their name stays on past arrangements.
    await ctx.tx.update(helpers).set({ archivedAt: ctx.now, phone: "", version: sql`${helpers.version} + 1` }).where(eq(helpers.id, h.id));
    return { helperId: h.id };
  },
});

/**
 * Ask a helper to cover a time. Records external care as proposed and
 * returns a one-off link for the adult to send from their own phone.
 */
export const askHelper = defineCommand({
  name: "AskHelper",
  scope: "household",
  payload: z.object({ helperId: z.uuid(), childIds: z.array(z.uuid()).min(1).max(8), span: spanSchema, note: shortText(300).default("") }),
  async handler(ctx, p) {
    const [h] = await ctx.tx.select().from(helpers).where(and(eq(helpers.id, p.helperId), eq(helpers.householdId, ctx.household.id), isNull(helpers.archivedAt)));
    if (!h) throw new DomainError("NOT_FOUND", "That helper could not be found.");
    await assertPeople(ctx, [], p.childIds);
    const span = resolveSpan(p.span, ctx.household.timeZone);
    if (span.end <= ctx.now.getTime()) throw new DomainError("VALIDATION", "That time has already passed.");
    const [a] = await ctx.tx
      .insert(careArrangements)
      .values({
        householdId: ctx.household.id,
        kind: "external",
        providerName: h.name,
        helperId: h.id,
        childIds: p.childIds,
        startAt: new Date(span.start),
        endAt: new Date(span.end),
        state: "proposed",
        createdBy: ctx.actor.accountId,
        note: p.note,
      })
      .returning();
    const token = randomBytes(18).toString("base64url");
    await ctx.tx.insert(careAsks).values({
      householdId: ctx.household.id,
      helperId: h.id,
      arrangementId: a.id,
      tokenHash: hashAskToken(token),
      expiresAt: new Date(Math.min(span.end, ctx.now.getTime() + ASK_TTL_MS)),
      createdBy: ctx.actor.accountId,
    });
    await ctx.bumpSchedule();
    await ctx.audit("helper.ask", "care", a.id);
    await ctx.track("helper_asked");
    return { arrangementId: a.id, token, phone: h.phone, helperName: h.name };
  },
});

export interface AskView {
  askerName: string;
  helperName: string;
  childNames: string[];
  start: number;
  end: number;
  timeZone: string;
  note: string;
  response: "yes" | "no" | null;
  open: boolean;
}

async function loadAsk(db: Db, token: string) {
  const [row] = await db
    .select({ ask: careAsks, arrangement: careArrangements, helperName: helpers.name, timeZone: households.timeZone, askerName: accounts.displayName })
    .from(careAsks)
    .innerJoin(careArrangements, eq(careArrangements.id, careAsks.arrangementId))
    .innerJoin(helpers, eq(helpers.id, careAsks.helperId))
    .innerJoin(households, eq(households.id, careAsks.householdId))
    .innerJoin(accounts, eq(accounts.id, careAsks.createdBy))
    .where(and(eq(careAsks.tokenHash, hashAskToken(token)), isNull(households.deletedAt)));
  return row ?? null;
}

/** What the helper sees: nothing beyond the time, first names and a reply. */
export async function askView(db: Db, token: string, now = new Date()): Promise<AskView | null> {
  const row = await loadAsk(db, token);
  if (!row) return null;
  const kids = await db.select({ id: children.id, name: children.preferredName }).from(children).where(eq(children.householdId, row.ask.householdId));
  return {
    askerName: row.askerName.split(" ")[0],
    helperName: row.helperName,
    childNames: row.arrangement.childIds.map((id) => kids.find((k) => k.id === id)?.name ?? "").filter(Boolean),
    start: row.arrangement.startAt.getTime(),
    end: row.arrangement.endAt.getTime(),
    timeZone: row.timeZone,
    note: row.arrangement.note,
    response: row.ask.response,
    open: !row.ask.response && row.ask.expiresAt.getTime() > now.getTime() && row.arrangement.state === "proposed",
  };
}

export async function answerAsk(db: Db, token: string, response: "yes" | "no", now = new Date()): Promise<AskView | null> {
  await db.transaction(async (tx) => {
    const [ask] = await tx.select().from(careAsks).where(eq(careAsks.tokenHash, hashAskToken(token))).for("update");
    if (!ask) return false;
    const [h] = await tx.select().from(households).where(and(eq(households.id, ask.householdId), isNull(households.deletedAt))).for("update");
    const [a] = await tx.select().from(careArrangements).where(eq(careArrangements.id, ask.arrangementId));
    if (!h || !a || ask.response || ask.expiresAt.getTime() <= now.getTime() || a.state !== "proposed") return false;
    await tx.update(careAsks).set({ response, respondedAt: now }).where(eq(careAsks.id, ask.id));
    await tx
      .update(careArrangements)
      .set(response === "yes" ? { state: "confirmed", confirmedAt: now, version: sql`${careArrangements.version} + 1` } : { state: "declined", version: sql`${careArrangements.version} + 1` })
      .where(eq(careArrangements.id, a.id));
    await tx.update(households).set({ scheduleRevision: sql`${households.scheduleRevision} + 1` }).where(eq(households.id, h.id));
    const [helper] = await tx.select({ name: helpers.name }).from(helpers).where(eq(helpers.id, ask.helperId));
    const adults = await tx.select({ id: memberships.accountId }).from(memberships).where(and(eq(memberships.householdId, h.id), isNull(memberships.endsAt)));
    for (const adult of adults) {
      await tx
        .insert(outbox)
        .values({
          householdId: h.id,
          eventType: "notify",
          dedupeKey: `notify:care.helper:${ask.id}:${adult.id}`,
          payload: {
            recipientId: adult.id,
            kind: `care.helper_${response}`,
            text: response === "yes" ? `${helper.name} said yes to looking after the children.` : `${helper.name} can't help this time.`,
            sourceType: "ask",
            sourceId: a.id,
            sourceVersion: 1,
            householdId: h.id,
          },
        })
        .onConflictDoNothing({ target: outbox.dedupeKey });
    }
    if (response === "yes") await track(tx, { type: "care_gap_resolved", accountId: ask.createdBy, householdId: h.id, reason: "helper" });
    return true;
  });
  return askView(db, token, now);
}
