"use client";

import { useState } from "react";
import { TimeZoneSelect } from "@/components/settings-panel";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { useCommand } from "@/components/use-command";

export function SetupForm() {
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState("Europe/London");
  const { run, pending, error } = useCommand();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("CreateHousehold", { name, timeZone }, { refresh: false });
        if (r) window.location.href = "/today";
      }}
    >
      <Field label="Household name" hint="For example, The Reynolds. You can start on your own and invite your partner later.">
        {(id, d) => <input id={id} aria-describedby={d} required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Household timezone" hint="Every shared plan uses this, whatever device you're on.">
        {(id, d) => <TimeZoneSelect id={id} describedBy={d} value={timeZone} onChange={setTimeZone} />}
      </Field>
      <ErrorNote message={error?.message} />
      <Button variant="primary" type="submit" disabled={pending}>Start our household</Button>
      <p className="text-sm text-ink-3">Joining your partner instead? Open the invitation link they sent you.</p>
    </form>
  );
}
