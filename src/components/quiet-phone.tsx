"use client";

import { BellOff } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useApp, useNow } from "./app-context";
import { localParts } from "./format";
import { Card } from "./ui";

/** The name the iPhone shortcut is saved under; the button runs it by name. */
export const SHORTCUT_NAME = "More quiet time";

function isApplePhone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const noSubscribe = () => () => {};

/** Runs the saved shortcut with the end time as its input: "2026-10-10 11:00". */
export function shortcutUrl(endMs: number, timeZone: string): string {
  const { date, time } = localParts(endMs, timeZone);
  return `shortcuts://run-shortcut?${new URLSearchParams({ name: SHORTCUT_NAME, input: "text", text: `${date} ${time}` })}`.replaceAll("+", "%20");
}

/**
 * When your own time is on, or about to start: one tap to quiet the phone
 * until it ends. On an iPhone it runs the shortcut set up once from Me; on
 * other phones it says how, since the web can't switch Do Not Disturb itself.
 */
export function QuietNow({ moments }: { moments: { id: string; start: number; end: number }[] }) {
  const app = useApp();
  const now = useNow();
  // False on the server, the real answer once in the browser.
  const apple = useSyncExternalStore(noSubscribe, isApplePhone, () => false);
  const m = moments.filter((x) => x.start - 15 * 60_000 <= now && x.end > now).sort((a, b) => a.start - b.start)[0];
  if (!m) return null;
  const until = localParts(m.end, app.timeZone).time;
  return (
    <Card tone="me" className="rise mt-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{m.start <= now ? "Your time is on" : `Your time starts at ${localParts(m.start, app.timeZone).time}`}, until {until}.</p>
        <p className="text-sm text-ink-2">{apple ? "Quiet your phone so it stays yours." : "Turn on Do Not Disturb until then, from your phone's quick settings."}</p>
      </div>
      {apple && (
        <a href={shortcutUrl(m.end, app.timeZone)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-me px-4 text-sm font-semibold text-white">
          <BellOff aria-hidden size={16} /> Quiet my phone
        </a>
      )}
    </Card>
  );
}

/** The one-off setup, on Me. */
export function QuietPhoneSetup() {
  return (
    <details className="mt-8 rounded-2xl border border-line p-4">
      <summary className="cursor-pointer font-display text-xl">Quiet your phone during your time</summary>
      <div className="mt-3 flex flex-col gap-3 text-[15px] text-ink-2">
        <p>When your time is on, Today shows a <strong>Quiet my phone</strong> button. It turns on Do Not Disturb until your time ends, and switches off by itself. It needs a one-off shortcut on an iPhone:</p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>Open the <strong>Shortcuts</strong> app and tap <strong>+</strong>.</li>
          <li>Add the action <strong>Get Dates from Input</strong>.</li>
          <li>Add <strong>Set Focus</strong>: Turn <strong>Do Not Disturb</strong> On, Until <strong>Time</strong>, and pick <strong>Dates</strong> as the time.</li>
          <li>Name the shortcut <strong>{SHORTCUT_NAME}</strong> exactly, and tap Done.</li>
        </ol>
        <p>On Android, the button isn&apos;t needed: swipe down, long-press <strong>Do Not Disturb</strong> and choose “Until” the time your plan ends.</p>
        <p className="text-sm text-ink-3">More never sees or changes your phone&apos;s settings. The shortcut lives on your phone.</p>
      </div>
    </details>
  );
}

/** The dot on the home-screen icon: how many updates are new. Supported on installed apps only. */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) nav.setAppBadge?.(count).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [count]);
  return null;
}
