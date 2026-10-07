import type { Category, Setting } from "@/lib/catalogue";

/**
 * Booking deep links (blueprint: a table is one tap away). Your own place's
 * booking page comes first; otherwise a search on a booking or map site,
 * near the household's town and for the plan's time where the site takes
 * one. Nothing is booked from More and nothing about the plan is sent beyond
 * the town, the time and how many are going.
 */

export interface BookingLink {
  label: string;
  url: string;
}

/** https only, and no credentials or local addresses, so a saved link is safe to open. */
export function safeBookingUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || /^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(u.hostname)) return null;
  return u.toString();
}

const SEARCH: Partial<Record<Category, string>> = {
  food: "restaurants",
  theatre: "theatre cinema",
  music: "live music",
  art: "museums galleries",
  active: "activities",
  making: "workshops classes",
};

export function bookingLinks(input: {
  category: Category;
  setting: Setting;
  bookingUrl?: string | null;
  /** The household's town. */
  near: string | null;
  /** Local date and time of the plan, "YYYY-MM-DDTHH:MM". */
  localStart?: string;
  people?: number;
}): BookingLink[] {
  const own = input.bookingUrl ? safeBookingUrl(input.bookingUrl) : null;
  if (own) return [{ label: "Book", url: own }];
  if (input.setting === "home" || !input.near) return [];
  const out: BookingLink[] = [];
  if (input.category === "food") {
    const q = new URLSearchParams({ term: input.near, covers: String(Math.min(20, Math.max(1, input.people ?? 2))) });
    if (input.localStart) q.set("dateTime", input.localStart);
    out.push({ label: "Find a table", url: `https://www.opentable.co.uk/s?${q}` });
  }
  const what = SEARCH[input.category];
  if (what) out.push({ label: input.category === "food" ? "On the map" : "Find somewhere", url: `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${what} near ${input.near}` })}` });
  return out;
}
