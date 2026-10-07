"use client";

import { Heart, Leaf, Users } from "lucide-react";
import { useState } from "react";
import type { MomentView, WeekView } from "@/server/queries/week";
import { useApp, useNow } from "./app-context";
import { todayIn } from "./format";
import { MomentCard } from "./moment-card";
import { MomentEditor, type MomentKind } from "./moment-editor";
import { FindATime } from "./find-a-time";
import { RitualsSection } from "./rituals";
import { WeekPicksSection } from "./week-picks";
import { Button, EmptyState, SectionTitle } from "./ui";

const EMPTY: Record<MomentKind, { title: string; body: string }> = {
  us: { title: "Nothing just for the two of you yet.", body: "It doesn't need to be big. A walk, a takeaway on the sofa, an hour with phones away." },
  family: { title: "No family plans yet.", body: "Something small to look forward to together: the park, pancakes, a film with blankets." },
  me: { title: "No time for you yet.", body: "A swim, a coffee alone, an hour to read. Protected time makes everything else easier." },
};

/** Moments of one kind, split by what each adult needs to do next. */
export function MomentList({ data, kind, title, intro }: { data: WeekView; kind: MomentKind; title: string; intro: string }) {
  const app = useApp();
  const [creating, setCreating] = useState(false);
  const now = useNow();
  const mine = data.moments.filter((m) => m.momentKind === kind);
  const waiting = mine.filter((m) => m.lifecycle === "planned" && m.end > now && m.participantIds.includes(app.me.id) && m.myDecision !== "accepted");
  const upcoming = mine.filter((m) => m.lifecycle === "planned" && m.end > now && !waiting.includes(m));
  const drafts = mine.filter((m) => m.lifecycle === "draft");
  const past = mine.filter((m) => m.lifecycle === "completed" || (m.lifecycle === "planned" && m.end <= now)).reverse();
  const card = (m: MomentView) => (
    <li key={m.id}>
      <MomentCard moment={m} expense={data.expenses.find((e) => e.id === m.expenseId)} />
    </li>
  );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="mt-1 max-w-prose text-ink-2">{intro}</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>+ Plan something</Button>
      </div>
      {waiting.length > 0 && (<><SectionTitle>Waiting for your answer</SectionTitle><ul className="flex flex-col gap-3">{waiting.map(card)}</ul></>)}
      <WeekPicksSection kind={kind} />
      <SectionTitle>Coming up</SectionTitle>
      {upcoming.length ? <ul className="flex flex-col gap-3">{upcoming.map(card)}</ul> : <EmptyState icon={kind === "us" ? <Heart /> : kind === "me" ? <Leaf /> : <Users />} tone={kind} title={EMPTY[kind].title} action={<Button variant="primary" onClick={() => setCreating(true)}>Plan something</Button>}>{EMPTY[kind].body}</EmptyState>}
      <RitualsSection kind={kind} rituals={data.rituals} />
      <FindATime kind={kind} />
      {drafts.length > 0 && (<><SectionTitle>Your drafts</SectionTitle><p className="-mt-2 mb-3 text-sm text-ink-3">Only you can see these until you share them.</p><ul className="flex flex-col gap-3">{drafts.map(card)}</ul></>)}
      {past.length > 0 && (<><SectionTitle>Recently</SectionTitle><ul className="flex flex-col gap-3">{past.map(card)}</ul></>)}
      {creating && <MomentEditor open onClose={() => setCreating(false)} template={{ kind, title: "" }} defaultDate={todayIn(app.timeZone)} />}
    </div>
  );
}
