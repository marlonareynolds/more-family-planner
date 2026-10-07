"use client";

import { Check, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NEEDS, NEED_LABEL, type Need } from "@/lib/kindness";
import type { KindnessCard as Card_, MyNeeds } from "@/server/queries/needs";
import { useApp } from "./app-context";
import { Button, Card, ErrorNote, Segmented, cx, inputClass } from "./ui";
import { useCommand } from "./use-command";

/**
 * "What would help you": private to its author. Nothing on this form is
 * ever shown to anyone else; it only tips the odds of the small kindnesses
 * the partner is offered, from the week after.
 */
export function WhatWouldHelp({ mine }: { mine: MyNeeds }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const partner = app.partner?.displayName ?? null;
  const [chosen, setChosen] = useState<Map<Need, boolean>>(() => new Map(mine.needs.map((n) => [n.need, n.shapes])));
  const [note, setNote] = useState(mine.note);
  const [saved, setSaved] = useState(false);
  const paused = mine.needs.some((n) => n.paused);

  const toggle = (need: Need) => {
    const next = new Map(chosen);
    if (next.has(need)) next.delete(need);
    else next.set(need, true);
    setChosen(next);
    setSaved(false);
  };
  const setShapes = (need: Need, shapes: boolean) => {
    setChosen(new Map(chosen).set(need, shapes));
    setSaved(false);
  };
  async function save() {
    const ok = await run("SaveNeeds", { needs: [...chosen].map(([need, shapes]) => ({ need, shapes })), note });
    if (ok) setSaved(true);
  }

  return (
    <div>
      <p className="flex items-start gap-2 text-sm text-ink-2">
        <Lock aria-hidden size={16} className="mt-0.5 shrink-0" />
        <span>
          Only you will ever see this.{" "}
          {partner
            ? `More never tells ${partner} what you chose, or that you chose anything. It quietly makes a few of the small kindnesses ${partner} is offered a little more likely to match, from next week. Whatever ${partner} does, they chose to do.`
            : "Once a partner joins your household, it will quietly shape a few of the small kindnesses they're offered, without ever saying who or what."}
        </span>
      </p>
      {paused && <p className="mt-2 text-sm text-ink-3">Some of these were about someone who has left the household, so they shape nothing now. Save to use them for {partner ?? "whoever joins next"}.</p>}
      <fieldset className="mt-4">
        <legend className="font-semibold">What would mean a lot to you right now?</legend>
        <ul className="mt-2 grid gap-2">
          {NEEDS.map((need) => {
            const on = chosen.has(need);
            return (
              <li key={need} className={cx("rounded-xl border p-3", on ? "border-[var(--us)] bg-surface-2" : "border-line")}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(need)} className="mt-1 size-5 accent-[var(--brand)]" />
                  <span>
                    <span className="block text-[15px]">{NEED_LABEL[need].label}</span>
                    <span className="block text-xs text-ink-3">{NEED_LABEL[need].hint}</span>
                  </span>
                </label>
                {on && partner && (
                  <div className="mt-2 pl-8">
                    <Segmented
                      label={`Use for ${NEED_LABEL[need].label}`}
                      value={chosen.get(need) ? "shape" : "mine"}
                      onChange={(v) => setShapes(need, v === "shape")}
                      options={[
                        { value: "shape", label: `Let it shape ${partner}'s ideas` },
                        { value: "mine", label: "Just for me" },
                      ]}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <label className="mt-4 block">
        <span className="font-semibold">In your own words</span>
        <span className="block text-xs text-ink-3">Like a diary line. It is locked away and never used for anything, by anyone.</span>
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} className={cx(inputClass, "mt-1")} />
      </label>
      <ErrorNote message={error?.message} />
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save, just for me"}</Button>
        {saved && <span className="text-sm text-ink-3">Saved. Only you can see this.</span>}
      </div>
    </div>
  );
}

/** "A small kindness this week": two ideas from the viewer's own shelf. */
export function KindnessCard({ card }: { card: Card_ }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const mark = (key: string, value: "done" | "skip" | null) => run("MarkKindness", { weekKey: card.weekKey, key, mark: value });
  if (!card.items.length) return null;
  return (
    <Card tone="us" className="mt-6">
      <h2 className="font-display text-xl italic">A small kindness this week</h2>
      <p className="mt-1 text-sm text-ink-2">Ideas just for you{card.partnerName ? `, for ${card.partnerName}` : ""}. Nobody is told whether you do them.</p>
      <ul className="mt-3 grid gap-2">
        {card.items.map((k) => (
          <li key={k.key} className="rounded-xl bg-surface p-3">
            <p className={cx(k.done && "text-ink-3 line-through")}>{k.text}</p>
            <span className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => mark(k.key, k.done ? null : "done")} aria-pressed={k.done}>
                <Check aria-hidden size={14} /> {k.done ? "Done" : "I did this"}
              </Button>
              {!k.done && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => mark(k.key, "skip")}>
                  <RefreshCw aria-hidden size={14} /> Another
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ErrorNote message={error?.message} />
      <details className="mt-3 text-xs text-ink-3">
        <summary className="cursor-pointer">Why these?</summary>
        <p className="mt-1">Ideas from More&apos;s own list, a new pair each week. What either of you tells More can tip the balance; it never says who or what. Your partner sees a different list, so nothing you do was suggested to them.</p>
      </details>
    </Card>
  );
}
