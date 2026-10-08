/**
 * The week's open decisions (integration brief, "Connect existing
 * decisions"): deadlines, Jobs without an agreed owner, unanswered care and
 * handover requests, plans waiting for an answer and clashes, each read from
 * the records that already exist and resolved with the action that already
 * exists for it. Nothing here creates, moves or dismisses a record.
 *
 * Each record keeps its own status words: an invitation waiting for an
 * answer, a Job asked of someone, and care proposed but not confirmed are
 * different things and are never merged into one label. A proposal is never
 * shown as agreed, and proposed care never counts as cover.
 *
 * Time for the two of you never appears: For Us plans stay on For Us and
 * Today, so the shared review carries no couple prompts (founder rule).
 */

export type DecisionKind = "deadline" | "job" | "plan" | "review" | "clash" | "care" | "handover" | "care-gap";

/** Who needs to act: you, the other adult, someone outside the household, or either of you. */
export type WaitingOn = { kind: "me" } | { kind: "adult"; id: string } | { kind: "outside"; name: string } | { kind: "anyone" };

export interface DecisionItem {
  key: string;
  kind: DecisionKind;
  /** The record the existing action works on. */
  targetId: string;
  /** What needs deciding, in plain words. */
  text: string;
  /** When it matters: local date, and a time where there is one. */
  date: string;
  time: string | null;
  waitingOn: WaitingOn;
  /** The record's own status, in its own words. */
  status: string;
  /** The ways to resolve it, all existing actions. "Not this week" is never offered for an obligation. */
  actions: DecisionAction[];
}

export type DecisionAction = "mark-done" | "take-it" | "ask-partner" | "answer-job" | "answer-plan" | "check-plan" | "open-plan" | "answer-care" | "answer-handover" | "arrange-care";

export interface DecisionJob {
  id: string;
  title: string;
  cadence: string;
  status: "overdue" | "today" | "upcoming" | "done";
  dueOn: string | null;
  dueTime: string | null;
  ownerId: string | null;
  proposedOwnerId: string | null;
  forTitle: string | null;
}

export interface DecisionMoment {
  id: string;
  momentKind: "me" | "us" | "family";
  title: string;
  start: number;
  organiserId: string;
  participantIds: string[];
  lifecycle: "draft" | "planned" | "completed" | "cancelled";
  sharing: "private" | "shared";
  agreed: boolean;
  decisions: Record<string, "accepted" | "alternative" | "declined" | null>;
  review: "current" | "needs_review";
  reviewReason: string | null;
  detailsHidden: boolean;
  conflicts: { start: number; title?: string }[];
}

export interface DecisionArrangement {
  id: string;
  kind: "parent" | "external" | "not_needed";
  responsibleAccountId: string | null;
  providerName: string | null;
  childIds: string[];
  start: number;
  end: number;
  state: "proposed" | "confirmed" | "declined";
  dropOff: { by: string | null; agreed: boolean };
  collect: { by: string | null; agreed: boolean };
}

export interface DecisionInput {
  me: string;
  /** Local dates [from, to): the week under review. Anything overdue before it is included too. */
  from: string;
  to: string;
  today: string;
  /** Local date and time of an instant, in the household's time zone. */
  local: (ms: number) => { date: string; time: string };
  names: (accountId: string) => string;
  childNames: (childIds: string[]) => string;
  jobs: readonly DecisionJob[];
  moments: readonly DecisionMoment[];
  /** Care arrangements still ahead, any state, that the viewer can see. */
  arrangements: readonly DecisionArrangement[];
  careGaps: readonly { date: string; childIds: string[]; reason: string; start: number | null }[];
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export function weekDecisions(input: DecisionInput): DecisionItem[] {
  const { me, from, to, today } = input;
  const inWeek = (date: string) => date < to && (date >= from || date >= today);
  const out: DecisionItem[] = [];

  // ── Jobs: deadlines (one-off Jobs, often from the Desk) and Jobs nobody has agreed to own ──
  for (const j of input.jobs) {
    if (j.status === "done" || !j.dueOn) continue;
    const overdue = j.status === "overdue";
    if (!overdue && !inWeek(j.dueOn)) continue;
    const deadline = j.cadence === "once";
    const what = j.forTitle ? `${j.title} (for ${j.forTitle})` : j.title;
    let waitingOn: WaitingOn;
    let status: string;
    let actions: DecisionAction[];
    if (j.proposedOwnerId === me) {
      waitingOn = { kind: "me" };
      status = "You've been asked to take this on";
      actions = ["answer-job"];
    } else if (j.proposedOwnerId) {
      waitingOn = { kind: "adult", id: j.proposedOwnerId };
      status = `Asked ${input.names(j.proposedOwnerId)}, not yet accepted`;
      actions = [];
    } else if (!j.ownerId) {
      waitingOn = { kind: "anyone" };
      status = "Nobody has taken this on";
      actions = ["take-it", "ask-partner"];
    } else if (deadline && j.ownerId === me) {
      // Owned and agreed: still worth seeing in the review, because it has a cut-off.
      waitingOn = { kind: "me" };
      status = "Yours";
      actions = ["mark-done"];
    } else if (deadline) {
      waitingOn = { kind: "adult", id: j.ownerId };
      status = `${input.names(j.ownerId)} has agreed to do this`;
      actions = [];
    } else {
      continue; // An owned repeating job is Today's business, not a decision.
    }
    out.push({
      key: `job:${j.id}:${j.dueOn}`,
      kind: deadline ? "deadline" : "job",
      targetId: j.id,
      text: deadline ? `${what}: due${j.dueTime ? ` by ${j.dueTime}` : ""}` : what,
      date: j.dueOn,
      time: j.dueTime,
      waitingOn,
      status: overdue ? `${status}. ${j.dueOn === today ? "The cut-off has passed" : "It's overdue"}` : status,
      actions,
    });
  }

  // ── Plans: invitations waiting for an answer, plans that need checking, and clashes ──
  for (const m of input.moments) {
    if (m.lifecycle !== "planned" || m.sharing !== "shared") continue;
    if (m.momentKind === "us") continue; // For Us stays out of shared planning.
    // Someone else's time to themselves is busy time to the viewer, not a decision.
    if (m.momentKind === "me" && m.organiserId !== me) continue;
    const at = input.local(m.start);
    if (!inWeek(at.date)) continue;
    const inIt = m.participantIds.includes(me) || m.momentKind === "family";
    if (!inIt) continue;
    if (m.review === "needs_review" && m.participantIds.includes(me)) {
      out.push({ key: `review:${m.id}`, kind: "review", targetId: m.id, text: `Check “${m.title}”`, date: at.date, time: at.time, waitingOn: { kind: "me" }, status: m.reviewReason ?? "Something changed", actions: ["check-plan"] });
      continue;
    }
    if (!m.agreed) {
      const mine = m.decisions[me];
      if (m.participantIds.includes(me) && mine !== "accepted") {
        out.push({
          key: `plan:${m.id}`,
          kind: "plan",
          targetId: m.id,
          text: `Answer “${m.title}”`,
          date: at.date,
          time: at.time,
          waitingOn: { kind: "me" },
          status: mine === "declined" ? "You said no; it stays proposed until it changes" : mine === "alternative" ? "You suggested another time" : "Waiting for your answer",
          actions: ["answer-plan"],
        });
      } else {
        const pending = m.participantIds.filter((p) => p !== me && m.decisions[p] !== "accepted");
        const declined = pending.filter((p) => m.decisions[p] === "declined");
        out.push({
          key: `plan:${m.id}`,
          kind: "plan",
          targetId: m.id,
          text: `“${m.title}”`,
          date: at.date,
          time: at.time,
          // A no comes back to the organiser to decide what to do; otherwise it waits on the other adult.
          waitingOn: declined.length && m.organiserId === me ? { kind: "me" } : pending[0] ? { kind: "adult", id: pending[0] } : { kind: "anyone" },
          status: declined.length
            ? `${declined.map(input.names).join(" and ")} said no`
            : pending.length
              ? `Proposed, waiting for ${pending.map(input.names).join(" and ")}`
              : "Proposed",
          actions: declined.length && m.organiserId === me ? ["open-plan"] : [],
        });
      }
      continue;
    }
    if (m.conflicts.length) {
      const c = m.conflicts[0];
      const clashAt = input.local(c.start).time;
      out.push({
        key: `clash:${m.id}:${m.conflicts.map((x) => x.start).join(",")}`,
        kind: "clash",
        targetId: m.id,
        text: `“${m.title}” overlaps ${c.title ? `“${c.title}”` : "something else"} at ${clashAt}`,
        date: at.date,
        time: at.time,
        waitingOn: m.organiserId === me ? { kind: "me" } : { kind: "adult", id: m.organiserId },
        status: "Agreed, but something now overlaps it",
        actions: ["open-plan"],
      });
    }
  }

  // ── Care: asks still waiting for a yes, and handovers nobody has agreed ──
  const asked: DecisionArrangement[] = [];
  for (const a of input.arrangements) {
    if (a.state === "declined") continue;
    const at = input.local(a.start);
    if (!inWeek(at.date)) continue;
    const kids = input.childNames(a.childIds);
    if (a.state === "proposed") {
      asked.push(a);
      if (a.kind === "parent" && a.responsibleAccountId === me) {
        out.push({ key: `care:${a.id}`, kind: "care", targetId: a.id, text: `Look after ${kids}`, date: at.date, time: at.time, waitingOn: { kind: "me" }, status: "Asked of you, not yet answered", actions: ["answer-care"] });
      } else if (a.kind === "parent" && a.responsibleAccountId) {
        out.push({ key: `care:${a.id}`, kind: "care", targetId: a.id, text: `${input.names(a.responsibleAccountId)} to look after ${kids}`, date: at.date, time: at.time, waitingOn: { kind: "adult", id: a.responsibleAccountId }, status: "Asked, not yet confirmed", actions: [] });
      } else if (a.kind === "external") {
        const who = a.providerName ?? "Someone outside the household";
        out.push({ key: `care:${a.id}`, kind: "care", targetId: a.id, text: `${who} to look after ${kids}`, date: at.date, time: at.time, waitingOn: { kind: "outside", name: who }, status: "Asked, not yet confirmed", actions: [] });
      }
      continue;
    }
    for (const leg of ["drop_off", "collect"] as const) {
      const h = leg === "drop_off" ? a.dropOff : a.collect;
      if (!h.by || h.agreed) continue;
      const when = input.local(leg === "drop_off" ? a.start : a.end);
      const what = `${leg === "drop_off" ? "Drop-off" : "Collection"} for ${kids}${a.providerName ? ` ${leg === "drop_off" ? "to" : "from"} ${a.providerName}` : ""}`;
      out.push({
        key: `handover:${a.id}:${leg}`,
        kind: "handover",
        targetId: a.id,
        text: what,
        date: when.date,
        time: when.time,
        waitingOn: h.by === me ? { kind: "me" } : { kind: "adult", id: h.by },
        status: h.by === me ? "Asked of you, not yet answered" : `Asked ${input.names(h.by)}, not yet agreed`,
        actions: h.by === me ? ["answer-handover"] : [],
      });
    }
  }

  // ── Care gaps nobody has asked anyone about yet ──
  for (const g of input.careGaps) {
    if (!inWeek(g.date)) continue;
    const pendingAsk = asked.some((a) => g.childIds.some((c) => a.childIds.includes(c)) && input.local(a.start).date === g.date && (g.start === null || overlaps(a, { start: g.start, end: g.start + 1 })));
    out.push({
      key: `gap:${g.date}:${g.childIds.join(",")}:${g.reason}`,
      kind: "care-gap",
      targetId: g.date,
      text: `${input.childNames(g.childIds)} need${g.childIds.length === 1 ? "s" : ""} care (${g.reason})`,
      date: g.date,
      time: g.start === null ? null : input.local(g.start).time,
      waitingOn: { kind: "anyone" },
      status: pendingAsk ? "Someone has been asked; not covered until they say yes" : "Nobody arranged yet",
      actions: ["arrange-care"],
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.key.localeCompare(b.key));
}

/** Split for display: yours to answer, either of you, and waiting on someone else. */
export function groupDecisions(items: readonly DecisionItem[]) {
  return {
    mine: items.filter((i) => i.waitingOn.kind === "me"),
    either: items.filter((i) => i.waitingOn.kind === "anyone"),
    others: items.filter((i) => i.waitingOn.kind === "adult" || i.waitingOn.kind === "outside"),
  };
}
