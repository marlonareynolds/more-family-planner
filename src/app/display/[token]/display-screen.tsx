"use client";

import { Backpack, Heart, Luggage, Plane, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtDate, localParts } from "@/components/format";
import { WeatherGlyph, weatherText } from "@/components/weather";
import { cx } from "@/components/ui";
import type { DisplayItem, DisplayView } from "@/server/queries/display";

const REFRESH_MS = 5 * 60_000;

const KIND: Record<DisplayItem["kind"], { icon: typeof Heart; tone: string }> = {
  family: { icon: Users, tone: "bg-family-soft text-family" },
  activity: { icon: Backpack, tone: "bg-brand-soft text-brand" },
  care: { icon: Heart, tone: "bg-care-soft text-care" },
  away: { icon: Plane, tone: "bg-surface-2 text-ink-2" },
  trip: { icon: Luggage, tone: "bg-family-soft text-family" },
};

function dayName(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return fmtDate(date, { month: "short" });
}

/** A clock that keeps itself right and refreshes the page every few minutes. */
function useClock(timeZone: string) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);
  return localParts(now, timeZone);
}

export function DisplayScreen({ token, view }: { token: string; view: DisplayView }) {
  const clock = useClock(view.timeZone);
  const child = view.mode === "child";
  return (
    <main className={cx("mx-auto min-h-dvh px-4 py-5 sm:px-8 sm:py-8", child ? "max-w-2xl" : "max-w-[1600px]")}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-2">
        <div>
          <p className="label-caps text-ink-3">{child ? `${view.child!.name}'s days` : view.householdName}</p>
          <h1 suppressHydrationWarning className="font-display text-[2.6rem] leading-none sm:text-[3.4rem]">{fmtDate(clock.date, { month: "long" })}</h1>
        </div>
        <div className="text-right">
          <p suppressHydrationWarning className="font-display text-[2.6rem] leading-none tabular-nums sm:text-[3.4rem]">{clock.time}</p>
          {view.days[0]?.weather && (
            <p className="mt-1 flex items-center justify-end gap-1.5 text-ink-2"><WeatherGlyph w={view.days[0].weather} size={18} /> {weatherText(view.days[0].weather)}</p>
          )}
        </div>
      </header>

      <section aria-label="Coming up" className="mt-4 flex flex-wrap gap-3">
        {view.countdown && (
          <p className="rounded-2xl bg-family-soft px-4 py-3 text-family">
            <span className="font-display text-3xl italic">{view.countdown.sleeps}</span> {view.countdown.sleeps === 1 ? "sleep" : "sleeps"} until {view.countdown.title}
          </p>
        )}
        {view.turn && (!child || view.turn.childId === view.child?.id) && (
          <p className="flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-brand">
            <Sparkles aria-hidden size={18} /> {child ? "It's your turn to choose a family plan!" : `${view.turn.name}'s turn to choose`}
          </p>
        )}
      </section>

      {child && <ChildChoice token={token} view={view} />}

      <div className={cx("mt-5 grid gap-4", child ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7")}>
        {view.days.map((d) => (
          <section key={d.date} aria-labelledby={`day-${d.date}`} className={cx("flex flex-col rounded-2xl border bg-surface p-3", d.date === view.today ? "border-brand shadow-lift" : "border-line")}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id={`day-${d.date}`} className={cx("font-display text-xl", d.date === view.today && "text-brand")}>{dayName(d.date, view.today)}</h2>
              {d.weather && <span className="flex items-center gap-1 text-sm text-ink-3" title={weatherText(d.weather)}><WeatherGlyph w={d.weather} size={16} /> {d.weather.high}°</span>}
            </div>
            {d.marker && <p className="mt-1 w-fit rounded-full bg-family-soft px-2 py-0.5 text-xs text-family">{d.marker}</p>}
            {d.items.length === 0 ? (
              <p className="mt-3 text-ink-3 italic">Nothing planned</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {d.items.map((i) => {
                  const k = KIND[i.kind];
                  return (
                    <li key={i.key} className="flex items-start gap-2">
                      <span className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", k.tone)}><k.icon aria-hidden size={15} /></span>
                      <span className="min-w-0">
                        <span className="block text-[17px] font-medium leading-snug">{i.title}</span>
                        <span className="block text-sm text-ink-3">
                          {i.time ? `${i.time}${i.endTime ? `–${i.endTime}` : ""}` : i.endTime ? `until ${i.endTime}` : "All day"}
                          {!child && i.children.length > 0 && i.kind !== "care" ? ` · ${i.children.join(", ")}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-ink-3">Grown-ups&apos; own plans aren&apos;t shown here. This screen updates itself.</p>
    </main>
  );
}

/** When it's this child's turn: three ideas, one tap, and the grown-ups hear about it. */
function ChildChoice({ token, view }: { token: string; view: DisplayView }) {
  const router = useRouter();
  const [wish, setWish] = useState(view.wish);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pick(key: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/display/${encodeURIComponent(token)}/wish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityKey: key }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error?.message ?? "That didn't work. Try again in a minute.");
      else {
        setWish(data.wish);
        router.refresh();
      }
    } catch {
      setError("The screen seems to be offline.");
    } finally {
      setBusy(false);
    }
  }
  if (wish) {
    return <p className="mt-4 rounded-2xl bg-good/10 px-4 py-3 text-[17px]">You picked <strong>{wish}</strong>. The grown-ups will find a time for it.</p>;
  }
  if (!view.choices.length) return null;
  return (
    <section aria-label="Choose a family plan" className="mt-4">
      <h2 className="font-display text-2xl">What shall we do?</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-3">
        {view.choices.map((c) => (
          <li key={c.key}>
            <button type="button" disabled={busy} onClick={() => pick(c.key)} className="flex h-full w-full flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-4 text-left shadow-soft transition-transform active:scale-[0.98] disabled:opacity-60">
              <span className="text-[17px] font-semibold">{c.title}</span>
              <span className="text-sm text-ink-2">{c.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
