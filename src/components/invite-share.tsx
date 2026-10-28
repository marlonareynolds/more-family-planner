"use client";

import { useState, useSyncExternalStore } from "react";
import { Button, inputClass } from "./ui";

/**
 * Sending the partner invitation (review: "copy-link only"). The phone's own
 * share sheet comes first where there is one, so the link goes by whatever
 * the two of you already use; WhatsApp, a text and copying are always there.
 */
const noSubscribe = () => () => {};

export function InviteShare({ link }: { link: string }) {
  // False on the server, the real answer once in the browser.
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === "function", () => false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const message = `I've set us up on More so we can plan time for us, for the kids and for each of us. Join here: ${link}`;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Send it yourself. It works once and expires in 7 days. More won&apos;t show it again.</p>
      <div className="flex flex-wrap gap-2">
        {canShare && (
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await navigator.share({ title: "Join me on More", text: message.replace(` ${link}`, ""), url: link });
                setShared(true);
              } catch {}
            }}
          >
            Share…
          </Button>
        )}
        <a className={`inline-flex min-h-11 items-center rounded-full px-4 ${canShare ? "border border-line" : "bg-brand text-white"}`} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4" href={`sms:?&body=${encodeURIComponent(message)}`}>Text message</a>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              setCopied(true);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <input readOnly aria-label="Invitation link" className={inputClass} value={link} onFocus={(e) => e.currentTarget.select()} />
      {shared && <p role="status" className="text-sm text-ink-3">Sent. When they join, you&apos;ll see them under Adults.</p>}
    </div>
  );
}
