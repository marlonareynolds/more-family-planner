/**
 * Outgoing email through Resend's HTTP API (free tier). Without
 * RESEND_API_KEY nothing is sent and callers treat the email as not sent.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailTransport = (email: Email) => Promise<boolean>;

let transport: EmailTransport | null = null;

export function setEmailTransport(fn: EmailTransport | null): void {
  transport = fn;
}

function resend(): EmailTransport | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const from = process.env.EMAIL_FROM || "More <onboarding@resend.dev>";
  return async (email) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  };
}

export function emailTransport(): EmailTransport | null {
  return transport ?? resend();
}

/** The public address of the app, for links in emails. */
export function appUrl(): string {
  const explicit = process.env.MORE_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return "http://localhost:3000";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
