import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { households, moments, outbox, weatherForecasts } from "@/db/schema";
import { whenPhrase } from "@/domain/discreet";
import { isWet, rainDuring, type HourPoint } from "@/domain/weather";
import { CATALOGUE, type Activity } from "@/lib/catalogue";
import { placeAsActivity, placeKey, type PlaceView } from "@/lib/places";
import type { HttpFetch } from "./calendar-providers";
import { placesFor } from "./queries/places";

/**
 * Forecasts from Open-Meteo (free, no key). Each household with a town gets
 * a 7-day hourly forecast, refreshed every few hours by the tick and kept as
 * it is if a refresh fails, so a slow weather service never blocks a page.
 */

const REFRESH_MS = 3 * 3_600_000;
/** Older than this, a forecast is no longer trusted. */
const TRUST_MS = 18 * 3_600_000;

export async function fetchForecast(latitude: number, longitude: number, http: HttpFetch = fetch): Promise<HourPoint[]> {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(3),
    longitude: longitude.toFixed(3),
    hourly: "precipitation_probability,precipitation,weather_code,temperature_2m",
    timeformat: "unixtime",
    timezone: "UTC",
    forecast_days: "7",
  });
  const res = await http(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const data = (await res.json()) as { hourly?: { time?: number[]; precipitation_probability?: (number | null)[]; precipitation?: (number | null)[]; weather_code?: (number | null)[]; temperature_2m?: (number | null)[] } };
  const h = data.hourly;
  if (!h?.time?.length) throw new Error("forecast empty");
  return h.time.map((t, i) => ({
    t: t * 1000,
    rain: h.precipitation_probability?.[i] ?? 0,
    mm: h.precipitation?.[i] ?? 0,
    code: h.weather_code?.[i] ?? 3,
    temp: h.temperature_2m?.[i] ?? 0,
  }));
}

/** Refresh the households whose forecast is missing or due. Best effort, one at a time. */
export async function refreshForecasts(db: Db, now = new Date(), http: HttpFetch = fetch, limit = 20): Promise<{ refreshed: number; failed: number }> {
  const due = await db
    .select({ id: households.id, lat: households.latitude, lon: households.longitude })
    .from(households)
    .leftJoin(weatherForecasts, eq(weatherForecasts.householdId, households.id))
    .where(and(isNull(households.deletedAt), isNotNull(households.latitude), isNotNull(households.longitude), or(isNull(weatherForecasts.fetchedAt), lt(weatherForecasts.fetchedAt, new Date(now.getTime() - REFRESH_MS)))))
    .limit(limit);
  let refreshed = 0;
  let failed = 0;
  for (const h of due) {
    try {
      const hours = await fetchForecast(h.lat!, h.lon!, http);
      await db
        .insert(weatherForecasts)
        .values({ householdId: h.id, fetchedAt: now, hours })
        .onConflictDoUpdate({ target: weatherForecasts.householdId, set: { fetchedAt: now, hours } });
      refreshed++;
    } catch {
      failed++;
    }
  }
  return { refreshed, failed };
}

export async function forecastFor(db: DbOrTx, householdId: string, now = new Date()): Promise<HourPoint[] | null> {
  const [row] = await db.select().from(weatherForecasts).where(eq(weatherForecasts.householdId, householdId));
  if (!row || now.getTime() - row.fetchedAt.getTime() > TRUST_MS) return null;
  return row.hours as HourPoint[];
}

/** The idea behind a plan, if it came from the catalogue or one of the household's places. */
export function activityFor(key: string | null, kind: Activity["kind"], householdPlaces: readonly PlaceView[]): Activity | null {
  if (!key) return null;
  if (key.startsWith("place:")) {
    const p = householdPlaces.find((x) => placeKey(x.id) === key);
    return p ? placeAsActivity(p, kind) : null;
  }
  return CATALOGUE.find((a) => a.key === key) ?? null;
}

/**
 * The day before an outdoor plan (and again on the day if it turns wet),
 * tell the people going that rain is likely and a swap is ready. Family
 * plans and your own time only: time for the two of you is never nudged.
 */
export async function queueWeatherSwaps(db: Db, now = new Date()): Promise<{ queued: number }> {
  const soon = new Date(now.getTime() + 30 * 3_600_000);
  const rows = await db
    .select({ m: moments, tz: households.timeZone })
    .from(moments)
    .innerJoin(households, eq(households.id, moments.householdId))
    .innerJoin(weatherForecasts, eq(weatherForecasts.householdId, moments.householdId))
    .where(
      and(
        isNull(households.deletedAt),
        eq(moments.lifecycle, "planned"),
        eq(moments.sharing, "shared"),
        inArray(moments.kind, ["family", "me"]),
        isNotNull(moments.activityKey),
        gt(moments.startAt, now),
        lt(moments.startAt, soon),
      ),
    );
  let queued = 0;
  const placeCache = new Map<string, PlaceView[]>();
  for (const { m, tz } of rows) {
    if (!placeCache.has(m.householdId)) placeCache.set(m.householdId, m.activityKey?.startsWith("place:") ? await placesFor(db, m.householdId) : []);
    const activity = activityFor(m.activityKey, m.kind, placeCache.get(m.householdId)!);
    if (!activity?.weatherSensitive) continue;
    const hours = await forecastFor(db, m.householdId, now);
    if (!hours || !isWet(rainDuring(hours, m.startAt.getTime(), m.endAt.getTime()))) continue;
    const when = whenPhrase(m.startAt.getTime(), now.getTime(), tz);
    for (const recipientId of m.participantIds) {
      const text = m.kind === "me" ? `Rain is likely for your time ${when}. There's an indoor option ready in More.` : `Rain is likely for ${m.title} ${when}. There's an indoor swap ready in More.`;
      const r = await db
        .insert(outbox)
        .values({
          householdId: m.householdId,
          eventType: "notify",
          dedupeKey: `notify:weather.swap:${m.id}:${m.materialVersion}:${recipientId}`,
          payload: { recipientId, kind: "weather.swap", text, sourceType: "moment", sourceId: m.id, sourceVersion: m.materialVersion, householdId: m.householdId },
        })
        .onConflictDoNothing({ target: outbox.dedupeKey })
        .returning({ id: outbox.id });
      queued += r.length;
    }
  }
  return { queued };
}

/** Forget a household's forecast, e.g. when its town is cleared. */
export async function clearForecast(db: DbOrTx, householdId: string): Promise<void> {
  await db.delete(weatherForecasts).where(eq(weatherForecasts.householdId, householdId));
}
