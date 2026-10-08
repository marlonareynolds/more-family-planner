import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dinners, jobDone, jobs, meals, shoppingItems } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { instantToLocalDate } from "@/domain/time";
import { cleanIngredients, dinnerJobTitle, itemKey, rolesFor, type DinnerChoice, type DinnerRole } from "@/domain/meals";
import { defineCommand, assertVersion, type CommandContext } from "../pipeline";
import { dateString, queueNotification, requiredText, shortText, supersedeDeliveries } from "./helpers";
import { assertRoomForJob, partnerOf } from "./jobs";

/**
 * Dinners and the shopping list. Choosing a dinner reserves nobody's
 * evening and implies nobody is looking after the children: who cooks and
 * who clears up are ordinary jobs, linked to the dinner, taken on or asked
 * for and answered like any other job.
 */

const ingredientList = z.array(shortText(60)).max(30).default([]);

async function loadMeal(ctx: CommandContext, id: string) {
  const [m] = await ctx.tx.select().from(meals).where(and(eq(meals.id, id), eq(meals.householdId, ctx.household.id), isNull(meals.archivedAt)));
  if (!m) throw new DomainError("NOT_FOUND", "That meal could not be found.");
  return m;
}

async function loadDinner(ctx: CommandContext, id: string) {
  const [d] = await ctx.tx.select().from(dinners).where(and(eq(dinners.id, id), eq(dinners.householdId, ctx.household.id)));
  if (!d) throw new DomainError("NOT_FOUND", "That dinner could not be found.");
  return d;
}

/** The dinner's live jobs, one per role at most (the database holds to that too). */
async function linkedJobs(ctx: CommandContext, dinnerId: string) {
  return ctx.tx.select().from(jobs).where(and(eq(jobs.forType, "dinner"), eq(jobs.forId, dinnerId), eq(jobs.householdId, ctx.household.id), isNull(jobs.archivedAt)));
}

/** Tell the other person on a dinner job what changed, never the person who changed it. */
async function tell(ctx: CommandContext, j: typeof jobs.$inferSelect, kind: string, text: string, version: number) {
  for (const who of new Set([j.ownerId, j.proposedOwnerId])) {
    if (who && who !== ctx.actor.accountId) await queueNotification(ctx, { recipientId: who, kind, text, sourceType: "job", sourceId: j.id, sourceVersion: version });
  }
}

/**
 * Bring a dinner's shopping rows in line with what it now needs. Only this
 * dinner's own unticked rows are added or dropped: another dinner's, and
 * anything typed in by hand, stay as they were. Ticked rows are kept so the
 * same thing isn't added again.
 */
async function syncShopping(ctx: CommandContext, dinnerId: string, ingredients: readonly string[]) {
  const wanted = cleanIngredients(ingredients);
  const keys = wanted.map(itemKey);
  await ctx.tx
    .delete(shoppingItems)
    .where(and(eq(shoppingItems.dinnerId, dinnerId), isNull(shoppingItems.gotAt), keys.length ? notInArray(shoppingItems.itemKey, keys) : sql`true`));
  for (const name of wanted) {
    await ctx.tx.insert(shoppingItems).values({ householdId: ctx.household.id, name, itemKey: itemKey(name), dinnerId, addedBy: ctx.actor.accountId }).onConflictDoNothing();
  }
}

/** Retire a dinner's job (nobody cooks a meal eaten elsewhere), telling whoever had it. */
async function retireJob(ctx: CommandContext, j: typeof jobs.$inferSelect, why: string) {
  // Already done: it stays done in the history, and there's nobody to tell.
  const [done] = await ctx.tx.select({ jobId: jobDone.jobId }).from(jobDone).where(and(eq(jobDone.jobId, j.id), eq(jobDone.dueOn, j.startsOn)));
  await ctx.tx.update(jobs).set({ archivedAt: ctx.now, proposedOwnerId: null, proposedBy: null, version: sql`${jobs.version} + 1` }).where(eq(jobs.id, j.id));
  await supersedeDeliveries(ctx.tx, j.id);
  if (!done) await tell(ctx, j, "job.retired", `${ctx.actor.displayName} changed dinner: ${why}, so “${j.title}” is off your list.`, j.version + 1);
}

export const saveMeal = defineCommand({
  name: "SaveMeal",
  scope: "household",
  payload: z.object({
    mealId: z.uuid().nullable().default(null),
    version: z.number().int().nullable().default(null),
    name: requiredText(60, "A name"),
    ingredients: ingredientList,
    quick: z.boolean().default(false),
  }),
  async handler(ctx, p) {
    const ingredients = cleanIngredients(p.ingredients);
    if (!p.mealId) {
      const count = await ctx.tx.$count(meals, and(eq(meals.householdId, ctx.household.id), isNull(meals.archivedAt)));
      if (count >= 100) throw new DomainError("VALIDATION", "Up to a hundred meals can be saved. Remove a few you no longer make.");
      const [m] = await ctx.tx.insert(meals).values({ householdId: ctx.household.id, name: p.name, ingredients, quick: p.quick, createdBy: ctx.actor.accountId }).returning();
      await ctx.audit("meal.add", "meal", m.id);
      return { mealId: m.id };
    }
    const m = await loadMeal(ctx, p.mealId);
    assertVersion(m, p.version ?? -1, "This meal");
    await ctx.tx.update(meals).set({ name: p.name, ingredients, quick: p.quick, version: sql`${meals.version} + 1` }).where(eq(meals.id, m.id));
    // Dinners still to come with this meal take the new list; past ones are history.
    const today = instantToLocalDate(ctx.now.getTime(), ctx.household.timeZone);
    const upcoming = await ctx.tx.select().from(dinners).where(and(eq(dinners.mealId, m.id), eq(dinners.householdId, ctx.household.id), sql`${dinners.date} >= ${today}`));
    for (const d of upcoming) if (d.choice === "meal" || d.choice === "fallback") await syncShopping(ctx, d.id, ingredients);
    if (p.name !== m.name) {
      for (const d of upcoming) {
        for (const j of await linkedJobs(ctx, d.id)) {
          if (j.role === "cook") await ctx.tx.update(jobs).set({ title: dinnerJobTitle("cook", d.choice, p.name) }).where(eq(jobs.id, j.id));
        }
      }
    }
    return { mealId: m.id };
  },
});

export const archiveMeal = defineCommand({
  name: "ArchiveMeal",
  scope: "household",
  payload: z.object({ mealId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const m = await loadMeal(ctx, p.mealId);
    assertVersion(m, p.version, "This meal");
    // Dinners already chosen keep it; it just stops being offered.
    await ctx.tx.update(meals).set({ archivedAt: ctx.now, version: sql`${meals.version} + 1` }).where(eq(meals.id, m.id));
    return { mealId: m.id };
  },
});

/**
 * Choose or change dinner for one date. Saving the same choice again
 * changes nothing; changing it keeps the cook and clear-up jobs that still
 * make sense (with the cook told about a new meal) and retires the ones
 * that don't.
 */
export const setDinner = defineCommand({
  name: "SetDinner",
  scope: "household",
  payload: z.object({
    date: dateString,
    /** The dinner's version when changing one already chosen; null for a new day. */
    version: z.number().int().nullable().default(null),
    choice: z.enum(["meal", "fallback", "leftovers", "elsewhere", "later"]),
    mealId: z.uuid().nullable().default(null),
    note: shortText(80).default(""),
  }),
  async handler(ctx, p) {
    const needsMeal = p.choice === "meal" || p.choice === "fallback";
    if (needsMeal !== !!p.mealId) throw new DomainError("VALIDATION", needsMeal ? "Pick which meal." : "Only a meal or the fallback names a meal.");
    const meal = p.mealId ? await loadMeal(ctx, p.mealId) : null;
    if (p.choice === "fallback" && !meal!.quick) throw new DomainError("VALIDATION", "Mark a meal as quick to use it as the fallback.");
    const note = p.choice === "elsewhere" ? p.note : "";

    const [existing] = await ctx.tx.select().from(dinners).where(and(eq(dinners.householdId, ctx.household.id), eq(dinners.date, p.date)));
    if (existing) {
      assertVersion(existing, p.version ?? -1, "Dinner on this day");
      if (existing.choice === p.choice && existing.mealId === p.mealId && existing.note === note) return { dinnerId: existing.id };
    } else if (p.version !== null) {
      throw new DomainError("CONFLICT", "Dinner on this day was removed. Have another look.");
    }
    const [d] = existing
      ? await ctx.tx.update(dinners).set({ choice: p.choice, mealId: p.mealId, note, updatedAt: ctx.now, version: sql`${dinners.version} + 1` }).where(eq(dinners.id, existing.id)).returning()
      : await ctx.tx.insert(dinners).values({ householdId: ctx.household.id, date: p.date, choice: p.choice, mealId: p.mealId, note, createdBy: ctx.actor.accountId }).returning();

    await syncShopping(ctx, d.id, needsMeal ? meal!.ingredients : []);

    const roles = rolesFor(p.choice);
    for (const j of await linkedJobs(ctx, d.id)) {
      if (!roles.includes(j.role!)) {
        await retireJob(ctx, j, p.choice === "elsewhere" ? "eating elsewhere" : "decide later");
        continue;
      }
      const title = dinnerJobTitle(j.role!, p.choice, meal?.name ?? null);
      if (title !== j.title) {
        // Same evening, same part: the agreement stands, and they hear what's changed.
        await ctx.tx.update(jobs).set({ title, version: sql`${jobs.version} + 1` }).where(eq(jobs.id, j.id));
        await tell(ctx, j, "job.changed", `${ctx.actor.displayName} changed dinner: now “${title}”.`, j.version + 1);
      }
    }
    await ctx.audit(existing ? "dinner.change" : "dinner.add", "dinner", d.id);
    return { dinnerId: d.id };
  },
});

/**
 * Move dinner to another date. Its jobs move with it. Someone who agreed to
 * cook on Tuesday hasn't agreed to Thursday, so their job goes back to
 * being a request until they say yes again.
 */
export const moveDinner = defineCommand({
  name: "MoveDinner",
  scope: "household",
  payload: z.object({ dinnerId: z.uuid(), version: z.number().int(), toDate: dateString }),
  async handler(ctx, p) {
    const d = await loadDinner(ctx, p.dinnerId);
    assertVersion(d, p.version, "This dinner");
    if (d.date === p.toDate) return { dinnerId: d.id };
    const [there] = await ctx.tx.select().from(dinners).where(and(eq(dinners.householdId, ctx.household.id), eq(dinners.date, p.toDate)));
    if (there) {
      if (there.choice !== "later" || (await linkedJobs(ctx, there.id)).length) throw new DomainError("CONFLICT", "There's already a dinner on that day. Change that one first.");
      await removeDinnerRows(ctx, there.id);
    }
    await ctx.tx.update(dinners).set({ date: p.toDate, updatedAt: ctx.now, version: sql`${dinners.version} + 1` }).where(eq(dinners.id, d.id));
    for (const j of await linkedJobs(ctx, d.id)) {
      const askAgain = j.ownerId && j.ownerId !== ctx.actor.accountId ? j.ownerId : null;
      await ctx.tx
        .update(jobs)
        .set({
          startsOn: p.toDate,
          ...(askAgain ? { ownerId: null, proposedOwnerId: askAgain, proposedBy: ctx.actor.accountId } : {}),
          version: sql`${jobs.version} + 1`,
        })
        .where(eq(jobs.id, j.id));
      await supersedeDeliveries(ctx.tx, j.id);
      const asked = askAgain ?? j.proposedOwnerId;
      if (asked && asked !== ctx.actor.accountId) {
        await queueNotification(ctx, { recipientId: asked, kind: "job.proposed", text: `${ctx.actor.displayName} moved dinner. Could you still do “${j.title}” on the new day?`, sourceType: "job", sourceId: j.id, sourceVersion: j.version + 1 });
      }
    }
    await ctx.audit("dinner.move", "dinner", d.id);
    return { dinnerId: d.id };
  },
});

async function removeDinnerRows(ctx: CommandContext, dinnerId: string) {
  await ctx.tx.delete(shoppingItems).where(and(eq(shoppingItems.dinnerId, dinnerId), isNull(shoppingItems.gotAt)));
  // What was already bought stays on the list's history, no longer tied to a dinner.
  await ctx.tx.update(shoppingItems).set({ dinnerId: null, clearedAt: ctx.now }).where(eq(shoppingItems.dinnerId, dinnerId));
  await ctx.tx.delete(dinners).where(eq(dinners.id, dinnerId));
}

/** Take the dinner off the day: its jobs are retired with a word to whoever had them; done ones keep their history. */
export const removeDinner = defineCommand({
  name: "RemoveDinner",
  scope: "household",
  payload: z.object({ dinnerId: z.uuid(), version: z.number().int() }),
  async handler(ctx, p) {
    const d = await loadDinner(ctx, p.dinnerId);
    assertVersion(d, p.version, "This dinner");
    for (const j of await linkedJobs(ctx, d.id)) await retireJob(ctx, j, "it's off the plan");
    // Jobs keep their link id as history; nothing else points at the dinner.
    await removeDinnerRows(ctx, d.id);
    await ctx.audit("dinner.remove", "dinner", d.id);
    return { dinnerId: d.id };
  },
});

/**
 * Take on, or ask your partner to take on, cooking or clearing up for a
 * dinner. There is at most one live job per dinner and part: asking again
 * returns the one already there rather than making a second.
 */
export const dinnerJob = defineCommand({
  name: "DinnerJob",
  scope: "household",
  payload: z.object({ dinnerId: z.uuid(), role: z.enum(["cook", "clear"]), owner: z.enum(["me", "partner"]) }),
  async handler(ctx, p) {
    const d = await loadDinner(ctx, p.dinnerId);
    if (!rolesFor(d.choice).includes(p.role)) throw new DomainError("VALIDATION", "Nobody needs to cook or clear up for this dinner.");
    const [already] = (await linkedJobs(ctx, d.id)).filter((j) => j.role === p.role);
    if (already) return { jobId: already.id, existed: true };
    await assertRoomForJob(ctx);
    const partner = p.owner === "partner" ? await partnerOf(ctx) : null;
    if (p.owner === "partner" && !partner) throw new DomainError("VALIDATION", "Invite your partner before asking them.");
    const meal = d.mealId ? (await ctx.tx.select({ name: meals.name }).from(meals).where(eq(meals.id, d.mealId)))[0] : null;
    const role: DinnerRole = p.role;
    const [j] = await ctx.tx
      .insert(jobs)
      .values({
        householdId: ctx.household.id,
        title: dinnerJobTitle(role, d.choice as DinnerChoice, meal?.name ?? null),
        cadence: "once",
        startsOn: d.date,
        minutes: role === "cook" ? 45 : 20,
        forType: "dinner",
        forId: d.id,
        role,
        createdBy: ctx.actor.accountId,
        ownerId: partner ? null : ctx.actor.accountId,
        proposedOwnerId: partner?.id ?? null,
        proposedBy: partner ? ctx.actor.accountId : null,
      })
      .returning();
    if (partner) {
      await queueNotification(ctx, { recipientId: partner.id, kind: "job.proposed", text: `${ctx.actor.displayName} asked if you could take on “${j.title}”.`, sourceType: "job", sourceId: j.id, sourceVersion: j.version });
    }
    await ctx.audit("dinner.job", "job", j.id);
    await ctx.track("job_added", `dinner-${role}`);
    return { jobId: j.id, existed: false };
  },
});

export const addShoppingItem = defineCommand({
  name: "AddShoppingItem",
  scope: "household",
  payload: z.object({ name: requiredText(60, "What to get") }),
  async handler(ctx, p) {
    const key = itemKey(p.name);
    // Typed twice, it's still one line.
    const [there] = await ctx.tx
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(and(eq(shoppingItems.householdId, ctx.household.id), isNull(shoppingItems.dinnerId), eq(shoppingItems.itemKey, key), isNull(shoppingItems.gotAt)));
    if (there) return { itemId: there.id };
    const count = await ctx.tx.$count(shoppingItems, and(eq(shoppingItems.householdId, ctx.household.id), isNull(shoppingItems.clearedAt)));
    if (count >= 300) throw new DomainError("VALIDATION", "The list is full. Clear the ticked items first.");
    const [row] = await ctx.tx.insert(shoppingItems).values({ householdId: ctx.household.id, name: p.name.replace(/\s+/g, " "), itemKey: key, addedBy: ctx.actor.accountId }).returning();
    return { itemId: row.id };
  },
});

/** Tick (or untick) a line: every unticked row for that item, from dinners or by hand. */
export const setShoppingGot = defineCommand({
  name: "SetShoppingGot",
  scope: "household",
  payload: z.object({ itemKey: z.string().min(1).max(60), got: z.boolean() }),
  async handler(ctx, p) {
    const mine = and(eq(shoppingItems.householdId, ctx.household.id), eq(shoppingItems.itemKey, p.itemKey), isNull(shoppingItems.clearedAt));
    if (p.got) await ctx.tx.update(shoppingItems).set({ gotAt: ctx.now, gotBy: ctx.actor.accountId }).where(and(mine, isNull(shoppingItems.gotAt)));
    else await ctx.tx.update(shoppingItems).set({ gotAt: null, gotBy: null }).where(mine);
    return { itemKey: p.itemKey };
  },
});

/** Take a hand-added line off. A dinner's ingredient leaves with its dinner, or gets ticked. */
export const removeShoppingItem = defineCommand({
  name: "RemoveShoppingItem",
  scope: "household",
  payload: z.object({ itemKey: z.string().min(1).max(60) }),
  async handler(ctx, p) {
    await ctx.tx.delete(shoppingItems).where(and(eq(shoppingItems.householdId, ctx.household.id), eq(shoppingItems.itemKey, p.itemKey), isNull(shoppingItems.dinnerId), isNull(shoppingItems.gotAt)));
    return { itemKey: p.itemKey };
  },
});

/** Clear what's been ticked. Hand-added rows go; a dinner's stay hidden so it isn't added again. */
export const clearShoppingGot = defineCommand({
  name: "ClearShoppingGot",
  scope: "household",
  payload: z.object({}),
  async handler(ctx) {
    const got = and(eq(shoppingItems.householdId, ctx.household.id), sql`${shoppingItems.gotAt} is not null`, isNull(shoppingItems.clearedAt));
    await ctx.tx.delete(shoppingItems).where(and(got, isNull(shoppingItems.dinnerId)));
    await ctx.tx.update(shoppingItems).set({ clearedAt: ctx.now }).where(got);
    return {};
  },
});

