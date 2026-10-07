"use client";

import { useEffect, useState } from "react";
import type { WeekPick, WeekPicks } from "@/server/queries/picks";
import { useApp } from "./app-context";
import { fmtDate } from "./format";
import { MomentEditor, type MomentKind } from "./moment-editor";
import { Badge, Button, Card, SectionTitle } from "./ui";

export function careLine(p: WeekPick, kind: MomentKind, partnerName: string | null): string {
  if (p.carer.kind === "not_needed") return kind === "family" ? "Everyone's free" : kind === "us" ? "You're both free" : "You're free";
  if (p.carer.kind === "partner") return `${p.carer.name ?? partnerName ?? "Your partner"} is free for the children`;
  if (p.carer.kind === "helper") return `The children need looking after. Ask ${p.carer.name}?`;
  return "The children will need looking after";
}

export function costLine(minor: number): string {
  return minor === 0 ? "Free" : `About £${Math.round(minor / 100)}`;
}

export const endDateOf = (slot: { date: string; startTime: string; endTime: string }) =>
  slot.endTime < slot.startTime ? new Date(Date.parse(`${slot.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : slot.date;

/**
 * This fortnight's picks: three different ideas, each already matched to a
 * free time and to whoever could cover the children (spec 11.3 step 7).
 */
export function WeekPicksSection({ kind }: { kind: MomentKind }) {
  const app = useApp();
  const [data, setData] = useState<WeekPicks | null>(null);
  const [failed, setFailed] = useState(false);
  const [planning, setPlanning] = useState<WeekPick | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/v1/picks?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: WeekPicks) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [kind]);

  if (kind === "us" && app.adults.length < 2) return null;
  return (
    <section aria-labelledby={`picks-${kind}`}>
      <SectionTitle><span id={`picks-${kind}`}>Picks for the next two weeks</span></SectionTitle>
      {failed && <p className="text-sm text-bad">Picks couldn&apos;t be worked out just now.</p>}
      {!data && !failed && <p className="text-sm text-ink-3">Matching ideas to your free time…</p>}
      {data && data.picks.length === 0 && <p className="text-sm text-ink-2">Nothing in the starter ideas fits right now. Plan your own below.</p>}
      {data && data.lighterWeek && <p className="mb-2 text-sm text-ink-2">You said this week is heavy, so these start small.</p>}
      {data && (
        <ul className="grid gap-3 md:grid-cols-3">
          {data.picks.map((p) => (
            <li key={p.activity.key}>
              <Card tone={kind} className="flex h-full flex-col gap-2">
                <h3 className="font-semibold leading-snug">{p.activity.title}{p.activity.local && <span className="ml-2 align-middle"><Badge tone="good">Your place</Badge></span>}</h3>
                <p className="text-sm text-ink-2">{p.simpler && p.activity.simpler ? p.activity.simpler : p.activity.summary}</p>
                {p.slot ? (
                  <p className="text-sm">
                    <strong>{fmtDate(p.slot.date)} · {p.slot.startTime}–{p.slot.endTime}</strong>
                    <span className={`block ${p.carer.kind === "helper" || p.carer.kind === "none" ? "text-warn" : "text-ink-3"}`}>{careLine(p, kind, app.partner?.displayName ?? null)}</span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-3">No free time long enough in the next two weeks.</p>
                )}
                <p className="text-xs text-ink-3">
                  {costLine(p.activity.typicalCostMinor)}
                  {p.activity.weatherSensitive && p.activity.backup ? ` · If it rains: ${p.activity.backup}` : ""}
                </p>
                <div className="mt-auto pt-1">
                  <Button size="sm" variant="primary" onClick={() => setPlanning(p)}>Plan this</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data && data.uncertainFor.length > 0 && <p className="mt-2 text-xs text-warn">{data.uncertainFor.join(" and ")}: a calendar isn&apos;t up to date, so check the times.</p>}
      {planning && (
        <MomentEditor
          open
          onClose={() => setPlanning(null)}
          defaultDate={planning.slot?.date ?? new Date().toISOString().slice(0, 10)}
          template={{
            kind,
            title: planning.activity.title,
            activityKey: planning.activity.key,
            notes: planning.simpler && planning.activity.simpler ? planning.activity.simpler : planning.activity.summary,
            budgetMinor: planning.activity.typicalCostMinor || null,
            durationMinutes: planning.activity.durationMinutes,
            location: planning.activity.location,
            slot: planning.slot ? { date: planning.slot.date, startTime: planning.slot.startTime, endTime: planning.slot.endTime, endDate: endDateOf(planning.slot) } : undefined,
          }}
        />
      )}
    </section>
  );
}
