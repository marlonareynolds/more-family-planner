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
