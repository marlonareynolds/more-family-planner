import Link from "next/link";
import { SupportForm } from "./support-form";

export const metadata = { title: "Help" };

/** Reachable signed in or out, so someone locked out can still ask. */
export default function SupportPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-16">
      <Link href="/" className="font-display text-3xl text-brand">More</Link>
      <h1 className="font-display text-3xl">Ask for help</h1>
      <p className="text-ink-2">
        Something not working, a question about your data, or an idea? Write it here. A person reads every message.
        To close your account yourself, use Settings.
      </p>
      <SupportForm />
      <p className="text-xs text-ink-3">Only the people who run More see this. Don&apos;t include passwords.</p>
    </main>
  );
}
