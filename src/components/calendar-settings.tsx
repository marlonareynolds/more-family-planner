"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { fmtDateTime } from "./format";
import { Badge, Button, Card, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

type Visibility = CalendarView["visibility"];

const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: "busy_only", label: "Partner sees “Busy”" },
  { value: "private", label: "Hidden from partner" },
  { value: "shared", label: "Partner sees the details" },
];

const ERRORS: Record<string, string> = {
  unreachable: "The link couldn't be reached.",
  http_error: "The calendar service refused the link. It may have been reset.",
  not_calendar: "The link didn't return a calendar.",
  too_large: "The calendar is too large to import.",
  blocked_address: "That address can't be used.",
};

async function syncNow(feedId: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const res = await fetch(`/api/v1/calendar-feeds/${feedId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: data?.error?.message ?? "Couldn't update just now." };
    return data;
  } catch {
    return { ok: false, message: "You seem to be offline." };
  }
}

/** Read-only calendar links (spec 8.11): imported as the owner's busy time. */
export function CalendarSettings({ calendars }: { calendars: CalendarView[] }) {
  const app = useApp();
  const router = useRouter();
  const { run, pending, error } = useCommand(app.householdId);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("busy_only");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mine = calendars.filter((c) => c.mine);
  const theirs = calendars.filter((c) => !c.mine);

  const refresh = async (id: string) => {
    setBusyId(id);
    const r = await syncNow(id);
    setBusyId(null);
    setNote(r.ok ? null : (r.message ?? ERRORS[r.error ?? ""] ?? "Couldn't update just now."));
    router.refresh();
  };

  return (
    <section id="calendars">
      <SectionTitle action={!adding && <Button size="sm" onClick={() => setAdding(true)}>+ Connect a calendar</Button>}>Calendars</SectionTitle>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Connect your work or personal calendar so its events count as your busy time. More only reads it, refreshes it a few times a day and never changes the original.
        </p>
        {mine.length === 0 && !adding && <p className="text-sm text-ink-3">No calendars connected yet.</p>}
        {mine.map((c) => (
          <div key={c.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{c.label}</p>
              {c.lastError ? <Badge tone="bad">Not updating</Badge> : c.stale ? <Badge tone="warn">Out of date</Badge> : <Badge tone="good">Up to date</Badge>}
            </div>
            <p className="text-sm text-ink-3">
              {c.lastSuccessAt ? `Updated ${fmtDateTime(Date.parse(c.lastSuccessAt), app.timeZone)} · ${c.eventCount} item${c.eventCount === 1 ? "" : "s"} in the next six months` : "Not read yet."}
              {c.lastError && ` ${ERRORS[c.lastError] ?? "The last update failed."}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`vis-${c.id}`}>What your partner sees from {c.label}</label>
              <select id={`vis-${c.id}`} className={`${inputClass} w-auto`} value={c.visibility} disabled={pending}
                onChange={(e) => run("UpdateCalendarFeed", { feedId: c.id, version: c.version, label: c.label, visibility: e.target.value })}>
                {VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
              <Button size="sm" disabled={busyId === c.id} onClick={() => refresh(c.id)}>{busyId === c.id ? "Updating…" : "Update now"}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("RemoveCalendarFeed", { feedId: c.id, version: c.version })}>Disconnect</Button>
            </div>
          </div>
        ))}
        {theirs.length > 0 && (
          <p className="border-t border-line pt-3 text-sm text-ink-2">
            {app.partner?.displayName ?? "Your partner"} has {theirs.length} connected calendar{theirs.length === 1 ? "" : "s"}
            {theirs.some((c) => c.stale) ? ", not all up to date, so their free time may be wrong." : ", up to date."}
          </p>
        )}
        {adding && (
          <form
            className="flex flex-col gap-3 border-t border-line pt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run<{ feedId: string }>("AddCalendarFeed", { label, url, visibility }, { refresh: false });
              if (!r) return;
              setAdding(false);
              setLabel("");
              setUrl("");
              await refresh(r.feedId);
            }}
          >
            <Field label="Name" hint="Only you see this, e.g. Work">{(id, d) => <input id={id} aria-describedby={d} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required />}</Field>
            <Field label="Calendar link (iCal)" hint="Treat it like a password: anyone with it can read the calendar. It's never shown to your partner.">
              {(id, d) => <input id={id} aria-describedby={d} className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or webcal://…" autoComplete="off" spellCheck={false} required />}
            </Field>
            <Field label="What your partner sees">
              {(id) => (
                <select id={id} className={inputClass} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                  {VISIBILITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              )}
            </Field>
            <details className="text-sm text-ink-2">
              <summary className="cursor-pointer text-brand">Where do I find the link?</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Google Calendar (on a computer): Settings → your calendar → Integrate calendar → “Secret address in iCal format”.</li>
                <li>Outlook: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.</li>
                <li>Apple iCloud: Calendar app → share the calendar → Public Calendar → copy the link.</li>
              </ul>
            </details>
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={pending}>Connect</Button>
              <Button type="button" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <ErrorNote message={error?.message ?? note} />
      </Card>
    </section>
  );
}
