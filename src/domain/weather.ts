import type { Activity } from "@/lib/catalogue";
import { instantToLocal, instantToLocalDate } from "./time";

/**
 * The weather, only where it changes a plan (blueprint: weather-aware
 * swaps). A forecast is a chance, not a fact, so a plan is only called wet
 * when rain is likely, and the swap is offered, never made for anyone.
 */

/** One forecast hour. `t` is the start of the hour, epoch ms. */
export interface HourPoint {
  t: number;
  /** Chance of rain, 0–100. */
  rain: number;
  /** Expected rain in mm. */
  mm: number;
  /** WMO weather code. */
  code: number;
  /** Temperature, °C. */
  temp: number;
}

export interface DayWeather {
  date: string;
  label: string;
  icon: WeatherIcon;
  high: number;
  low: number;
  /** Highest chance of rain in the daytime, 0–100. */
  rain: number;
}

export type WeatherIcon = "sun" | "cloud-sun" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** At or above this chance of rain in a plan's hours, it is likely to be wet. */
export const WET_CHANCE = 60;
const DAYTIME = [8, 20] as const;

export function describeCode(code: number): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: "Clear", icon: "sun" };
  if (code <= 2) return { label: "Bright spells", icon: "cloud-sun" };
  if (code === 3) return { label: "Cloudy", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Foggy", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? "Showers" : "Rain", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Snow", icon: "snow" };
  if (code >= 95) return { label: "Thunderstorms", icon: "storm" };
  return { label: "Cloudy", icon: "cloud" };
}

/** Codes ranked by how much they spoil a day out, for picking a day's headline. */
function severity(code: number): number {
  const icon = describeCode(code).icon;
  return ["sun", "cloud-sun", "cloud", "fog", "drizzle", "rain", "snow", "storm"].indexOf(icon);
}

/** A day's summary from its daytime hours, or null when the forecast doesn't reach it. */
export function dayWeather(hours: readonly HourPoint[], date: string, timeZone: string): DayWeather | null {
  const day = hours.filter((h) => instantToLocalDate(h.t, timeZone) === date);
  const daytime = day.filter((h) => {
    const hour = instantToLocal(h.t, timeZone).hour;
    return hour >= DAYTIME[0] && hour < DAYTIME[1];
  });
  if (daytime.length < 6) return null;
  // The headline is the weather for most of the day, worsened only if rain is likely.
  const counts = new Map<number, number>();
  for (const h of daytime) counts.set(h.code, (counts.get(h.code) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || severity(b[0]) - severity(a[0]))[0][0];
  const wettest = daytime.reduce((a, b) => (b.rain > a.rain ? b : a));
  const headline = wettest.rain >= WET_CHANCE && severity(wettest.code) > severity(common) ? wettest.code : common;
  const temps = day.map((h) => h.temp);
  return {
    date,
    ...describeCode(headline),
    high: Math.round(Math.max(...temps)),
    low: Math.round(Math.min(...temps)),
    rain: Math.round(Math.max(...daytime.map((h) => h.rain))),
  };
}

/** The chance of rain while a plan is on, or null when the forecast doesn't cover it. */
export function rainDuring(hours: readonly HourPoint[], start: number, end: number): { chance: number; mm: number; code: number } | null {
  const inside = hours.filter((h) => h.t < end && h.t + 3_600_000 > start);
  if (!inside.length || inside[0].t > start + 3_600_000 || inside.at(-1)!.t + 3_600_000 < end) return null;
  const worst = inside.reduce((a, b) => (b.rain > a.rain ? b : a));
  return { chance: Math.round(worst.rain), mm: Math.round(inside.reduce((s, h) => s + h.mm, 0) * 10) / 10, code: worst.code };
}

export function isWet(r: { chance: number; mm: number } | null): boolean {
  return !!r && (r.chance >= WET_CHANCE || r.mm >= 2);
}

export interface SwapOption {
  /** A catalogue or household-place key; null for the plan's own backup idea. */
  activityKey: string | null;
  title: string;
  summary: string;
  location?: string;
}

/**
 * Indoor alternatives for an outdoor plan: its own backup first, then the
 * household's indoor places, then indoor ideas of a similar length that suit
 * the children who are going. At most three, so it stays an offer.
 */
export function swapOptions(input: {
  activity: Activity;
  ideas: readonly Activity[];
  childAges: readonly string[];
  /** Ideas this household asked not to see again. */
  avoid?: ReadonlySet<string>;
}): SwapOption[] {
  const { activity } = input;
  const out: SwapOption[] = [];
  if (activity.backup) out.push({ activityKey: null, title: activity.backup, summary: `The backup for ${activity.title.toLowerCase()}.` });
  const fits = (a: Activity) =>
    a.key !== activity.key &&
    a.kind === activity.kind &&
    !a.weatherSensitive &&
    a.setting !== "outdoors" &&
    !input.avoid?.has(a.key) &&
    a.durationMinutes <= activity.durationMinutes * 1.5 &&
    a.durationMinutes >= activity.durationMinutes * 0.4 &&
    (!a.ages || !input.childAges.length || input.childAges.every((age) => a.ages!.includes(age as never)));
  const candidates = input.ideas.filter(fits);
  // Your own places first, then the closest in length.
  candidates.sort((a, b) => Number(!!b.local) - Number(!!a.local) || Math.abs(a.durationMinutes - activity.durationMinutes) - Math.abs(b.durationMinutes - activity.durationMinutes));
  for (const a of candidates) {
    if (out.length >= 3) break;
    out.push({ activityKey: a.key, title: a.title, summary: a.summary, location: a.location });
  }
  return out;
}
