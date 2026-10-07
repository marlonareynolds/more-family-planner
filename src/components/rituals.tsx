"use client";

import { useState } from "react";
import type { RitualView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { addDaysStr, fmtDate, todayIn } from "./format";
import type { MomentKind } from "./moment-editor";
import { PeoplePicker } from "./people-picker";
import { Badge, Button, Card, Checkbox, Dialog, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

const IDEAS: Record<MomentKind, string> = {
  me: "Saturday swim, Thursday evening class",
  us: "Fortnightly date night, Sunday morning coffee",
  family: "Friday pizza, a monthly hour with each child",
};

/** Plans that repeat. Each date becomes its own plan with its own care check. */
export function RitualsSection({ kind, rituals }: { kind: MomentKind; rituals: RitualView[] }) {
  const [creating, setCreating] = useState(false);
  const mine = rituals.filter((r) => r.kind === kind);
  return (
    <section>
      <SectionTitle action={<Button size="sm" onClick={() => setCreating(true)}>+ Start a ritual</Button>}>Rituals</SectionTitle>
      {mine.length === 0 ? (
        <p className="text-sm text-ink-2">Something you do every week or month, like {IDEAS[kind]}. More puts the next few dates in the diary and checks childcare for each.</p>
      ) : (
        <ul className="flex flex-col gap-3">{mine.map((r) => <li key={r.id}><RitualCard ritual={r} /></li>)}</ul>
      )}
      {creating && <RitualEditor kind={kind} onClose={() => setCreating(false)} />}
    </section>
  );
}

export function RitualCard({ ritual: r }: { ritual: RitualView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const waitingFor = r.participantIds.filter((p) => !r.agreedBy.includes(p));
  return (
    <Card tone={r.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{r.title}</h3>
          <p className="text-sm text-ink-2">{r.label}, {r.startTime} for {r.durationMinutes >= 120 ? `${r.durationMinutes / 60} hours` : `${r.durationMinutes} min`}</p>
        </div>
        {r.active ? <Badge tone="good">In the diary</Badge> : <Badge tone="warn">Waiting for {waitingFor.map((id) => (id === app.me.id ? "you" : app.nameOf(id))).join(" and ")}</Badge>}
      </div>
      <ErrorNote message={error?.message} />
      {r.participantIds.includes(app.me.id) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.awaitingMe && <Button size="sm" variant="primary" disabled={pending} onClick={() => run("JoinRitual", { ritualId: r.id, version: r.version })}>Yes, I&apos;m in</Button>}
          {confirmEnd ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              {r.awaitingMe ? "Say no to this?" : "Stop it? Future dates come out of the diary."}
              <Button size="sm" variant="danger" disabled={pending} onClick={() => run("EndRitual", { ritualId: r.id, version: r.version })}>{r.awaitingMe ? "Not for me" : "Stop"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>Keep</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>{r.awaitingMe ? "Not for me" : "Stop…"}</Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function RitualEditor({ kind, onClose, preset }: { kind: MomentKind; onClose: () => void; preset?: { title?: string; activityKey?: string; durationMinutes?: number; startTime?: string } }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [title, setTitle] = useState(preset?.title ?? "");
  const [cadence, setCadence] = useState<"weekly" | "fortnightly" | "monthly">(kind === "us" ? "fortnightly" : "weekly");
  const [startsOn, setStartsOn] = useState(addDaysStr(todayIn(app.timeZone), 1));
  const [startTime, setStartTime] = useState(preset?.startTime ?? (kind === "us" ? "19:30" : kind === "me" ? "10:00" : "17:30"));
  const [hours, setHours] = useState(String((preset?.durationMinutes ?? (kind === "us" ? 150 : 90)) / 60));
  const [people, setPeople] = useState({ adultIds: kind === "me" ? [app.me.id] : app.adults.map((a) => a.id), childIds: kind === "family" ? app.children.map((c) => c.id) : [] });
  const [needsCare, setNeedsCare] = useState(kind !== "family" && app.children.length > 0);

  async function save() {
    const ok = await run("StartRitual", {
      kind,
      title,
      activityKey: preset?.activityKey ?? null,
      participantIds: kind === "me" ? [app.me.id] : people.adultIds,
      childIds: kind === "family" ? people.childIds : [],
      needsCare,
      cadence,
      startsOn,
      startTime,
      durationMinutes: Math.round(Number(hours) * 60) || 60,
    });
    if (ok) onClose();
  }
  const others = (kind === "me" ? [] : people.adultIds).filter((id) => id !== app.me.id);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Start a ritual"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim()} onClick={save}>{others.length ? `Suggest to ${others.map(app.nameOf).join(" and ")}` : "Start"}</Button></>}
    >
      <div className="flex flex-col gap-3">
        <Field label="What">{(id) => <input id={id} className={inputClass} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={IDEAS[kind].split(",")[0]} />}</Field>
        <Field label="How often">
          {(id) => (
            <select id={id} className={inputClass} value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
              <option value="weekly">Every week</option>
              <option value="fortnightly">Every other week</option>
              <option value="monthly">Once a month</option>
            </select>
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="First date">{(id) => <input id={id} type="date" className={inputClass} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
          <Field label="Time">{(id) => <input id={id} type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />}</Field>
          <Field label="Hours">{(id) => <input id={id} inputMode="decimal" className={inputClass} value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ""))} />}</Field>
        </div>
        <p className="-mt-1 text-xs text-ink-3">Starts {startsOn ? fmtDate(startsOn) : "…"}. {cadence === "monthly" ? "Then the same weekday of each month." : "Then on the same weekday."}</p>
        {kind === "family" && <PeoplePicker adultIds={people.adultIds} childIds={people.childIds} onChange={setPeople} label="Who" />}
        {app.children.length > 0 && kind !== "family" && <Checkbox checked={needsCare} onChange={setNeedsCare} label="The children need looking after" hint="Checked for each date separately." />}
        {others.length > 0 && <p className="text-sm text-ink-3">Dates go in the diary once {others.map(app.nameOf).join(" and ")} says yes.</p>}
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}
