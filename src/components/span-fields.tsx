"use client";

import { Checkbox, Field, inputClass } from "./ui";
import { localParts } from "./format";
import type { ApiError } from "./use-command";

export interface SpanValue {
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startChoice?: "earlier" | "later";
  endChoice?: "earlier" | "later";
}

export function spanFrom(start: number, end: number, timeZone: string, allDay = false): SpanValue {
  const s = localParts(start, timeZone);
  const e = localParts(allDay ? end - 1 : end, timeZone);
  return { allDay, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time };
}

export function defaultSpan(date: string, startTime = "19:00", endTime = "21:00"): SpanValue {
  return { allDay: false, startDate: date, startTime, endDate: date, endTime };
}

export function spanPayload(v: SpanValue) {
  return v.allDay
    ? { allDay: true, startDate: v.startDate, endDate: v.endDate < v.startDate ? v.startDate : v.endDate }
    : { allDay: false, startDate: v.startDate, startTime: v.startTime, endDate: v.endDate, endTime: v.endTime, startChoice: v.startChoice, endChoice: v.endChoice };
}

/** Date and time inputs. Every operation works without dragging (spec 6.3). */
export function SpanFields({ value, onChange, allowAllDay = true, error }: { value: SpanValue; onChange: (v: SpanValue) => void; allowAllDay?: boolean; error?: ApiError | null }) {
  const set = (patch: Partial<SpanValue>) => onChange({ ...value, ...patch });
  const ambiguous = error?.code === "DST_AMBIGUOUS";
  const gap = error?.code === "DST_GAP" ? (error.details?.suggestion as string | undefined) : undefined;
  return (
    <div className="flex flex-col gap-3">
      {allowAllDay && <Checkbox checked={value.allDay} onChange={(allDay) => set({ allDay })} label="All day" />}
      <div className="grid grid-cols-2 gap-3">
        <Field label={value.allDay ? "First day" : "Date"}>
          {(id) => (
            <input
              id={id}
              type="date"
              required
              className={inputClass}
              value={value.startDate}
              onChange={(e) => {
                const startDate = e.target.value;
                set({ startDate, endDate: value.endDate < startDate || value.endDate === value.startDate ? startDate : value.endDate });
              }}
            />
          )}
        </Field>
        {value.allDay ? (
          <Field label="Last day">{(id) => <input id={id} type="date" required className={inputClass} min={value.startDate} value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />}</Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts">{(id) => <input id={id} type="time" required className={inputClass} value={value.startTime} onChange={(e) => set({ startTime: e.target.value, startChoice: undefined })} />}</Field>
            <Field label="Ends">{(id) => <input id={id} type="time" required className={inputClass} value={value.endTime} onChange={(e) => set({ endTime: e.target.value, endChoice: undefined })} />}</Field>
          </div>
        )}
      </div>
      {!value.allDay && value.endDate !== value.startDate && (
        <Field label="Ends on" hint="For overnight plans">{(id) => <input id={id} type="date" className={inputClass} min={value.startDate} value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />}</Field>
      )}
      {!value.allDay && value.endDate === value.startDate && value.endTime <= value.startTime && value.endTime !== "" && (
        <button type="button" className="self-start text-sm text-brand underline" onClick={() => set({ endDate: addOne(value.startDate) })}>
          Ends the next day?
        </button>
      )}
      {ambiguous && (
        <fieldset className="rounded-xl bg-warn/10 p-3 text-sm">
          <legend className="font-medium text-warn">The clocks go back that night, so that time happens twice.</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" name="dst" onChange={() => set({ startChoice: "earlier", endChoice: "earlier" })} /> First time (BST)</label>
            <label className="flex items-center gap-2"><input type="radio" name="dst" onChange={() => set({ startChoice: "later", endChoice: "later" })} /> Second time (GMT)</label>
          </div>
        </fieldset>
      )}
      {gap && (
        <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">
          The clocks go forward then, so that time doesn&apos;t exist.{" "}
          <button type="button" className="underline" onClick={() => set({ startTime: gap.slice(11, 16) })}>Use {gap.slice(11, 16)} instead</button>
        </p>
      )}
    </div>
  );
}

function addOne(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
