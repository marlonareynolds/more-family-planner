"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { CATALOGUE } from "@/lib/catalogue";
import type { Guidance } from "@/server/queries/learning";
import { useApp } from "./app-context";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

const titleOf = (key: string) => CATALOGUE.find((a) => a.key === key)?.title ?? key;
const LABEL = { allow: "Suggest it", avoid: "Don't suggest", simplify: "Keep it simple" } as const;

/**
 * What More has learned from this adult's own feedback, and their explicit
 * choices (spec 8.10, AT-16). Explicit choices always win; forgetting an
 * inference is durable until the adult restores it.
 */
export function LearningControls({ guidance }: { guidance: Guidance }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [activity, setActivity] = useState("");
  const [choice, setChoice] = useState<"allow" | "avoid" | "simplify">("avoid");
  const explicitKeys = new Set(guidance.explicit.map((e) => e.activityKey));

  return (
    <section aria-labelledby="learning-title">
      <SectionTitle><span id="learning-title">What More has learned about you</span></SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-ink-3">Built only from your private feedback. Your partner never sees it, and it only changes your own suggestions.</p>
      <ErrorNote message={error?.message} />
      {guidance.inferred.length === 0 ? (
        <EmptyState icon={<Sparkles />} tone="me" title="Nothing learned yet.">After a plan, a quick reflection helps More suggest better next time.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {guidance.inferred.map((i) => (
            <li key={i.activityKey}>
              <Card className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {titleOf(i.activityKey)} <Badge tone={i.forgotten ? "neutral" : "warn"}>{i.forgotten ? "Forgotten" : LABEL[i.guidance]}</Badge>
                    {explicitKeys.has(i.activityKey) && <span className="ml-1"><Badge>Your choice overrides this</Badge></span>}
                  </p>
                  <p className="text-sm text-ink-3">{i.reason}</p>
                </div>
                <Button size="sm" disabled={pending} onClick={() => run("ForgetInference", { activityKey: i.activityKey, restore: i.forgotten })}>
                  {i.forgotten ? "Use it again" : "Forget this"}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-2 mt-6 font-medium">Your own choices</h3>
      {guidance.explicit.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {guidance.explicit.map((e) => (
            <li key={e.activityKey} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line px-4 py-2">
              <span>
                {titleOf(e.activityKey)} <Badge>{LABEL[e.guidance]}</Badge>
              </span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("SetPreference", { activityKey: e.activityKey, guidance: null })}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (activity && (await run("SetPreference", { activityKey: activity, guidance: choice }))) setActivity("");
        }}
      >
        <Field label="Idea">
          {(id) => (
            <select id={id} className={`${inputClass} w-auto`} value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="">Choose an idea</option>
              {(["me", "us", "family"] as const).map((k) => (
                <optgroup key={k} label={k === "me" ? "For me" : k === "us" ? "For us" : "Family"}>
                  {CATALOGUE.filter((a) => a.kind === k).map((a) => <option key={a.key} value={a.key}>{a.title}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Field label="Preference">
          {(id) => (
            <select id={id} className={`${inputClass} w-auto`} value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)}>
              {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </Field>
        <Button type="submit" disabled={pending || !activity}>Save choice</Button>
      </form>
    </section>
  );
}
