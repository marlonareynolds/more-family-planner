import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "@/db/client";
import { auditEvents, households, idempotencyKeys, memberships, outbox } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { Actor } from "./auth";

/**
 * The command pipeline (spec 10.3, 12.2). Every state change goes through
 * `executeCommand`:
 *   validate → idempotency check → lock household and check membership at
 *   commit → expected revisions → domain handler → audit + outbox → commit.
 * The actor always comes from the verified session, never from the payload.
 */

export const envelopeSchema = z.object({
  command: z.string().min(1).max(64),
  householdId: z.uuid().optional(),
  resourceId: z.uuid().optional(),
  expected: z
    .object({
      resourceVersion: z.number().int().positive().optional(),
      membershipRevision: z.number().int().positive().optional(),
      scheduleRevision: z.number().int().positive().optional(),
    })
    .optional(),
  idempotencyKey: z.string().min(8).max(128),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export type HouseholdRow = typeof households.$inferSelect;

export interface CommandContext {
  tx: Tx;
  actor: Actor;
  /** Present for household-scoped commands, locked FOR UPDATE. */
  household: HouseholdRow;
  envelope: Envelope;
  now: Date;
  /** Record that the household schedule changed; returns the new revision. */
  bumpSchedule(): Promise<number>;
  /** Record that membership changed; returns the new revision. */
  bumpMembership(): Promise<number>;
  emit(eventType: string, dedupeKey: string, payload: Record<string, unknown>, availableAt?: Date): Promise<void>;
  audit(action: string, resourceType: string | null, resourceId: string | null): Promise<void>;
}

export type AccountContext = Omit<CommandContext, "household" | "bumpSchedule" | "bumpMembership">;

interface BaseDef<P> {
  name: string;
  payload: z.ZodType<P>;
}

export interface HouseholdCommand<P, R> extends BaseDef<P> {
  scope: "household";
  handler(ctx: CommandContext, payload: P): Promise<R>;
}

export interface AccountCommand<P, R> extends BaseDef<P> {
  scope: "account";
  handler(ctx: AccountContext, payload: P): Promise<R>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = HouseholdCommand<any, any> | AccountCommand<any, any>;

const registry = new Map<string, AnyCommand>();

export function defineCommand<P, R>(def: HouseholdCommand<P, R> | AccountCommand<P, R>): typeof def {
  if (registry.has(def.name)) throw new Error(`Duplicate command ${def.name}`);
  registry.set(def.name, def as AnyCommand);
  return def;
}

export function commandNames(): string[] {
  return [...registry.keys()].sort();
}

export interface CommandResult<R = unknown> {
  ok: true;
  command: string;
  result: R;
  revisions?: { membershipRevision: number; scheduleRevision: number };
  replayed?: boolean;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function requestHash(e: Envelope): string {
  const { idempotencyKey: _ignored, ...rest } = e;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}

/** Postgres errors that mean "the world changed under you". */
function translateDbError(err: unknown): unknown {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23P01") return new DomainError("CONFLICT", "That time is no longer free for everyone. Refresh to see the latest week.");
  if (code === "23505") return new DomainError("CONFLICT", "That change has already been made.");
  if (code === "40001" || code === "40P01") return new DomainError("CONFLICT", "Someone else changed this at the same time. Please try again.");
  return err;
}

export async function executeCommand(actor: Actor, raw: unknown): Promise<CommandResult> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "The request was not understood.", { issues: parsed.error.issues.map((i) => i.path.join(".")) });
  const envelope = parsed.data;
  const def = registry.get(envelope.command);
  if (!def) throw new DomainError("VALIDATION", "Unknown command.");
  const payloadResult = def.payload.safeParse(envelope.payload ?? {});
  if (!payloadResult.success) {
    const first = payloadResult.error.issues[0];
    throw new DomainError("VALIDATION", first?.message ?? "Some details are missing.", {
      field: first?.path.join("."),
    });
  }
  const payload = payloadResult.data;
  const hash = requestHash(envelope);
  const db = await getDb();

  try {
    return await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.actorId, actor.accountId), eq(idempotencyKeys.key, envelope.idempotencyKey)));
      if (prior) {
        if (prior.requestHash !== hash || prior.command !== envelope.command) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different change.");
        }
        return { ...(prior.response as CommandResult), replayed: true };
      }

      const now = new Date();
      const emit: CommandContext["emit"] = async (eventType, dedupeKey, data, availableAt) => {
        await tx
          .insert(outbox)
          .values({ householdId: envelope.householdId ?? null, eventType, dedupeKey, payload: data, availableAt: availableAt ?? now })
          .onConflictDoNothing({ target: outbox.dedupeKey });
      };
      const audit: CommandContext["audit"] = async (action, resourceType, resourceId) => {
        await tx.insert(auditEvents).values({
          householdId: envelope.householdId ?? null,
          actorId: actor.accountId,
          action,
          resourceType,
          resourceId,
          result: "ok",
        });
      };

      let result: unknown;
      let revisions: CommandResult["revisions"];

      if (def.scope === "household") {
        if (!envelope.householdId) throw new DomainError("VALIDATION", "Choose a household.");
        // Lock the household row: membership is checked at commit time and
        // concurrent changes to one household are serialised (INV-02).
        const [household] = await tx
          .select()
          .from(households)
          .where(and(eq(households.id, envelope.householdId), isNull(households.deletedAt)))
          .for("update");
        if (!household) throw new DomainError("NOT_FOUND", "That household could not be found.");
        const [membership] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.householdId, household.id), eq(memberships.accountId, actor.accountId), isNull(memberships.endsAt)));
        if (!membership) throw new DomainError("NOT_FOUND", "That household could not be found.");

        const exp = envelope.expected;
        if (exp?.membershipRevision !== undefined && exp.membershipRevision !== household.membershipRevision) {
          throw new DomainError("MEMBERSHIP_CHANGED", "Your household changed. Refresh to see who is in it now.", {
            membershipRevision: household.membershipRevision,
          });
        }
        if (exp?.scheduleRevision !== undefined && exp.scheduleRevision !== household.scheduleRevision) {
          throw new DomainError("STALE_VERSION", "The week changed since you opened it. Refresh and try again.", {
            scheduleRevision: household.scheduleRevision,
          });
        }

        const current = { ...household };
        const ctx: CommandContext = {
          tx,
          actor,
          household: current,
          envelope,
          now,
          emit,
          audit,
          async bumpSchedule() {
            const [row] = await tx
              .update(households)
              .set({ scheduleRevision: sql`${households.scheduleRevision} + 1` })
              .where(eq(households.id, current.id))
              .returning({ r: households.scheduleRevision });
            current.scheduleRevision = row.r;
            return row.r;
          },
          async bumpMembership() {
            const [row] = await tx
              .update(households)
              .set({ membershipRevision: sql`${households.membershipRevision} + 1` })
              .where(eq(households.id, current.id))
              .returning({ r: households.membershipRevision });
            current.membershipRevision = row.r;
            return row.r;
          },
        };
        result = await def.handler(ctx, payload);
        revisions = { membershipRevision: current.membershipRevision, scheduleRevision: current.scheduleRevision };
      } else {
        result = await def.handler({ tx, actor, envelope, now, emit, audit }, payload);
      }

      const response: CommandResult = { ok: true, command: def.name, result, revisions };
      await tx.insert(idempotencyKeys).values({
        actorId: actor.accountId,
        key: envelope.idempotencyKey,
        command: envelope.command,
        requestHash: hash,
        response,
      });
      return response;
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

/** Compare-and-set on a versioned row (INV-08): zero rows updated is an error. */
export function assertVersion(row: { version: number } | undefined, expected: number | undefined, what = "This item"): void {
  if (!row) throw new DomainError("NOT_FOUND", `${what} could not be found.`);
  if (expected === undefined) throw new DomainError("VALIDATION", "A version is required for this change.");
  if (row.version !== expected) {
    throw new DomainError("STALE_VERSION", `${what} changed since you opened it. Refresh to see the latest.`, {
      currentVersion: row.version,
    });
  }
}
