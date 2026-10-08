"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { JOB_STARTERS, JOB_TEMPLATES, type JobCadence, type JobTemplate } from "@/domain/jobs";
import type { JobsView, JobView } from "@/server/queries/jobs";
import { useApp } from "./app-context";
import { fmtDate, todayIn } from "./format";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

const CADENCES: { value: JobCadence; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "fortnightly", label: "Every other week" },
  { value: "monthly", label: "Once a month" },
  { value: "yearly", label: "Once a year" },
  { value: "once", label: "Just once" },
];

const hours = (mins: number) => (mins < 60 ? `${mins} min` : `${Math.round((mins / 60) * 2) / 2} h`);

function dueLine(j: JobView, today: string): string {
  if (j.status === "done") return "Done";
  if (!j.dueOn) return "";
  const by = j.dueTime ? ` by ${j.dueTime}` : "";
  if (j.status === "today") return `Today${by}`;
  if (j.status === "overdue") return `Was due ${fmtDate(j.dueOn)}${by}`;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return j.dueOn === tomorrow ? `Tomorrow${by}` : `Next: ${fmtDate(j.dueOn)}${by}`;
}

/** One job, with the actions that fit who you are to it. */
export function JobRow({ job, today, compact = false }: { job: JobView; today: string; compact?: boolean }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const partner = app.adults.find((a) => a.id !== app.me.id) ?? null;
  const [editing, setEditing] = useState(false);
  const mine = job.ownerId === app.me.id;
  const due = job.status === "today" || job.status === "overdue";
  // Undo is offered for a day, in case "done" was tapped by mistake.
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const justDone = !!job.lastDoneOn && job.lastDoneOn >= yesterday;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {job.title}
            {due && <span className="ml-2 align-middle"><Badge tone={job.status === "overdue" ? "warn" : "us"}>{dueLine(job, today)}</Badge></span>}
          </p>
          <p className="text-sm text-ink-3">
            {job.cadenceLabel}
            {!due && job.status !== "done" ? ` · ${dueLine(job, today)}` : ""}
            {" · "}
            {job.ownerName ? (mine ? "Yours" : job.ownerName) : "Nobody yet"}
            {job.proposedOwnerId && !job.awaitingMyAnswer && <> · asked {partner?.displayName ?? "your partner"}</>}
          </p>
          {job.forTitle && <p className="text-sm text-ink-3">For {job.forTitle}</p>}
          {job.notes && !compact && <p className="text-sm text-ink-2">{job.notes}</p>}
          {job.steps.length > 0 && <Checklist job={job} open={!compact || mine} />}
          {job.lastDoneBy && job.status !== "overdue" && <p className="text-xs text-ink-3">Last done by {job.lastDoneBy === app.me.displayName ? "you" : job.lastDoneBy}, {fmtDate(job.lastDoneOn!)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {due && job.dueOn && (
            <Button size="sm" variant={mine ? "primary" : "secondary"} disabled={pending} onClick={() => run("MarkJobDone", { jobId: job.id, dueOn: job.dueOn })}>
              {mine ? "Done" : "I did it"}
            </Button>
          )}
          {justDone && !due && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("UndoJobDone", { jobId: job.id, dueOn: job.lastDoneOn })}>Undo</Button>}
          {!compact && !job.ownerId && <Button size="sm" disabled={pending} onClick={() => run("ProposeJobOwner", { jobId: job.id, version: job.version, to: "me" })}>I&apos;ll take it</Button>}
          {!compact && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>
      {job.awaitingMyAnswer && (
        <Card tone="us" className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{job.proposedByName ?? "Your partner"} asked if you could take this on.</p>
          <span className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: job.id, version: job.version, accept: true })}>Yes, it&apos;s mine</Button>
            <Button size="sm" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: job.id, version: job.version, accept: false })}>Not now</Button>
          </span>
        </Card>
      )}
      <ErrorNote message={error?.message} />
      {editing && <JobEditor job={job} onClose={() => setEditing(false)} />}
    </li>
  );
}

/**
 * The owner's own checklist for the due date shown. Anyone can tick a step,
 * nobody is told, and the partner sees no running count on Today.
 */
function Checklist({ job, open }: { job: JobView; open: boolean }) {
  const app = useApp();
  const { run, pending } = useCommand(app.householdId);
  const done = job.steps.filter((s) => s.done).length;
  if (!open || !job.dueOn) return <p className="text-xs text-ink-3">{job.steps.length} step{job.steps.length === 1 ? "" : "s"}</p>;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-sm text-ink-2">Checklist, {done} of {job.steps.length} ready{job.dueOn ? ` for ${fmtDate(job.dueOn)}` : ""}</summary>
      <ul className="mt-1 flex flex-col gap-1">
        {job.steps.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={s.done} disabled={pending} onChange={(e) => run("TickJobStep", { stepId: s.id, dueOn: job.dueOn, done: e.target.checked })} />
              <span className={s.done ? "text-ink-3 line-through" : ""}>{s.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function JobsBoard({ data }: { data: JobsView }) {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [starter, setStarter] = useState<(typeof JOB_STARTERS)[number] | JobTemplate | null>(null);
  const today = data.today || todayIn(app.timeZone);
  const due = data.jobs.filter((j) => j.status === "today" || j.status === "overdue" || j.awaitingMyAnswer);
  const rest = data.jobs.filter((j) => !due.includes(j));
  const existing = new Set(data.jobs.map((j) => j.title.toLowerCase()));
  const starters = JOB_STARTERS.filter((s) => !existing.has(s.title.toLowerCase()));
  const totalMins = data.share.reduce((s, l) => s + l.minutesPerMonth, 0) + data.unowned.minutesPerMonth;

  return (
    <div>
      <h1 className="font-display text-3xl">Household jobs</h1>
      <p className="mt-1 max-w-prose text-ink-2">The jobs that keep the week running, each with one owner you&apos;ve both agreed. The owner gets a reminder; anyone can mark it done.</p>

      {data.jobs.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-medium">Who looks after what</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {data.share.map((l) => (
              <li key={l.accountId}>
                <div className="flex justify-between text-sm"><span>{l.accountId === app.me.id ? "You" : l.name}</span><span className="text-ink-3">{l.jobs} job{l.jobs === 1 ? "" : "s"} · about {hours(l.minutesPerMonth)} a month</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
                  <div className="h-2 rounded-full bg-brand/60" style={{ width: `${totalMins ? Math.round((l.minutesPerMonth / totalMins) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
            {data.unowned.jobs > 0 && <li className="text-sm text-ink-3">{data.unowned.jobs} job{data.unowned.jobs === 1 ? " has" : "s have"} no owner yet (about {hours(data.unowned.minutesPerMonth)} a month).</li>}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Rough times you entered, repeating jobs only. It&apos;s a conversation starter, not a score: some jobs weigh more than their minutes.</p>
        </Card>
      )}

      {due.length > 0 && (
        <>
          <SectionTitle>Needs doing</SectionTitle>
          <Card><ul className="divide-y divide-line">{due.map((j) => <JobRow key={j.id} job={j} today={today} />)}</ul></Card>
        </>
      )}

      <SectionTitle action={<Button size="sm" onClick={() => setAdding(true)}>+ Add a job</Button>}>All jobs</SectionTitle>
      {rest.length === 0 && due.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="No jobs shared out yet." action={<Button variant="primary" onClick={() => setAdding(true)}>Add a job</Button>}>Start with the few that cause the most “did you…?” moments. Each one gets a single owner, agreed by both of you.</EmptyState>
      ) : rest.length > 0 ? (
        <Card><ul className="divide-y divide-line">{rest.map((j) => <JobRow key={j.id} job={j} today={today} />)}</ul></Card>
      ) : null}

      {starters.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink-2">Common ones to start from</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {starters.map((s) => (
              <li key={s.title}>
                <button type="button" className="min-h-10 rounded-full border border-line px-3 text-sm hover:border-brand" onClick={() => setStarter(s)}>+ {s.title}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="mt-6 text-sm font-medium text-ink-2">With a checklist</h2>
      <p className="text-xs text-ink-3">For responsibilities with several parts. Remove any step that doesn&apos;t fit.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {JOB_TEMPLATES.map((s) => (
          <li key={s.key}>
            <button type="button" className="min-h-10 rounded-full border border-line px-3 text-sm hover:border-brand" onClick={() => setStarter(s)}>+ {s.title}</button>
          </li>
        ))}
      </ul>
      {(adding || starter) && <JobEditor starter={starter} onClose={() => { setAdding(false); setStarter(null); }} />}
    </div>
  );
}

function JobEditor({ job, starter, onClose }: { job?: JobView; starter?: (typeof JOB_STARTERS)[number] | JobTemplate | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const partner = app.adults.find((a) => a.id !== app.me.id) ?? null;
  const [title, setTitle] = useState(job?.title ?? starter?.title ?? "");
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [cadence, setCadence] = useState<JobCadence>(job?.cadence ?? starter?.cadence ?? "weekly");
  const [startsOn, setStartsOn] = useState(job?.startsOn ?? todayIn(app.timeZone));
  const [dayBefore, setDayBefore] = useState(job?.remindDayBefore ?? starter?.remindDayBefore ?? false);
  const [minutes, setMinutes] = useState(String(job?.minutes ?? starter?.minutes ?? 15));
  const [owner, setOwner] = useState<"me" | "partner" | "none">("me");
  const [dueTime, setDueTime] = useState(job?.dueTime ?? "");
  const [steps, setSteps] = useState<string[]>(job?.steps.map((s) => s.text) ?? (starter && "steps" in starter ? starter.steps : []));
  const [step, setStep] = useState("");

  async function save() {
    const fields = { title, notes, cadence, startsOn, remindDayBefore: dayBefore, minutes: Math.min(600, Math.max(1, Number(minutes) || 15)), dueTime: cadence === "once" && dueTime ? dueTime : null, steps };
    const ok = job ? await run("EditJob", { jobId: job.id, version: job.version, ...fields }) : await run("AddJob", { ...fields, owner });
    if (ok) onClose();
  }
  async function owners(to: "me" | "partner" | "none") {
    if (job && (await run("ProposeJobOwner", { jobId: job.id, version: job.version, to }))) onClose();
  }
  const mine = job?.ownerId === app.me.id;

  return (
    <Dialog
      open
      onClose={onClose}
      title={job ? `Edit: ${job.title}` : "Add a job"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim()} onClick={save}>Save</Button></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Job">{(id) => <input id={id} required maxLength={80} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bins out" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How often">
            {(id) => (
              <select id={id} className={inputClass} value={cadence} disabled={!!job?.dinner} onChange={(e) => setCadence(e.target.value as JobCadence)}>
                {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
          </Field>
          <Field label={cadence === "once" ? "When" : "First time"} hint={job?.dinner ? "Set by the dinner: move it on Our Week." : starter?.hint}>{(id, d) => <input id={id} aria-describedby={d} type="date" className={inputClass} value={startsOn} disabled={!!job?.dinner} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
        </div>
        {cadence === "once" && (
          <Field label="Due by (optional)" hint="For a cut-off like “by 12 noon”.">{(id, d) => <input id={id} aria-describedby={d} type="time" className={`${inputClass} w-36`} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />}</Field>
        )}
        <Checkbox checked={dayBefore} onChange={setDayBefore} label="Remind the evening before" hint="For things like bins and PE kit. Otherwise the reminder comes that morning." />
        <Field label="Roughly how long it takes (minutes)" hint="Only used to show who carries what.">{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className={`${inputClass} w-28`} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />}</Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink-2">Checklist (optional)</legend>
          <p className="text-xs text-ink-3">The parts of the job, for whoever owns it. Nobody is told about ticks.</p>
          {steps.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {steps.map((s, i) => (
                <li key={`${s}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm">
                  {s}
                  <button type="button" className="min-h-9 px-2 text-ink-3 hover:text-bad" aria-label={`Remove step: ${s}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          )}
          {steps.length < 12 && (
            <div className="mt-2 flex gap-2">
              <label htmlFor="job-step" className="sr-only">Add a step</label>
              <input id="job-step" maxLength={80} className={inputClass} value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (step.trim()) { setSteps([...steps, step.trim()]); setStep(""); } } }} />
              <Button type="button" size="sm" disabled={!step.trim()} onClick={() => { setSteps([...steps, step.trim()]); setStep(""); }}>Add</Button>
            </div>
          )}
        </fieldset>
        <Field label="Notes (optional)">{(id) => <textarea id={id} rows={2} maxLength={500} className={`${inputClass} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {!job && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Who looks after it</legend>
            <div className="flex flex-wrap gap-2">
              {([["me", "Me"], ...(partner ? [["partner", `Ask ${partner.displayName}`]] : []), ["none", "Decide later"]] as [typeof owner, string][]).map(([v, label]) => (
                <label key={v} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${owner === v ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  <input type="radio" name="owner" className="sr-only" checked={owner === v} onChange={() => setOwner(v)} />
                  {label}
                </label>
              ))}
            </div>
            {owner === "partner" && <p className="mt-2 text-xs text-ink-3">{partner?.displayName} gets asked and says yes before it&apos;s theirs.</p>}
          </fieldset>
        )}
        {job && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {!mine && <Button size="sm" disabled={pending} onClick={() => owners("me")}>I&apos;ll take it</Button>}
            {partner && job.ownerId !== partner.id && <Button size="sm" disabled={pending} onClick={() => owners("partner")}>Ask {partner.displayName} to take it</Button>}
            {mine && <Button size="sm" variant="ghost" disabled={pending} onClick={() => owners("none")}>Put back in the shared list</Button>}
            <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { if (await run("ArchiveJob", { jobId: job.id, version: job.version })) onClose(); }}>Remove job</Button>
          </div>
        )}
        <ErrorNote message={error?.message} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** The compact list on Today: what's due, and anything asked of you. */
export function JobsToday({ data }: { data: JobsView }) {
  const app = useApp();
  const items = data.jobs.filter((j) => j.awaitingMyAnswer || ((j.status === "today" || j.status === "overdue") && (j.ownerId === app.me.id || !j.ownerId)));
  if (!items.length) return null;
  return (
    <>
      <SectionTitle action={<Link className="text-sm text-brand underline" href="/jobs">All jobs</Link>}>Jobs</SectionTitle>
      <Card><ul className="divide-y divide-line">{items.map((j) => <JobRow key={j.id} job={j} today={data.today} compact />)}</ul></Card>
    </>
  );
}
