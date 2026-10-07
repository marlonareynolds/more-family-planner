"use client";

import { useState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";

export function SignInForm({ mode, next }: { mode: "dev" | "supabase"; next: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/today";

  async function devSignIn(n: string) {
    setError(null);
    const res = await fetch("/api/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) });
    if (res.ok) window.location.href = safeNext;
    else setError("Could not sign in.");
  }

  async function magicLink() {
    setError(null);
    const { createBrowserClient } = await import("@supabase/ssr");
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}` },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  if (mode === "supabase") {
    if (sent) return <p className="text-ink-2">Check your email for a sign-in link.</p>;
    return (
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void magicLink(); }}>
        <Field label="Email">{(id) => <input id={id} type="email" required autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <ErrorNote message={error} />
        <Button variant="primary" type="submit">Email me a sign-in link</Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
        Development sign-in with synthetic people. Real sign-in turns on when the identity provider is configured.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => devSignIn("Alex")}>Continue as Alex</Button>
        <Button onClick={() => devSignIn("Sam")}>Continue as Sam</Button>
      </div>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void devSignIn(name.trim()); }}>
        <Field label="Or use another name">{(id) => <input id={id} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button type="submit">Sign in</Button>
      </form>
      <ErrorNote message={error} />
    </div>
  );
}
