import Link from "next/link";
import { LegalDoc } from "@/components/legal-doc";
import { LegalFooter } from "@/components/legal-footer";
import { TERMS, TERMS_UPDATED } from "@/content/legal/terms";
import { fillLegal, legalIdentity, stripReview } from "@/lib/legal";

export const metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="font-display text-3xl text-brand">More</Link>
      <h1 className="mt-6 font-display text-4xl">Terms of use</h1>
      <p className="mt-2 text-sm text-ink-3">Last updated {TERMS_UPDATED}</p>
      <div className="mt-6">
        <LegalDoc source={fillLegal(stripReview(TERMS), legalIdentity())} />
      </div>
      <LegalFooter />
    </main>
  );
}
