import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { LegalFooter } from "@/components/legal-footer";
import { PRIVACY, PRIVACY_UPDATED } from "@/content/legal/privacy";
import { fillLegal, legalIdentity, stripReview } from "@/lib/legal";

export const metadata = { title: "Privacy notice" };

/** Reachable signed in or out: people read it before they sign up. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="font-display text-3xl text-brand">More</Link>
      <h1 className="mt-6 font-display text-4xl">Privacy notice</h1>
      <p className="mt-2 text-sm text-ink-3">Last updated {PRIVACY_UPDATED}</p>
      <div className="mt-6">
        <LegalDoc source={fillLegal(stripReview(PRIVACY), legalIdentity())} />
      </div>
      <LegalFooter />
    </main>
  );
}
