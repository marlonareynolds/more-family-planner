"use client";

import { ArrowRight, Bell, CalendarPlus, Check, Heart, ListChecks, MapPin, MessageCircleHeart, RefreshCw, Sparkles, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobsView } from "@/server/queries/jobs";
import type { MomentView, WeekView } from "@/server/queries/week";
import { useApp, useNow } from "./app-context";
import { CheckinDialog } from "./checkin-dialog";
import { fmtDate, localParts, mondayOf, todayIn } from "./format";
import { JobsToday } from "./jobs";
import { MomentCard } from "./moment-card";
import { RitualCard } from "./rituals";
import { toast } from "./toast";
import { WeekBoard } from "./week-board";
import { Button, Card, SectionTitle } from "./ui";
import { useCommand } from "./use-command";

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${LONG_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${LONG_MONTHS[m - 1]}`;
}

/** "Tonight", "Tomorrow at 19:30", "Friday at 10:00", "Sat 18 Oct". */
function whenLabel(m: MomentView, today: string, tz: string): string {
  const { date, time } = localParts(m.start, tz);
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const hour = Number(time.slice(0, 2));
  if (days === 0) return hour >= 17 ? `Tonight at ${time}` : `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days < 7) return `${LONG_DAYS[new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay()]} at ${time}`;
  return `${fmtDate(date)} at ${time}`;
}

export function TodayView({ data, jobs }: { data: WeekView; jobs?: JobsView }) {
  const app = useApp();
  const router = useRouter();
  const now = useNow();
  const { run } = useCommand(app.householdId);
  const [checkin, setCheckin] = useState(false);
  const today = todayIn(app.timeZone);
  const hour = Number(localParts(now, app.timeZone).time.slice(0, 2));
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
    toast(`All ${toAnswer.length} agreed. Your week just got better.`, { celebrate: true });
    router.refresh();
  }

  // The week ahead at a glance: what's agreed, time for you, what's next.
  const weekEnd = now + 7 * 86_400_000;
  const ahead = data.moments.filter((m) => m.lifecycle === "planned" && m.end > now && m.start < weekEnd);
  const agreed = ahead.filter((m) => m.agreed && (m.participantIds.includes(app.me.id) || m.momentKind === "family"));
  const meHours = Math.round((agreed.filter((m) => m.momentKind === "me" && m.organiserId === app.me.id).reduce((s, m) => s + (m.end - m.start), 0) / 3_600_000) * 2) / 2;
  const next = [...agreed].sort((a, b) => a.start - b.start)[0];
  const jobsDue = jobs?.jobs.filter((j) => (j.status === "today" || j.status === "overdue") && j.ownerId === app.me.id).length ?? 0;

  const steps = [
    { done: app.children.length > 0, label: "Add the children", href: "/settings#children", icon: Users },
    { done: app.adults.length > 1, label: "Bring your partner in", href: "/settings", icon: UserPlus },
    { done: data.calendars.length > 0 || data.events.some((e) => e.mine), label: "Add your work week or calendar", href: "/welcome", icon: CalendarPlus },
    { done: data.planning.planned || data.moments.some((m) => m.sharing === "shared"), label: "Plan your first week", href: "/plan", icon: Sparkles },
    { done: (jobs?.jobs.length ?? 0) > 0, label: "Share out a household job", href: "/jobs", icon: ListChecks },
    { done: app.places.length > 0, label: "Save a place you love", href: "/places", icon: MapPin },
  ];
  const doneSteps = steps.filter((s) => s.done).length;

  const has = (action: string) => data.attention.some((a) => a.action === action);
  const others = [
    ...(!data.checkinDone ? [{ label: "Quick private check-in", hint: "Two questions, just for you", icon: MessageCircleHeart, tone: "bg-me-soft text-me", onClick: () => setCheckin(true) }] : []),
    ...(has("date-ahead") ? [{ label: "Plan something together", hint: "Nothing for the two of you yet", icon: Heart, tone: "bg-us-soft text-us", href: "/us" }] : []),
    ...(has("calendar") ? [{ label: "Check calendars", hint: "A calendar needs a look", icon: RefreshCw, tone: "bg-surface-2 text-ink-2", href: "/settings#calendars" }] : []),
    ...(has("invite") && doneSteps === steps.length ? [{ label: "Invite your partner", hint: "Share the week with them", icon: UserPlus, tone: "bg-brand-soft text-brand", href: "/settings" }] : []),
  ] as { label: string; hint: string; icon: typeof Heart; tone: string; href?: string; onClick?: () => void }[];

  return (
    <div>
      <header className="rise">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-3">{longDate(today)}</p>
        <h1 className="mt-1 font-display text-[2rem] leading-tight">{greeting(hour)}, {app.me.displayName}</h1>
      </header>

      <section aria-label="Your week at a glance" className="rise shadow-lift relative mt-5 overflow-hidden rounded-3xl p-5 text-white" style={{ ["--i" as string]: 1, background: "linear-gradient(135deg, var(--hero-a), var(--hero-b))" }}>
        <svg aria-hidden viewBox="0 0 200 200" className="absolute -right-10 -top-12 size-48 opacity-15">
          <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="18" />
          <circle cx="100" cy="100" r="40" fill="currentColor" />
        </svg>
        <p className="text-sm/5 text-white/75">Up next</p>
        {next ? (
          <Link href="/week" className="group mt-1 block">
            <p className="font-display text-2xl leading-snug">{next.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-white/85">{whenLabel(next, today, app.timeZone)} <ArrowRight aria-hidden size={16} className="transition-transform group-hover:translate-x-0.5" /></p>
          </Link>
        ) : (
          <div className="mt-1">
            <p className="font-display text-2xl leading-snug">Nothing booked yet</p>
            <p className="mt-0.5 text-white/85">Ten minutes together fills the week with something to look forward to.</p>
            <Link href="/plan" className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-[var(--hero-a)] shadow-soft transition-transform active:scale-[0.97]">
              <Sparkles aria-hidden size={16} /> Plan the week
            </Link>
          </div>
        )}
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center">
          <div><dt className="text-xs text-white/70">Agreed plans</dt><dd className="font-display text-2xl">{agreed.length}</dd></div>
          <div><dt className="text-xs text-white/70">Time for you</dt><dd className="font-display text-2xl">{meHours ? `${meHours}h` : "–"}</dd></div>
          <div><dt className="text-xs text-white/70">Your jobs due</dt><dd className="font-display text-2xl">{jobsDue}</dd></div>
        </dl>
      </section>

      {doneSteps < steps.length && (
        <Card className="rise mt-5" style={{ ["--i" as string]: 2 }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg">Getting set up</h2>
            <span className="text-sm text-ink-3">{doneSteps} of {steps.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${(doneSteps / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-3 flex flex-col">
            {steps.map((s) => (
              <li key={s.label}>
                {s.done ? (
                  <span className="flex min-h-11 items-center gap-3 text-ink-3">
                    <span className="grid size-7 place-items-center rounded-full bg-good/15 text-good"><Check aria-hidden size={16} /></span>
                    <span className="line-through decoration-ink-3/40">{s.label}</span>
                  </span>
                ) : (
                  <Link href={s.href} className="group flex min-h-11 items-center gap-3 rounded-xl">
                    <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-brand"><s.icon aria-hidden size={15} /></span>
                    <span className="flex-1 font-medium">{s.label}</span>
                    <ArrowRight aria-hidden size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {unread.length > 0 && (
        <Card className="rise mt-5" style={{ ["--i" as string]: 3 }}>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-medium"><Bell aria-hidden size={16} className="text-brand" /> New</h2>
            <Button size="sm" variant="ghost" onClick={() => run("MarkNotificationsRead", { ids: unread.map((n) => n.id) })}>Mark read</Button>
          </div>
          <ul className="mt-2 space-y-1.5 text-[15px] text-ink-2">
            {unread.map((n) => <li key={n.id} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />{n.text}</li>)}
          </ul>
        </Card>
      )}

      {needsMe.length === 0 ? (
        <p className="rise mt-8 flex items-center gap-3 rounded-2xl bg-good/10 px-4 py-3 text-[15px] text-ink-2" style={{ ["--i" as string]: 4 }}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-good/15 text-good"><Check aria-hidden size={17} /></span>
          All clear. Nothing is waiting on you.
        </p>
      ) : (
        <SectionTitle action={toAnswer.length > 1 ? <Button size="sm" variant="primary" disabled={answering} onClick={yesToAll}>Yes to all {toAnswer.length}</Button> : undefined}>Needs you</SectionTitle>
      )}
      {needsMe.length > 0 && (
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

      {others.length > 0 && (
        <>
          <SectionTitle>When you have a minute</SectionTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {others.map((o) => {
              const inner = (
                <>
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full ${o.tone}`}><o.icon aria-hidden size={18} /></span>
                  <span className="flex-1"><span className="block font-medium">{o.label}</span><span className="block text-sm text-ink-3">{o.hint}</span></span>
                  <ArrowRight aria-hidden size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
                </>
              );
              return (
                <li key={o.label}>
                  {o.href ? <Link href={o.href} className="group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left shadow-soft transition-transform active:scale-[0.98]">{inner}</Link> : <button type="button" onClick={o.onClick} className="group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left shadow-soft transition-transform active:scale-[0.98] w-full">{inner}</button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {checkin && <CheckinDialog onClose={() => setCheckin(false)} weekKey={mondayOf(today)} />}
    </div>
  );
}
