"use client";

import { useState } from "react";
import { Button, ErrorNote } from "@/components/ui";

export function AskAnswer({ token, initial, open, askerName }: { token: string; initial: "yes" | "no" | null; open: boolean; askerName: string }) {
  const [answer, setAnswer] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (answer) {
    return (
      <p role="status" className="rounded-xl bg-brand-soft p-4 text-brand">
        {answer === "yes" ? `Thank you. ${askerName} has your yes.` : `Thanks for letting ${askerName} know.`}
      </p>
    );
  }
  if (!open) return <p className="text-ink-2">This ask has closed. {askerName} may have sorted it another way.</p>;

  async function reply(response: "yes" | "no") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/asks/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "That didn't go through.");
      if (data.response) setAnswer(data.response);
      else setError("This ask has closed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <Button variant="primary" disabled={pending} onClick={() => reply("yes")}>Yes, I can</Button>
        <Button disabled={pending} onClick={() => reply("no")}>Sorry, I can&apos;t</Button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
