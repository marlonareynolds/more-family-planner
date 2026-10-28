import { redirect } from "next/navigation";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { authMode, currentActor } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignIn(props: PageProps<"/sign-in">) {
  if (await currentActor()) redirect("/today");
  const { next } = await props.searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-3xl">Sign in</h1>
      <SignInForm mode={authMode()} next={typeof next === "string" ? next : "/today"} />
      <p className="text-sm text-ink-3">
        Can&apos;t get in? <a className="underline" href="/support">Ask for help</a>.
      </p>
      <p className="text-sm text-ink-3">
        By signing in you agree to the <Link className="underline" href="/terms">terms of use</Link>. The <Link className="underline" href="/privacy">privacy notice</Link> explains what More keeps and why.
      </p>
      <LegalFooter />
    </main>
  );
}
