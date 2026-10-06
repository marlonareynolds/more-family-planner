"use client";

import { useState } from "react";
import { matchActivities, type Activity, type AgeBand, type Setting } from "@/lib/catalogue";
import { useApp } from "./app-context";
import { fmtMoney, todayIn } from "./format";
import { MomentEditor } from "./moment-editor";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Segmented, inputClass } from "./ui";

type GuidanceMap = Record<string, { guidance: "allow" | "avoid" | "simplify"; source: "explicit" | "inferred"; reason?: string }>;

/**
 * Suggestions from the starter catalogue. Hard constraints filter; the
 * viewer's own private guidance hides or simplifies; no-match is honest.
 */
export function Ideas({ kind, guidance, lighterWeek = false }: { kind: Activity["kind"]; guidance: GuidanceMap; lighterWeek?: boolean }) {
  const app = useApp();
  const [maxCost, setMaxCost] = useState<string>("any");
  const [setting, setSetting] = useState<Setting | "any">("any");
  // A heavy week (from your own private check-in) starts with low-effort ideas.
  const [lowEffort, setLowEffort] = useState(lighterWeek);
  const [maxMinutes, setMaxMinutes] = useState<string>("any");
  const [rainProof, setRainProof] = useState(false);
  const [calm, setCalm] = useState(false);
  const [stepFree, setStepFree] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [planning, setPlanning] = useState<Activity | null>(null);
  const bands = [...new Set(app.children.map((c) => c.ageBand as AgeBand))];

  const matches = matchActivities({
    kind,
    childAgeBands: bands,
    maxCostMinor: maxCost === "any" ? null : Number(maxCost),
    setting,
    lowEffort,
    rainProof,
    calm,
    stepFree,
    maxMinutes: maxMinutes === "any" ? null : Number(maxMinutes),
  });
  const avoided = matches.filter((a) => guidance[a.key]?.guidance === "avoid");
  const shown = showHidden ? matches : matches.filter((a) => guidance[a.key]?.guidance !== "avoid");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Budget">
          {(id) => (
            <select id={id} className={`${inputClass} w-auto`} value={maxCost} onChange={(e) => setMaxCost(e.target.value)}>
              <option value="any">Any</option>
              <option value="0">Free</option>
              <option value="1500">Up to £15</option>
              <option value="5000">Up to £50</option>
              <option value="10000">Up to £100</option>
            </select>
          )}
        </Field>
        <Field label="Time">
          {(id) => (
            <select id={id} className={`${inputClass} w-auto`} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}>
              <option value="any">Any length</option>
              <option value="60">An hour or less</option>
              <option value="120">Up to 2 hours</option>
              <option value="240">Up to half a day</option>
            </select>
          )}
        </Field>
        <Segmented
          label="Setting"
          value={setting}
          onChange={setSetting}
          options={[
            { value: "any", label: "Anywhere" },
            { value: "home", label: "Home" },
            { value: "outdoors", label: "Outdoors" },
            { value: "out-indoors", label: "Out, indoors" },
          ]}
        />
        <Checkbox checked={lowEffort} onChange={setLowEffort} label="Low effort this week" />
        <Checkbox checked={rainProof} onChange={setRainProof} label="Works if it rains" />
        <Checkbox checked={calm} onChange={setCalm} label="Calm and quiet" />
        <Checkbox checked={stepFree} onChange={setStepFree} label="Step-free" />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="Nothing in the starter ideas fits all of that.">Try a wider budget or setting, or plan your own.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((a) => {
            const g = guidance[a.key];
            const simplify = lowEffort || g?.guidance === "simplify";
            return (
              <li key={a.key}>
                <Card className="flex h-full flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{a.title}</h3>
                    <span className="flex flex-wrap gap-1">
                      {g?.guidance === "simplify" && <Badge tone="warn">Try it shorter</Badge>}
                      {g?.guidance === "avoid" && <Badge>Hidden for you</Badge>}
                    </span>
                  </div>
                  <p className="text-sm text-ink-2">{simplify && a.simpler ? a.simpler : a.summary}</p>
                  <p className="text-xs text-ink-3">
                    {a.typicalCostMinor === 0 ? "Free" : `About £${Math.round(a.typicalCostMinor / 100)}`} · {a.durationMinutes >= 600 ? "overnight" : `${Math.round(a.durationMinutes / 15) * 15} min`} · {a.preparation} prep
                    {a.weatherSensitive ? " · weather dependent" : ""}
                    {a.sensoryLoad === "high" ? " · busy and loud" : a.sensoryLoad === "low" ? " · calm" : ""}
                    {a.stepFree ? " · usually step-free" : ""}
                  </p>
                  {a.weatherSensitive && a.backup && <p className="text-xs text-ink-3">If it rains: {a.backup}</p>}
                  {a.accessNotes && <p className="text-xs text-ink-3">{a.accessNotes}</p>}
                  <div className="mt-auto pt-2">
                    <Button size="sm" onClick={() => setPlanning(a)}>Plan this</Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {avoided.length > 0 && (
        <button className="mt-3 text-sm text-ink-3 underline" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? "Hide" : "Show"} {avoided.length} idea{avoided.length === 1 ? "" : "s"} you asked to avoid
        </button>
      )}
      <p className="mt-4 text-xs text-ink-3">Starter ideas for now, not yet reviewed by an expert. A suggestion is never a booking.</p>
      {planning && (
        <MomentEditor
          open
          onClose={() => setPlanning(null)}
          template={{
            kind,
            title: planning.title,
            activityKey: planning.key,
            notes: lowEffort || guidance[planning.key]?.guidance === "simplify" ? (planning.simpler ?? planning.summary) : planning.summary,
            budgetMinor: planning.typicalCostMinor || null,
            durationMinutes: planning.durationMinutes,
          }}
          defaultDate={todayIn(app.timeZone)}
        />
      )}
    </div>
  );
}
