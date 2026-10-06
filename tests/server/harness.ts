import { randomUUID } from "node:crypto";
import { setDb, type Db } from "@/db/client";
import { createPgliteDb } from "@/db/pglite";
import { accountFor, type Actor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { getWeek } from "@/server/queries/week";
import { DomainError } from "@/domain/errors";

export interface World {
  db: Db;
  alex: Actor;
  sam: Actor;
  householdId: string;
  run: (actor: Actor, command: string, payload: unknown, extra?: Record<string, unknown>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper returns command-specific results
  week: (actor: Actor, weekKey: string, now?: Date) => ReturnType<typeof getWeek>;
}

export async function newWorld(opts: { partner?: boolean } = {}): Promise<World> {
  const db = await createPgliteDb();
  setDb(db);
  const alex = await accountFor(db, { subject: "test:alex", displayName: "Alex" });
  const sam = await accountFor(db, { subject: "test:sam", displayName: "Sam" });
  const run: World["run"] = async (actor, command, payload, extra = {}) => {
    const res = await executeCommand(actor, { command, householdId: world.householdId, idempotencyKey: randomUUID(), payload, ...extra });
    return res.result;
  };
  const world: World = { db, alex, sam, householdId: "", run, week: (a, w, now) => getWeek(db, a, w, now) };
  const created = await executeCommand(alex, { command: "CreateHousehold", idempotencyKey: randomUUID(), payload: { name: "The Reynolds" } });
  world.householdId = (created.result as { householdId: string }).householdId;
  if (opts.partner !== false) {
    const { token } = await run(alex, "CreateInvite", {});
    await executeCommand(sam, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token } });
  }
  return world;
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`Expected ${code} but got ${e instanceof DomainError ? e.code : String(e)}`);
  }
  throw new Error(`Expected ${code} but the command succeeded`);
}

export const timed = (date: string, start: string, end: string, endDate = date) => ({ allDay: false, startDate: date, startTime: start, endDate, endTime: end });
