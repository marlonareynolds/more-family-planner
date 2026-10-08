"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SuggestedTime } from "@/domain/free-time";
import { CATALOGUE } from "@/lib/catalogue";
import type { FreeTimes } from "@/server/queries/free-time";
import type { MomentView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { fmtDate, fmtRange, localParts } from "./format";
import { Button, Dialog, ErrorNote } from "./ui";
import { useCommand } from "./use-command";

const CARE_TEXT: Partial<Record<SuggestedTime["care"], string>> = {
  arranged: "care already arranged",
  pending: "care asked, not yet confirmed",
  partly_arranged: "care arranged for part of it",
  needs_care: "the children would need someone",
  partner_free: "your partner is free then",
};

/**
 * When a late shift, illness or a cancelled helper gets in the way: what
 * this plan touches, and a few workable choices. Each choice uses the
 * plan's existing rules, so a moved plan is asked again of anyone else in
 * it, and nothing is accepted on someone's behalf.
 */
export function RecoveryDialog({ moment: m, onClose }: { moment: MomentView; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [slots, setSlots] = useState<SuggestedTime[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);
  const minutes = Math.min(720, Math.max(30, Math.round((m.end - m.start) / 60_000)));
  const others = m.participantIds.filter((id) => id !== app.me.id);
  const canMove = m.momentKind !== "us" || m.organiserId === app.me.id;
  const activity = m.activityKey ? CATALOGUE.find((a) => a.key === m.activityKey) : undefined;
  const simpler = m.momentKind !== "us" ? (activity?.simpler ?? activity?.backup ?? null) : null;
  const date = localParts(m.start, app.timeZone).date;

  useEffect(() => {
    if (!looking) return;
    let live = true;
    fetch(`/api/v1/free-times?kind=${m.momentKind}&minutes=${minutes}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: FreeTimes) => {
        if (!live) return;
        // Not the slot it's already in.
        setSlots(d.slots.filter((s) => Math.abs(s.start - m.start) >= 30 * 60_000).slice(0, 3));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [looking, m.momentKind, m.start, minutes]);

  async function move(s: SuggestedTime) {
    const end = localParts(s.end, app.timeZone);
    if (await run("MoveMoment", { momentId: m.id, version: m.version, span: { allDay: false, startDate: s.date, startTime: s.startTime, endDate: end.date, endTime: end.time } })) onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Something's changed?">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <p className="font-medium">{m.title}, {fmtDate(date)}, {fmtRange(m.start, m.end, app.timeZone)}</p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {others.length > 0 && <li>With {others.map((id) => app.nameOf(id)).join(" and ")}</li>}
            {m.childIds.length > 0 && <li>{m.childIds.map(app.childName).join(", ")} {m.childIds.length === 1 ? "is" : "are"} part of it</li>}
            {m.needsCare && <li>The children need someone while it&apos;s on</li>}
            {m.expenseId && <li>It has costs entered; payments are kept whatever you choose</li>}
          </ul>
        </div>

        {canMove && (
          <section>
            <h3 className="font-medium">Another time</h3>
            <p className="text-sm text-ink-3">{others.length ? `${others.map((id) => app.nameOf(id)).join(" and ")} will be asked again before it counts as agreed.` : "Times you're free in the next two weeks."}</p>
            {!looking ? (
              <Button className="mt-2" size="sm" onClick={() => setLooking(true)}>Find free times</Button>
            ) : failed ? (
              <p className="mt-2 text-sm text-ink-3">Free times couldn&apos;t be loaded. Try again in a moment.</p>
            ) : !slots ? (
              <p className="mt-2 text-sm text-ink-3">Looking…</p>
            ) : slots.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Nothing free that fits in the next two weeks.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {slots.map((s) => (
                  <li key={s.start} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">{fmtDate(s.date)}, {s.startTime} to {s.endTime}{CARE_TEXT[s.care] ? ` · ${CARE_TEXT[s.care]}` : ""}</span>
                    <Button size="sm" disabled={pending} onClick={() => move(s)}>Move it here</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {simpler && (
          <section>
            <h3 className="font-medium">Keep the time, make it simpler</h3>
            <p className="text-sm text-ink-2">{simpler}</p>
            <Button className="mt-2" size="sm" disabled={pending} onClick={async () => { if (await run("SwapActivity", { momentId: m.id, version: m.version, title: simpler.replace(/\.$/, "").slice(0, 120), activityKey: null, location: "", reason: "simpler" })) onClose(); }}>Do the simpler version</Button>
          </section>
        )}

        {m.needsCare && (
          <section>
            <h3 className="font-medium">Ask someone else to have the children</h3>
            <p className="text-sm text-ink-3">It stays a request until they say yes.</p>
            <Link href={`/holidays?date=${date}`} className="mt-2 inline-flex min-h-9 items-center text-sm text-brand underline">Sort out care for {fmtDate(date)}</Link>
          </section>
        )}

        <section>
          <h3 className="font-medium">Leave it out this time</h3>
          <p className="text-sm text-ink-3">
            {m.momentKind === "me" ? "It stays on your Me page for a couple of weeks, in case you'd like the time back. Nobody else sees that." : others.length ? `${others.map((id) => app.nameOf(id)).join(" and ")} will be told.` : ""}
          </p>
          <Button className="mt-2" size="sm" variant="danger" disabled={pending} onClick={async () => { if (await run("CancelMoment", { momentId: m.id, version: m.version })) onClose(); }}>
            {m.ritualId ? "Skip just this date" : "Leave it out"}
          </Button>
        </section>
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}
