/**
 * Parts of More switched off for the household test (strategy review,
 * 27 Oct 2026: "stop building or remove"). Hidden, never deleted: the code,
 * the data and the tests stay, and each comes back by naming it in the
 * MORE_SHOW environment variable (comma-separated, e.g. "places,weather").
 *
 * - trial: the Trial page leaves the menu; it still opens from its link.
 * - time-shared: the "How time has been shared" card on Our Week.
 * - places: Our places, and saving a plan as a place.
 * - look-back: the monthly Look back page.
 * - quiet-phone: "Quiet your phone" on Me.
 * - weather: forecasts, wet-weather swaps and the Open-Meteo calls behind them.
 */
export const FEATURES = ["trial", "time-shared", "places", "look-back", "quiet-phone", "weather"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = Record<Feature, boolean>;

/** Which features are on. Server-side only: pass the result to client components. */
export function features(env: string | undefined = process.env.MORE_SHOW): Features {
  const on = new Set((env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const all = on.has("all");
  return Object.fromEntries(FEATURES.map((f) => [f, all || on.has(f)])) as Features;
}

export function shown(f: Feature): boolean {
  return features()[f];
}
