"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { fmtDateTime } from "./format";
import { Badge, Button, Card, Checkbox, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
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
  reconnect: "More's access has ended. Connect it again to keep it in step.",
  write_failed: "Your plans couldn't be added to it as busy. More will try again.",
};

/** The landing note after coming back from Google or Microsoft. */
const RESULTS: Record<string, string> = {
  connected: "Connected. Its events now count as your busy time, and your More plans will show in it as “Busy”.",
  cancelled: "Nothing was connected.",
  expired: "That took a little long. Please try connecting again.",
  too_many: "You can connect up to 5 calendars.",
  unavailable: "That kind of calendar isn't set up yet.",
  failed: "Connecting didn't work. Please try again.",
};

const PROVIDER_NAME = { google: "Google Calendar", microsoft: "Outlook" } as const;

export interface CalendarConnect {
  /** Sign-in options that are set up on this server. */
  providers: ("google" | "microsoft")[];
  result: string | null;
}

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

async function disconnect(feedId: string, version: number, timeZone: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/v1/calendar-feeds/${feedId}/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return data?.error?.message ?? "Couldn't disconnect just now.";
    if (data?.cleared !== false) return null;
    const left: { start: number; end: number }[] = data?.cleanup?.left ?? [];
    if (!left.length) return "Disconnected, but More couldn't check that calendar. Any “Busy” blocks it added may still be there; you can delete them there.";
    const when = left.slice(0, 6).map((b) => fmtDateTime(b.start, timeZone)).join("; ");
    return `Disconnected. ${left.length} “Busy” ${left.length === 1 ? "block" : "blocks"} couldn't be removed and may still be in that calendar: ${when}${left.length > 6 ? " and more" : ""}. Delete them there.`;
  } catch {
    return "You seem to be offline.";
  }
}

/**
 * Connected calendars (spec 8.11): imported as the owner's busy time. A
 * signed-in Google or Outlook account can also receive More's plans as
 * plain "Busy" blocks, so work never books over family time.
 */
export function CalendarSettings({ calendars, connect }: { calendars: CalendarView[]; connect: CalendarConnect }) {
  const app = useApp();
  const router = useRouter();
  const { run, pending, error } = useCommand(app.householdId);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("busy_only");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(connect.result ? (RESULTS[connect.result] ?? null) : null);
  const mine = calendars.filter((c) => c.mine);
  const theirs = calendars.filter((c) => !c.mine);

  const drop = async (c: CalendarView) => {
    if (c.provider === "ics") return run("RemoveCalendarFeed", { feedId: c.id, version: c.version });
    setBusyId(c.id);
    setNote(await disconnect(c.id, c.version, app.timeZone));
    setBusyId(null);
    router.refresh();
  };

  const refresh = async (id: string) => {
    setBusyId(id);
    const r = await syncNow(id);
    setBusyId(null);
    setNote(r.ok ? null : (r.message ?? ERRORS[r.error ?? ""] ?? "Couldn't update just now."));
    router.refresh();
  };

  return (
    <section id="calendars">
      <SectionTitle action={!adding && <Button size="sm" onClick={() => setAdding(true)}>+ Add a calendar link</Button>}>Calendars</SectionTitle>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Connect your work or personal calendar so its events count as your busy time. More never changes your own events.
          {connect.providers.length > 0 && " Sign in with Google or Outlook and More can also mark its plans there as “Busy”, with no details, so nobody books over them."}
        </p>
        {connect.providers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {connect.providers.map((p) => (
              <a key={p} href={`/api/v1/calendars/connect/${p}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-[15px] font-medium text-ink hover:bg-surface-2">
                Connect {PROVIDER_NAME[p]}
              </a>
            ))}
          </div>
        )}
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
              <Button size="sm" variant="ghost" disabled={pending || busyId === c.id} onClick={() => drop(c)}>Disconnect</Button>
            </div>
            {c.provider !== "ics" && (
              <Checkbox
                checked={c.writeBusy}
                onChange={(v) => run("UpdateCalendarFeed", { feedId: c.id, version: c.version, label: c.label, visibility: c.visibility, writeBusy: v })}
                label="Show my More plans here as “Busy”"
                hint="Agreed plans, children you're looking after and time away, for the next three months. Only the word “Busy”, set to private."
              />
            )}
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
