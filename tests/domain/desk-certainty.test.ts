import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checksFor } from "@/lib/desk-checks";
import { readLetter, weekdayClash, type Proposal } from "@/lib/desk-read";

/**
 * Review (27 Oct 2026, thread 2): on the repo's own letters the reader on
 * the phone set a Monday class to repeat on Tuesdays, turned a past deadline
 * into next year's and pre-ticked it, and never flagged a date whose weekday
 * didn't match. Now: anything the reader is unsure of waits for a person,
 * and nothing is guessed.
 */

const TODAY = "2026-10-27"; // a Tuesday
const read = (text: string) => readLetter(text, { today: TODAY, children: [] });
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");
/** Would the card start ticked? The same rule the Desk uses: past, unsure or optional items never are. */
const preTicked = (p: Proposal, letter: string) => !p.past && p.role !== "optional" && !checksFor(p, { children: [], letter, today: TODAY }).some((c) => c.decide);

describe("the Desk never pre-ticks what the reader is unsure of", () => {
  it("a weekday that doesn't match the date is flagged, not guessed", () => {
    const letter = fixture("football-club.txt");
    const tournament = read(letter).find((p) => p.title === "Tournament")!;
    // "Sunday 16th November": 16 November 2026 is a Monday.
    expect(tournament.dateCertain).toBe(false);
    expect(preTicked(tournament, letter)).toBe(false);
    expect(checksFor(tournament, { children: [], letter, today: TODAY }).find((c) => c.code === "date_unclear")?.text).toMatch(/day of the week/);
  });

  it("a past deadline stays in the past instead of moving to next year", () => {
    const letter = fixture("oakfield-newsletter.txt");
    const booking = read(letter).find((p) => /booking deadline/i.test(p.title))!;
    // "by 12 noon on Monday 12 October": 12 October 2026 was a Monday, two weeks ago.
    expect(booking.startDate).toBe("2026-10-12");
    expect(booking.past).toBe(true);
    expect(preTicked(booking, letter)).toBe(false);
  });

  it("a date with no year that has only just passed is not quietly moved to next year", () => {
    const [p] = read("Please return the consent form by 1 October.");
    expect(p.startDate).toBe("2027-10-01");
    expect(p.dateCertain).toBe(false);
    expect(preTicked(p, "Please return the consent form by 1 October.")).toBe(false);
    // Early next year from late this year is still certain: letters look ahead.
    expect(readLetter("Term starts on 5 January.", { today: "2026-12-10", children: [] })[0]).toMatchObject({ startDate: "2027-01-05", dateCertain: true });
  });

  it("a repeat on the wrong weekday is flagged", () => {
    const letter = "Mon 20 Oct – Year 5 swimming starts (every Monday until 8 Dec)";
    const [p] = read(letter);
    expect(p.repeat).toBe("weekly");
    expect(p.dateCertain).toBe(false);
    expect(preTicked(p, letter)).toBe(false);
  });

  it("a weekday that matches leaves the card as it was", () => {
    const letter = "Christmas Fair on Saturday 5 December from 11am to 2pm.";
    const [p] = read(letter);
    expect(p.dateCertain).toBe(true);
    expect(preTicked(p, letter)).toBe(true);
  });

  it("the same checks apply to the AI reader's cards", () => {
    expect(weekdayClash("Our tournament is on Sunday 16th November, kick off 10am", "2026-11-16")).toBe(true);
    expect(weekdayClash("Our tournament is on Sunday 16th November, kick off 10am", "2025-11-16")).toBe(false);
    expect(weekdayClash("Swimming every Monday from 20 October", "2026-10-20")).toBe(true);
    const ai = { kind: "event", role: "deadline", startTime: null, endTime: null, endStated: false, dateCertain: true, pickupChange: false, forWhom: null, childIds: [], source: "Please pay by 1 October", title: "Payment", details: "" } as const;
    // A date the letter gave no year for, almost a year away: it may have passed.
    expect(checksFor({ ...ai, childIds: [], startDate: "2027-10-01" }, { children: [], letter: null, today: TODAY }).some((c) => c.code === "date_unclear" && c.decide)).toBe(true);
    expect(checksFor({ ...ai, childIds: [], startDate: "2026-11-01" }, { children: [], letter: null, today: TODAY }).some((c) => c.code === "date_unclear")).toBe(false);
  });
});
