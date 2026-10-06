"use client";

import Link from "next/link";
import { useState } from "react";
import type { WeekEvent, WeekView, MomentView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { addDaysStr, fmtDate, fmtMoney, fmtRange, localParts, todayIn } from "./format";
import { EventEditor } from "./event-editor";
import { MomentCard } from "./moment-card";
import { MomentEditor, type MomentKind } from "./moment-editor";
import { Badge, Button, Dialog, Segmented, cx } from "./ui";

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
      {mode === "week" && week.money.estimateMinor + week.money.netPaidMinor > 0 && (
        <p className="mb-4 text-sm text-ink-2">
          This week&apos;s plans: expected {fmtMoney(week.money.estimateMinor)}, committed {fmtMoney(week.money.committedMinor)}, paid {fmtMoney(week.money.netPaidMinor)}
        </p>
      )}

      <div className={cx(view === "grid" && mode === "week" ? "grid gap-3 md:grid-cols-7" : "flex flex-col gap-6")}>
        {week.days.map((date) => {
          const list = days.get(date) ?? [];
          return (
            <section key={date} aria-labelledby={`d-${date}`} className={cx(view === "grid" && mode === "week" && "min-w-0")}>
              <div className="mb-2 flex items-center justify-between">
                <h2 id={`d-${date}`} className={cx("text-sm font-semibold uppercase tracking-wide", date === today ? "text-brand" : "text-ink-3")}>
                  {date === today ? "Today · " : ""}
                  {fmtDate(date)}
                </h2>
                {mode === "week" && view === "agenda" && (
                  <button className="rounded-full px-2 text-sm text-brand" onClick={() => setChooser(date)} aria-label={`Add on ${fmtDate(date)}`}>+ Add</button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-ink-3">{view === "grid" ? "–" : "Nothing planned. Rest is valid too."}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((it, i) => (
                    <li key={i}>
                      {it.type === "event" && <EventRow e={it.e} onOpen={() => setEditingEvent(it.e)} compact={view === "grid"} />}
                      {it.type === "moment" && <MomentCard moment={it.m} expense={week.expenses.find((x) => x.id === it.m.expenseId)} compact={view === "grid"} />}
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
            <Button className="justify-start" onClick={() => { setNewEvent(chooser); setChooser(null); }}>▦ Something in the diary</Button>
            <Button className="justify-start" onClick={() => { setNewMoment({ kind: "me", date: chooser }); setChooser(null); }}>◐ Time for me</Button>
            <Button className="justify-start" onClick={() => { setNewMoment({ kind: "us", date: chooser }); setChooser(null); }}>♥ Time for us</Button>
            <Button className="justify-start" onClick={() => { setNewMoment({ kind: "family", date: chooser }); setChooser(null); }}>✿ Family time</Button>
            <Link className="rounded-full border border-line px-4 py-2.5 text-[15px]" href={`/holidays?date=${chooser}`}>☂ Childcare</Link>
          </div>
        </Dialog>
      )}
      {editingEvent && <EventEditor open onClose={() => setEditingEvent(null)} event={editingEvent} defaultDate={week.weekKey} key={`${editingEvent.id}-${editingEvent.recurrenceId}`} />}
      {newEvent && <EventEditor open onClose={() => setNewEvent(null)} defaultDate={newEvent} />}
      {newMoment && <MomentEditor open onClose={() => setNewMoment(null)} template={{ kind: newMoment.kind, title: "" }} defaultDate={newMoment.date} />}
    </div>
  );
}

function EventRow({ e, onOpen, compact }: { e: WeekEvent; onOpen: () => void; compact?: boolean }) {
  const app = useApp();
  const canEdit = e.mine || e.visibility === "shared";
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
