"use client";

import { useState } from "react";
import type { MomentView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { minorToInput, toMinor } from "./format";
import { PeoplePicker } from "./people-picker";
import { SpanFields, defaultSpan, spanFrom, spanPayload, type SpanValue } from "./span-fields";
import { Button, Checkbox, Dialog, ErrorNote, Field, inputClass } from "./ui";
import { useCommand } from "./use-command";

export type MomentKind = "me" | "us" | "family";

export interface MomentTemplate {
  kind: MomentKind;
  title: string;
  activityKey?: string;
  notes?: string;
  budgetMinor?: number | null;
  durationMinutes?: number;
  location?: string;
}

const KIND_TITLE: Record<MomentKind, string> = { me: "Time for me", us: "Time for us", family: "Family time" };

/**
 * Create or edit a Me, Us or Family moment. A new moment starts as a
 * private draft; sharing it is a separate, deliberate step.
 */
export function MomentEditor({
  open,
  onClose,
  moment,
  template,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  moment?: MomentView | null;
  template?: MomentTemplate | null;
  defaultDate: string;
}) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const kind: MomentKind = moment?.momentKind ?? template?.kind ?? "us";
  const startTime = kind === "me" ? "10:00" : kind === "family" ? "10:00" : "19:30";
  const endFromTemplate = () => {
    const mins = template?.durationMinutes ?? (kind === "us" ? 150 : 120);
    const [h, m] = startTime.split(":").map(Number);
    const t = h * 60 + m + mins;
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };

  const [title, setTitle] = useState(moment?.title ?? template?.title ?? "");
  const [notes, setNotes] = useState(moment?.notes ?? template?.notes ?? "");
  const [location, setLocation] = useState(moment?.location ?? template?.location ?? "");
  const [span, setSpan] = useState<SpanValue>(moment ? spanFrom(moment.start, moment.end, app.timeZone) : defaultSpan(defaultDate, startTime, endFromTemplate()));
  const [people, setPeople] = useState({
    adultIds: moment?.participantIds ?? (kind === "me" ? [app.me.id] : app.adults.map((a) => a.id)),
    childIds: moment?.childIds ?? (kind === "family" ? app.children.map((c) => c.id) : []),
  });
  const [needsCare, setNeedsCare] = useState(moment?.needsCare ?? (kind !== "family" && app.children.length > 0));
  const [budget, setBudget] = useState(minorToInput(moment?.budgetMinor ?? template?.budgetMinor ?? null));
  const [travelBefore, setTravelBefore] = useState(String(moment?.travelBeforeMinutes ?? 0));
  const [travelAfter, setTravelAfter] = useState(String(moment?.travelAfterMinutes ?? 0));
  const [surprise, setSurprise] = useState(moment?.surprise ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    const budgetMinor = toMinor(budget);
    if (Number.isNaN(budgetMinor)) return setLocalError("Enter the budget like 60 or 60.50.");
    setLocalError(null);
    const fields = {
      title,
      notes,
      location,
      activityKey: moment?.activityKey ?? template?.activityKey ?? null,
      span: spanPayload(span),
      participantIds: kind === "me" ? [app.me.id] : people.adultIds,
      childIds: kind === "us" ? [] : people.childIds,
      needsCare,
      budgetMinor,
      travelBeforeMinutes: Number(travelBefore) || 0,
      travelAfterMinutes: Number(travelAfter) || 0,
      surprise: kind === "us" && surprise,
    };
    const ok = moment
      ? await run("EditMoment", { momentId: moment.id, version: moment.version, fields }, { expected: { membershipRevision: app.membershipRevision } })
      : await run("CreateMoment", { kind, ...fields }, { expected: { membershipRevision: app.membershipRevision } });
    if (ok) onClose();
  }

  const shared = moment?.sharing === "shared";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={moment ? `Edit: ${KIND_TITLE[kind].toLowerCase()}` : KIND_TITLE[kind]}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !title.trim()} onClick={save}>
            {moment ? "Save" : "Save as draft"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {shared && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">Changing the time, people, care or budget asks everyone to agree again. Wording changes don&apos;t.</p>}
        <Field label="What">{(id) => <input id={id} required className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "me" ? "A swim, a long walk, an hour with a book" : kind === "us" ? "Dinner, a show, a walk and a pub lunch" : "Park, cinema, pancake morning"} />}</Field>
        <SpanFields value={span} onChange={setSpan} allowAllDay={false} error={error} />
        {kind === "family" && <PeoplePicker adultIds={people.adultIds} childIds={people.childIds} onChange={setPeople} label="Who is coming" />}
        {kind === "us" && app.adults.length < 2 && <p className="text-sm text-warn">Invite your partner in Settings before sharing this.</p>}
        {app.children.length > 0 && (
          <Checkbox
            checked={needsCare}
            onChange={setNeedsCare}
            label={kind === "family" ? "Children not coming need looking after" : "The children need looking after"}
            hint="More checks every child has care for the whole time, including travel."
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Travel before (min)">{(id) => <input id={id} inputMode="numeric" className={inputClass} value={travelBefore} onChange={(e) => setTravelBefore(e.target.value.replace(/\D/g, ""))} />}</Field>
          <Field label="Travel after (min)">{(id) => <input id={id} inputMode="numeric" className={inputClass} value={travelAfter} onChange={(e) => setTravelAfter(e.target.value.replace(/\D/g, ""))} />}</Field>
        </div>
        <Field label="Spending limit (£)" hint="Optional. Agreed together for shared plans.">{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} />}</Field>
        <Field label="Where">{(id) => <input id={id} className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} rows={3} className={`${inputClass} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {kind === "us" && (
          <Checkbox checked={surprise} onChange={setSurprise} label="Keep the details a surprise" hint="Your partner still sees the time, the childcare and the spending limit before agreeing." />
        )}
        <ErrorNote message={localError ?? (error && error.code !== "DST_AMBIGUOUS" ? error.message : null)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
