"use client";

import { MapPin, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useApp } from "./app-context";
import { fmtDateTime } from "./format";
import { Button, Card, ErrorNote, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

export interface ScreenLink {
  id: string;
  childId: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

interface Found {
  name: string;
  admin1?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

/**
 * The household's town: for the forecast on plans and "near you" booking
 * searches. The lookup goes straight from this browser to Open-Meteo's
 * free place search; only the chosen name and rough position are saved.
 */
export function TownSettings({ placeName }: { placeName: string | null }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setNote(null);
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: query.trim(), count: "5", language: "en", format: "json" })}`);
      const data = (await res.json()) as { results?: Found[] };
      setFound(data.results ?? []);
    } catch {
      setNote("The town search isn't reachable just now. Try again in a minute.");
    } finally {
      setSearching(false);
    }
  }
  async function choose(f: Found) {
    const label = [f.name, f.admin1].filter(Boolean).join(", ");
    if (await run("SetHouseholdLocation", { placeName: label.slice(0, 80), latitude: f.latitude, longitude: f.longitude })) {
      setFound(null);
      setQuery("");
    }
  }

  return (
    <section id="town">
      <SectionTitle>Your town</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">For the forecast on outdoor plans, with an indoor swap when rain is likely, and for “find a table” links near home.</p>
        {placeName ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 font-medium"><MapPin aria-hidden size={16} className="text-brand" /> {placeName}</p>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("SetHouseholdLocation", { placeName: null, latitude: null, longitude: null })}>Remove</Button>
          </div>
        ) : (
          <p className="text-sm text-ink-3">Not set. Weather swaps and local links are off.</p>
        )}
        <form className="flex gap-2" onSubmit={search}>
          <label htmlFor="town-q" className="sr-only">Town or village</label>
          <input id="town-q" className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeName ? "Change town" : "Town or village, e.g. Guildford"} maxLength={80} />
          <Button type="submit" disabled={searching || query.trim().length < 2}>{searching ? "Looking…" : "Find"}</Button>
        </form>
        {found && (found.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {found.map((f) => (
              <li key={`${f.latitude},${f.longitude}`}>
                <button type="button" disabled={pending} onClick={() => choose(f)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-surface-2">
                  <span>{f.name}{f.admin1 ? `, ${f.admin1}` : ""}</span>
                  <span className="text-xs text-ink-3">{f.country_code}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-3">No town by that name. Try a nearby one.</p>)}
        <ErrorNote message={error?.message ?? note} />
      </Card>
    </section>
  );
}

/**
 * Screens for the family: a kitchen display and each child's own view. A
 * link opens without an account and shows family logistics only, so it can
 * live on an old tablet or a child's device. Shown once; switch off anytime.
 */
export function FamilyScreens({ links }: { links: ScreenLink[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [fresh, setFresh] = useState<{ url: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const labelOf = (childId: string | null) => (childId ? `${app.childName(childId)}'s screen` : "Kitchen display");

  async function create(childId: string | null) {
    const r = await run<{ token: string }>("CreateDisplayLink", { childId });
    if (r) {
      setFresh({ url: `${window.location.origin}/display/${r.token}`, label: labelOf(childId) });
      setCopied(false);
    }
  }

  return (
    <section id="screens">
      <SectionTitle>Family screens</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          A week view for a tablet in the kitchen, and a simple screen for each child with what&apos;s on for them and when it&apos;s their turn to choose. They show family plans, the children&apos;s activities, who&apos;s looking after them and who&apos;s away. Never your own plans, the two of you, notes or money.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={pending} onClick={() => create(null)}><MonitorSmartphone aria-hidden size={15} /> Kitchen display</Button>
          {app.children.map((c) => <Button key={c.id} size="sm" disabled={pending} onClick={() => create(c.id)}>{c.preferredName}&apos;s screen</Button>)}
        </div>
        {fresh && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
            <label className="text-sm font-medium" htmlFor="screen-url">{fresh.label}: open this on that device</label>
            <input id="screen-url" readOnly className={inputClass} value={fresh.url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(fresh.url).catch(() => {}); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
              <a href={fresh.url} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm">Open</a>
            </div>
            <p className="text-xs text-ink-3">Anyone with the link can see this screen, so open it on the device and keep it there. More keeps no copy; make a new one if it&apos;s lost.</p>
          </div>
        )}
        {links.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-medium">{labelOf(l.childId)}</span>
                  <span className="block text-xs text-ink-3">{l.lastSeenAt ? `Last open ${fmtDateTime(Date.parse(l.lastSeenAt), app.timeZone)}` : "Not opened yet"}</span>
                </span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("RevokeDisplayLink", { linkId: l.id })}>Switch off</Button>
              </li>
            ))}
          </ul>
        )}
        <ErrorNote message={error?.message} />
      </Card>
    </section>
  );
}
