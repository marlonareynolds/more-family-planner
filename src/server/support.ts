import { z } from "zod";
import type { Db } from "@/db/client";
import { supportRequests } from "@/db/schema";
import { emailTransport, escapeHtml } from "./reach/email";

export const supportInput = z.object({
  topic: z.enum(["problem", "privacy", "idea", "other"]),
  message: z.string().trim().min(3).max(4000),
  contact: z.string().trim().max(200).default(""),
});
export type SupportInput = z.infer<typeof supportInput>;

const TOPIC = { problem: "Something isn't working", privacy: "Privacy or my data", idea: "An idea", other: "Something else" } as const;

/**
 * Keep a support message, and email it to the operator when
 * MORE_SUPPORT_EMAIL and an email key are set. The message is stored either
 * way, so nothing is lost if email isn't switched on.
 */
export async function submitSupport(db: Db, accountId: string | null, input: SupportInput): Promise<{ id: string; emailed: boolean }> {
  const [row] = await db.insert(supportRequests).values({ accountId, topic: input.topic, message: input.message, contact: input.contact }).returning({ id: supportRequests.id });
  const to = process.env.MORE_SUPPORT_EMAIL;
  const send = emailTransport();
  let emailed = false;
  if (to && send) {
    const lines = [`Topic: ${TOPIC[input.topic]}`, `Reply to: ${input.contact || "(not given)"}`, `Signed in: ${accountId ? "yes" : "no"}`, "", input.message, "", `Reference ${row.id}`];
    emailed = await send({
      to,
      subject: `More support: ${TOPIC[input.topic]}`,
      text: lines.join("\n"),
      html: `<pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${escapeHtml(lines.join("\n"))}</pre>`,
    }).catch(() => false);
  }
  return { id: row.id, emailed };
}
