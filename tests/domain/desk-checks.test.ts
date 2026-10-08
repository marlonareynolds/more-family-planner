import { describe, expect, it } from "vitest";
import { checksFor, noteLines } from "@/lib/desk-checks";
import { readLetter, type Proposal } from "@/lib/desk-read";

/**
 * Quality release, priority 3: uncertainty is visible on every Desk card
 * before anything enters the diary, and a pickup, a payment or an unclear
 * child or date waits for a deliberate answer. Before this release the cards
 * carried none of these: a missing end silently became a one-hour event.
 */

const kids = [
  { id: "11111111-1111-4111-8111-111111111111", preferredName: "Mia" },
  { id: "22222222-2222-4222-8222-222222222222", preferredName: "Leo" },
];
const ctx = { today: "2026-10-07", children: kids };
const codes = (p: Proposal, letter: string | null = null, children = kids) => checksFor(p, { children, letter }).map((c) => `${c.code}${c.decide ? "!" : ""}`);
const one = (text: string) => {
  const found = readLetter(text, ctx);
  expect(found).toHaveLength(1);
  return found[0];
};

describe("Desk card checks", () => {
  it("a date with no time says so, and doesn't pretend to an hour", () => {
    const p = one("Harvest festival on Friday 17 October.");
    expect(p.startTime).toBeNull();
    expect(codes(p)).toContain("time_not_stated");
    expect(noteLines(checksFor(p, { children: kids, letter: null }))).toEqual(["Time not stated in the letter."]);
  });

  it("a start with no end is marked as an estimate", () => {
    const p = one("Parents' evening on 22/10 at 3.30pm.");
    expect(p.endStated).toBe(false);
    expect(checksFor(p, { children: kids, letter: null }).find((c) => c.code === "estimated_end")?.text).toBe("End time not stated. Shown as 16:30, an estimate.");
  });

  it("a stated end carries no estimate", () => {
    expect(codes(one("Parents' evening on 22/10, 3.30pm to 6pm."))).not.toContain("estimated_end");
  });

  it("an early finish is a pickup decision, not merely optional", () => {
    const p = one("School closes at 1.30pm on Friday 19 December.");
    expect(p.pickupChange).toBe(true);
    expect(codes(p)).toContain("pickup!");
  });

  it("a payment deadline needs someone to pay it", () => {
    const p = one("Please pay £12.50 for the trip by 12pm on Monday 20 October.");
    expect(p.role).toBe("deadline");
    expect(codes(p)).toContain("payment!");
  });

  it("asks which child when the letter is for a year group and there are two children", () => {
    const p = one("Year 4 trip to the Science Museum on Wednesday 12 November.");
    expect(codes(p)).toContain("which_child!");
    expect(codes(p, null, [kids[0]])).not.toContain("which_child!");
    expect(codes({ ...p, childIds: [kids[1].id] })).not.toContain("which_child!");
  });

  it("a worked-out date must be checked", () => {
    const p = one("Harvest festival on Friday 17 October.");
    expect(codes({ ...p, dateCertain: false })).toContain("date_unclear!");
  });

  it("flags a quoted line the letter doesn't contain word for word", () => {
    const p = one("Harvest festival on Friday 17 October.");
    expect(codes(p, "Harvest   festival on **Friday** 17 October.")).not.toContain("not_in_letter!");
    expect(codes(p, "Sports day on Friday 17 October.")).toContain("not_in_letter!");
  });
});
