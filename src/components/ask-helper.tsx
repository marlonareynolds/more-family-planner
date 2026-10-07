"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { fmtDate, localParts } from "./format";
import { Button, Dialog, ErrorNote, Field, inputClass } from "./ui";
import { useCommand } from "./use-command";

/**
 * Ask someone from the village to look after the children. More makes a
 * one-off link; the adult sends it from their own phone, so nothing is
 * sent on More's behalf and no contact list is touched.
 */
export function AskHelperDialog({ childIds, start, end, onClose }: { childIds: string[]; start: number; end: number; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [helperId, setHelperId] = useState(app.helpers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<{ link: string; phone: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const s = localParts(start, app.timeZone);
  const e = localParts(end, app.timeZone);
  const when = `${fmtDate(s.date)} ${s.time} to ${e.date === s.date ? e.time : `${fmtDate(e.date)} ${e.time}`}`;
  const names = childIds.map(app.childName).join(" and ");

  async function ask() {
    const r = await run<{ token: string; phone: string; helperName: string }>("AskHelper", {
      helperId,
      childIds,
      span: { allDay: false, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time },
      note,
    });
    if (r) setSent({ link: `${window.location.origin}/ask/${r.token}`, phone: r.phone, name: r.helperName });
  }

  const message = sent ? `Hi ${sent.name}, could you look after ${names} on ${when}? Tap to say yes or no: ${sent.link}` : "";
  if (!app.helpers.length) {
    return (
      <Dialog open onClose={onClose} title="Ask someone to help" footer={<Button onClick={onClose}>Close</Button>}>
        <p className="text-ink-2">Save the people who help with the children first, like a grandparent or a sitter.</p>
        <a href="/settings#helpers" className="mt-3 inline-block text-brand underline">Add people in Settings</a>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={sent ? `Send your ask to ${sent.name}` : "Ask someone to help"}
      footer={sent ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !helperId} onClick={ask}>Make the ask</Button></>}
    >
      {!sent ? (
        <div className="flex flex-col gap-3">
          <p className="text-ink-2">{names || "The children"}, {when}.</p>
          <Field label="Who">
            {(id) => (
              <select id={id} className={inputClass} value={helperId} onChange={(ev) => setHelperId(ev.target.value)}>
                {app.helpers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="A note for them (optional)" hint="They'll see this, the time and the children's first names. Nothing else.">
            {(id, d) => <input id={id} aria-describedby={d} className={inputClass} maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} />}
          </Field>
          <ErrorNote message={error?.message} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-2">Their answer comes straight back here, and the childcare updates when they say yes.</p>
          <div className="flex flex-wrap gap-2">
            {sent.phone && (
              <a className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-white" href={`sms:${sent.phone.replace(/[^+0-9]/g, "")}?&body=${encodeURIComponent(message)}`}>Send as a text</a>
            )}
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button onClick={() => navigator.share({ text: message }).catch(() => {})}>Share…</Button>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(message).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy message"}
            </Button>
          </div>
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">{message}</p>
        </div>
      )}
    </Dialog>
  );
}
