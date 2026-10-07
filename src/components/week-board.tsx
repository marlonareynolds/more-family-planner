"use client";

import { ArrowRight, Backpack, Cake, CalendarDays, Heart, Leaf, Plus, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { WeekEvent, WeekView, MomentView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { addDaysStr, fmtDate, fmtMoney, fmtRange, localParts, todayIn } from "./format";
import { EventEditor } from "./event-editor";
import { MomentCard } from "./moment-card";
import { MomentEditor, type MomentKind } from "./moment-editor";
import { Badge, Button, Dialog, Segmented, cx } from "./ui";

const CHOICE = "flex min-h-14 items-center gap-3 rounded-2xl border border-line px-3 text-left text-[15px] transition-colors hover:bg-surface-2 active:scale-[0.99]";

type Item =
  | { type: "event"; start: number; end: number; e: WeekEvent }
  | { type: "moment"; start: number; end: number; m: MomentView }
  | { type: "care"; start: number; end: number; g: WeekView["care"][number]["groups"][number] };

function itemsByDay(week: WeekView, timeZone: string): Map<string, Item[]> {
  const map = new Map<string, Item[]>(week.days.map((d) => [d, []]));
  const put = (date: string, it: Item) => map.get(date)?.push(it);
  for (const e of week.events) {
    // Multi-day items appear on each day they touch.
    let d = localParts(e.start, timeZone).date;
    const last = localParts(e.end - 1, timeZone).date;
    for (let i = 0; i < 15 && d <= last; i++, d = addDaysStr(d, 1)) put(d, { type: "event", start: e.start, end: e.end, e });
  }
  for (const m of week.moments) if (m.lifecycle !== "cancelled") put(localParts(m.start, timeZone).date, { type: "moment", start: m.start, end: m.end, m });
  for (const day of week.care) for (const g of day.groups) put(day.date, { type: "care", start: g.gaps[0]?.start ?? 0, end: 0, g });
  for (const list of map.values()) list.sort((a, b) => Number(b.type === "event" && b.e.allDay) - Number(a.type === "event" && a.e.allDay) || a.start - b.start);
  return map;
}

export function WeekBoard({ week, mode = "week" }: { week: WeekView; mode?: "week" | "today" }) {
  const app = useApp();
  const [view, setView] = useState<"agenda" | "grid">("agenda");
  const [editingEvent, setEditingEvent] = useState<WeekEvent | null>(null);
  const [newEvent, setNewEvent] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [newMoment, setNewMoment] = useState<{ kind: MomentKind; date: string } | null>(null);
  const [chooser, setChooser] = useState<string | null>(null);
  const days = itemsByDay(week, app.timeZone);
  const today = todayIn(app.timeZone);
  const prev = addDaysStr(week.weekKey, -7);
  const next = addDaysStr(week.weekKey, 7);

  return (
    <div>
      {mode === "week" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Link href={`/week?w=${prev}`} className="rounded-full px-3 py-2 text-ink-2 hover:bg-surface-2" aria-label="Previous week">←</Link>
            <h1 className="font-display text-2xl">
              {fmtDate(week.weekKey, { weekday: false })} to {fmtDate(addDaysStr(week.weekKey, 6), { weekday: false })}
            </h1>
            <Link href={`/week?w=${next}`} className="rounded-full px-3 py-2 text-ink-2 hover:bg-surface-2" aria-label="Next week">→</Link>
          </div>
          <div className="flex items-center gap-2">
            <Segmented label="View" value={view} onChange={setView} options={[{ value: "agenda", label: "Agenda" }, { value: "grid", label: "Week" }]} />
            <Button variant="primary" onClick={() => setChooser(week.days.includes(today) ? today : week.weekKey)}>+ Add</Button>
          </div>
        </div>
      )}
      {mode === "week" && week.calendars.some((c) => c.stale) && (
        <p className="mb-4 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          {week.calendars.filter((c) => c.stale).map((c) => (c.mine ? `Your “${c.label}” calendar` : `${app.nameOf(c.ownerId)}'s calendar`)).join(" and ")} isn&apos;t up to date, so free time shown here may be wrong.{" "}
          {week.calendars.some((c) => c.stale && c.mine) && <Link className="underline" href="/settings#calendars">Check it</Link>}
        </p>
      )}
      {mode === "week" && week.money.estimateMinor + week.money.netPaidMinor > 0 && (
        <p className="mb-4 text-sm text-ink-2">
          This week&apos;s plans: expected {fmtMoney(week.money.estimateMinor)}, committed {fmtMoney(week.money.committedMinor)}, paid {fmtMoney(week.money.netPaidMinor)}
        </p>
      )}

      {mode === "week" && week.days.every((d) => (days.get(d) ?? []).length === 0) && (
        <Link href="/plan" className="rise group mb-4 flex items-center gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-brand">
          <Sparkles aria-hidden size={20} className="shrink-0" />
          <span className="flex-1"><span className="block font-medium">A blank week, full of possibility.</span><span className="block text-sm text-ink-2">Plan it together in ten minutes: one thing for each of you.</span></span>
          <ArrowRight aria-hidden size={18} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <div className={cx(view === "grid" && mode === "week" ? "grid gap-3 md:grid-cols-7" : "flex flex-col gap-3")}>
        {week.days.map((date) => {
          const list = days.get(date) ?? [];
          if (list.length === 0 && view === "agenda") {
            // A free day is one quiet line, not a paragraph repeated seven times.
            return (
              <section key={date} aria-labelledby={`d-${date}`} className={cx("flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-dashed px-4", date === today ? "border-brand/40" : "border-line")}>
                <h2 id={`d-${date}`} className={cx("text-sm font-semibold uppercase tracking-wide", date === today ? "text-brand" : "text-ink-3")}>
                  {date === today ? "Today · " : ""}
                  {fmtDate(date)}
                  {week.markers[date] && <span className="ml-2 rounded-full bg-family-soft px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-family">{week.markers[date]}</span>}
                  <AwayChips trips={week.trips} date={date} />
                </h2>
                <span className="flex items-center gap-2 text-sm text-ink-3">
                  Free
                  {mode === "week" && <button className="flex min-h-9 items-center gap-1 rounded-full px-2 text-brand hover:bg-brand-soft" onClick={() => setChooser(date)} aria-label={`Add on ${fmtDate(date)}`}><Plus aria-hidden size={15} />Add</button>}
                </span>
              </section>
            );
          }
          return (
            <section key={date} aria-labelledby={`d-${date}`} className={cx(view === "grid" && mode === "week" ? "min-w-0" : "py-1")}>
              <div className="mb-2 flex items-center justify-between">
                <h2 id={`d-${date}`} className={cx("text-sm font-semibold uppercase tracking-wide", date === today ? "text-brand" : "text-ink-3")}>
                  {date === today ? "Today · " : ""}
                  {fmtDate(date)}
                  {week.markers[date] && <span className="ml-2 rounded-full bg-family-soft px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-family">{week.markers[date]}</span>}
                  <AwayChips trips={week.trips} date={date} />
                </h2>
                {mode === "week" && view === "agenda" && (
                  <button className="flex min-h-9 items-center gap-1 rounded-full px-2 text-sm text-brand hover:bg-brand-soft" onClick={() => setChooser(date)} aria-label={`Add on ${fmtDate(date)}`}><Plus aria-hidden size={15} />Add</button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-ink-3">–</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((it, i) => (
                    <li key={i}>
                      {it.type === "event" && <EventRow e={it.e} onOpen={() => setEditingEvent(it.e)} compact={view === "grid"} />}
                      {it.type === "moment" && <MomentCard moment={it.m} expense={week.expenses.find((x) => x.id === it.m.expenseId)} compact={view === "grid" || mode === "today"} />}
                      {it.type === "care" && <CareRow g={it.g} date={date} />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {chooser && (
        <Dialog open onClose={() => setChooser(null)} title={`Add on ${fmtDate(chooser)}`}>
          <div className="grid gap-2">
            {([
              { label: "Something in the diary", icon: CalendarDays, tone: "bg-surface-2 text-ink-2", go: () => setNewEvent(chooser) },
              { label: "Time for me", icon: Leaf, tone: "bg-me-soft text-me", go: () => setNewMoment({ kind: "me", date: chooser }) },
              { label: "Time for us", icon: Heart, tone: "bg-us-soft text-us", go: () => setNewMoment({ kind: "us", date: chooser }) },
              { label: "Family time", icon: Users, tone: "bg-family-soft text-family", go: () => setNewMoment({ kind: "family", date: chooser }) },
              { label: "Birthday, anniversary or other yearly date", icon: Cake, tone: "bg-brand-soft text-brand", go: () => setNewDate(chooser) },
            ] as const).map((o) => (
              <button key={o.label} type="button" className={CHOICE} onClick={() => { o.go(); setChooser(null); }}>
                <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", o.tone)}><o.icon aria-hidden size={18} /></span>
                {o.label}
              </button>
            ))}
            <Link className={CHOICE} href={`/holidays?date=${chooser}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-care-soft text-care"><Backpack aria-hidden size={18} /></span>
              Childcare
            </Link>
          </div>
        </Dialog>
      )}
      {editingEvent && <EventEditor open onClose={() => setEditingEvent(null)} event={editingEvent} defaultDate={week.weekKey} key={`${editingEvent.id}-${editingEvent.recurrenceId}`} />}
      {newEvent && <EventEditor open onClose={() => setNewEvent(null)} defaultDate={newEvent} />}
      {newDate && <EventEditor open onClose={() => setNewDate(null)} defaultDate={newDate} important />}
      {newMoment && <MomentEditor open onClose={() => setNewMoment(null)} template={{ kind: newMoment.kind, title: "" }} defaultDate={newMoment.date} />}
    </div>
  );
}

function EventRow({ e, onOpen, compact }: { e: WeekEvent; onOpen: () => void; compact?: boolean }) {
  const app = useApp();
  const canEdit = !e.imported && (e.mine || e.visibility === "shared");
  const who = [...e.adultIds.map((id) => (id === app.me.id ? "Me" : app.nameOf(id))), ...e.childIds.map(app.childName)];
  const body = (
    <>
      <p className="text-sm text-ink-3">{fmtRange(e.start, e.end, app.timeZone, e.allDay)}</p>
      <p className={cx("font-medium", e.detailsHidden && "text-ink-2")}>
        {e.title}
        {e.recurring && <span className="ml-1 text-ink-3" aria-label="repeats">↻</span>}
        {e.mine && e.visibility !== "shared" && <span className="ml-2 align-middle"><Badge>{e.visibility === "private" ? "Only me" : "Busy only"}</Badge></span>}
      </p>
      {!compact && who.length > 0 && <p className="text-sm text-ink-2">{who.join(", ")}</p>}
      {!compact && e.importedFrom && <p className="text-xs text-ink-3">From {e.importedFrom} · change it there</p>}
      {!compact && e.location && <p className="text-sm text-ink-3">📍 {e.location}</p>}
    </>
  );
  return canEdit ? (
    <button onClick={onOpen} className="block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2">
      {body}
    </button>
  ) : (
    <div className="rounded-2xl border border-dashed border-line px-4 py-3">{body}</div>
  );
}

function CareRow({ g, date }: { g: WeekView["care"][number]["groups"][number]; date: string }) {
  const app = useApp();
  const names = g.childIds.map(app.childName).join(", ");
  const who = g.arrangements
    .filter((a) => a.state === "confirmed")
    .map((a) => (a.kind === "parent" ? app.nameOf(a.responsibleAccountId!) : a.kind === "external" ? a.providerName : "No care needed"))
    .join(" then ");
  return (
    <Link href={`/holidays?date=${date}`} className="block rounded-2xl border border-line border-l-4 border-l-care bg-surface px-4 py-3 hover:bg-surface-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{names}</p>
        <Badge tone={g.state === "covered" ? "good" : "warn"}>{g.state === "covered" ? "Care covered" : g.state === "partly_covered" ? "Gap in care" : "Care needed"}</Badge>
      </div>
      <p className="text-sm text-ink-2">{g.reason}{who ? ` · ${who}` : ""}</p>
      {g.state !== "covered" && g.gaps.length > 0 && (
        <p className="text-sm text-warn">Not covered {g.gaps.map((x) => fmtRange(x.start, x.end, app.timeZone)).join(", ")}</p>
      )}
    </Link>
  );
}

/** Who's away on a day, and when they're back: one quiet chip per trip. */
function AwayChips({ trips, date }: { trips: WeekView["trips"]; date: string }) {
  const app = useApp();
  return (
    <>
      {trips.map((t) => {
        const s = localParts(t.start, app.timeZone);
        const e = localParts(t.end, app.timeZone);
        if (date < s.date || date > e.date) return null;
        const everyone = t.travellerIds.length === app.adults.length && t.childIds.length === app.children.length;
        const who = everyone ? t.title : t.travellerIds.map((id) => (id === app.me.id ? "You" : app.nameOf(id))).join(" and ");
        const label = date === e.date && e.time !== "00:00" ? `${who} back ${e.time}` : date === s.date ? `${who} away from ${s.time}` : `${who} away`;
        return <span key={t.id} className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-ink-2">{label}</span>;
      })}
    </>
  );
}
