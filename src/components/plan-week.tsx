"use client";

import { Coffee } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { WeekPick, WeekPicks } from "@/server/queries/picks";
import type { WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { AskHelperDialog } from "./ask-helper";
import { fmtDate, fmtTime, localParts } from "./format";
import { Badge, Button, Card, Checkbox, ChoiceCard, EmptyState, ErrorNote, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";
import { careLine, costLine, endDateOf } from "./week-picks";

type Kind = "me" | "family";
const HEADINGS: Record<Kind, { title: string; hint: string }> = {
  me: { title: "Time for you", hint: "One protected slot. Rest counts." },
  family: { title: "Family time", hint: "One thing everyone can enjoy." },
};

/**
 * The Sunday ten minutes: see the week, pick one thing of each kind (each
 * already matched to a free time), and send it all in one go. Time for the
 * two of you is deliberately not on the list: the plan only says, as a
 * fact, which evenings are free for you both.
 */
export function PlanWeekFlow({ week, picks, freeEvenings = [] }: { week: WeekView; picks: Partial<Record<Kind, WeekPicks>>; freeEvenings?: string[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const kinds = (Object.keys(picks) as Kind[]).filter((k) => picks[k]!.picks.some((p) => p.slot));
  const [choice, setChoice] = useState<Record<Kind, number | null>>(() => ({
    me: picks.me?.picks.findIndex((p) => p.slot) ?? null,
    family: picks.family?.picks.findIndex((p) => p.slot) ?? null,
  }));
  const [askPartner, setAskPartner] = useState(true);
  const [chosenBy, setChosenBy] = useState("");
  const [sent, setSent] = useState<{ kind: Kind; pick: WeekPick }[] | null>(null);
  const [asking, setAsking] = useState<WeekPick | null>(null);

  const partner = app.partner;
  const chosen = (k: Kind) => {
    const i = choice[k];
    return i === null || i < 0 ? null : (picks[k]?.picks[i] ?? null);
  };
  const selected = kinds.map((k) => ({ kind: k, pick: chosen(k) })).filter((x): x is { kind: Kind; pick: WeekPick } => !!x.pick?.slot);

  const agreed = week.moments.filter((m) => m.lifecycle === "planned" && m.agreed);
  const answers = week.moments.filter((m) => m.lifecycle === "planned" && m.sharing === "shared" && m.participantIds.includes(app.me.id) && m.myDecision !== "accepted");
  const gaps = week.care.flatMap((d) => d.groups.filter((g) => g.state !== "covered").map((g) => ({ date: d.date, reason: g.reason, childIds: g.childIds })));
  const busyDays = week.days.map((d) => ({ date: d, count: week.events.filter((e) => localParts(e.start, app.timeZone).date === d && !e.allDay).length }));

  async function send() {
    const items = selected.map(({ kind, pick }) => {
      const slot = pick.slot!;
      return {
        kind,
        title: pick.activity.title,
        activityKey: pick.activity.key,
        notes: pick.simpler && pick.activity.simpler ? pick.activity.simpler : pick.activity.summary,
        location: pick.activity.location ?? "",
        span: { allDay: false, startDate: slot.date, startTime: slot.startTime, endDate: endDateOf(slot), endTime: slot.endTime },
        participantIds: kind === "me" ? [app.me.id] : app.adults.map((a) => a.id),
        childIds: kind === "family" ? app.children.map((c) => c.id) : [],
        needsCare: kind !== "family" && app.children.length > 0,
        budgetMinor: pick.activity.typicalCostMinor || null,
        chosenByChildId: kind === "family" && chosenBy ? chosenBy : null,
        askPartnerToCover: kind === "me" && askPartner && pick.carer.kind === "partner",
      };
    });
    if (await run("PlanWeek", { weekKey: week.weekKey, items }, { expected: { membershipRevision: app.membershipRevision } })) setSent(selected);
  }

  if (sent) {
    const needHelp = sent.filter((s) => s.kind === "me" && (s.pick.carer.kind === "helper" || s.pick.carer.kind === "none"));
    return (
      <div className="max-w-2xl">
        <h1 className="font-display text-3xl">That&apos;s the week</h1>
        <p className="mt-2 text-ink-2">{partner ? `${partner.displayName} will get a notification and can answer everything in one go.` : "It's in the diary."}</p>
        <ul className="mt-4 flex flex-col gap-2">
          {sent.map(({ kind, pick }) => (
            <li key={kind}><Card tone={kind}><strong>{pick.activity.title}</strong> <span className="text-ink-3">· {fmtDate(pick.slot!.date)} {pick.slot!.startTime}</span></Card></li>
          ))}
        </ul>
        {needHelp.map(({ pick }) => (
          <Card key={pick.activity.key} className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p>“{pick.activity.title}” needs someone with the children.</p>
            <Button variant="primary" onClick={() => setAsking(pick)}>{app.helpers.length ? `Ask ${pick.carer.name ?? app.helpers[0].name}` : "Ask someone"}</Button>
          </Card>
        ))}
        <div className="mt-6 flex gap-3"><Link href="/today" className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-white">Done</Link><Link href={`/week?w=${week.weekKey}`} className="inline-flex min-h-11 items-center rounded-full border border-line px-5">See the week</Link></div>
        {asking && <AskHelperDialog childIds={app.children.map((c) => c.id)} start={asking.slot!.start} end={asking.slot!.end} onClose={() => setAsking(null)} />}
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl">Plan the week of {fmtDate(week.weekKey, { weekday: false, month: "long" })}</h1>
      <p className="mt-1 text-ink-2">About ten minutes. See what&apos;s on, pick one thing of each kind, and send it to {partner?.displayName ?? "the diary"} in one go.</p>
      {week.planning.planned && week.planning.weekKey === week.weekKey && <p className="mt-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand">This week has already been planned. You can still add more.</p>}

      <SectionTitle>1. What&apos;s already on</SectionTitle>
      <Card className="flex flex-col gap-3">
        <ul className="grid grid-cols-7 gap-1 text-center text-xs" aria-label="Commitments per day">
          {busyDays.map((d) => (
            <li key={d.date} className="rounded-lg bg-surface-2 px-1 py-2">
              <span className="block text-ink-3">{fmtDate(d.date).slice(0, 3)}</span>
              <span className="block text-base font-semibold">{d.count || "–"}</span>
              {week.markers[d.date] && <span className="block text-[10px] text-family">Bank hol</span>}
            </li>
          ))}
        </ul>
        {agreed.length > 0 && <p className="text-sm">Agreed: {agreed.map((m) => `${m.title} (${fmtDate(localParts(m.start, app.timeZone).date)} ${fmtTime(m.start, app.timeZone)})`).join(", ")}.</p>}
        {answers.length > 0 && (
          <p className="text-sm text-warn">
            {answers.length} plan{answers.length === 1 ? "" : "s"} waiting for your answer. <Link className="underline" href="/today">Answer</Link>
          </p>
        )}
        {gaps.length > 0 ? (
          <ul className="text-sm">
            {gaps.map((g, i) => (
              <li key={i} className="text-warn">{fmtDate(g.date)}: {g.childIds.map(app.childName).join(", ")} need{g.childIds.length === 1 ? "s" : ""} care ({g.reason}). <Link className="underline" href={`/holidays?date=${g.date}`}>Sort it</Link></li>
            ))}
          </ul>
        ) : (
          app.children.length > 0 && <p className="text-sm text-good">No childcare gaps this week.</p>
        )}
        {partner && freeEvenings.length > 0 && <p className="text-sm text-ink-2">Free for you and {partner.displayName}: {freeEvenings.map((d) => fmtDate(d)).join(", ")}, in the evening.</p>}
        {week.rituals.filter((r) => r.active).length > 0 && <p className="text-sm text-ink-2">Rituals: {week.rituals.filter((r) => r.active).map((r) => r.title).join(", ")}.</p>}
      </Card>

      {kinds.length === 0 && <div className="mt-8"><EmptyState icon={<Coffee />} title="This week is full.">No free time long enough for anything new. That&apos;s fine: rest is valid too.</EmptyState></div>}
      {kinds.map((k, n) => {
        const data = picks[k]!;
        return (
          <section key={k}>
            <SectionTitle>{n + 2}. {HEADINGS[k].title}</SectionTitle>
            <p className="-mt-2 mb-3 text-sm text-ink-3">{HEADINGS[k].hint}{data.lighterWeek ? " You said the week is heavy, so these start small." : ""}</p>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{HEADINGS[k].title}</legend>
              {data.picks.map((p, i) =>
                p.slot ? (
                  <ChoiceCard key={p.activity.key} name={`pick-${k}`} checked={choice[k] === i} onChange={() => setChoice({ ...choice, [k]: i })}>
                    <span className="block font-medium">{p.activity.title}{p.activity.local && <span className="ml-2 align-middle"><Badge tone="good">Your place</Badge></span>}</span>
                    <span className="mt-0.5 block text-sm text-ink-2">{fmtDate(p.slot.date)} · {p.slot.startTime}–{p.slot.endTime} · {costLine(p.activity.typicalCostMinor)}</span>
                    <span className={`block text-sm ${p.carer.kind === "helper" || p.carer.kind === "none" ? "text-warn" : "text-ink-3"}`}>{careLine(p, k, partner?.displayName ?? null)}</span>
                    {p.activity.weatherSensitive && p.activity.backup && <span className="block text-xs text-ink-3">If it rains: {p.activity.backup}</span>}
                  </ChoiceCard>
                ) : null,
              )}
              <ChoiceCard name={`pick-${k}`} checked={choice[k] === null} onChange={() => setChoice({ ...choice, [k]: null })}>
                <span className="text-ink-2">Not this week</span>
              </ChoiceCard>
            </fieldset>
            {k === "me" && chosen("me")?.carer.kind === "partner" && partner && (
              <div className="mt-2"><Checkbox checked={askPartner} onChange={setAskPartner} label={`Ask ${partner.displayName} to have the children then`} /></div>
            )}
            {k === "family" && chosen("family") && app.children.length > 1 && (
              <div className="mt-2">
                <label className="text-sm" htmlFor="chosen-by">Whose pick is it?</label>
                <select id="chosen-by" className={`${inputClass} mt-1`} value={chosenBy} onChange={(e) => setChosenBy(e.target.value)}>
                  <option value="">Nobody in particular</option>
                  {app.children.map((c) => <option key={c.id} value={c.id}>{c.preferredName}&apos;s pick</option>)}
                </select>
              </div>
            )}
          </section>
        );
      })}

      <div className="shadow-lift sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 backdrop-blur md:bottom-4">
        <span className="flex-1 text-sm text-ink-2">{selected.length ? `${selected.length} plan${selected.length === 1 ? "" : "s"}: ${selected.map((s) => s.pick.activity.title).join(", ")}` : "Nothing picked yet."}</span>
        <Button variant="primary" disabled={pending || !selected.length} onClick={send}>{partner ? `Send to ${partner.displayName}` : "Add to the diary"}</Button>
      </div>
      <ErrorNote message={error?.message} />
      {!partner && <p className="mt-2 text-sm text-ink-3"><Badge>Tip</Badge> Invite your partner in Settings so they can answer.</p>}
    </div>
  );
}
