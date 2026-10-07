import type { Activity, Category, Setting } from "./catalogue";

/** A household's own place, as the app sees it. */
export interface PlaceView {
  id: string;
  name: string;
  area: string;
  kinds: ("me" | "us" | "family")[];
  category: Category;
  setting: Setting;
  notes: string;
  typicalCostMinor: number;
  durationMinutes: number;
  stepFree: boolean;
  calm: boolean;
  version: number;
}

export const placeKey = (id: string) => `place:${id}`;

/** A place as an idea, so it can sit alongside the catalogue in ideas and picks. */
export function placeAsActivity(p: PlaceView, kind: Activity["kind"]): Activity {
  return {
    key: placeKey(p.id),
    kind,
    title: p.name,
    summary: p.notes || (p.area ? `One of your places, in ${p.area}.` : "One of your places."),
    category: p.category,
    typicalCostMinor: p.typicalCostMinor,
    durationMinutes: p.durationMinutes,
    setting: p.setting,
    preparation: "low",
    weatherSensitive: p.setting === "outdoors",
    sensoryLoad: p.calm ? "low" : "medium",
    accessNotes: "",
    stepFree: p.stepFree,
    local: true,
    location: [p.name, p.area].filter(Boolean).join(", "),
    owner: "Your household",
    reviewBy: "",
  };
}

export function placeActivities(places: readonly PlaceView[], kind: Activity["kind"]): Activity[] {
  return places.filter((p) => p.kinds.includes(kind)).map((p) => placeAsActivity(p, kind));
}
