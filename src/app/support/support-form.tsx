"use client";

import { useState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";

const TOPICS = [
  { value: "problem", label: "Something isn't working" },
  { value: "privacy", label: "Privacy or my data" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
] as const;

export function SupportForm() {
  const [topic, setTopic] = useState<(typeof TOPICS)[number]["value"]>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  if (reference) {
    return (
      <p role="status" className="rounded-xl bg-brand-soft p-4 text-brand">
        Thank you. We have your message (reference {reference}){contact ? " and will reply to you there." : "."}
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, message, contact }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "That didn't go through.");
      setReference(data.reference);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="What's it about?">
        {(id) => (
          <select id={id} className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value as typeof topic)}>
            {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
      </Field>
      <Field label="Your message">
        {(id) => <textarea id={id} className={`${inputClass} min-h-32`} required minLength={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <Field label="How can we reply?" hint="An email or phone number. Optional.">
        {(id) => <input id={id} className={inputClass} maxLength={200} autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} />}
      </Field>
      <Button variant="primary" type="submit" disabled={pending || message.trim().length < 3}>Send</Button>
      <ErrorNote message={error} />
    </form>
  );
}
