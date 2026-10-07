import type { ImportedOccurrence } from "@/domain/ics";
import type { Interval } from "@/domain/intervals";
import { localToInstantCompatible } from "@/domain/time";
import { appUrl } from "./reach/email";

/**
 * Two-way calendar sync with Google Calendar and Microsoft Outlook
 * (blueprint, Our Week). More reads the adult's own calendar as busy time and
 * writes its agreed plans back as "Busy", never with their details, so work
 * colleagues can't book over them. Switched on per provider by its OAuth app
 * keys; without them the option doesn't appear.
 */

export type Provider = "google" | "microsoft";
export const PROVIDERS: Provider[] = ["google", "microsoft"];
export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Tokens {
  access: string;
  refresh: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
}

/** A refused or revoked grant: the adult has to connect again. */
export class ReconnectNeeded extends Error {}
/** Anything else that went wrong talking to the provider. */
export class ProviderError extends Error {}

const CONFIG = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Calendars.ReadWrite",
    id: () => process.env.MICROSOFT_CLIENT_ID,
    secret: () => process.env.MICROSOFT_CLIENT_SECRET,
  },
} as const;

export const PROVIDER_NAME: Record<Provider, string> = { google: "Google Calendar", microsoft: "Outlook" };

export function providerReady(p: Provider): boolean {
  return !!(CONFIG[p].id() && CONFIG[p].secret());
}

export function redirectUri(p: Provider): string {
  return `${appUrl()}/api/v1/calendars/callback/${p}`;
}

export function authorizeUrl(p: Provider, state: string): string {
  const c = CONFIG[p];
  const q = new URLSearchParams({ client_id: c.id() ?? "", redirect_uri: redirectUri(p), response_type: "code", scope: c.scope, state });
  if (p === "google") {
    q.set("access_type", "offline");
    q.set("prompt", "consent");
  } else {
    q.set("response_mode", "query");
    q.set("prompt", "select_account");
  }
  return `${c.authorize}?${q}`;
}

async function tokenRequest(p: Provider, form: Record<string, string>, http: HttpFetch, now: number): Promise<Tokens & { idToken?: string }> {
  const c = CONFIG[p];
  const body = new URLSearchParams({ client_id: c.id() ?? "", client_secret: c.secret() ?? "", ...form, ...(p === "microsoft" ? { scope: c.scope } : {}) });
  const res = await http(c.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant" || res.status === 400 || res.status === 401) throw new ReconnectNeeded(data.error ?? `token ${res.status}`);
    throw new ProviderError(`token ${res.status}`);
  }
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? form.refresh_token ?? "",
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
    idToken: data.id_token,
  };
}

/** Swap the code from the consent screen for tokens and the account's email. */
export async function exchangeCode(p: Provider, code: string, http: HttpFetch = fetch, now = Date.now()): Promise<{ tokens: Tokens; email: string | null }> {
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) }, http, now);
  if (!t.refresh) throw new ProviderError("no refresh token");
  let email: string | null = null;
  if (p === "google" && t.idToken) {
    // Straight from Google's token endpoint over TLS, so the payload can be read as is.
    try {
      email = (JSON.parse(Buffer.from(t.idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null;
    } catch {}
  }
  if (p === "microsoft") {
    const me = await api(p, t.access, "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {}, http).catch(() => null);
    email = (me as { mail?: string; userPrincipalName?: string } | null)?.mail ?? (me as { userPrincipalName?: string } | null)?.userPrincipalName ?? null;
  }
  return { tokens: { access: t.access, refresh: t.refresh, expiresAt: t.expiresAt }, email };
}

/** A working access token, refreshed when it is about to expire. */
export async function freshTokens(p: Provider, tokens: Tokens, http: HttpFetch = fetch, now = Date.now()): Promise<{ tokens: Tokens; changed: boolean }> {
  if (tokens.expiresAt - now > 120_000) return { tokens, changed: false };
  const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: tokens.refresh }, http, now);
  return { tokens: { access: t.access, refresh: t.refresh || tokens.refresh, expiresAt: t.expiresAt }, changed: true };
}

async function api(p: Provider, access: string, url: string, init: RequestInit, http: HttpFetch): Promise<unknown> {
  const res = await http(url, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(p === "microsoft" ? { Prefer: 'outlook.timezone="UTC"' } : {}), ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new ReconnectNeeded(`api ${res.status}`);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new ProviderError(`api ${res.status}`);
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

const MORE_TAG = "More";

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

interface GraphEvent {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  categories?: string[];
  responseStatus?: { response?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

/**
 * The adult's own calendar inside a window, as busy time: free, declined,
 * cancelled and More's own blocks are left out.
 */
export async function listBusy(p: Provider, access: string, window: Interval, timeZone: string, http: HttpFetch = fetch): Promise<ImportedOccurrence[]> {
  const out: ImportedOccurrence[] = [];
  const allDay = (externalId: string, title: string, startDate: string, endDateExclusive: string) =>
    out.push({ externalId, title, allDay: true, startDate, endDateExclusive, start: localToInstantCompatible(`${startDate}T00:00`, timeZone), end: localToInstantCompatible(`${endDateExclusive}T00:00`, timeZone) });

  if (p === "google") {
    let page: string | undefined;
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({ timeMin: new Date(window.start).toISOString(), timeMax: new Date(window.end).toISOString(), singleEvents: "true", maxResults: "2500", orderBy: "startTime" });
      if (page) q.set("pageToken", page);
      const data = (await api(p, access, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {}, http)) as { items?: GoogleEvent[]; nextPageToken?: string } | null;
      for (const e of data?.items ?? []) {
        if (e.status === "cancelled" || e.transparency === "transparent" || e.extendedProperties?.private?.more === "1") continue;
        if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
        const title = e.summary || "Busy";
        if (e.start?.date && e.end?.date) allDay(`google:${e.id}`, title, e.start.date, e.end.date);
        else if (e.start?.dateTime && e.end?.dateTime) out.push({ externalId: `google:${e.id}`, title, allDay: false, start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime) });
      }
      page = data?.nextPageToken;
      if (!page) break;
    }
    return out;
  }

  let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({
    startDateTime: new Date(window.start).toISOString(),
    endDateTime: new Date(window.end).toISOString(),
    $top: "500",
    $select: "id,subject,isAllDay,isCancelled,showAs,categories,responseStatus,start,end",
  })}`;
  for (let i = 0; url && i < 20; i++) {
    const data = (await api(p, access, url, {}, http)) as { value?: GraphEvent[]; "@odata.nextLink"?: string } | null;
    for (const e of data?.value ?? []) {
      if (e.isCancelled || e.showAs === "free" || e.categories?.includes(MORE_TAG) || e.responseStatus?.response === "declined") continue;
      if (!e.start?.dateTime || !e.end?.dateTime) continue;
      const title = e.subject || "Busy";
      if (e.isAllDay) allDay(`microsoft:${e.id}`, title, e.start.dateTime.slice(0, 10), e.end.dateTime.slice(0, 10));
      else out.push({ externalId: `microsoft:${e.id}`, title, allDay: false, start: Date.parse(`${e.start.dateTime.replace(/Z$/, "")}Z`), end: Date.parse(`${e.end.dateTime.replace(/Z$/, "")}Z`) });
    }
    url = data?.["@odata.nextLink"];
  }
  return out;
}

export interface BusyBlock {
  start: number;
  end: number;
}

const NOTE = "Held by More. The details are in the app.";

/** Create or move a "Busy" block. Returns its id in the provider. */
export async function putBusy(p: Provider, access: string, existingId: string | null, block: BusyBlock, http: HttpFetch = fetch): Promise<string> {
  const iso = (ms: number) => new Date(ms).toISOString();
  if (p === "google") {
    const body = {
      summary: "Busy",
      description: NOTE,
      start: { dateTime: iso(block.start) },
      end: { dateTime: iso(block.end) },
      transparency: "opaque",
      visibility: "private",
      reminders: { useDefault: false },
      extendedProperties: { private: { more: "1" } },
    };
    const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    if (existingId) {
      const moved = (await api(p, access, `${base}/${encodeURIComponent(existingId)}`, { method: "PATCH", body: JSON.stringify(body) }, http)) as { id?: string } | null;
      if (moved?.id) return moved.id;
    }
    const made = (await api(p, access, base, { method: "POST", body: JSON.stringify(body) }, http)) as { id?: string } | null;
    if (!made?.id) throw new ProviderError("no id");
    return made.id;
  }
  const body = {
    subject: "Busy",
    body: { contentType: "text", content: NOTE },
    start: { dateTime: iso(block.start).slice(0, 19), timeZone: "UTC" },
    end: { dateTime: iso(block.end).slice(0, 19), timeZone: "UTC" },
    showAs: "busy",
    sensitivity: "private",
    isReminderOn: false,
    categories: [MORE_TAG],
  };
  const base = "https://graph.microsoft.com/v1.0/me/events";
  if (existingId) {
    const moved = (await api(p, access, `${base}/${encodeURIComponent(existingId)}`, { method: "PATCH", body: JSON.stringify(body) }, http)) as { id?: string } | null;
    if (moved?.id) return moved.id;
  }
  const made = (await api(p, access, base, { method: "POST", body: JSON.stringify(body) }, http)) as { id?: string } | null;
  if (!made?.id) throw new ProviderError("no id");
  return made.id;
}

export async function deleteBusy(p: Provider, access: string, id: string, http: HttpFetch = fetch): Promise<void> {
  const url = p === "google" ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}` : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`;
  await api(p, access, url, { method: "DELETE" }, http);
}
