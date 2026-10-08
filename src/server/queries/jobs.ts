import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobDone, jobStepDone, jobSteps, jobs } from "@/db/schema";
import { jobCadenceLabel, jobStatus, monthlyMinutes, type JobCadence, type JobStatus } from "@/domain/jobs";
import { addDays, instantToLocal, instantToLocalDate } from "@/domain/time";
import type { Actor } from "../auth";
import { currentAdults } from "../commands/helpers";
import { linkedTitles } from "../linked";
import { householdFor } from "./week";

export interface JobView {
  id: string;
  title: string;
  notes: string;
  cadence: JobCadence;
  startsOn: string;
  remindDayBefore: boolean;
  minutes: number;
  cadenceLabel: string;
  ownerId: string | null;
  ownerName: string | null;
  proposedOwnerId: string | null;
  proposedByName: string | null;
  /** Your partner asked you to take this on. */
  awaitingMyAnswer: boolean;
  status: JobStatus;
  dueOn: string | null;
  /** A precise cut-off on the due day ("12:00" for "by noon"). */
  dueTime: string | null;
  /** The diary item it is for, if the viewer may see it ("Year 4 Trip to the Science Museum"). */
  forTitle: string | null;
  /** Cooking or clearing up for a dinner: that dinner's id and part. */
  dinner: { id: string; role: "cook" | "clear" } | null;
  /** The optional checklist, ticked for the due date shown. */
  steps: { id: string; text: string; done: boolean }[];
  /** Who did the most recent due date, if it's done. */
  lastDoneBy: string | null;
  lastDoneOn: string | null;
  version: number;
}

export interface ShareLine {
  accountId: string;
  name: string;
  jobs: number;
  minutesPerMonth: number;
}

export interface JobsView {
  today: string;
  jobs: JobView[];
  /** Who looks after what. Counts and rough time, never a score. */
  share: ShareLine[];
  unowned: { jobs: number; minutesPerMonth: number };
}

export async function jobsFor(db: Db, actor: Actor, now = new Date()): Promise<JobsView> {
  const household = await householdFor(db, actor);
  if (!household) return { today: "", jobs: [], share: [], unowned: { jobs: 0, minutesPerMonth: 0 } };
  const today = instantToLocalDate(now.getTime(), household.timeZone);
  const adults = await currentAdults(db, household.id);
  const name = (id: string | null) => (id ? (adults.find((a) => a.id === id)?.displayName ?? null) : null);
  const all = await db.select().from(jobs).where(and(eq(jobs.householdId, household.id), isNull(jobs.archivedAt))).orderBy(jobs.createdAt);
  // A dinner's job for an evening that's gone is history, not something overdue.
  const rows = all.filter((j) => !(j.forType === "dinner" && j.startsOn < today));
  const steps = rows.length ? await db.select().from(jobSteps).where(inArray(jobSteps.jobId, rows.map((j) => j.id))).orderBy(jobSteps.position) : [];
  const ticks = steps.length ? await db.select().from(jobStepDone).where(inArray(jobStepDone.stepId, steps.map((s) => s.id))) : [];
  const ticked = new Set(ticks.map((t) => `${t.stepId}:${t.dueOn}`));
  const done = await db.select().from(jobDone).where(and(eq(jobDone.householdId, household.id), gte(jobDone.dueOn, addDays(today, -400))));
  const doneBy = new Map(done.map((d) => [`${d.jobId}:${d.dueOn}`, d.doneBy]));

  // What each job is for, shown only where the viewer can see that item.
  const forTitles = await linkedTitles(
    db,
    household.id,
    actor.accountId,
    rows.flatMap((j) => (j.forType && j.forId ? [{ type: j.forType, id: j.forId }] : [])),
  );
  const nowClock = instantToLocal(now.getTime(), household.timeZone).toPlainTime().toString().slice(0, 5);

  const order: Record<JobStatus, number> = { overdue: 0, today: 1, upcoming: 2, done: 3 };
  const out: JobView[] = rows.map((j) => {
    const doneSet = new Set(done.filter((d) => d.jobId === j.id).map((d) => d.dueOn));
    const due = jobStatus(j, today, doneSet);
    // "By 12 noon": past the cut-off on the day, it is overdue.
    const status: JobStatus = due.status === "today" && j.dueTime && nowClock > j.dueTime ? "overdue" : due.status;
    const dueOn = due.dueOn;
    const recent = [...doneSet].filter((d) => d <= today).sort().at(-1) ?? null;
    return {
      id: j.id,
      title: j.title,
      notes: j.notes,
      cadence: j.cadence,
      startsOn: j.startsOn,
      remindDayBefore: j.remindDayBefore,
      minutes: j.minutes,
      cadenceLabel: jobCadenceLabel(j),
      ownerId: j.ownerId,
      ownerName: name(j.ownerId),
      proposedOwnerId: j.proposedOwnerId,
      proposedByName: name(j.proposedBy),
      awaitingMyAnswer: j.proposedOwnerId === actor.accountId,
      status,
      dueOn,
      dueTime: j.dueTime,
      forTitle: j.forId ? (forTitles.get(j.forId) ?? null) : null,
      dinner: j.forType === "dinner" && j.forId && j.role ? { id: j.forId, role: j.role } : null,
      steps: steps.filter((s) => s.jobId === j.id).map((s) => ({ id: s.id, text: s.text, done: !!dueOn && ticked.has(`${s.id}:${dueOn}`) })),
      lastDoneBy: recent ? name(doneBy.get(`${j.id}:${recent}`) ?? null) : null,
      lastDoneOn: recent,
      version: j.version,
    };
  });
  out.sort((a, b) => order[a.status] - order[b.status] || (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9"));

  const recurring = rows.filter((j) => j.cadence !== "once");
  const share = adults.map((a) => {
    const theirs = recurring.filter((j) => j.ownerId === a.id);
    return { accountId: a.id, name: a.displayName, jobs: theirs.length, minutesPerMonth: theirs.reduce((s, j) => s + monthlyMinutes(j.cadence, j.minutes), 0) };
  });
  const free = recurring.filter((j) => !j.ownerId);
  return { today, jobs: out, share, unowned: { jobs: free.length, minutesPerMonth: free.reduce((s, j) => s + monthlyMinutes(j.cadence, j.minutes), 0) } };
}
