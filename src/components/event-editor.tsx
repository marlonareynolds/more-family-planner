"use client";

import { useState } from "react";
import type { WeekEvent } from "@/server/queries/week";
import { useApp } from "./app-context";
import { PeoplePicker } from "./people-picker";
import { SpanFields, defaultSpan, spanFrom, spanPayload, type SpanValue } from "./span-fields";
import { Button, Dialog, ErrorNote, Field, Segmented, inputClass } from "./ui";
import { useCommand } from "./use-command";

type Freq = "none" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const DAY_LABEL: Record<(typeof DAYS)[number], string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

interface Rule {
  freq: Exclude<Freq, "none">;
  byDay?: (typeof DAYS)[number][];
  count?: number;
}

/**
 * The one event editor (spec 8.4). Repeating events ask whether a change
 * applies to this date, this and future dates, or the whole series.
 */
export function EventEditor({ open, onClose, event, defaultDate, important }: { open: boolean; onClose: () => void; event?: WeekEvent | null; defaultDate: string; important?: boolean }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const editing = !!event;
  const rule = (event?.rule ?? null) as Rule | null;

  const [title, setTitle] = useState(event?.title ?? "");
  const [span, setSpan] = useState<SpanValue>(
    event ? spanFrom(event.start, event.end, app.timeZone, event.allDay) : { ...defaultSpan(defaultDate, "09:00", "10:00"), allDay: !!important },
  );
  const [people, setPeople] = useState({ adultIds: event?.adultIds ?? [app.me.id], childIds: event?.childIds ?? [] });
  const [visibility, setVisibility] = useState<WeekEvent["visibility"]>(event?.visibility ?? "shared");
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [travelBefore, setTravelBefore] = useState(String(event?.travelBeforeMinutes ?? 0));
  const [travelAfter, setTravelAfter] = useState(String(event?.travelAfterMinutes ?? 0));
  const [freq, setFreq] = useState<Freq>(rule?.freq ?? (important ? "YEARLY" : "none"));
  const [byDay, setByDay] = useState<(typeof DAYS)[number][]>(rule?.byDay ?? []);
  const [count, setCount] = useState(rule?.count ? String(rule.count) : "");
  const [scope, setScope] = useState<"occurrence" | "future" | "series">(event?.recurring ? "occurrence" : "series");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fields = () => ({
    title,
    notes,
    location,
    visibility,
    span: spanPayload(span),
    adultIds: people.adultIds,
    childIds: people.childIds,
    travelBeforeMinutes: Number(travelBefore) || 0,
    travelAfterMinutes: Number(travelAfter) || 0,
    rule: freq === "none" ? null : { freq, ...(freq === "WEEKLY" && byDay.length ? { byDay } : {}), ...(count ? { count: Number(count) } : {}) },
  });

  async function save() {
    const ok = editing
      ? await run("UpdateEvent", { eventId: event!.id, version: event!.version, scope: event!.recurring ? scope : "series", recurrenceId: event!.recurrenceId ?? undefined, fields: fields() }, { expected: { membershipRevision: app.membershipRevision } })
      : await run("AddEvent", fields(), { expected: { membershipRevision: app.membershipRevision } });
    if (ok) onClose();
  }

  async function remove() {
    const ok = await run("DeleteEvent", { eventId: event!.id, version: event!.version, scope: event!.recurring ? scope : "series", recurrenceId: event!.recurrenceId ?? undefined });
    if (ok) onClose();
  }

  const scopePicker = event?.recurring && (
    <fieldset className="rounded-xl bg-surface-2 p-3">
      <legend className="text-sm font-medium text-ink-2">This repeats. Apply changes to</legend>
      <div className="mt-2 flex flex-col gap-2 text-[15px]">
        {(
          [
            ["occurrence", "Only this date"],
            ["future", "This and future dates"],
            ["series", "Every date"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit event" : important ? "Add an important date" : "Add to the diary"}
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm text-ink-2">Delete {event?.recurring ? (scope === "occurrence" ? "this date" : scope === "future" ? "this and future dates" : "every date") : "this event"}?</span>
            <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            <Button variant="danger" disabled={pending} onClick={remove}>Delete</Button>
          </>
        ) : (
          <>
            {editing && <Button variant="ghost" className="mr-auto text-bad" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={pending || !title.trim()} onClick={save}>{editing ? "Save" : "Add"}</Button>
          </>
        )
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {scopePicker}
        <Field label="What">{(id) => <input id={id} required className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Swimming, work trip, parents' evening" />}</Field>
        <SpanFields value={span} onChange={setSpan} error={error} />
        {(!event?.recurring || scope !== "occurrence") && (
          <div className="flex flex-col gap-3">
            <Field label="Repeats">
              {(id) => (
                <select id={id} className={inputClass} value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
                  <option value="none">Does not repeat</option>
                  <option value="DAILY">Every day</option>
                  <option value="WEEKLY">Every week</option>
                  <option value="MONTHLY">Every month</option>
                  <option value="YEARLY">Every year</option>
                </select>
              )}
            </Field>
            {freq === "WEEKLY" && (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-ink-2">On</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d) => (
                    <button key={d} type="button" role="checkbox" aria-checked={byDay.includes(d)} onClick={() => setByDay(byDay.includes(d) ? byDay.filter((x) => x !== d) : [...byDay, d])} className={`min-h-9 min-w-11 rounded-full border px-2 text-sm ${byDay.includes(d) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2"}`}>
                      {DAY_LABEL[d]}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {freq !== "none" && (
              <Field label="Number of times" hint="Leave empty to keep repeating">{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className={inputClass} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />}</Field>
            )}
          </div>
        )}
        <PeoplePicker adultIds={people.adultIds} childIds={people.childIds} onChange={setPeople} label="Who is busy" />
        <Field label="Who can see the details">
          {() => (
            <Segmented
              label="Who can see the details"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: "shared", label: "Shared" },
                { value: "busy_only", label: "Busy only" },
                { value: "private", label: "Only me" },
              ]}
            />
          )}
        </Field>
        <p className="-mt-2 text-xs text-ink-3">
          {visibility === "shared" ? "Your household sees everything." : visibility === "busy_only" ? "Others see “Busy” at this time, nothing more." : "Hidden from others. It still stops clashes, shown as unavailable."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Travel before (min)">{(id) => <input id={id} inputMode="numeric" className={inputClass} value={travelBefore} onChange={(e) => setTravelBefore(e.target.value.replace(/\D/g, ""))} />}</Field>
          <Field label="Travel after (min)">{(id) => <input id={id} inputMode="numeric" className={inputClass} value={travelAfter} onChange={(e) => setTravelAfter(e.target.value.replace(/\D/g, ""))} />}</Field>
        </div>
        <Field label="Where">{(id) => <input id={id} className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} rows={3} className={`${inputClass} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <ErrorNote message={error && error.code !== "DST_AMBIGUOUS" ? error.message : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
