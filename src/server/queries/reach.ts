import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, pushSubscriptions } from "@/db/schema";
import type { Actor } from "../auth";
import { emailTransport } from "../reach/email";
import { pushConfigured, vapidPublicKey } from "../reach/push";

export interface ReachSettings {
  pushEnabled: boolean;
  weeklyEmail: boolean;
  quietStart: string;
  quietEnd: string;
  dateHints: boolean;
  email: string | null;
  devices: number;
  vapidPublicKey: string | null;
  pushReady: boolean;
  emailReady: boolean;
}

export async function reachFor(db: Db, actor: Actor): Promise<ReachSettings> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, actor.accountId));
  const devices = await db.$count(pushSubscriptions, eq(pushSubscriptions.accountId, actor.accountId));
  return {
    pushEnabled: a.pushEnabled,
    weeklyEmail: a.weeklyEmail,
    quietStart: a.quietStart,
    quietEnd: a.quietEnd,
    dateHints: a.dateHints,
    email: a.email,
    devices,
    vapidPublicKey: vapidPublicKey(),
    pushReady: pushConfigured(),
    emailReady: !!emailTransport(),
  };
}
