import { Temporal } from "@js-temporal/polyfill";
import { cadenceLabel as ritualCadenceLabel, ritualDates } from "./rituals";

/**
 * Household jobs (the shared load). A job is due on dates that follow its
 * cadence. Only the latest due date counts: a missed week is not a backlog,
 * because next week's bins matter more than last week's.
 */

export type JobCadence = "once" | "weekly" | "fortnightly" | "monthly" | "yearly";

export interface JobRule {
  cadence: JobCadence;
  startsOn: string;
}

/** Due dates from `from` to `to` inclusive. */
export function jobDates(rule: JobRule, from: string, to: string): string[] {
  if (rule.cadence === "once") return rule.startsOn >= from && rule.startsOn <= to ? [rule.startsOn] : [];
  if (rule.cadence === "yearly") {
    const start = Temporal.PlainDate.from(rule.startsOn);
    const out: string[] = [];
    const lo = Temporal.PlainDate.from(from);
    const hi = Temporal.PlainDate.from(to);
    for (let y = Math.max(lo.year, start.year); y <= hi.year; y++) {
      // 29 February falls back to the 28th in other years.
      const d = Temporal.PlainDate.from({ year: y, month: start.month, day: start.day }, { overflow: "constrain" });
      if (Temporal.PlainDate.compare(d, lo) >= 0 && Temporal.PlainDate.compare(d, hi) <= 0 && Temporal.PlainDate.compare(d, start) >= 0) out.push(d.toString());
    }
    return out;
  }
  return ritualDates({ cadence: rule.cadence, startsOn: rule.startsOn }, from, to);
}

const addDays = (date: string, n: number) => Temporal.PlainDate.from(date).add({ days: n }).toString();

/** The latest due date on or before `today`, if any. */
export function lastDue(rule: JobRule, today: string): string | null {
  const back = rule.cadence === "yearly" ? 366 : rule.cadence === "monthly" ? 40 : rule.cadence === "fortnightly" ? 14 : rule.cadence === "weekly" ? 7 : 3660;
  const dates = jobDates(rule, addDays(today, -back), today);
  return dates.at(-1) ?? null;
}

/** The first due date after `today`, if any. */
export function nextDue(rule: JobRule, today: string): string | null {
  const ahead = rule.cadence === "yearly" ? 367 : rule.cadence === "once" ? 3660 : 40;
  return jobDates(rule, addDays(today, 1), addDays(today, ahead))[0] ?? null;
}

export type JobStatus = "overdue" | "today" | "upcoming" | "done";

/**
 * Where a job stands today. The latest due date that has passed and isn't
 * done is what needs doing; otherwise the next one is coming up.
 */
export function jobStatus(rule: JobRule, today: string, done: ReadonlySet<string>): { status: JobStatus; dueOn: string | null } {
  const last = lastDue(rule, today);
  if (last && !done.has(last)) return { status: last === today ? "today" : "overdue", dueOn: last };
  const next = nextDue(rule, today);
  if (next) return { status: "upcoming", dueOn: next };
  return { status: "done", dueOn: last };
}

export function jobCadenceLabel(rule: JobRule): string {
  const d = Temporal.PlainDate.from(rule.startsOn);
  if (rule.cadence === "once") return `Once, ${d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  if (rule.cadence === "yearly") return `Every year on ${d.toLocaleString("en-GB", { day: "numeric", month: "long" })}`;
  return ritualCadenceLabel(rule.cadence, rule.startsOn);
}

/** Rough minutes a job takes in an average month, for the share view. */
export function monthlyMinutes(cadence: JobCadence, minutes: number): number {
  const perMonth = { once: 0, weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1, yearly: 1 / 12 }[cadence];
  return Math.round(minutes * perMonth);
}

/** Common jobs to start from, so nobody faces a blank page. */
export const JOB_STARTERS: { title: string; cadence: JobCadence; minutes: number; remindDayBefore: boolean; hint: string }[] = [
  { title: "Bins out", cadence: "weekly", minutes: 10, remindDayBefore: true, hint: "Pick your collection day" },
  { title: "Recycling out", cadence: "fortnightly", minutes: 10, remindDayBefore: true, hint: "Pick your collection day" },
  { title: "PE kit and swimming bag", cadence: "weekly", minutes: 10, remindDayBefore: true, hint: "The day it's needed" },
  { title: "School emails, forms and payments", cadence: "weekly", minutes: 30, remindDayBefore: false, hint: "A regular catch-up day" },
  { title: "Meal plan and food order", cadence: "weekly", minutes: 45, remindDayBefore: false, hint: "Before the shop" },
  { title: "Book bags and reading records", cadence: "weekly", minutes: 10, remindDayBefore: true, hint: "The day they go back" },
  { title: "Clean bedding", cadence: "fortnightly", minutes: 40, remindDayBefore: false, hint: "A weekend day" },
  { title: "Pay childcare and clubs", cadence: "monthly", minutes: 15, remindDayBefore: false, hint: "When invoices arrive" },
  { title: "Birthday presents and cards coming up", cadence: "monthly", minutes: 30, remindDayBefore: false, hint: "Early in the month" },
  { title: "Check the calendar for the month ahead", cadence: "monthly", minutes: 20, remindDayBefore: false, hint: "The last weekend" },
];
