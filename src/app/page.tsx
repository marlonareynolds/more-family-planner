import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth";

export default async function Landing() {
  if (await currentActor()) redirect("/today");
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-4xl leading-tight sm:text-5xl">Make room for the people inside the plan.</h1>
      <p className="text-lg text-ink-2">More room for me. More time for us. Better days together.</p>
      <ul className="space-y-2 text-ink-2">
        <li>One shared household, with a private space for each adult.</li>
        <li>Protect personal time with the childcare it needs attached.</li>
        <li>Agree dates and family plans that actually fit the week.</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-full bg-brand px-5 font-medium text-brand-ink">
          Sign in
        </Link>
      </div>
      <p className="text-sm text-ink-3">Opening this page does not give anyone access to your household. Each adult signs in separately.</p>
    </main>
  );
}
