"use client";

import { useState } from "react";
import type { LookBack } from "@/server/queries/look-back";
import { useApp } from "./app-context";
import { fmtDate, todayIn } from "./format";
import { MomentEditor } from "./moment-editor";
import { Card, SectionTitle } from "./ui";

/**
 * When each child last had an hour alone with each adult. Shown plainly,
 * never scored (spec 6.3): a nudge, not a league table.
 */
export function OneToOne({ pairs }: { pairs: LookBack["oneToOne"] }) {
  const app = useApp();
  const [planning, setPlanning] = useState<LookBack["oneToOne"][number] | null>(null);
  if (!pairs.length) return null;
  const today = todayIn(app.timeZone);
  const ago = (date: string | null) => {
    if (!date) return "not yet";
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${fmtDate(date)}`;
  };
  return (
    <section>
      <SectionTitle>One-to-one time</SectionTitle>
      <Card>
        <p className="mb-2 text-sm text-ink-3">An hour with one child, just the two of you. The last one for each:</p>
        <ul className="divide-y divide-line">
          {pairs.map((p) => (
            <li key={`${p.adultId}:${p.childId}`} className="flex items-center justify-between gap-3 py-2">
              <span className="text-[15px]">
                {p.adultId === app.me.id ? "You" : p.adultName} and {p.childName}: <span className="text-ink-3">{ago(p.lastDate)}</span>
              </span>
              {p.adultId === app.me.id && <button className="shrink-0 text-sm text-brand underline" onClick={() => setPlanning(p)}>Plan one</button>}
            </li>
          ))}
        </ul>
      </Card>
      {planning && (
        <MomentEditor
          open
          onClose={() => setPlanning(null)}
          defaultDate={today}
          template={{ kind: "family", title: `${planning.childName} and me`, durationMinutes: 60, adultIds: [planning.adultId], childIds: [planning.childId], chosenByChildId: planning.childId, activityKey: "fam-one-to-one" }}
        />
      )}
    </section>
  );
}
