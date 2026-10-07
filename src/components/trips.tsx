"use client";

import { Plane } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { TripView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { addDaysStr, fmtDate, localParts, todayIn } from "./format";
import { PeoplePicker } from "./people-picker";
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, SectionTitle, Segmented, inputClass } from "./ui";
import { useCommand } from "./use-command";

type Kind = TripView["kind"];
const KINDS: { value: Kind; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "family", label: "Family holiday" },
];

/** Who's away and who's left at home, in plain words. */
export function useTripWords() {
  const app = useApp();
  const name = (id: string) => (id === app.me.id ? "You" : app.nameOf(id));
  const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  return {
    who: (t: TripView) => list(t.travellerIds.map(name)),
    home: (t: TripView) => {
      const kids = app.children.filter((c) => !t.childIds.includes(c.id));
      if (!kids.length) return null;
      const stayers = app.adults.filter((a) => !t.travellerIds.includes(a.id));
      const names = list(kids.map((c) => c.preferredName));
      return stayers.length ? `${list(stayers.map((a) => name(a.id)))} at home with ${names}` : `Nobody at home for ${names}: they need care`;
    },
    when: (t: TripView) => {
      const s = localParts(t.start, app.timeZone);
      const e = localParts(t.end, app.timeZone);
      return s.date === e.date ? `${fmtDate(s.date)}, ${s.time} to ${e.time}` : `${fmtDate(s.date)} ${s.time} to ${fmtDate(e.date)} ${e.time}`;
    },
  };
}

/**
 * Time away (blueprint, Our Week): one entry for a work trip or a family
 * holiday, instead of a care request for every pickup it affects.
 */
export function TripsSection({ trips }: { trips: TripView[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const words = useTripWords();
  const [editing, setEditing] = useState<TripView | "new" | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  return (
    <section>
      <SectionTitle action={<Button size="sm" onClick={() => setEditing("new")}>+ Time away</Button>}>Trips and time away</SectionTitle>
      <ErrorNote message={error?.message} />
      {trips.length === 0 ? (
        <EmptyState icon={<Plane />} title="Nobody's away.">
          Add a work trip or a holiday once. More shows who&apos;s away, works out when the children need someone, and keeps everyone&apos;s free time right.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {trips.map((t) => {
            const home = words.home(t);
            return (
              <li key={t.id}>
                <Card tone={t.kind === "family" ? "family" : undefined} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{t.title}{t.destination && <span className="font-normal text-ink-3"> · {t.destination}</span>}</h3>
                      <p className="text-sm text-ink-2">{words.who(t)} · {words.when(t)}</p>
                      {home && <p className={`text-sm ${home.startsWith("Nobody") ? "text-warn" : "text-ink-3"}`}>{home}</p>}
                    </div>
                    <Badge>{KINDS.find((k) => k.value === t.kind)?.label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-sm" href={`/holidays?date=${localParts(t.start, app.timeZone).date}`}>See care that week</Link>
                    <Button size="sm" onClick={() => setEditing(t)}>Edit</Button>
                    {cancelling === t.id ? (
                      <span className="flex items-center gap-2 text-sm">
                        Cancel this trip?
                        <Button size="sm" variant="danger" disabled={pending} onClick={async () => (await run("CancelTrip", { tripId: t.id, version: t.version })) && setCancelling(null)}>Cancel trip</Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(null)}>Keep</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(t.id)}>Cancel…</Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <TripDialog trip={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function TripDialog({ trip, onClose }: { trip: TripView | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const words = useTripWords();
  const start = trip ? localParts(trip.start, app.timeZone) : { date: addDaysStr(todayIn(app.timeZone), 7), time: "08:00" };
  const end = trip ? localParts(trip.end, app.timeZone) : { date: addDaysStr(todayIn(app.timeZone), 9), time: "20:00" };
  const [kind, setKind] = useState<Kind>(trip?.kind ?? "work");
  const [title, setTitle] = useState(trip?.title ?? "");
  const [destination, setDestination] = useState(trip?.destination ?? "");
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endDate, setEndDate] = useState(end.date);
  const [endTime, setEndTime] = useState(end.time);
  const [people, setPeople] = useState({ adultIds: trip?.travellerIds ?? [app.me.id], childIds: trip?.childIds ?? [] });

  function chooseKind(k: Kind) {
    setKind(k);
    // A family holiday usually means everyone; a work trip just you.
    if (k === "family" && !trip) setPeople({ adultIds: app.adults.map((a) => a.id), childIds: app.children.map((c) => c.id) });
    if (k !== "family" && !trip) setPeople({ adultIds: [app.me.id], childIds: [] });
  }

  async function save() {
    const fields = { kind, title, destination, startDate, startTime, endDate, endTime, travellerIds: people.adultIds, childIds: people.childIds };
    const ok = trip ? await run("UpdateTrip", { ...fields, tripId: trip.id, version: trip.version }) : await run("AddTrip", fields);
    if (ok) onClose();
  }

  const preview = words.home({ id: "", kind, title, destination, start: 0, end: 0, travellerIds: people.adultIds, childIds: people.childIds, organiserId: app.me.id, version: 0 });
  return (
    <Dialog
      open
      onClose={onClose}
      title={trip ? "Edit time away" : "Time away"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim() || !people.adultIds.length} onClick={save}>Save</Button></>}
    >
      <div className="flex flex-col gap-3">
        <Segmented label="What kind of trip" value={kind} options={KINDS} onChange={chooseKind} />
        <Field label="What">{(id) => <input id={id} className={inputClass} maxLength={80} value={title} placeholder={kind === "work" ? "Conference" : kind === "family" ? "Cornwall" : "Weekend away"} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Where (optional)">{(id) => <input id={id} className={inputClass} maxLength={80} value={destination} onChange={(e) => setDestination(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leaving">{(id) => <input id={id} type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="At">{(id) => <input id={id} type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />}</Field>
          <Field label="Back">{(id) => <input id={id} type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>
          <Field label="At">{(id) => <input id={id} type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />}</Field>
        </div>
        <PeoplePicker adultIds={people.adultIds} childIds={people.childIds} onChange={setPeople} label="Who's going" />
        {preview && <p className="text-sm text-ink-2">{preview}. {preview.startsWith("Nobody") ? "More adds care needs for the whole time." : "More flags anything in their diary while you're away."}</p>}
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}
