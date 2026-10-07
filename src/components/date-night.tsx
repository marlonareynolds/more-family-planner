"use client";

import { Check, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SuggestedTime } from "@/domain/free-time";
import { placeKey } from "@/lib/places";
import { BookingLinks } from "./booking-links";
import { BUDGETS, COURSE_HINT, COURSE_LABEL, DATE_NIGHT_KEY, MOODS, MOOD_MINUTES, composeMenu, menuToNotes, startWindow, type Budget, type Course, type Menu, type Mood, type Timing } from "@/lib/date-night";
import type { FreeTimes } from "@/server/queries/free-time";
import { useApp } from "./app-context";
import { fmtDate, mondayOf, todayIn } from "./format";
import { toast } from "./toast";
import { ErrorNote, cx } from "./ui";
import { useCommand } from "./use-command";
import { BrushStroke, Glasses, PAPER, PIGMENT, SEPIA, SIENNA_INK, Sprig, Wash, type Pigment } from "./watercolour";

const MOOD_PIGMENT: Record<Mood, Pigment> = { cosy: "rose", out: "ultramarine", air: "sap", new: "ochre" };
const COURSES: Course[] = ["entree", "plat", "dessert"];

/** "Friday 10 October, 19:30" */
function whenLine(slot: SuggestedTime): string {
  return `${fmtDate(slot.date, { month: "long" })}, ${slot.startTime}`;
}

/**
 * The invitation itself: a painted menu card. Editable while composing, and
 * the same card the partner opens on Today.
 */
export function MenuCard({ menu, when, from, onChange, onShuffle, compact = false }: {
  menu: Menu;
  when?: string;
  from: string;
  onChange?: (m: Menu) => void;
  onShuffle?: (c: Course) => void;
  compact?: boolean;
}) {
  const editable = !!onChange;
  return (
    <article
      aria-label="Menu du soir"
      className={cx("relative isolate overflow-hidden rounded-[6px] font-menu text-center", compact ? "px-5 py-6" : "px-6 py-9")}
      style={{ background: PAPER, color: SEPIA, boxShadow: "0 1px 0 rgb(58 45 39 / .08), 0 18px 40px -22px rgb(58 45 39 / .45), inset 0 0 0 1px rgb(58 45 39 / .10), inset 0 0 0 7px #fbf6ea, inset 0 0 0 8px rgb(58 45 39 / .14)" }}
    >
      <Wash pigment="rose" seed={7} className="absolute -right-16 -top-16 -z-10 size-56" />
      <Wash pigment="ochre" seed={13} strength={0.7} className="absolute -left-20 top-1/3 -z-10 size-48" />
      <Wash pigment="ultramarine" seed={29} strength={0.6} className="absolute -bottom-20 -right-10 -z-10 size-56" />

      <Glasses className={cx("mx-auto", compact ? "h-10" : "h-14")} />
      <h3 className={cx("font-script leading-none", compact ? "mt-1 text-[2.4rem]" : "mt-2 text-[3.1rem]")}>Menu du soir</h3>
      {when && <p className="mt-2 text-[0.8rem] font-semibold uppercase tracking-[0.22em]">{when}</p>}
      <Sprig className="mx-auto mt-3 h-6 w-32" />

      <ol className={cx("flex flex-col", compact ? "mt-3 gap-4" : "mt-5 gap-6")}>
        {COURSES.map((c) => (
          <li key={c}>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.26em]" style={{ color: SIENNA_INK }}>
              {COURSE_LABEL[c]} <span className="sr-only">({COURSE_HINT[c]})</span>
            </p>
            {editable ? (
              <textarea
                aria-label={`${COURSE_HINT[c]}`}
                rows={2}
                maxLength={160}
                value={menu[c]}
                onChange={(e) => onChange!({ ...menu, [c]: e.target.value })}
                className="mt-1 w-full resize-none rounded-[4px] bg-transparent text-center text-[1.35rem] italic leading-snug outline-none [field-sizing:content] focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-[rgb(58_45_39/0.4)]"
              />
            ) : (
              <p className={cx("mt-1 italic leading-snug", compact ? "text-[1.2rem]" : "text-[1.35rem]")}>{menu[c]}</p>
            )}
            {c === "plat" && menu.location && <p className="text-sm">{menu.location}</p>}
            {onShuffle && (
              <button type="button" onClick={() => onShuffle(c)} className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[0.95rem] hover:bg-[rgb(58_45_39/0.06)]">
                <RefreshCw aria-hidden size={14} /> Another {c === "entree" ? "start" : c === "plat" ? "main" : "finish"}
              </button>
            )}
          </li>
        ))}
      </ol>

      <BrushStroke pigment="rose" className="mx-auto mt-6 h-3 w-40" />
      {editable ? (
        <label className="mt-3 block">
          <span className="block text-[0.78rem] font-semibold uppercase tracking-[0.22em]">A line from {from}</span>
          <input
            value={menu.note}
            maxLength={140}
            onChange={(e) => onChange!({ ...menu, note: e.target.value })}
            placeholder="Can't wait. Wear the blue."
            className="mt-1 w-full rounded-[4px] bg-transparent text-center font-script text-[1.7rem] leading-tight outline-none placeholder:text-[rgb(58_45_39/0.45)] focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-[rgb(58_45_39/0.4)]"
          />
        </label>
      ) : (
        menu.note && <p className="mt-3 font-script text-[1.7rem] leading-tight">“{menu.note}”</p>
      )}
      <p className="mt-2 italic">with love, {from}</p>
    </article>
  );
}

/** Rule-based and free: compose an evening, then send it as an invitation. */
export function DateNightConcierge() {
  const app = useApp();
  const router = useRouter();
  const { run, pending, error } = useCommand(app.householdId);
  const [mood, setMood] = useState<Mood | null>(null);
  const [budget, setBudget] = useState<Budget>("treat");
  const [timing, setTiming] = useState<Timing>("evening");
  const [turns, setTurns] = useState<Partial<Record<Course, number>>>({});
  const [edits, setEdits] = useState<Partial<Menu>>({});
  const [slots, setSlots] = useState<SuggestedTime[] | null>(null);
  const [slot, setSlot] = useState<SuggestedTime | null>(null);
  const [needsSitter, setNeedsSitter] = useState(true);
  const partner = app.partner;
  const hasChildren = app.children.length > 0;
  // Each partner composes from their own shelf, never the other's.
  const seed = `${app.householdId}:${app.me.id}:${mondayOf(todayIn(app.timeZone))}`;
  const shelf = useMemo(() => ({ householdId: app.householdId, accountId: app.me.id, adultIds: app.adults.map((a) => a.id) }), [app.householdId, app.me.id, app.adults]);

  const composed = useMemo(
    () => (mood ? composeMenu({ mood, budget, seed, turns, places: app.places, shelf }) : null),
    [mood, budget, seed, turns, app.places, shelf],
  );
  const menu: Menu | null = composed ? { ...composed, ...edits } : null;

  useEffect(() => {
    if (!mood || !partner) return;
    let live = true;
    const [after, before] = startWindow(mood, timing);
    fetch(`/api/v1/free-times?kind=us&minutes=${MOOD_MINUTES[mood]}&after=${after}&before=${before}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: FreeTimes) => {
        if (!live) return;
        setSlots(d.slots);
        setSlot(d.slots[0] ?? null);
      })
      .catch(() => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [mood, timing, partner]);

  // When the main course is one of your places, its own booking page comes first.
  const mainPlace = menu?.location ? app.places.find((p) => menu.location!.startsWith(p.name)) : undefined;

  function chooseMood(m: Mood) {
    setMood(m);
    setEdits({});
    setTurns({});
    setSlots(null);
    setNeedsSitter(m !== "cosy" || timing === "daytime");
  }

  async function send() {
    if (!menu || !slot || !partner || !mood) return;
    const created = await run<{ momentId: string; version: number }>(
      "CreateMoment",
      {
        kind: "us",
        title: "Date night",
        notes: menuToNotes(menu),
        location: menu.location ?? "",
        activityKey: DATE_NIGHT_KEY,
        span: { allDay: false, startDate: slot.date, startTime: slot.startTime, endDate: slot.endTime < slot.startTime ? nextDay(slot.date) : slot.date, endTime: slot.endTime },
        participantIds: [app.me.id, partner.id],
        needsCare: hasChildren && needsSitter,
        budgetMinor: BUDGETS.find((b) => b.value === budget)!.minor,
      },
      { refresh: false },
    );
    if (!created) return;
    const shared = await run("ShareMoment", { momentId: created.momentId, version: created.version }, { refresh: false });
    if (!shared) return;
    toast(`Your invitation is on its way to ${partner.displayName}.`, { celebrate: true });
    router.push("/us");
    router.refresh();
  }

  if (!partner) {
    return (
      <Shell>
        <p className="mt-6 text-[1.25rem] italic">An invitation needs someone to receive it.</p>
        <p className="mt-2 text-[1.05rem]">Invite your partner first, then come back to plan an evening for the two of you.</p>
        <Link href="/settings" className="mt-5 inline-flex min-h-11 items-center rounded-full px-5 text-[1.05rem] font-semibold text-white" style={{ background: PIGMENT.ultramarine }}>Invite your partner</Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <Step n="I" title="What kind of evening?">
        <div role="radiogroup" aria-label="Kind of evening" className="grid grid-cols-2 gap-3">
          {MOODS.map((m, i) => {
            const on = mood === m.value;
            return (
              <button
                key={m.value}
                role="radio"
                aria-checked={on}
                onClick={() => chooseMood(m.value)}
                className={cx("relative isolate min-h-28 overflow-hidden rounded-[6px] p-3 text-left transition-transform active:scale-[0.98]", on ? "ring-2 ring-[var(--dn-ink)]" : "ring-1 ring-[rgb(58_45_39/0.18)]")}
                style={{ background: PAPER }}
              >
                <Wash pigment={MOOD_PIGMENT[m.value]} seed={31 + i * 17} strength={on ? 1.3 : 0.9} className="absolute -right-8 -top-8 -z-10 size-32" />
                <span className="block text-[1.25rem] font-semibold leading-tight">{m.label}</span>
                <span className="mt-1 block text-[0.98rem] italic leading-snug">{m.line}</span>
                {on && <Check aria-hidden size={18} className="absolute bottom-3 right-3" />}
              </button>
            );
          })}
        </div>
      </Step>

      {mood && (
        <>
          <Step n="II" title="And the budget?">
            <Pills label="Budget" value={budget} onChange={(b) => { setBudget(b); setEdits({}); }} options={BUDGETS.map((b) => ({ value: b.value, label: b.label }))} />
          </Step>

          <Step n="III" title="When?">
            <Pills label="Time of day" value={timing} onChange={(t) => { setTiming(t); setSlots(null); }} options={[{ value: "evening", label: "An evening" }, { value: "daytime", label: "A daytime date" }]} />
            <div className="mt-3">
              {slots === null && <p className="italic">Looking at both your diaries…</p>}
              {slots && slots.length === 0 && <p className="italic">No shared time like that in the next two weeks. Try the other time of day.</p>}
              {slots && slots.length > 0 && (
                <div role="radiogroup" aria-label="Date and time" className="flex flex-wrap gap-2">
                  {slots.slice(0, 5).map((s) => (
                    <button key={s.start} role="radio" aria-checked={slot?.start === s.start} onClick={() => setSlot(s)}
                      className={cx("min-h-11 rounded-full px-4 text-[1.02rem] transition-colors", slot?.start === s.start ? "text-white" : "ring-1 ring-[rgb(58_45_39/0.25)]")}
                      style={slot?.start === s.start ? { background: SEPIA } : { background: PAPER }}>
                      {fmtDate(s.date)} · {s.startTime}
                    </button>
                  ))}
                </div>
              )}
              {hasChildren && (
                <label className="mt-4 flex items-start gap-3 text-[1.05rem]">
                  <input type="checkbox" checked={needsSitter} onChange={(e) => setNeedsSitter(e.target.checked)} className="mt-1.5 size-5" style={{ accentColor: SEPIA }} />
                  <span>We&apos;ll need someone for {app.children.map((c) => c.preferredName).join(" and ")}<span className="block text-[0.95rem] italic">It goes on the childcare list so you can ask a helper.</span></span>
                </label>
              )}
            </div>
          </Step>

          <Step n="IV" title="Your menu">
            <p className="-mt-1 mb-4 italic">Change any line, or ask for another.</p>
            {menu && (
              <MenuCard
                menu={menu}
                when={slot ? whenLine(slot) : undefined}
                from={app.me.displayName}
                onChange={(m) => setEdits(m)}
                onShuffle={(c) => { setTurns({ ...turns, [c]: (turns[c] ?? 0) + 1 }); setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== c))); }}
              />
            )}
            {mood === "out" && (
              <div className="mt-3 text-[1.02rem] italic">
                <BookingLinks activityKey={mainPlace ? placeKey(mainPlace.id) : null} category="food" setting="out-indoors" start={slot?.start} people={2} />
              </div>
            )}
          </Step>

          <div className="mt-8">
            <ErrorNote message={error?.message} />
            <button
              type="button"
              disabled={pending || !slot || !menu?.plat.trim()}
              onClick={send}
              className="relative isolate mt-2 flex min-h-14 w-full items-center justify-center overflow-hidden rounded-full px-6 text-[1.2rem] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
              style={{ background: PIGMENT.ultramarine }}
            >
              <Wash pigment="rose" seed={3} strength={1.4} className="absolute -left-10 -top-14 -z-10 size-40 opacity-70" />
              Send the invitation to {partner.displayName}
            </button>
            <p className="mt-2 text-center text-[0.98rem] italic">{partner.displayName} sees the menu on Today and can say yes or suggest another time.</p>
          </div>
        </>
      )}
    </Shell>
  );
}

/** The way in, on For Us: a small painted card. */
export function DateNightTeaser() {
  return (
    <Link href="/us/date-night" className="group relative isolate mt-6 block overflow-hidden rounded-[6px] px-5 py-5 font-menu transition-transform active:scale-[0.99]" style={{ background: PAPER, color: SEPIA, boxShadow: "inset 0 0 0 1px rgb(58 45 39 / .14), 0 10px 30px -18px rgb(58 45 39 / .5)" }}>
      <Wash pigment="rose" seed={41} className="absolute -right-12 -top-14 -z-10 size-52" />
      <Wash pigment="ochre" seed={9} strength={0.6} className="absolute -bottom-20 left-10 -z-10 size-44" />
      <div className="flex items-center gap-4">
        <Glasses className="h-14 shrink-0" />
        <div className="min-w-0">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.26em]">Your concierge</p>
          <p className="font-script text-[2.3rem] leading-none">Date night</p>
          <p className="mt-1 text-[1.08rem] italic leading-snug">Compose an evening like a three-course menu, and send it as an invitation.</p>
        </div>
      </div>
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate -mx-4 -mt-5 min-h-dvh overflow-hidden px-5 pb-16 pt-8 font-menu md:-mx-10 md:-mt-10 md:px-10" style={{ background: "#f6efe1", color: SEPIA, ["--dn-ink" as string]: SEPIA }}>
      <Wash pigment="rose" seed={41} className="absolute -right-24 -top-20 -z-10 size-80" />
      <Wash pigment="ochre" seed={9} strength={0.7} className="absolute -left-28 top-6 -z-10 size-64" />
      <Wash pigment="sap" seed={57} strength={0.5} className="absolute -right-28 top-[55%] -z-10 size-72" />
      <div className="mx-auto max-w-xl">
        <Link href="/us" className="text-[1.02rem] italic underline decoration-[rgb(58_45_39/0.3)] underline-offset-4">← For Us</Link>
        <p className="mt-6 text-[0.8rem] font-semibold uppercase tracking-[0.3em]">Your concierge</p>
        <h1 className="font-script text-[3.6rem] leading-[1.05]">Date night</h1>
        <p className="mt-1 text-[1.3rem] italic leading-snug">An evening for the two of you, composed like a menu and sent as an invitation.</p>
        <p className="mt-2 text-[1.02rem]">These suggestions are yours alone. Your partner&apos;s concierge never offers them the same courses, so what you send is from you.</p>
        {children}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rise mt-9">
      <h2 className="mb-3 flex items-baseline gap-3 text-[1.6rem] font-medium leading-tight">
        <span className="text-[1.35rem] italic" style={{ color: SIENNA_INK }} aria-hidden>{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Pills<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("min-h-11 rounded-full px-4 text-[1.05rem] transition-colors", value === o.value ? "text-white" : "ring-1 ring-[rgb(58_45_39/0.25)]")}
          style={value === o.value ? { background: SEPIA } : { background: PAPER }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
