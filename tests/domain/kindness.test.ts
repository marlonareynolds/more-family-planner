import { describe, expect, it } from "vitest";
import { BUDGETS, LINE_NEEDS, MOODS, composeMenu, courseOptions, menuStarts, type Course } from "@/lib/date-night";
import { KINDNESSES, NEEDS, dealKindnesses, kindnessText, type Need } from "@/lib/kindness";
import { myShare } from "@/lib/private-split";

const adults = ["b-sam", "a-alex"];
const shelf = (accountId: string, householdId = "h1") => ({ householdId, accountId, adultIds: adults });
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `seed-${i}`);
const none = new Set<Need>();

// The kindness list only grows at the end: a kindness's position is its seat
// on the private split, so reordering would move ideas between partners.
const FROZEN_FIRST = ["k-out-loud", "k-hidden-note", "k-thanks-small", "k-midday-text", "k-tell-a-friend", "k-proud-of", "k-take-a-job", "k-clear-up-alone"];

describe("The kindness list", () => {
  it("has six kindnesses for every need, unique keys that don't name the need, and grows only at the end", () => {
    for (const need of NEEDS) expect(KINDNESSES.filter((k) => k.need === need)).toHaveLength(6);
    expect(new Set(KINDNESSES.map((k) => k.key)).size).toBe(KINDNESSES.length);
    for (const k of KINDNESSES) expect(k.key.split("-").filter((w) => (NEEDS as readonly string[]).includes(w)), k.key).toEqual([]);
    expect(KINDNESSES.slice(0, FROZEN_FIRST.length).map((k) => k.key)).toEqual(FROZEN_FIRST);
  });

  it("names the partner, and falls back gently without one", () => {
    expect(kindnessText({ text: "Leave a note somewhere {name} will find it" }, "Sam")).toBe("Leave a note somewhere Sam will find it");
    expect(kindnessText({ text: "Hold {name}'s hand" }, null)).toBe("Hold your partner's hand");
  });
});

describe("Small kindnesses stay genuine", () => {
  it("each partner has their own half of the list: nothing on one card can appear on the other's", () => {
    const alex = myShare(KINDNESSES, (k) => k.key, shelf("a-alex"), (k) => KINDNESSES.indexOf(k)).map((k) => k.key);
    const sam = myShare(KINDNESSES, (k) => k.key, shelf("b-sam"), (k) => KINDNESSES.indexOf(k)).map((k) => k.key);
    expect(alex.filter((k) => sam.includes(k))).toEqual([]);
    expect(alex.length + sam.length).toBe(KINDNESSES.length);
    // Every need is on both shelves, so a need always has something to tip towards.
    for (const need of NEEDS) {
      expect(KINDNESSES.filter((k) => k.need === need && alex.includes(k.key)).length).toBeGreaterThanOrEqual(2);
      expect(KINDNESSES.filter((k) => k.need === need && sam.includes(k.key)).length).toBeGreaterThanOrEqual(2);
    }
    for (const seed of seeds(200)) {
      const dealt = dealKindnesses({ shelf: shelf("b-sam"), needs: new Set(NEEDS), seed });
      expect(dealt.every((k) => sam.includes(k.key))).toBe(true);
    }
  });

  it("with nothing shared, every kindness on the shelf turns up about equally often", () => {
    const counts = new Map<string, number>();
    const runs = seeds(4000);
    for (const seed of runs) for (const k of dealKindnesses({ shelf: shelf("b-sam"), needs: none, seed })) counts.set(k.key, (counts.get(k.key) ?? 0) + 1);
    const mine = myShare(KINDNESSES, (k) => k.key, shelf("b-sam"), (k) => KINDNESSES.indexOf(k));
    const mean = (runs.length * 2) / mine.length;
    for (const k of mine) {
      expect(counts.get(k.key) ?? 0).toBeGreaterThan(mean * 0.75);
      expect(counts.get(k.key) ?? 0).toBeLessThan(mean * 1.25);
    }
  });

  it("a need tips the odds without making anything certain", () => {
    const share = (needs: Set<Need>) => {
      let matching = 0;
      let deals = 0;
      let withoutAny = 0;
      for (const seed of seeds(3000)) {
        const dealt = dealKindnesses({ shelf: shelf("b-sam"), needs, seed });
        const m = dealt.filter((k) => k.need === "noticed").length;
        matching += m;
        deals += dealt.length;
        if (m === 0) withoutAny++;
      }
      return { rate: matching / deals, withoutAny: withoutAny / 3000 };
    };
    const before = share(none);
    const after = share(new Set<Need>(["noticed"]));
    expect(before.rate).toBeGreaterThan(0.08);
    expect(before.rate).toBeLessThan(0.18);
    expect(after.rate).toBeGreaterThan(0.28);
    expect(after.rate).toBeLessThan(0.5);
    // Plenty of weeks still have nothing from the shared need: no card gives it away.
    expect(after.withoutAny).toBeGreaterThan(0.3);
  });

  it("'Another' and recently done kindnesses step aside", () => {
    const first = dealKindnesses({ shelf: shelf("b-sam"), needs: none, seed: "w1" });
    const skipped = dealKindnesses({ shelf: shelf("b-sam"), needs: none, seed: "w1", skipped: new Set([first[0].key]) });
    expect(skipped.map((k) => k.key)).not.toContain(first[0].key);
    expect(skipped[0].key).toBe(first[1].key);
    const rested = dealKindnesses({ shelf: shelf("b-sam"), needs: none, seed: "w1", rested: new Set(first.map((k) => k.key)) });
    expect(rested.some((k) => first.some((f) => f.key === k.key))).toBe(false);
  });
});

describe("The date night concierge leans the same way", () => {
  const all = (course: Course) => new Set(MOODS.flatMap((m) => BUDGETS.flatMap((b) => courseOptions(course, m.value, b.value).map((o) => o.text))));

  it("tags only lines that exist", () => {
    const lines = new Set([...all("entree"), ...all("plat"), ...all("dessert")]);
    for (const line of Object.keys(LINE_NEEDS)) expect(lines.has(line), line).toBe(true);
  });

  it("sends the browser positions only, and a need makes a matching first course likelier", () => {
    const starts = menuStarts({ seed: "s", needs: new Set<Need>(["listened"]), shelf: shelf("b-sam") });
    expect(Object.values(starts).every((v) => Number.isInteger(v))).toBe(true);
    expect(Object.keys(starts).sort()).toEqual(
      [...MOODS.flatMap((m) => [`${m.value}:entree`, `${m.value}:dessert`, ...BUDGETS.map((b) => `${m.value}:${b.value}:plat`)])].sort(),
    );
    // Whichever partner has "Phones in a drawer" on their shelf is the one it can lean for.
    const line = "Phones in a drawer, and a toast to getting through the week";
    const who = ["a-alex", "b-sam"].find((a) => courseOptions("entree", "cosy", "treat", [], shelf(a)).some((o) => o.text === line))!;
    const rate = (needs: Set<Need>) => {
      let hits = 0;
      for (const seed of seeds(1500)) {
        const menu = composeMenu({ mood: "cosy", budget: "treat", seed: "x", shelf: shelf(who), starts: menuStarts({ seed, needs, shelf: shelf(who) }) });
        if (menu.entree === line) hits++;
      }
      return hits / 1500;
    };
    const before = rate(none);
    expect(before).toBeGreaterThan(0.2);
    expect(before).toBeLessThan(0.45);
    expect(rate(new Set<Need>(["listened"]))).toBeGreaterThan(before * 1.5);
  });

  it("uses the server's starting point when it has one, and shuffles on from it", () => {
    const list = courseOptions("entree", "out", "treat", [], shelf("a-alex")).map((o) => o.text);
    const starts = { "out:entree": 1 };
    expect(composeMenu({ mood: "out", budget: "treat", seed: "z", shelf: shelf("a-alex"), starts }).entree).toBe(list[1]);
    expect(composeMenu({ mood: "out", budget: "treat", seed: "z", shelf: shelf("a-alex"), starts, turns: { entree: 1 } }).entree).toBe(list[2 % list.length]);
  });
});
