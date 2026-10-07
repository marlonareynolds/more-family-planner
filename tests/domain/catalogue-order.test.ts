import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/catalogue";
import { courseOptions, type Budget, type Course, type Mood } from "@/lib/date-night";

/**
 * Private shelves (R07) seat each idea by its position in its list, so lists
 * may only grow at the end. Reordering, removing or inserting in the middle
 * would move ideas between partners' shelves. Retire an idea by leaving it in
 * place and filtering it out, never by deleting it.
 *
 * To record a deliberate append: UPDATE_SEATS=1 pnpm exec vitest run tests/domain/catalogue-order.test.ts
 */
const FILE = join(__dirname, "catalogue-order.frozen.json");

function current(): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const kind of ["me", "us", "family"] as const) lists[`catalogue:${kind}`] = CATALOGUE.filter((a) => a.kind === kind).map((a) => a.key);
  for (const mood of ["cosy", "out", "air", "new"] as Mood[]) {
    for (const course of ["entree", "dessert"] as Course[]) lists[`${course}:${mood}`] = courseOptions(course, mood, "free").map((o) => o.text);
    for (const budget of ["free", "treat", "splurge"] as Budget[]) lists[`plat:${mood}:${budget}`] = courseOptions("plat", mood, budget).map((o) => o.text);
  }
  return lists;
}

describe("idea lists only grow at the end (R07 guard)", () => {
  it("every frozen list is still a prefix of the current list", () => {
    const now = current();
    if (process.env.UPDATE_SEATS) writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    const frozen = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string[]>;
    for (const [name, list] of Object.entries(frozen)) {
      expect(now[name], name).toBeDefined();
      expect(now[name].slice(0, list.length), name).toEqual(list);
    }
  });
});
