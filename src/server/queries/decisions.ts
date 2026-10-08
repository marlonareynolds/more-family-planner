import { weekDecisions, type DecisionItem } from "@/domain/decisions";
import { instantToLocal, instantToLocalDate } from "@/domain/time";
import type { JobsView } from "./jobs";
import type { WeekView } from "./week";

/**
 * The open decisions between `from` and `to` (local dates, `to` exclusive)
 * for the viewer of `week`. Reads only the viewer's own projections, so
 * anything withheld from them (a partner's private time, a surprise, a
 * private draft) is already withheld here.
 */
export function decisionsFor(week: WeekView, jobs: JobsView, range: { from: string; to: string }, now = new Date()): DecisionItem[] {
  const tz = week.household.timeZone;
  const name = (id: string) => (id === week.me.id ? "you" : (week.adults.find((a) => a.id === id)?.displayName ?? "your partner"));
  const childNames = (ids: string[]) => {
    const list = ids.map((id) => week.children.find((c) => c.id === id)?.preferredName ?? "A child");
    return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "The children");
  };
  // A care need caused by a For Us plan is still shown, because the children
  // need someone, but never with what the plan is: the review carries no couple plans.
  const couple = new Set(week.moments.filter((m) => m.momentKind === "us").map((m) => m.title));
  const reasonFor = (reason: string) => (couple.has(reason) ? "you're both out" : reason);
  return weekDecisions({
    me: week.me.id,
    from: range.from,
    to: range.to,
    today: instantToLocalDate(now.getTime(), tz),
    local: (ms) => ({ date: instantToLocalDate(ms, tz), time: instantToLocal(ms, tz).toPlainTime().toString().slice(0, 5) }),
    names: name,
    childNames,
    jobs: jobs.jobs,
    moments: week.moments,
    arrangements: week.careOpen,
    careGaps: week.care.flatMap((d) => d.groups.filter((g) => g.state !== "covered").map((g) => ({ date: d.date, childIds: g.childIds, reason: reasonFor(g.reason), start: g.gaps[0]?.start ?? null }))),
  });
}
