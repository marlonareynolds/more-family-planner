"use client";

import { useEffect, useState } from "react";
import type { SuggestedTime } from "@/domain/free-time";
import type { FreeTimes } from "@/server/queries/free-time";
import { useApp } from "./app-context";
import { fmtDate, todayIn } from "./format";
import { MomentEditor, type MomentKind } from "./moment-editor";
import { Card, SectionTitle, Segmented, cx } from "./ui";

const LENGTHS = [
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "Half day" },
];
const DEFAULT: Record<MomentKind, string> = { me: "60", us: "120", family: "180" };

/**
 * "When could we?" Free times for everyone this plan needs over the next two
 * weeks, from the diary, connected calendars, agreed plans and care.
 */
export function FindATime({ kind }: { kind: MomentKind }) {
  const app = useApp();
  const [minutes, setMinutes] = useState(DEFAULT[kind]);
  const [data, setData] = useState<FreeTimes | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<SuggestedTime | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/v1/free-times?kind=${kind}&minutes=${minutes}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: FreeTimes) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [kind, minutes]);

  const careText = (s: SuggestedTime) =>
    s.care === "partner_free" ? `${app.partner?.displayName ?? "Your partner"} is free for the children`
    : s.care === "needs_care" ? "The children will need looking after"
    : s.care === "with_family" ? "Everyone's free"
    : kind === "us" ? "You're both free" : "You're free";
  const who = kind === "me" ? "you're" : kind === "us" ? "you're both" : "everyone's";

  return (
    <section aria-labelledby={`find-${kind}`}>
      <SectionTitle>
        <span id={`find-${kind}`}>When {who} free</span>
      </SectionTitle>
      <Card className="flex flex-col gap-3">
        <Segmented label="How long" value={minutes} onChange={setMinutes} options={LENGTHS} />
        {data?.lighterWeek && minutes !== "60" && (
          <p className="text-sm text-ink-2">
            You said this week is heavy. <button className="text-brand underline" onClick={() => setMinutes("60")}>Show shorter times</button>
          </p>
        )}
        {failed && <p className="text-sm text-bad">Free times couldn&apos;t be worked out just now.</p>}
        {!data && !failed && <p className="text-sm text-ink-3">Looking at the next two weeks…</p>}
        {data && data.slots.length === 0 && <p className="text-sm text-ink-2">No shared free time of that length in the next two weeks. Try a shorter time.</p>}
        {data && data.slots.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.slots.map((s) => (
              <li key={s.start}>
                <button onClick={() => setPicked(s)} className={cx("w-full rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2")}>
                  <span className="block font-medium">{fmtDate(s.date)} · {s.startTime}–{s.endTime}</span>
                  <span className={cx("block text-sm", s.care === "needs_care" ? "text-warn" : "text-ink-3")}>{careText(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && data.uncertainFor.length > 0 && (
          <p className="text-xs text-warn">{data.uncertainFor.join(" and ")} {data.uncertainFor.length === 1 && data.uncertainFor[0] !== "You" ? "has" : "have"} a calendar that isn&apos;t up to date, so check before agreeing.</p>
        )}
        <p className="text-xs text-ink-3">From the diary, connected calendars, agreed plans and childcare. School times count only if they&apos;re in the diary.</p>
      </Card>
      {picked && (
        <MomentEditor
          open
          onClose={() => setPicked(null)}
          defaultDate={todayIn(app.timeZone)}
          template={{ kind, title: "", durationMinutes: Number(minutes), slot: { date: picked.date, startTime: picked.startTime, endTime: picked.endTime, endDate: picked.endTime < picked.startTime ? addDay(picked.date) : picked.date } }}
        />
      )}
    </section>
  );
}

function addDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
