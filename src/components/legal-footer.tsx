import Link from "next/link";
import { legalIdentity } from "@/lib/legal";

/** Who runs More, how to reach them, and the privacy notice and terms. */
export function LegalFooter() {
  const who = legalIdentity();
  return (
    <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
      <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/privacy" className="underline">Privacy</Link>
        <Link href="/terms" className="underline">Terms</Link>
        <Link href="/support" className="underline">Help</Link>
        {who.supportEmail && <a href={`mailto:${who.supportEmail}`} className="underline">{who.supportEmail}</a>}
      </nav>
      <p className="mt-2">More is run by {who.controller}, UK. ICO registration: {who.ico}.</p>
    </footer>
  );
}
