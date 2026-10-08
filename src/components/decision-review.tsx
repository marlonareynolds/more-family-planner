"use client";

import Link from "next/link";
import { useState } from "react";
import { groupDecisions, type DecisionItem } from "@/domain/decisions";
import type { JobsView } from "@/server/queries/jobs";
import type { WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { fmtDate } from "./format";
import { MomentCard } from "./moment-card";
import { Button, Card, ErrorNote } from "./ui";
import { useCommand } from "./use-command";

/**
 * The week's open decisions, short first: what needs deciding, when it
 * matters, whose answer is needed and the record's own status, with the
 * action that already resolves it. Details open on demand.
 */
export function DecisionReview({ items, week, jobs }: { items: DecisionItem[]; week: WeekView; jobs: JobsView }) {
  const app = useApp();
  const groups = groupDecisions(items);
  const partner = app.partner?.displayName ?? "your partner";
  if (!items.length) return <p className="text-sm text-good">Nothing is waiting to be decided this week.</p>;
  const section = (title: string, hint: string, list: DecisionItem[]) =>
    list.length > 0 && (
      <div>
        <h3 className="text-sm font-medium text-ink-2">{title}</h3>
        <p className="text-xs text-ink-3">{hint}</p>
        <ul className="mt-1 divide-y divide-line">
          {list.map((i) => <DecisionRow key={i.key} item={i} week={week} jobs={jobs} />)}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {section("For you to answer", "Only your own decisions. Each one saves on its own.", groups.mine)}
      {section("Either of you", "Nobody has this yet. Take it, or ask.", groups.either)}
      {section(`Waiting on someone else`, `Asked of ${partner} or a helper. Nothing here counts as agreed until they say yes.`, groups.others)}
    </div>
  );
}

function DecisionRow({ item: i, week, jobs }: { item: DecisionItem; week: WeekView; jobs: JobsView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [open, setOpen] = useState(false);
  const job = i.kind === "deadline" || i.kind === "job" ? jobs.jobs.find((j) => j.id === i.targetId) : undefined;
  const moment = i.kind === "plan" || i.kind === "review" || i.kind === "clash" ? week.moments.find((m) => m.id === i.targetId) : undefined;
  const care = i.kind === "care" || i.kind === "handover" ? week.careOpen.find((a) => a.id === i.targetId) : undefined;
  const leg = i.kind === "handover" ? (i.key.endsWith(":drop_off") ? "drop_off" : "collect") : null;
  const has = (a: DecisionItem["actions"][number]) => i.actions.includes(a);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{i.text}</p>
          <p className="text-sm text-ink-3">
            {fmtDate(i.date)}{i.time ? ` ${i.time}` : ""} · {i.status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job && has("mark-done") && job.dueOn && <Button size="sm" variant="primary" disabled={pending} onClick={() => run("MarkJobDone", { jobId: job.id, dueOn: job.dueOn })}>Done</Button>}
          {job && has("take-it") && <Button size="sm" disabled={pending} onClick={() => run("ProposeJobOwner", { jobId: job.id, version: job.version, to: "me" })}>I&apos;ll take it</Button>}
          {job && has("ask-partner") && app.partner && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ProposeJobOwner", { jobId: job.id, version: job.version, to: "partner" })}>Ask {app.partner.displayName}</Button>}
          {job && has("answer-job") && (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: job.id, version: job.version, accept: true })}>Yes, it&apos;s mine</Button>
              <Button size="sm" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: job.id, version: job.version, accept: false })}>Not now</Button>
            </>
          )}
          {care && has("answer-care") && (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => run("RespondToCare", { arrangementId: care.id, version: care.version, decision: "confirm" })}>Yes, I&apos;ll do it</Button>
              <Button size="sm" disabled={pending} onClick={() => run("RespondToCare", { arrangementId: care.id, version: care.version, decision: "decline" })}>I can&apos;t</Button>
            </>
          )}
          {care && leg && has("answer-handover") && (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => run("RespondToHandover", { arrangementId: care.id, version: care.version, leg, decision: "agree" })}>Yes, I&apos;ll do it</Button>
              <Button size="sm" disabled={pending} onClick={() => run("RespondToHandover", { arrangementId: care.id, version: care.version, leg, decision: "decline" })}>I can&apos;t</Button>
            </>
          )}
          {has("arrange-care") && <Link className="inline-flex min-h-9 items-center text-sm text-brand underline" href={`/holidays?date=${i.date}`}>Sort it</Link>}
          {moment && (has("answer-plan") || has("check-plan") || has("open-plan")) && (
            <Button size="sm" variant={has("answer-plan") ? "primary" : "secondary"} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Close" : has("answer-plan") ? "Answer" : "Open"}
            </Button>
          )}
        </div>
      </div>
      {open && moment && <div className="mt-2"><MomentCard moment={moment} expense={week.expenses.find((x) => x.id === moment.expenseId)} /></div>}
      <ErrorNote message={error?.message} />
    </li>
  );
}

/** Today's link into the same decisions: counts only, and where to resolve them. */
export function DecisionSummary({ items, until }: { items: DecisionItem[]; until: string }) {
  const app = useApp();
  const g = groupDecisions(items);
  if (!items.length) return null;
  const parts = [
    g.mine.length ? `${g.mine.length} for you` : null,
    g.either.length ? `${g.either.length} nobody has yet` : null,
    g.others.length ? `${g.others.length} waiting on ${app.partner && g.others.every((i) => i.waitingOn.kind === "adult") ? app.partner.displayName : "someone else"}` : null,
  ].filter(Boolean);
  return (
    <Card className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">Decisions to make by {fmtDate(until)}</p>
        <p className="text-sm text-ink-2">{parts.join(" · ")}</p>
      </div>
      <Link href="/plan#decisions" className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-5">Review</Link>
    </Card>
  );
}
