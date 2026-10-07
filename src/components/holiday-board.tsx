"use client";

import { Backpack } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { HolidayRow } from "@/server/queries/holidays";
import type { ArrangementView, TripView, WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { addDaysStr, fmtDate, fmtRange, localParts, todayIn } from "./format";
import { PeoplePicker } from "./people-picker";
import { TripsSection } from "./trips";
import { SpanFields, defaultSpan, spanFrom, spanPayload, type SpanValue } from "./span-fields";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand, type ApiError } from "./use-command";

export function HolidayBoard({ week, holidays, showingArchived, trips = [] }: { week: WeekView; holidays: HolidayRow[]; showingArchived: boolean; trips?: TripView[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [arranging, setArranging] = useState<{ childIds: string[]; span: SpanValue } | null>(null);
  const [editing, setEditing] = useState<HolidayRow | "new" | null>(null);

  const careLabel = (a: ArrangementView) => (a.kind === "parent" ? (a.responsibleAccountId === app.me.id ? "You" : app.nameOf(a.responsibleAccountId!)) : a.kind === "external" ? a.providerName : "No separate care needed");
  const stateLabel = (a: ArrangementView) =>
    a.state === "confirmed" ? (a.kind === "external" ? "confirmed by the family" : "confirmed") : a.state === "proposed" ? `waiting for ${a.responsibleAccountId === app.me.id ? "you" : app.nameOf(a.responsibleAccountId ?? "")}` : "declined";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Trips, holidays and care</h1>
          <p className="mt-1 max-w-prose text-ink-2">Who is away, who needs care, and who has it. Children sharing the same care are shown together.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setArranging({ childIds: app.children.map((c) => c.id), span: defaultSpan(todayIn(app.timeZone), "09:00", "17:00") })}>Arrange care</Button>
          <Button variant="primary" onClick={() => setEditing("new")}>+ School holiday</Button>
        </div>
      </div>
      {app.children.length === 0 && <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-sm">Add your children in <Link className="underline" href="/settings">Settings</Link> first.</p>}

      {week.careAwaitingMe.length > 0 && (
        <>
          <SectionTitle>Asked of you</SectionTitle>
          <ul className="flex flex-col gap-2">
            {week.careAwaitingMe.map((a) => (
              <li key={a.id}>
                <Card tone="care" className="flex flex-wrap items-center justify-between gap-3">
                  <p>Look after {a.childIds.map(app.childName).join(", ")} · {fmtDate(localParts(a.start, app.timeZone).date)} {fmtRange(a.start, a.end, app.timeZone)}</p>
                  <span className="flex gap-2">
                    <Button size="sm" variant="primary" disabled={pending} onClick={() => run("RespondToCare", { arrangementId: a.id, version: a.version, decision: "confirm" })}>Yes, I&apos;ll do it</Button>
                    <Button size="sm" disabled={pending} onClick={() => run("RespondToCare", { arrangementId: a.id, version: a.version, decision: "decline" })}>I can&apos;t</Button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-8 flex items-center gap-1">
        <Link href={`/holidays?date=${addDaysStr(week.weekKey, -7)}`} className="rounded-full px-3 py-2 text-ink-2 hover:bg-surface-2" aria-label="Previous week">←</Link>
        <h2 className="font-display text-lg">Week of {fmtDate(week.weekKey, { weekday: false, month: "long" })}</h2>
        <Link href={`/holidays?date=${addDaysStr(week.weekKey, 7)}`} className="rounded-full px-3 py-2 text-ink-2 hover:bg-surface-2" aria-label="Next week">→</Link>
      </div>
      <ErrorNote message={error?.message} />
      {week.care.length === 0 ? (
        <EmptyState icon={<Backpack />} tone="family" title="No care needed this week.">Care needs come from school holidays, time away and plans that need the children looked after.</EmptyState>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {week.care.map((day) => (
            <section key={day.date}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">{fmtDate(day.date)}</h3>
              <ul className="flex flex-col gap-2">
                {day.groups.map((g, i) => (
                  <li key={i}>
                    <Card tone="care">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{g.childIds.map(app.childName).join(", ")} <span className="font-normal text-ink-3">· {g.reason}</span></p>
                        <Badge tone={g.state === "covered" ? "good" : "warn"}>{g.state === "covered" ? "Covered" : g.state === "partly_covered" ? "Partly covered" : "Needs care"}</Badge>
                      </div>
                      {g.arrangements.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-ink-2">
                          {g.arrangements.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center gap-2">
                              <span>{fmtRange(a.start, a.end, app.timeZone)}: {careLabel(a)}, {stateLabel(a)}</span>
                              <button className="text-xs text-ink-3 underline" onClick={() => run("RemoveCare", { arrangementId: a.id, version: a.version })}>remove</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {g.state !== "covered" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm text-warn">Not covered {g.gaps.map((x) => fmtRange(x.start, x.end, app.timeZone)).join(", ")}</p>
                          <Button size="sm" onClick={() => setArranging({ childIds: g.childIds, span: spanFrom(g.gaps[0].start, g.gaps[0].end, app.timeZone) })}>Arrange</Button>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TripsSection trips={trips} />

      <SectionTitle action={<Link className="text-sm text-brand underline" href={showingArchived ? "/holidays" : "/holidays?archived=1"}>{showingArchived ? "Show current" : "Show archived"}</Link>}>
        {showingArchived ? "Archived holidays" : "School holidays"}
      </SectionTitle>
      {holidays.length === 0 ? (
        <EmptyState title={showingArchived ? "Nothing archived." : "No holidays added yet."}>{showingArchived ? null : "Add the school terms once and More spots the weeks that need cover."}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {holidays.map((h) => (
            <li key={h.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/holidays?date=${h.startDate}`} className="font-medium underline-offset-2 hover:underline">{h.name}</Link>
                  <p className="text-sm text-ink-2">{fmtDate(h.startDate)} to {fmtDate(h.endDate)} · {h.dailyStart} to {h.dailyEnd} · {h.childIds.map(app.childName).join(", ")}</p>
                </div>
                <span className="flex gap-2">
                  {!h.archived && <Button size="sm" onClick={() => setEditing(h)}>Edit</Button>}
                  <Button size="sm" variant="ghost" onClick={() => run("SetHolidayArchived", { holidayId: h.id, version: h.version, archived: !h.archived })}>{h.archived ? "Restore" : "Archive"}</Button>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {arranging && <ArrangeDialog initial={arranging} onClose={() => setArranging(null)} />}
      {editing && <HolidayDialog holiday={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ArrangeDialog({ initial, onClose }: { initial: { childIds: string[]; span: SpanValue }; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [who, setWho] = useState<string>(app.me.id);
  const [provider, setProvider] = useState("");
  const [childIds, setChildIds] = useState(initial.childIds);
  const [span, setSpan] = useState(initial.span);
  const [note, setNote] = useState("");
  const kind = who === "external" ? "external" : who === "not_needed" ? "not_needed" : "parent";
  const asking = kind === "parent" && who !== app.me.id;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Arrange care"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={pending || !childIds.length}
            onClick={async () => {
              const ok = await run("ArrangeCare", { kind, responsibleAccountId: kind === "parent" ? who : null, providerName: kind === "external" ? provider : null, childIds, span: spanPayload(span), note, confirmed: kind !== "parent" });
              if (ok) onClose();
            }}
          >
            {asking ? `Ask ${app.nameOf(who)}` : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Who will look after them">
          {(id) => (
            <select id={id} className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
              {app.adults.map((a) => <option key={a.id} value={a.id}>{a.id === app.me.id ? "Me" : `${a.displayName} (I'll ask them)`}</option>)}
              <option value="external">Someone else: a relative, friend or club</option>
              <option value="not_needed">No separate care needed</option>
            </select>
          )}
        </Field>
        {kind === "external" && (
          <Field label="Who" hint="You're recording that they have confirmed. More doesn't vet carers.">{(id, d) => <input id={id} aria-describedby={d} className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Nana, Holiday club" />}</Field>
        )}
        <PeoplePicker adultIds={[]} childIds={childIds} onChange={(v) => setChildIds(v.childIds)} showAdults={false} label="Children" />
        <SpanFields value={span} onChange={setSpan} allowAllDay={false} error={error as ApiError | null} />
        <Field label="Note (drop-off, collection, anything to know)">{(id) => <textarea id={id} rows={2} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote message={error && error.code !== "DST_AMBIGUOUS" ? error.message : null} />
      </div>
    </Dialog>
  );
}

function HolidayDialog({ holiday, onClose }: { holiday: HolidayRow | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const today = todayIn(app.timeZone);
  const [name, setName] = useState(holiday?.name ?? "Half term");
  const [startDate, setStartDate] = useState(holiday?.startDate ?? today);
  const [endDate, setEndDate] = useState(holiday?.endDate ?? addDaysStr(today, 4));
  const [dailyStart, setDailyStart] = useState(holiday?.dailyStart ?? "08:30");
  const [dailyEnd, setDailyEnd] = useState(holiday?.dailyEnd ?? "17:30");
  const [weekends, setWeekends] = useState(holiday?.includeWeekends ?? false);
  const [childIds, setChildIds] = useState(holiday?.childIds ?? app.children.map((c) => c.id));
  const [impact, setImpact] = useState<{ kept: number; added: number; removed: number; removedWithArrangements: number } | null>(null);
  const [ack, setAck] = useState(false);
  const fields = { name, startDate, endDate, dailyStart, dailyEnd, includeWeekends: weekends, childIds };

  async function save() {
    if (!holiday) {
      if (await run("CreateHoliday", fields)) onClose();
      return;
    }
    if (!impact) {
      const r = await run<{ impact: typeof impact }>("UpdateHoliday", { ...fields, holidayId: holiday.id, version: holiday.version, previewOnly: true }, { refresh: false });
      if (r) setImpact(r.impact);
      return;
    }
    if (await run("UpdateHoliday", { ...fields, holidayId: holiday.id, version: holiday.version, acknowledgeRemovedCare: ack })) onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={holiday ? "Edit holiday" : "Add a school holiday"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !childIds.length || (!!impact && impact.removedWithArrangements > 0 && !ack)} onClick={save}>
            {holiday && !impact ? "Preview changes" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">{(id) => <input id={id} className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setImpact(null); }} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day">{(id) => <input id={id} type="date" className={inputClass} value={startDate} onChange={(e) => { setStartDate(e.target.value); setImpact(null); }} />}</Field>
          <Field label="Last day">{(id) => <input id={id} type="date" className={inputClass} min={startDate} value={endDate} onChange={(e) => { setEndDate(e.target.value); setImpact(null); }} />}</Field>
          <Field label="Care needed from">{(id) => <input id={id} type="time" className={inputClass} value={dailyStart} onChange={(e) => { setDailyStart(e.target.value); setImpact(null); }} />}</Field>
          <Field label="Until">{(id) => <input id={id} type="time" className={inputClass} value={dailyEnd} onChange={(e) => { setDailyEnd(e.target.value); setImpact(null); }} />}</Field>
        </div>
        <Checkbox checked={weekends} onChange={(v) => { setWeekends(v); setImpact(null); }} label="Include weekends" />
        <PeoplePicker adultIds={[]} childIds={childIds} onChange={(v) => { setChildIds(v.childIds); setImpact(null); }} showAdults={false} label="Children off school" />
        <p className="text-xs text-ink-3">A school holiday marks when children need care. It doesn&apos;t assume either adult is off work.</p>
        {impact && (
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <p className="font-medium">What this change does</p>
            <ul className="mt-1 list-disc pl-5 text-ink-2">
              <li>{impact.kept} child-days stay as they are, with their care</li>
              <li>{impact.added} new child-days start with no care arranged</li>
              <li>{impact.removed} child-days are removed</li>
            </ul>
            {impact.removedWithArrangements > 0 && (
              <div className="mt-2">
                <Checkbox checked={ack} onChange={setAck} label={`${impact.removedWithArrangements} removed days already have care arranged. Bookings with carers or clubs are not changed by More; I'll sort those myself.`} />
              </div>
            )}
          </div>
        )}
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}
