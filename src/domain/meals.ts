/**
 * Dinners and the shopping list (the small first scope from the integration
 * brief): saved meals, one dinner choice per day, a quick fallback, and a
 * shared list built from the dinners plus anything added by hand.
 */

export type DinnerChoice = "meal" | "fallback" | "leftovers" | "elsewhere" | "later";
export type DinnerRole = "cook" | "clear";

/** "Milk", " milk " and "MILK" are one line on the list. */
export function itemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Ingredients as typed, one line each, without blanks or repeats. */
export function cleanIngredients(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = itemKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Which responsibilities a dinner can have: nobody cooks a meal eaten elsewhere. */
export function rolesFor(choice: DinnerChoice): DinnerRole[] {
  if (choice === "meal" || choice === "fallback") return ["cook", "clear"];
  if (choice === "leftovers") return ["cook", "clear"];
  return [];
}

/** The words for a dinner on a list or a job: "Fish pie", "Leftovers", "Eating elsewhere". */
export function dinnerLabel(choice: DinnerChoice, mealName: string | null, note = ""): string {
  if (choice === "meal") return mealName ?? "A saved meal";
  if (choice === "fallback") return mealName ? `${mealName} (the quick one)` : "The quick fallback";
  if (choice === "leftovers") return "Leftovers";
  if (choice === "elsewhere") return note ? `Eating elsewhere: ${note}` : "Eating elsewhere";
  return "Decide later";
}

/** The job's own name for a dinner responsibility, within the 80-character job limit. */
export function dinnerJobTitle(role: DinnerRole, choice: DinnerChoice, mealName: string | null): string {
  const what = choice === "leftovers" ? "heat up the leftovers" : `cook ${(mealName ?? "dinner").slice(0, 60)}`;
  return role === "cook" ? `Dinner: ${what}` : "Dinner: clear up afterwards";
}

export interface EveningItem {
  /** Local clock times on the day, "HH:MM". */
  startTime: string;
  endTime: string;
  allDay: boolean;
  adults: number;
  children: number;
  /** A title the viewer may see, or null when it's someone's busy time. */
  title: string | null;
}

/**
 * Why an evening might be a hard one for cooking, in plain words, from
 * what's in the diary: a late finish, someone out at teatime, a club.
 * Explainable rules only; no score, and nothing about how anyone feels.
 */
export function hardEveningReasons(items: readonly EveningItem[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (i.allDay) continue;
    const teatime = i.startTime < "19:00" && i.endTime > "17:30";
    if (!teatime) continue;
    if (i.children > 0) out.push(i.title ?? "a club");
    else if (i.adults > 0) out.push(i.startTime < "17:00" ? "a late finish" : "someone out at teatime");
  }
  return [...new Set(out)];
}

/** "Football and a late finish" */
export function joinReasons(reasons: readonly string[]): string {
  const r = reasons.slice(0, 3);
  const text = r.length > 1 ? `${r.slice(0, -1).join(", ")} and ${r.at(-1)}` : (r[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
