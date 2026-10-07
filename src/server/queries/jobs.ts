import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobDone, jobs } from "@/db/schema";
import { jobCadenceLabel, jobStatus, monthlyMinutes, type JobCadence, type JobStatus } from "@/domain/jobs";
import { addDays, instantToLocalDate } from "@/domain/time";
import type { Actor } from "../auth";
import { currentAdults } from "../commands/helpers";
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
  const rows = await db.select().from(jobs).where(and(eq(jobs.householdId, household.id), isNull(jobs.archivedAt))).orderBy(jobs.createdAt);
  const done = await db.select().from(jobDone).where(and(eq(jobDone.householdId, household.id), gte(jobDone.dueOn, addDays(today, -400))));
  const doneBy = new Map(done.map((d) => [`${d.jobId}:${d.dueOn}`, d.doneBy]));

  const order: Record<JobStatus, number> = { overdue: 0, today: 1, upcoming: 2, done: 3 };
  const out: JobView[] = rows.map((j) => {
    const doneSet = new Set(done.filter((d) => d.jobId === j.id).map((d) => d.dueOn));
    const { status, dueOn } = jobStatus(j, today, doneSet);
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
