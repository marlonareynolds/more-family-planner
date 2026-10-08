"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "./app-context";
import { addDaysStr, mondayOf, todayIn } from "./format";
import { Button, Card, ErrorNote, Field, inputClass } from "./ui";
import { useCommand } from "./use-command";
import { DeskBoard } from "./desk";

type Step = "children" | "letters" | "holidays" | "work" | "calendar" | "invite" | "done";
const AGE_BANDS = ["0-4", "5-7", "8-11", "12-15", "16+"] as const;
const DAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const;
const HOLIDAYS = ["Autumn half term", "Christmas holidays", "Spring half term", "Easter holidays", "Summer half term", "Summer holidays"];

/**
 * A short path that fills the week: children, school holidays, each adult's
 * usual working pattern, a calendar link and the partner invite. Every step
 * can be skipped and done later in Settings.
 */
export function Welcome({ has, ai = false }: { has: { children: boolean; holidays: boolean; work: boolean; calendar: boolean; partner: boolean; letters: boolean }; ai?: boolean }) {
  const app = useApp();
  // Fixed when the page opens: adding things on the way must not move the steps under the person.
  const [steps] = useState<Step[]>(() => [
    ...(!has.children && !has.partner ? (["children"] as const) : []),
    // Letters next: term dates and school letters fill the diary fastest, and can cover the holidays too.
    ...(!has.letters ? (["letters"] as const) : []),
    // Holidays only make sense once there are children.
    ...(!has.holidays && app.children.length > 0 ? (["holidays"] as const) : []),
    ...(!has.work ? (["work"] as const) : []),
    ...(!has.calendar ? (["calendar"] as const) : []),
    ...(!has.partner ? (["invite"] as const) : []),
    "done" as const,
  ]);
  const [i, setI] = useState(0);
  /** A school break came in from a letter, so the holidays form isn't needed. */
  const [breaksAdded, setBreaksAdded] = useState(false);
  const step = steps[i];
  const next = () =>
    setI((n) => {
      let to = Math.min(n + 1, steps.length - 1);
      if (steps[to] === "holidays" && breaksAdded) to = Math.min(to + 1, steps.length - 1);
      return to;
    });
  const current: Step = step;

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm text-ink-3">Getting started · step {Math.min(i + 1, steps.length)} of {steps.length}</p>
      {current === "children" && <ChildrenStep onNext={next} />}
      {current === "letters" && <LettersStep ai={ai} onNext={next} onBreaks={() => setBreaksAdded(true)} />}
      {current === "holidays" && <HolidaysStep onNext={next} />}
      {current === "work" && <WorkStep onNext={next} />}
      {current === "calendar" && <CalendarStep onNext={next} />}
      {current === "invite" && <InviteStep onNext={next} />}
      {current === "done" && (
        <div>
          <h1 className="mt-2 font-display text-3xl">Your week is taking shape</h1>
          <p className="mt-2 text-ink-2">Now pick one thing for each of you this week. It takes about ten minutes, and {app.partner ? `${app.partner.displayName} can answer everything in one go` : "your partner can answer everything in one go once they join"}.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/plan" className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-white">Plan this week</Link>
            <Link href="/today" className="inline-flex min-h-11 items-center rounded-full border border-line px-5">Go to Today</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StepFrame({ title, intro, children, onSkip, onSave, saveLabel, pending, error }: { title: string; intro: string; children: React.ReactNode; onSkip: () => void; onSave: () => void; saveLabel: string; pending: boolean; error?: string | null }) {
  return (
    <div>
      <h1 className="mt-2 font-display text-3xl">{title}</h1>
      <p className="mt-2 text-ink-2">{intro}</p>
      <Card className="mt-4 flex flex-col gap-3">
        {children}
        <ErrorNote message={error} />
      </Card>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="primary" disabled={pending} onClick={onSave}>{saveLabel}</Button>
        <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
      </div>
    </div>
  );
}

function ChildrenStep({ onNext }: { onNext: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [rows, setRows] = useState([{ name: "", band: "5-7" as (typeof AGE_BANDS)[number] }]);
  async function save() {
    for (const r of rows.filter((r) => r.name.trim())) {
      if (!(await run("AddChild", { preferredName: r.name, ageBand: r.band }, { refresh: false }))) return;
    }
    window.location.reload();
  }
  return (
    <StepFrame title="Who are the children?" intro="First names and an age range are enough. More never asks for birth dates." onSkip={onNext} onSave={save} saveLabel="Save and continue" pending={pending} error={error?.message}>
      {rows.map((r, n) => (
        <div key={n} className="flex gap-2">
          <label className="sr-only" htmlFor={`child-${n}`}>Child {n + 1} name</label>
          <input id={`child-${n}`} className={inputClass} placeholder="First name" maxLength={40} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)))} />
          <label className="sr-only" htmlFor={`band-${n}`}>Age</label>
          <select id={`band-${n}`} className={`${inputClass} w-28`} value={r.band} onChange={(e) => setRows(rows.map((x, j) => (j === n ? { ...x, band: e.target.value as typeof r.band } : x)))}>
            {AGE_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      ))}
      <button className="self-start text-sm text-brand underline" onClick={() => setRows([...rows, { name: "", band: "5-7" }])}>+ Another child</button>
    </StepFrame>
  );
}

/** The household desk, as the first way in: the dates come from the letters the family already gets. */
function LettersStep({ ai, onNext, onBreaks }: { ai: boolean; onNext: () => void; onBreaks: () => void }) {
  const [added, setAdded] = useState(0);
  return (
    <div>
      <h1 className="mt-2 font-display text-3xl">Add your school letters</h1>
      <p className="mt-2 text-ink-2">
        Paste the school&apos;s term dates, a letter, a club timetable or a booking{ai ? ", or add a photo or PDF of one" : ""}. More picks out the dates and you check each one before anything goes in the diary. Do as many as you like now; the Household desk is always in the menu for the next one.
      </p>
      <div className="mt-4">
        <DeskBoard ai={ai} embedded onAdded={(r) => { setAdded((n) => n + r.length); if (r.some((x) => x.targetType === "holiday")) onBreaks(); }} />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" onClick={onNext}>{added ? "Continue" : "Skip for now"}</Button>
        {added > 0 && <span className="text-sm text-ink-2">{added === 1 ? "1 thing added" : `${added} things added`} so far.</span>}
      </div>
    </div>
  );
}

function HolidaysStep({ onNext }: { onNext: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [rows, setRows] = useState(HOLIDAYS.map((name) => ({ name, start: "", end: "" })));
  const [times, setTimes] = useState({ start: "08:30", end: "17:30" });
  const [localError, setLocalError] = useState<string | null>(null);
  async function save() {
    const filled = rows.filter((r) => r.start && r.end);
    if (filled.some((r) => r.end < r.start)) return setLocalError("Each holiday must end on or after its first day.");
    setLocalError(null);
    for (const r of filled) {
      const ok = await run("CreateHoliday", { name: r.name, startDate: r.start, endDate: r.end, dailyStart: times.start, dailyEnd: times.end, includeWeekends: false, childIds: app.children.map((c) => c.id) }, { refresh: false });
      if (!ok) return;
    }
    onNext();
  }
  return (
    <StepFrame
      title="School holidays"
      intro="Add this school year's holidays and More shows every day that needs childcare. Copy the dates from your school or council's term dates page (for Surrey schools, search “Surrey term dates”). Fill in as many as you have."
      onSkip={onNext}
      onSave={save}
      saveLabel="Save and continue"
      pending={pending}
      error={localError ?? error?.message}
    >
      {rows.map((r, n) => (
        <fieldset key={r.name} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <legend className="sr-only">{r.name}</legend>
          <span className="pb-2 text-sm">{r.name}</span>
          <Field label="First day">{(id) => <input id={id} type="date" className={`${inputClass} w-40`} value={r.start} onChange={(e) => setRows(rows.map((x, j) => (j === n ? { ...x, start: e.target.value, end: x.end || e.target.value } : x)))} />}</Field>
          <Field label="Last day">{(id) => <input id={id} type="date" className={`${inputClass} w-40`} value={r.end} onChange={(e) => setRows(rows.map((x, j) => (j === n ? { ...x, end: e.target.value } : x)))} />}</Field>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-3 border-t border-line pt-3">
        <Field label="Care needed from">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={times.start} onChange={(e) => setTimes({ ...times, start: e.target.value })} />}</Field>
        <Field label="Until">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={times.end} onChange={(e) => setTimes({ ...times, end: e.target.value })} />}</Field>
      </div>
      <p className="text-xs text-ink-3">INSET days can be added later as one-day holidays.</p>
    </StepFrame>
  );
}

function WorkStep({ onNext }: { onNext: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [days, setDays] = useState<string[]>(["MO", "TU", "WE", "TH", "FR"]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:30");
  const [commute, setCommute] = useState("0");
  async function save() {
    if (!days.length) return onNext();
    // Starts on the next of the chosen days so the series lines up with its rule.
    const monday = mondayOf(todayIn(app.timeZone));
    const first = addDaysStr(monday, DAYS.findIndex((d) => d.code === days[0]) + 7);
    const ok = await run("AddEvent", {
      title: "Work",
      visibility: "busy_only",
      span: { allDay: false, startDate: first, startTime: start, endDate: first, endTime: end },
      adultIds: [app.me.id],
      travelBeforeMinutes: Number(commute) || 0,
      travelAfterMinutes: Number(commute) || 0,
      rule: { freq: "WEEKLY", byDay: days },
    }, { refresh: false });
    if (ok) {
      // This week too: a second series for the days still to come.
      const today = todayIn(app.timeZone);
      const thisWeek = days.map((d) => addDaysStr(monday, DAYS.findIndex((x) => x.code === d))).filter((d) => d > today);
      for (const d of thisWeek) {
        await run("AddEvent", { title: "Work", visibility: "busy_only", span: { allDay: false, startDate: d, startTime: start, endDate: d, endTime: end }, adultIds: [app.me.id], travelBeforeMinutes: Number(commute) || 0, travelAfterMinutes: Number(commute) || 0 }, { refresh: false });
      }
      onNext();
    }
  }
  return (
    <StepFrame title="Your usual week" intro="When are you usually working? It shows as “Busy” to your partner, never the details, and keeps suggestions honest." onSkip={onNext} onSave={save} saveLabel="Save and continue" pending={pending} error={error?.message}>
      <fieldset>
        <legend className="mb-2 text-sm">Days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button key={d.code} type="button" aria-pressed={days.includes(d.code)} onClick={() => setDays(days.includes(d.code) ? days.filter((x) => x !== d.code) : DAYS.map((x) => x.code).filter((x) => x === d.code || days.includes(x)))} className={`min-h-10 rounded-full border px-3 text-sm ${days.includes(d.code) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Field label="From">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Until">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Field label="Commute each way (min)">{(id) => <input id={id} inputMode="numeric" className={`${inputClass} w-32`} value={commute} onChange={(e) => setCommute(e.target.value.replace(/\D/g, ""))} />}</Field>
      </div>
      <p className="text-xs text-ink-3">Different every week? Skip this and connect your work calendar next instead.</p>
    </StepFrame>
  );
}

function CalendarStep({ onNext }: { onNext: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [url, setUrl] = useState("");
  async function save() {
    if (!url.trim()) return onNext();
    if (await run("AddCalendarFeed", { label: "My calendar", url, visibility: "busy_only" }, { refresh: false })) onNext();
  }
  return (
    <StepFrame title="Connect a calendar" intro="Paste the private iCal link from Google, Outlook or iCloud. Its events show as your busy time, and your partner only sees “Busy”." onSkip={onNext} onSave={save} saveLabel="Connect and continue" pending={pending} error={error?.message}>
      <Field label="Calendar link" hint="Google: Settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Shared calendars → Publish. iCloud: Share calendar → Public calendar.">
        {(id, d) => <input id={id} aria-describedby={d} className={inputClass} inputMode="url" placeholder="https://… or webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
    </StepFrame>
  );
}

function InviteStep({ onNext }: { onNext: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const message = link ? `I've set us up on More so we can plan time for us, for the kids and for each of us. Join here: ${link}` : "";
  return (
    <div>
      <h1 className="mt-2 font-display text-3xl">Invite your partner</h1>
      <p className="mt-2 text-ink-2">They&apos;ll see the shared week straight away. Their journal and check-ins stay private to them, just like yours.</p>
      <Card className="mt-4 flex flex-col gap-3">
        {!link ? (
          <Button variant="primary" disabled={pending} onClick={async () => {
            const r = await run<{ token: string }>("CreateInvite", {}, { expected: { membershipRevision: app.membershipRevision }, refresh: false });
            if (r) setLink(`${window.location.origin}/join/${r.token}`);
          }}>Make an invitation link</Button>
        ) : (
          <>
            <p className="text-sm">Send it yourself. It works once and expires in 7 days.</p>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-white" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4" href={`sms:?&body=${encodeURIComponent(message)}`}>Text message</a>
              <Button onClick={async () => { await navigator.clipboard.writeText(message).catch(() => {}); setCopied(true); }}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          </>
        )}
        <ErrorNote message={error?.message} />
      </Card>
      <div className="mt-4 flex gap-3">
        <Button variant={link ? "primary" : "ghost"} onClick={onNext}>{link ? "Continue" : "Skip for now"}</Button>
      </div>
    </div>
  );
}
