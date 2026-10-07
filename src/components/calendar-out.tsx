"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { fmtDateTime } from "./format";
import { Button, Card, ErrorNote, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

export interface CalendarOutState {
  createdAt: string;
  lastFetchedAt: string | null;
}

/**
 * "Plans in your own calendar": a private subscription link. The link is
 * shown once, because only its hash is kept; a new one replaces it.
 */
export function CalendarOutSettings({ state }: { state: CalendarOutState | null }) {
  const app = useApp();
  const { run, pending, error } = useCommand();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    const r = await run<{ token: string }>("CreateCalendarLink", {}, { refresh: false });
    if (r) {
      setUrl(`${window.location.origin}/api/v1/calendar/${r.token}.ics`);
      setCopied(false);
    }
  }
  const webcal = url?.replace(/^https?:/, "webcal:");

  return (
    <section id="calendar-out">
      <SectionTitle>Plans in your own calendar</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          Add More to Google, Apple or Outlook calendar, so agreed plans and your turns with the children show up next to everything else.
          {app.partner ? ` ${app.partner.displayName}'s time for themselves shows only as busy, and surprises stay surprises.` : ""}
        </p>
        {url ? (
          <>
            <label className="text-sm font-medium" htmlFor="cal-out-url">Your private link</label>
            <input id="cal-out-url" readOnly className={inputClass} value={url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={async () => { await navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
              <a className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`} target="_blank" rel="noreferrer">Google Calendar</a>
              <a className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm" href={webcal}>Apple Calendar</a>
              <a className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm" href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=More`} target="_blank" rel="noreferrer">Outlook</a>
            </div>
            <p className="text-xs text-ink-3">Anyone with this link can see your plans, so keep it to yourself. More doesn&apos;t keep a copy: if you lose it, make a new one. Calendar apps check for changes every few hours.</p>
          </>
        ) : state ? (
          <>
            <p className="text-sm">
              Linked {fmtDateTime(Date.parse(state.createdAt), app.timeZone)}.{" "}
              {state.lastFetchedAt ? `Your calendar last checked ${fmtDateTime(Date.parse(state.lastFetchedAt), app.timeZone)}.` : "Your calendar hasn't checked it yet."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={create}>Make a new link</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("RemoveCalendarLink", {})}>Turn off</Button>
            </div>
            <p className="text-xs text-ink-3">A new link stops the old one working straight away.</p>
          </>
        ) : (
          <div><Button size="sm" variant="primary" disabled={pending} onClick={create}>Get my calendar link</Button></div>
        )}
        <ErrorNote message={error?.message} />
      </Card>
    </section>
  );
}
