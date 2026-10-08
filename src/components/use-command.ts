"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "./toast";

type Payload = Record<string, unknown> | undefined;

/**
 * A short confirmation for changes people care about. Quiet by default:
 * anything not listed here saves without a toast, because the screen
 * already shows the result.
 */
function confirmation(command: string, p: Payload): { text: string; celebrate?: boolean } | null {
  switch (command) {
    case "ShareMoment": return { text: "Sent. They'll see it on Today." };
    case "RespondToMoment":
      return p?.decision === "accepted" ? { text: "You're in. It's in the diary.", celebrate: true } : { text: "Answer sent." };
    case "CompleteMoment": return { text: "Lovely. Add a memory while it's fresh.", celebrate: true };
    case "PlanWeek":
      return Array.isArray(p?.items) && p.items.length === 0 ? { text: "Done. The rest of the week stays as it is." } : { text: "Your week is planned.", celebrate: true };
    case "MarkJobDone": return { text: "Done. One less thing.", celebrate: true };
    case "AnswerJobOwner": return p?.accept ? { text: "It's yours now. Thank you." } : { text: "Answer sent." };
    case "ProposeJobOwner": return p?.to === "partner" ? { text: "Asked. They'll see it on Today." } : null;
    case "AddJob": return { text: "Job added." };
    case "AddPlace": return { text: "Saved to your places." };
    case "SaveHighlight": return { text: "Memory saved." };
    case "StartRitual": return { text: "Ritual suggested." };
    case "JoinRitual": return { text: "You're in. The dates are in the diary.", celebrate: true };
    case "AddHelper": return { text: "Helper saved." };
    case "SaveCheckin": return { text: "Check-in saved, just for you." };
    case "SaveNeeds": return { text: "Saved, just for you." };
    case "CreateInvite": return null;
    default: return null;
  }
}

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

/**
 * Send a typed command. Each attempt carries a fresh idempotency key; the
 * same key is reused if the user retries after a network failure, so a
 * dropped response can never double-apply a change (INV-12).
 */
export function useCommand(householdId?: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const retryKey = useRef<{ body: string; key: string } | null>(null);

  const run = useCallback(
    async <T = Record<string, unknown>>(command: string, payload: unknown, opts: { expected?: Record<string, number>; refresh?: boolean } = {}): Promise<T | null> => {
      setPending(true);
      setError(null);
      const bodyCore = JSON.stringify({ command, householdId, payload, expected: opts.expected });
      const key = retryKey.current?.body === bodyCore ? retryKey.current.key : crypto.randomUUID();
      retryKey.current = { body: bodyCore, key };
      try {
        const res = await fetch("/api/v1/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, householdId, payload, expected: opts.expected, idempotencyKey: key }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          retryKey.current = null;
          setError(data?.error ?? { code: "INTERNAL", message: "Something went wrong.", details: null });
          if (res.status === 401) router.push("/sign-in");
          return null;
        }
        retryKey.current = null;
        // Batched calls (refresh: false) confirm once themselves.
        const note = opts.refresh === false ? null : confirmation(command, payload as Payload);
        if (note) toast(note.text, { celebrate: note.celebrate });
        if (opts.refresh !== false) router.refresh();
        return data.result as T;
      } catch {
        // Keep retryKey so a retry of the same change is idempotent.
        setError({ code: "NETWORK", message: "You seem to be offline. Your changes are still here; try again.", details: null });
        return null;
      } finally {
        setPending(false);
      }
    },
    [householdId, router],
  );

  return { run, pending, error, setError };
}
