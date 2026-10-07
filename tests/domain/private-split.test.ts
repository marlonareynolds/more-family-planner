import { describe, expect, it } from "vitest";
import { CATALOGUE, catalogueSeat } from "@/lib/catalogue";
import { composeMenu, courseOptions, type Budget, type Course, type Mood } from "@/lib/date-night";
import { myShare } from "@/lib/private-split";

const adults = ["b-sam", "a-alex"];
const shelf = (accountId: string, householdId = "h1") => ({ householdId, accountId, adultIds: adults });

describe("For Us shelves: each partner has their own ideas", () => {
  it("deals every item to exactly one adult, half each, stable across calls", () => {
    const items = CATALOGUE.filter((a) => a.kind === "us").map((a) => a.key);
    const alex = myShare(items, (k) => k, shelf("a-alex"), catalogueSeat);
    const sam = myShare(items, (k) => k, shelf("b-sam"), catalogueSeat);
    expect(alex.filter((k) => sam.includes(k))).toEqual([]);
    expect([...alex, ...sam].sort()).toEqual([...items].sort());
    expect(Math.abs(alex.length - sam.length)).toBeLessThanOrEqual(1);
    expect(myShare(items, (k) => k, shelf("a-alex"), catalogueSeat)).toEqual(alex);
    // Some other household is dealt the other way round.
    expect(["h2", "h3", "h4", "h5"].some((h) => JSON.stringify(myShare(items, (k) => k, shelf("a-alex", h), catalogueSeat)) !== JSON.stringify(alex))).toBe(true);
  });

  it("gives a single adult everything", () => {
    expect(myShare([1, 2, 3], String, { householdId: "h1", accountId: "a", adultIds: ["a"] })).toEqual([1, 2, 3]);
  });

  it("never offers both partners the same course, and each has more than one to choose from", () => {
    const places = [{ name: "The Boathouse", area: null, kinds: ["us"] }, { name: "Zia's", area: null, kinds: ["us"] }];
    for (const mood of ["cosy", "out", "air", "new"] as Mood[]) {
      for (const budget of ["free", "treat", "splurge"] as Budget[]) {
        for (const course of ["entree", "plat", "dessert"] as Course[]) {
          const a = courseOptions(course, mood, budget, places, shelf("a-alex")).map((o) => o.text);
          const s = courseOptions(course, mood, budget, places, shelf("b-sam")).map((o) => o.text);
          expect(a.filter((t) => s.includes(t))).toEqual([]);
          expect(a.length).toBeGreaterThanOrEqual(2);
          expect(s.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
    // A place stays on one shelf whatever the mood or budget.
    const owner = (name: string) => courseOptions("plat", "out", "free", places, shelf("a-alex")).some((o) => o.text.includes(name));
    for (const name of ["The Boathouse", "Zia's"]) {
      for (const [mood, budget] of [["air", "splurge"], ["new", "treat"]] as [Mood, Budget][]) {
        expect(courseOptions("plat", mood, budget, places, shelf("a-alex")).some((o) => o.text.includes(name))).toBe(owner(name));
      }
    }
  });

  it("composes different menus for the two partners in the same week", () => {
    const a = composeMenu({ mood: "out", budget: "treat", seed: "h1:a-alex:2030-10-07", shelf: shelf("a-alex") });
    const s = composeMenu({ mood: "out", budget: "treat", seed: "h1:b-sam:2030-10-07", shelf: shelf("b-sam") });
    expect(a.entree).not.toBe(s.entree);
    expect(a.plat).not.toBe(s.plat);
    expect(a.dessert).not.toBe(s.dessert);
  });
});

describe("R07 private shelves stay put (BR-12)", () => {
  const keys = CATALOGUE.filter((a) => a.kind === "us").map((a) => a.key);
  const owners = (items: string[], s: (id: string) => ReturnType<typeof shelf>) => {
    const alex = new Set(myShare(items, (k) => k, s("a-alex")));
    return new Map(items.map((k) => [k, alex.has(k) ? "a-alex" : "b-sam"]));
  };

  it("adding or removing ideas never moves an existing idea to the other shelf", () => {
    const before = owners(keys, (id) => shelf(id));
    for (const added of [["aaa-new"], ["zzz-new"], ["mid-new", "another-new", "third-new"]]) {
      const after = owners([...keys, ...added], (id) => shelf(id));
      expect(keys.filter((k) => after.get(k) !== before.get(k))).toEqual([]);
    }
    for (const removed of keys.slice(0, 4)) {
      const after = owners(keys.filter((k) => k !== removed), (id) => shelf(id));
      expect(keys.filter((k) => k !== removed && after.get(k) !== before.get(k))).toEqual([]);
    }
  });

  it("when a partner changes, ideas the staying adult has already used stay theirs", () => {
    const used = keys.slice(0, 6);
    const stayer = (id: string) => ({ householdId: "h1", accountId: id, adultIds: ["a-alex", "c-new"], claimed: Object.fromEntries(used.map((k) => [k, "a-alex"])) });
    const alex = myShare(keys, (k) => k, stayer("a-alex"));
    const newcomer = myShare(keys, (k) => k, stayer("c-new"));
    expect(used.every((k) => alex.includes(k))).toBe(true);
    expect(used.some((k) => newcomer.includes(k))).toBe(false);
    expect(alex.filter((k) => newcomer.includes(k))).toEqual([]);
  });

  it("an idea one partner has used is never on the other's shelf", () => {
    const claimed = { [keys[0]]: "b-sam", [keys[1]]: "a-alex" };
    const alex = myShare(keys, (k) => k, { ...shelf("a-alex"), claimed });
    const sam = myShare(keys, (k) => k, { ...shelf("b-sam"), claimed });
    expect(sam).toContain(keys[0]);
    expect(alex).not.toContain(keys[0]);
    expect(alex).toContain(keys[1]);
    expect(sam).not.toContain(keys[1]);
  });
});
