"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { Badge, Button, Card, Checkbox, ErrorNote, Field, SectionTitle, Segmented, cx, inputClass } from "./ui";
import { useCommand } from "./use-command";

export interface TrialAnswer {
  weekKey: string;
  baseline: boolean;
  meMoments: number | null;
  usMoments: number | null;
  familyMoments: number | null;
  minutesInApp: number | null;
  minutesOutside: number | null;
  fairlyAgreed: number | null;
  continueChoice: "yes" | "unsure" | "no" | null;
  helped: string;
  friction: string;
  shareWithTrial: boolean;
}

export interface TrialPanelData {
  weeks: { key: string; label: string }[];
  mine: TrialAnswer[];
  shared: (TrialAnswer & { authorName: string })[];
  coverage: { accountId: string; displayName: string; weeks: string[] }[];
  events: { type: string; count: number }[];
  activeDays: { any: number; both: number };
  since: string;
}

const EVENT_LABELS: Record<string, string> = {
  household_created: "Household set up",
  partner_joined: "Partner joined",
  first_plan_created: "First plan made",
  moment_shared: "Plans shared",
  moment_agreed: "Plans agreed by everyone",
  moment_completed: "Moments that happened",
  care_gap_resolved: "Care arranged",
  save_conflict: "Changes that clashed",
  trial_response_saved: "Trial answers saved",
};

const blank = (weekKey: string): TrialAnswer => ({
  weekKey, baseline: false, meMoments: null, usMoments: null, familyMoments: null, minutesInApp: null, minutesOutside: null,
  fairlyAgreed: null, continueChoice: null, helped: "", friction: "", shareWithTrial: false,
});

/** Weekly trial questions (spec 21.2) and what the trial has seen so far. */
export function TrialPanel({ data }: { data: TrialPanelData }) {
  const app = useApp();
  const [week, setWeek] = useState(data.weeks[0].key);
  const existing = (key: string) => data.mine.find((r) => r.weekKey === key);
  const [form, setForm] = useState<TrialAnswer>(existing(week) ?? { ...blank(week), baseline: data.mine.length === 0 });
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useCommand(app.householdId);
  const set = <K extends keyof TrialAnswer>(k: K, v: TrialAnswer[K]) => { setForm({ ...form, [k]: v }); setSaved(false); };
  const pick = (key: string) => { setWeek(key); setForm(existing(key) ?? blank(key)); setSaved(false); };
  const num = (label: string, k: "meMoments" | "usMoments" | "familyMoments" | "minutesInApp" | "minutesOutside", hint?: string) => (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <input id={id} aria-describedby={d} type="number" inputMode="numeric" min={0} className={inputClass} value={form[k] ?? ""}
          onChange={(e) => set(k, e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))} />
      )}
    </Field>
  );

  return (
    <div>
      <h1 className="font-display text-2xl">Household trial</h1>
      <p className="mt-1 max-w-prose text-ink-2">
        A few questions each week about what happened and what it took to organise. Answer on your own; every question is optional.
        Your answers stay private unless you choose to share them with the trial.
      </p>

      <SectionTitle>Your week</SectionTitle>
      <Card className="flex flex-col gap-4">
        <Segmented label="Which week" value={week} options={data.weeks.map((w) => ({ value: w.key, label: w.label }))} onChange={pick} />
        <Checkbox checked={form.baseline} onChange={(v) => set("baseline", v)} label="This was a normal week before using More" hint="The first week is the baseline everything else is compared with." />
        <fieldset className="grid grid-cols-3 gap-3">
          <legend className="mb-1 text-sm font-medium text-ink-2">Worthwhile moments that actually happened</legend>
          {num("For you", "meMoments")}
          {num("As a couple", "usMoments")}
          {num("As a family", "familyMoments")}
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-1 text-sm font-medium text-ink-2">Minutes spent organising</legend>
          {num("In More", "minutesInApp")}
          {num("Outside More", "minutesOutside", "Messages, calls, other calendars")}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink-2">Did care and preparation feel fairly agreed?</legend>
          <div className="flex items-center gap-1">
            <span className="text-xs text-ink-3">not at all</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={form.fairlyAgreed === n} onClick={() => set("fairlyAgreed", form.fairlyAgreed === n ? null : n)}
                className={cx("size-10 rounded-full border text-sm", form.fairlyAgreed === n ? "border-brand bg-brand-soft text-brand" : "border-line")}>
                {n}
              </button>
            ))}
            <span className="text-xs text-ink-3">completely</span>
          </div>
        </fieldset>
        <div>
          <p className="mb-1 text-sm font-medium text-ink-2">Would you choose to keep using More?</p>
          <Segmented label="Keep using More" value={form.continueChoice ?? ("" as never)} onChange={(v) => set("continueChoice", v)}
            options={[{ value: "yes", label: "Yes" }, { value: "unsure", label: "Not sure" }, { value: "no", label: "No" }]} />
        </div>
        <Field label="What helped?">{(id) => <textarea id={id} rows={2} className={`${inputClass} py-2`} value={form.helped} onChange={(e) => set("helped", e.target.value)} />}</Field>
        <Field label="What got in the way, or what extra work did More cause?">{(id) => <textarea id={id} rows={2} className={`${inputClass} py-2`} value={form.friction} onChange={(e) => set("friction", e.target.value)} />}</Field>
        <Checkbox checked={form.shareWithTrial} onChange={(v) => set("shareWithTrial", v)} label="Share this week's answers with the trial"
          hint={`Your partner${app.partner ? `, ${app.partner.displayName},` : ""} and the trial lead can then read them. Untick and save to withdraw.`} />
        <ErrorNote message={error?.message} />
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={pending} onClick={async () => setSaved(!!(await run("SaveTrialResponse", form)))}>Save answers</Button>
          {saved && <span role="status" className="text-sm text-good">Saved</span>}
        </div>
      </Card>

      <SectionTitle>Who has answered</SectionTitle>
      <Card className="flex flex-col gap-2">
        {data.coverage.map((c) => (
          <p key={c.accountId} className="text-[15px]">
            {c.accountId === app.me.id ? "You" : c.displayName}: {c.weeks.length ? `${c.weeks.length} week${c.weeks.length === 1 ? "" : "s"}` : "not yet"}
          </p>
        ))}
        <p className="text-xs text-ink-3">Only whether someone answered is shown here, never what they said.</p>
      </Card>

      {data.shared.length > 0 && (
        <>
          <SectionTitle>Shared by your partner</SectionTitle>
          <div className="flex flex-col gap-3">
            {data.shared.map((r) => <AnswerCard key={`${r.authorName}${r.weekKey}`} r={r} who={r.authorName} />)}
          </div>
        </>
      )}

      <SectionTitle>What More has seen since {data.since}</SectionTitle>
      <Card>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[15px] sm:grid-cols-3">
          <div><dt className="text-xs text-ink-3">Days anyone used More</dt><dd>{data.activeDays.any}</dd></div>
          <div><dt className="text-xs text-ink-3">Days you both did</dt><dd>{data.activeDays.both}</dd></div>
          {data.events.map((e) => (
            <div key={e.type}><dt className="text-xs text-ink-3">{EVENT_LABELS[e.type] ?? e.type}</dt><dd>{e.count}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-3">Counts only: no titles, places, notes or children&apos;s names are recorded. You can switch this off in Settings.</p>
      </Card>

      {data.mine.length > 0 && (
        <>
          <SectionTitle>Your past answers</SectionTitle>
          <div className="flex flex-col gap-3">{data.mine.map((r) => <AnswerCard key={r.weekKey} r={r} who="You" />)}</div>
        </>
      )}
    </div>
  );
}

function AnswerCard({ r, who }: { r: TrialAnswer; who: string }) {
  const moments = [r.meMoments, r.usMoments, r.familyMoments];
  const minutes = (r.minutesInApp ?? 0) + (r.minutesOutside ?? 0);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{who}, week of {r.weekKey}</p>
        {r.baseline && <Badge>Baseline</Badge>}
        {r.shareWithTrial && who === "You" && <Badge tone="good">Shared</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-2">
        Moments: {moments.map((m) => m ?? "–").join(" / ")} (you, couple, family)
        {r.minutesInApp !== null || r.minutesOutside !== null ? ` · ${minutes} min organising` : ""}
        {r.fairlyAgreed ? ` · fairness ${r.fairlyAgreed}/5` : ""}
        {r.continueChoice ? ` · keep using: ${r.continueChoice}` : ""}
      </p>
      {r.helped && <p className="mt-1 text-sm">Helped: {r.helped}</p>}
      {r.friction && <p className="mt-1 text-sm">Got in the way: {r.friction}</p>}
    </Card>
  );
}
