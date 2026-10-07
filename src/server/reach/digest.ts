import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, emailSends, households, memberships, weekPlans } from "@/db/schema";
import { weekAheadDue } from "@/domain/reach";
import { fmtDate, localParts } from "@/components/format";
import { getWeek, type WeekView } from "../queries/week";
import { appUrl, emailTransport, escapeHtml, type Email } from "./email";

/**
 * The Sunday "your week ahead" email (spec 13.2): one per adult per week,
 * built from exactly what that adult can see in the app.
 */

export function weekAheadEmail(view: WeekView, to: string, planned: boolean): Email {
  const tz = view.household.timeZone;
  const url = appUrl();
  const when = (ms: number) => {
    const p = localParts(ms, tz);
    return `${fmtDate(p.date)} ${p.time}`;
  };
  const answer = view.moments.filter((m) => m.lifecycle === "planned" && m.sharing === "shared" && m.participantIds.includes(view.me.id) && m.myDecision !== "accepted");
  const agreed = view.moments.filter((m) => m.lifecycle === "planned" && m.agreed);
  const gaps = view.care.flatMap((d) => d.groups.filter((g) => g.state !== "covered").map((g) => `${fmtDate(d.date)}: ${g.reason}`));
  const dates = view.attention.filter((a) => a.action === "date-ahead").map((a) => a.text);

  const sections: { title: string; lines: string[] }[] = [];
  if (answer.length) sections.push({ title: "Waiting for your answer", lines: answer.map((m) => `${m.title}, ${when(m.start)}`) });
  if (agreed.length) sections.push({ title: "Agreed", lines: agreed.map((m) => `${m.title}, ${when(m.start)}${m.ready ? "" : " (not quite ready yet)"}`) });
  if (gaps.length) sections.push({ title: "Childcare still to sort", lines: [...new Set(gaps)] });
  if (dates.length) sections.push({ title: "Coming up", lines: dates });
  const markers = Object.entries(view.markers).map(([d, name]) => `${fmtDate(d)}: ${name}`);
  if (markers.length) sections.push({ title: "Bank holidays", lines: markers });

  const intro = sections.length ? "Here's the week starting " + fmtDate(view.weekKey, { month: "long" }) + "." : "Nothing is in the diary for next week yet. Rest is valid too.";
  const cta = planned
    ? { text: "Open the week", href: `${url}/week?w=${view.weekKey}` }
    : { text: "Take ten minutes together to plan it", href: `${url}/plan` };

  const text = [
    `Hello ${view.me.displayName},`,
    "",
    intro,
    ...sections.flatMap((s) => ["", `${s.title}:`, ...s.lines.map((l) => `- ${l}`)]),
    "",
    `${cta.text}: ${cta.href}`,
    "",
    `You can turn this email off in Settings: ${url}/settings`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#faf7f2;font-family:-apple-system,Segoe UI,sans-serif;color:#1d2622">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="font-family:Georgia,serif;font-size:22px;color:#2f5d50;margin:0 0 16px">More</p>
<p>Hello ${escapeHtml(view.me.displayName)},</p>
<p>${escapeHtml(intro)}</p>
${sections.map((s) => `<h2 style="font-size:15px;margin:20px 0 6px">${escapeHtml(s.title)}</h2><ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(cta.href)}" style="background:#2f5d50;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">${escapeHtml(cta.text)}</a></p>
<p style="font-size:12px;color:#6f7c76">You get this because the weekly email is on. <a href="${escapeHtml(url)}/settings" style="color:#6f7c76">Turn it off in Settings</a>.</p>
</div></body></html>`;

  return { to, subject: `Your week ahead in More`, text, html };
}

export async function sendWeeklyDigests(db: Db, now = new Date(), limit = 100): Promise<{ sent: number; failed: number }> {
  const stats = { sent: 0, failed: 0 };
  const send = emailTransport();
  if (!send) return stats;
  const rows = await db
    .select({ accountId: accounts.id, displayName: accounts.displayName, email: accounts.email, householdId: households.id, timeZone: households.timeZone })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), isNull(memberships.endsAt)))
    .innerJoin(households, and(eq(households.id, memberships.householdId), isNull(households.deletedAt)))
    .where(and(eq(accounts.weeklyEmail, true), isNotNull(accounts.email), isNull(accounts.closedAt)))
    .limit(limit * 5);

  for (const r of rows) {
    if (stats.sent >= limit) break;
    const weekKey = weekAheadDue(now.getTime(), r.timeZone);
    if (!weekKey || !r.email) continue;
    // Claim first: a retry or a parallel run never sends the same week twice.
    const claimed = await db.insert(emailSends).values({ accountId: r.accountId, kind: "week-ahead", periodKey: weekKey }).onConflictDoNothing().returning();
    if (!claimed.length) continue;
    try {
      const view = await getWeek(db, { accountId: r.accountId, displayName: r.displayName }, weekKey, now);
      const [plan] = await db.select().from(weekPlans).where(and(eq(weekPlans.householdId, r.householdId), eq(weekPlans.weekKey, weekKey)));
      const ok = await send(weekAheadEmail(view, r.email, !!plan));
      if (!ok) throw new Error("send failed");
      stats.sent++;
    } catch {
      stats.failed++;
      await db.delete(emailSends).where(and(eq(emailSends.accountId, r.accountId), eq(emailSends.kind, "week-ahead"), eq(emailSends.periodKey, weekKey)));
    }
  }
  return stats;
}
