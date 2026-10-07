"use client";

import Link from "next/link";
import { useState } from "react";
import type { WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import type { JobsView } from "@/server/queries/jobs";
import { CheckinDialog } from "./checkin-dialog";
import { JobsToday } from "./jobs";
import { mondayOf, todayIn } from "./format";
import { MomentCard } from "./moment-card";
import { RitualCard } from "./rituals";
import { WeekBoard } from "./week-board";
import { Button, Card, EmptyState, SectionTitle } from "./ui";
import { useCommand } from "./use-command";

export function TodayView({ data, jobs }: { data: WeekView; jobs?: JobsView }) {
  const app = useApp();
  const { run } = useCommand(app.householdId);
  const [checkin, setCheckin] = useState(false);
  const today = todayIn(app.timeZone);
  const twoDays = { ...data, days: data.days.slice(0, 2), care: data.care.filter((c) => data.days.slice(0, 2).includes(c.date)) };
  const needsMe = data.attention.filter((a) => a.priority <= 4);
  const unread = data.notifications.filter((n) => !n.read);
  const momentFor = (id?: string) => data.moments.find((m) => m.id === id);
  const toAnswer = needsMe.filter((a) => a.action === "respond").map((a) => momentFor(a.targetId)).filter((m) => !!m && m.review !== "needs_review" && m.conflicts.length === 0);
  const [answering, setAnswering] = useState(false);
  async function yesToAll() {
    setAnswering(true);
    for (const m of toAnswer) await run("RespondToMoment", { momentId: m!.id, materialVersion: m!.materialVersion, decision: "accepted" }, { refresh: false });
    setAnswering(false);
    window.location.reload();
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Hello, {app.me.displayName}</h1>
      <p className="mt-1 text-ink-2">{app.householdName}</p>

      {unread.length > 0 && (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">New</h2>
            <Button size="sm" variant="ghost" onClick={() => run("MarkNotificationsRead", { ids: unread.map((n) => n.id) })}>Mark read</Button>
          </div>
          <ul className="mt-2 space-y-1 text-[15px] text-ink-2">
            {unread.map((n) => <li key={n.id}>{n.text}</li>)}
          </ul>
        </Card>
      )}

      <SectionTitle action={toAnswer.length > 1 ? <Button size="sm" variant="primary" disabled={answering} onClick={yesToAll}>Yes to all {toAnswer.length}</Button> : undefined}>Needs you</SectionTitle>
      {needsMe.length === 0 ? (
        <EmptyState title="Nothing needs you right now." />
      ) : (
        <ul className="flex flex-col gap-3">
          {needsMe.map((a) => {
            const m = momentFor(a.targetId);
            if (m && (a.action === "respond" || a.action === "review" || a.action === "complete" || a.action === "reflect")) {
              return <li key={a.key}><MomentCard moment={m} expense={data.expenses.find((x) => x.id === m.expenseId)} /></li>;
            }
            const ritual = a.action === "ritual" ? data.rituals.find((r) => r.id === a.targetId) : null;
            if (ritual) return <li key={a.key}><p className="mb-1 text-sm text-ink-2">{a.text}</p><RitualCard ritual={ritual} /></li>;
            if (a.action === "plan-week") {
              return (
                <li key={a.key}>
                  <Card tone="us" className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{a.text}</p>
                      <p className="text-sm text-ink-2">See what&apos;s on, pick one thing for each of you, and send it in one go.</p>
                    </div>
                    <Link href="/plan" className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand px-5 text-white">Start</Link>
                  </Card>
                </li>
              );
            }
            return (
              <li key={a.key}>
                <Card className="flex items-center justify-between gap-3">
                  <p>{a.text}</p>
                  {(a.action === "care" || a.action === "care-gap") && <Link className="shrink-0 text-sm text-brand underline" href={`/holidays${a.date ? `?date=${a.date}` : ""}`}>Open</Link>}
                  {a.action === "task" && m && <Link className="shrink-0 text-sm text-brand underline" href={`/week?w=${mondayOf(today)}`}>Open</Link>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {jobs && <JobsToday data={jobs} />}

      <SectionTitle action={<Link href="/week" className="text-sm text-brand underline">Whole week</Link>}>Today and tomorrow</SectionTitle>
      <WeekBoard week={twoDays} mode="today" />

      <SectionTitle>Other things</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {!data.checkinDone && <Button onClick={() => setCheckin(true)}>Quick private check-in</Button>}
        {data.attention.some((a) => a.action === "date-ahead") && <Link href="/us" className="inline-flex min-h-11 items-center rounded-full border border-line px-4">Plan something together</Link>}
        {data.attention.some((a) => a.action === "calendar") && <Link href="/settings#calendars" className="inline-flex min-h-11 items-center rounded-full border border-line px-4">Check calendars</Link>}
        {data.attention.some((a) => a.action === "invite") && <Link href="/settings" className="inline-flex min-h-11 items-center rounded-full border border-line px-4">Invite your partner</Link>}
      </div>
      {checkin && <CheckinDialog onClose={() => setCheckin(false)} weekKey={mondayOf(today)} />}
    </div>
  );
}
