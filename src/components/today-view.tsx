"use client";

import { ArrowRight, Bell, CalendarPlus, Check, Heart, Inbox, ListChecks, MapPin, MessageCircleHeart, RefreshCw, Sparkles, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DecisionItem } from "@/domain/decisions";
import type { MealsView } from "@/server/queries/meals";
import type { JobsView } from "@/server/queries/jobs";
import type { WeekView } from "@/server/queries/week";
import { useApp, useNow } from "./app-context";
import { CheckinDialog } from "./checkin-dialog";
import { DecisionSummary } from "./decision-review";
import { TonightDinner } from "./dinners";
import { fmtDate, localParts, mondayOf, todayIn } from "./format";
import { JobsToday } from "./jobs";
import { MomentCard } from "./moment-card";
import { MomentEditor } from "./moment-editor";
import { WeatherLine, WetPlanCard } from "./weather";
import { nextUp } from "@/domain/next-up";
import { AppBadge, QuietNow } from "./quiet-phone";
import { CATALOGUE } from "@/lib/catalogue";
import { placeKey } from "@/lib/places";
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

/** ISO 8601 week number, as printed in diaries. */
function isoWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const stubDay = (m: { start: number }, tz: string) => Number(localParts(m.start, tz).date.slice(8, 10));
const stubMonth = (m: { start: number }, tz: string) => LONG_MONTHS[Number(localParts(m.start, tz).date.slice(5, 7)) - 1].slice(0, 3);

/** "Tonight", "Tomorrow at 19:30", "Friday at 10:00", "Sat 18 Oct". */
function whenLabel(m: { start: number }, today: string, tz: string): string {
  const { date, time } = localParts(m.start, tz);
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const hour = Number(time.slice(0, 2));
  if (days === 0) return hour >= 17 ? `Tonight at ${time}` : `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days < 7) return `${LONG_DAYS[new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay()]} at ${time}`;
  return `${fmtDate(date)} at ${time}`;
}

export function TodayView({ data, jobs, decisions, deskUsed = true, meals }: { data: WeekView; jobs?: JobsView; decisions?: { items: DecisionItem[]; until: string }; deskUsed?: boolean; meals?: MealsView }) {
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
  // Up next: the next agreed plan, or a pickup or club you're down for, whichever is sooner.
  const next = nextUp({ me: app.me.id, now, moments: agreed, events: data.events });
  // Who has said yes to the next plan, so nobody needs to check.
  const agreedBy = (key: string) => {
    const m = agreed.find((x) => `m:${x.id}` === key);
    if (!m || m.momentKind === "me") return null;
    const names = m.participantIds.map((id) => (id === app.me.id ? "you" : app.nameOf(id)));
    return names.length > 1 ? `Agreed by ${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : null;
  };
  const jobsDue = jobs?.jobs.filter((j) => (j.status === "today" || j.status === "overdue") && j.ownerId === app.me.id).length ?? 0;

  const steps = [
    { done: app.children.length > 0, label: "Add the children", href: "/settings#children", icon: Users },
    { done: deskUsed, label: "Add a letter from school or a club", href: "/desk", icon: Inbox },
    { done: app.adults.length > 1, label: "Bring your partner in", href: "/settings", icon: UserPlus },
    { done: data.calendars.length > 0 || data.events.some((e) => e.mine), label: "Add your work week or calendar", href: "/welcome", icon: CalendarPlus },
    { done: data.planning.planned || data.moments.some((m) => m.sharing === "shared"), label: "Plan your first week", href: "/plan", icon: Sparkles },
    { done: (jobs?.jobs.length ?? 0) > 0, label: "Share out a household job", href: "/jobs", icon: ListChecks },
    { done: app.places.length > 0, label: "Save a place you love", href: "/places", icon: MapPin },
  ];
  const doneSteps = steps.filter((s) => s.done).length;

  const has = (action: string) => data.attention.some((a) => a.action === action);
  const others = [
    // The household desk is how most dates get in: always one tap from Today.
    { label: "Got a letter or booking?", hint: "Paste it or add a photo; More picks out the dates", icon: Inbox, tone: "bg-brand-soft text-brand", href: "/desk" },
    ...(!data.checkinDone ? [{ label: "Quick private check-in", hint: "Two questions, just for you", icon: MessageCircleHeart, tone: "bg-me-soft text-me", onClick: () => setCheckin(true) }] : []),
    ...(has("date-ahead") ? [{ label: "A date coming up", hint: "Only you get this reminder", icon: Heart, tone: "bg-us-soft text-us", href: "/us" }] : []),
    ...(has("calendar") ? [{ label: "Check calendars", hint: "A calendar needs a look", icon: RefreshCw, tone: "bg-surface-2 text-ink-2", href: "/settings#calendars" }] : []),
    ...(has("invite") && doneSteps === steps.length ? [{ label: "Invite your partner", hint: "Share the week with them", icon: UserPlus, tone: "bg-brand-soft text-brand", href: "/settings" }] : []),
  ] as { label: string; hint: string; icon: typeof Heart; tone: string; href?: string; onClick?: () => void }[];

  return (
    <div>
      <header className="rise">
        <div className="flex items-baseline justify-between border-b-2 border-ink pb-1.5">
          <p className="label-caps text-ink">{longDate(today)}</p>
          <p className="label-caps text-ink-3">Week {isoWeek(today)}</p>
        </div>
        <h1 className="mt-4 font-display text-[2.5rem] leading-[1.02]">
          {greeting(hour)},<br />
          <em className="text-brand">{app.me.displayName}.</em>
        </h1>
      </header>

      <div className="rise mt-3" style={{ ["--i" as string]: 1 }}><WeatherLine w={data.weather[today]} /></div>
      <AppBadge count={unread.length} />
      <AwayLines data={data} />

      <section aria-label="Your week at a glance" className="rise mt-6" style={{ ["--i" as string]: 1 }}>
        <div className="shadow-lift relative flex overflow-hidden rounded-[14px] bg-brand text-brand-ink">
          <div className="min-w-0 flex-1 p-5">
            <p className="label-caps opacity-75">Up next</p>
            {next ? (
              <Link href="/week" className="group mt-2 block">
                <p className="font-display text-[1.75rem] italic leading-tight">{next.title}</p>
                <p className="mt-1 flex items-center gap-1 opacity-85">{next.start <= now ? `On now, until ${localParts(next.end, app.timeZone).time}` : whenLabel(next, today, app.timeZone)} <ArrowRight aria-hidden size={16} className="transition-transform group-hover:translate-x-0.5" /></p>
                {next.kind === "moment" && agreedBy(next.key) && <p className="mt-1 text-sm opacity-85">{agreedBy(next.key)}</p>}
                {(next.leaveBy || next.kind === "duty") && (
                  <p className="mt-1 text-sm opacity-85">
                    {next.leaveBy ? `Leave by ${localParts(next.leaveBy, app.timeZone).time}` : ""}
                    {next.leaveBy && next.kind === "duty" ? " · you're" : next.kind === "duty" ? "You're" : ""}
                    {next.kind === "duty" ? ` on this with ${next.childIds.map(app.childName).join(" and ")}` : ""}
                  </p>
                )}
              </Link>
            ) : (
              <div className="mt-2">
                <p className="font-display text-[1.75rem] italic leading-tight">Nothing booked yet.</p>
                <p className="mt-1 text-[15px] opacity-85">Ten minutes together fills the week with something to look forward to.</p>
                <Link href="/plan" className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-brand-ink px-4 text-sm font-semibold text-brand transition-transform active:scale-[0.97]">
                  <Sparkles aria-hidden size={16} /> Plan the week
                </Link>
              </div>
            )}
          </div>
          {/* The stub: torn along the dashed line, with the date of the next plan. */}
          <div aria-hidden className="relative flex w-[5.5rem] shrink-0 flex-col items-center justify-center border-l-2 border-dashed border-brand-ink/30 text-center">
            <span className="absolute -left-[9px] -top-2 size-4 rounded-full bg-bg" />
            <span className="absolute -bottom-2 -left-[9px] size-4 rounded-full bg-bg" />
            {next ? (
              <>
                <span className="label-caps opacity-75">{stubMonth(next, app.timeZone)}</span>
                <span className="font-display text-[2.6rem] leading-none">{stubDay(next, app.timeZone)}</span>
              </>
            ) : (
              <span className="font-display text-[2.6rem] italic leading-none opacity-60">?</span>
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[14px] border border-line bg-surface text-center">
          <div className="px-2 py-3"><dt className="label-caps text-ink-3">Agreed</dt><dd className="mt-0.5 font-display text-[1.7rem] leading-none">{agreed.length}</dd></div>
          <div className="px-2 py-3"><dt className="label-caps text-ink-3">For you</dt><dd className="mt-0.5 font-display text-[1.7rem] leading-none">{meHours ? `${meHours}h` : "–"}</dd></div>
          <div className="px-2 py-3"><dt className="label-caps text-ink-3">Jobs due</dt><dd className="mt-0.5 font-display text-[1.7rem] leading-none">{jobsDue}</dd></div>
        </dl>
      </section>

      <QuietNow moments={agreed.filter((m) => m.momentKind === "me" && m.organiserId === app.me.id)} />

      {doneSteps < steps.length && (
        <Card className="rise mt-5" style={{ ["--i" as string]: 2 }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-[1.3rem] italic">Getting set up</h2>
            <span className="label-caps text-ink-3">{doneSteps} of {steps.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(doneSteps / steps.length) * 100}%` }} />
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
            if (a.action === "weather") {
              const plan = data.wetPlans.find((w) => w.momentId === a.targetId);
              return plan && m ? <li key={a.key}><WetPlanCard plan={plan} moment={m} /></li> : null;
            }
            if (a.action === "wish") {
              const wish = data.wishes.find((w) => w.id === a.targetId);
              return wish ? <li key={a.key}><WishCard wish={wish} /></li> : null;
            }
            if (m && a.action === "me-clash") {
              return <li key={a.key}><p className="mb-1 text-sm text-ink-2">{a.text} Only you see this.</p><MomentCard moment={m} /></li>;
            }
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

      {decisions && <DecisionSummary items={decisions.items} until={decisions.until} />}
      {meals && <TonightDinner data={meals} />}

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

/** A child's pick from their own screen: plan it, or put it aside kindly. */
function WishCard({ wish }: { wish: WeekView["wishes"][number] }) {
  const app = useApp();
  const { run, pending } = useCommand(app.householdId);
  const [planning, setPlanning] = useState(false);
  const name = app.childName(wish.childId);
  const idea = wish.activityKey.startsWith("place:") ? null : CATALOGUE.find((x) => x.key === wish.activityKey);
  const place = wish.activityKey.startsWith("place:") ? app.places.find((p) => placeKey(p.id) === wish.activityKey) : null;
  return (
    <Card tone="family">
      <p className="font-medium">{name} picked “{wish.title}”</p>
      <p className="text-sm text-ink-2">It was {name}&apos;s turn to choose. Find a time for it, or let {name} know it&apos;ll be another week.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => setPlanning(true)}>Plan it</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("SetWishAside", { wishId: wish.id })}>Not this time</Button>
      </div>
      {planning && (
        <MomentEditor
          open
          onClose={() => setPlanning(false)}
          defaultDate={todayIn(app.timeZone)}
          template={{ kind: "family", title: wish.title, activityKey: wish.activityKey, durationMinutes: idea?.durationMinutes ?? place?.durationMinutes ?? 120, location: place ? [place.name, place.area].filter(Boolean).join(", ") : undefined, chosenByChildId: wish.childId }}
        />
      )}
    </Card>
  );
}

/** Time away as plain facts: who is away now, and the family's next trip. */
function AwayLines({ data }: { data: WeekView }) {
  const app = useApp();
  const now = useNow();
  const today = todayIn(app.timeZone);
  const away = data.trips.filter((t) => t.start <= now && t.end > now && !t.travellerIds.includes(app.me.id));
  const trip = data.nextFamilyTrip;
  const days = trip ? Math.round((Date.parse(`${localParts(trip.start, app.timeZone).date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : 0;
  if (!away.length && !trip) return null;
  return (
    <ul className="rise mt-4 flex flex-col gap-1 text-[15px] text-ink-2" style={{ ["--i" as string]: 1 }}>
      {away.map((t) => {
        const back = localParts(t.end, app.timeZone);
        return <li key={t.id}>{t.travellerIds.map(app.nameOf).join(" and ")} {t.travellerIds.length > 1 ? "are" : "is"} away until {back.date === today ? "" : `${fmtDate(back.date)} `}{back.time}.</li>;
      })}
      {trip && days > 0 && <li><span className="font-display text-lg italic text-family">{days} {days === 1 ? "sleep" : "sleeps"}</span> until {trip.title}.</li>}
    </ul>
  );
}
