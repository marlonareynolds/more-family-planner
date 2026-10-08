"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { Button, Dialog, ErrorNote, Field, inputClass, cx } from "./ui";
import { useCommand } from "./use-command";

const WANTS = ["quiet", "exercise", "friends", "creativity", "sleep", "outdoors", "couple time", "family time"] as const;

/**
 * Optional and brief (spec 8.3). Unanswered means unknown, never "plenty of
 * energy". Answers are private: plans may get lighter without saying why,
 * and "what would help" reorders this adult's own picks for this week only.
 */
export function CheckinDialog({ onClose, weekKey }: { onClose: () => void; weekKey: string }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [energy, setEnergy] = useState<number | null>(null);
  const [pressure, setPressure] = useState<number | null>(null);
  const [wants, setWants] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const scale = (label: string, value: number | null, set: (v: number | null) => void, low: string, high: string) => (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      <div className="flex items-center gap-1">
        <span className="text-xs text-ink-3">{low}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => set(value === n ? null : n)} className={cx("size-10 rounded-full border text-sm", value === n ? "border-brand bg-brand-soft text-brand" : "border-line")}>
            {n}
          </button>
        ))}
        <span className="text-xs text-ink-3">{high}</span>
      </div>
    </fieldset>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="This week, privately"
      footer={
        <>
          <Button onClick={onClose}>Skip</Button>
          <Button variant="primary" disabled={pending} onClick={async () => { if (await run("SaveCheckin", { weekKey, energy, pressure, wants, note })) onClose(); }}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">Every question is optional. Only you see your answers.</p>
        {scale("Energy", energy, setEnergy, "low", "high")}
        {scale("Pressure", pressure, setPressure, "light", "heavy")}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink-2">What would help?</legend>
          <p className="mb-2 text-xs text-ink-3">Shapes your own suggestions this week only. To keep an idea coming, use &ldquo;Suggest it&rdquo; on Me.</p>
          <div className="flex flex-wrap gap-2">
            {WANTS.map((w) => (
              <button key={w} type="button" aria-pressed={wants.includes(w)} onClick={() => setWants(wants.includes(w) ? wants.filter((x) => x !== w) : [...wants, w])} className={cx("min-h-9 rounded-full border px-3 text-sm capitalize", wants.includes(w) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2")}>
                {w}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Note to self (optional)">{(id) => <textarea id={id} rows={2} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}
