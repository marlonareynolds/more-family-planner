import { describe, expect, it } from "vitest";
import { readLetter } from "@/lib/desk-read";

const ctx = {
  today: "2026-10-07",
  children: [
    { id: "c-mia", preferredName: "Mia" },
    { id: "c-sam", preferredName: "Sam" },
  ],
};

const SCHOOL = `---------- Forwarded message ---------
From: St Mary's Primary <office@stmarys.example>
Date: Mon, 6 Oct 2026 at 09:12
Subject: Autumn term dates and Year 3 trip
To: parents@stmarys.example

Dear parents,

Half term is from Monday 27th October to Friday 31st October.
INSET day: Monday 3 November, school closed to pupils.
Year 3 trip to the Natural History Museum on Thursday 16 October. Please send Mia with a packed lunch.
Parents' evening: 22/10/2026, 3.30pm - 6pm.
Harvest assembly 10 Oct at 9:15am.

Kind regards,
Mrs Patel
Sent from my iPhone`;

describe("readLetter: school letter", () => {
  const items = readLetter(SCHOOL, ctx);

  it("finds each dated item once, in letter order, and skips the forwarding headers", () => {
    expect(items.map((p) => [p.kind, p.startDate, p.endDate])).toEqual([
      ["holiday", "2026-10-27", "2026-10-31"],
      ["holiday", "2026-11-03", "2026-11-03"],
      ["event", "2026-10-16", "2026-10-16"],
      ["event", "2026-10-22", "2026-10-22"],
      ["event", "2026-10-10", "2026-10-10"],
    ]);
  });

  it("reads times, including a range whose first time has no am or pm", () => {
    expect(items[3]).toMatchObject({ startTime: "15:30", endTime: "18:00" });
    expect(items[4]).toMatchObject({ startTime: "09:15", endTime: "10:15" });
    expect(items[0]).toMatchObject({ startTime: null, endTime: null });
  });

  it("gives each item a readable title without the dates", () => {
    expect(items[0].title).toBe("Half term");
    expect(items[2].title).toBe("Year 3 trip to the Natural History Museum");
    expect(items[3].title).toBe("Parents' evening");
    expect(items[4].title).toBe("Harvest assembly");
  });

  it("matches children by name, and covers every child for a school break", () => {
    expect(items[2].childIds).toEqual(["c-mia"]);
    expect(items[0].childIds).toEqual(["c-mia"]);
  });

  it("keeps the source line so a parent can check it", () => {
    expect(items[1].source).toBe("INSET day: Monday 3 November, school closed to pupils.");
  });
});

describe("readLetter: dates", () => {
  it("reads a short range like 20 - 24 October", () => {
    const [p] = readLetter("Swimming week 20 - 24 October", ctx);
    expect(p).toMatchObject({ startDate: "2026-10-20", endDate: "2026-10-24", title: "Swimming week" });
  });

  it("puts a date without a year in the coming months, rolling into next year", () => {
    expect(readLetter("Nativity play 12 December", ctx)[0].startDate).toBe("2026-12-12");
    expect(readLetter("Sports day 3 July", ctx)[0].startDate).toBe("2027-07-03");
  });

  it("marks a past date as past so it isn't ticked", () => {
    const [p] = readLetter("Photos were taken 1/9/2026", ctx);
    expect(p.past).toBe(true);
  });

  it("reads American month-first order with a weekday", () => {
    const [p] = readLetter("Party on Saturday, October 18th, 2026 from 2pm to 4pm", ctx);
    expect(p).toMatchObject({ startDate: "2026-10-18", startTime: "14:00", endTime: "16:00" });
  });

  it("does not read 3.30 as a date", () => {
    expect(readLetter("Pickup moves to 3.30 from now on", ctx)).toEqual([]);
  });

  it("ignores impossible dates", () => {
    expect(readLetter("Meeting 31 November", ctx)).toEqual([]);
  });
});

describe("readLetter: bookings", () => {
  const BOOKING = `Subject: Your booking to Lisbon
Booking reference: XK72PQ
Outbound flight: Fri 14 Nov 2026, departs LGW 07:05, arrives LIS 09:50
Return flight: Mon 17 Nov 2026, departs LIS 18:20, arrives LGW 20:55`;

  it("turns the outward and return legs into one trip", () => {
    const items = readLetter(BOOKING, ctx);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "trip", startDate: "2026-11-14", startTime: "07:05", endDate: "2026-11-17", endTime: "20:55", title: "Your booking to Lisbon" });
  });
});

describe("readLetter: invitations and closures", () => {
  it("titles a bare date line from the heading above it, and turns an RSVP into a reply reminder", () => {
    const items = readLetter("You're invited to Leo's 7th birthday party!\nSaturday 25th October, 2-4pm\nJump Zone, Guildford. RSVP to Kate by 18 Oct", ctx);
    expect(items.map((p) => [p.title, p.startDate, p.startTime, p.endTime])).toEqual([
      ["You're invited to Leo's 7th birthday party!", "2026-10-25", "14:00", "16:00"],
      ["Reply: You're invited to Leo's 7th birthday party!", "2026-10-18", null, null],
    ]);
  });

  it("drops the little words that led into a time", () => {
    expect(readLetter("Your table at Dishoom is confirmed for Friday 14 November at 7:30pm for 2 people.", ctx)[0].title).toBe("Your table at Dishoom is confirmed for 2 people");
  });

  it("reads 'closes ... reopens' as the break in between", () => {
    const [p] = readLetter("Christmas holidays: school closes at 1.30pm on Friday 19 December and reopens Monday 5 January.", ctx);
    expect(p).toMatchObject({ kind: "holiday", startDate: "2026-12-20", endDate: "2027-01-04" });
  });
});

describe("readLetter: limits", () => {
  it("returns nothing for text without dates", () => {
    expect(readLetter("Thanks for a lovely term!", ctx)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(readLetter(SCHOOL, ctx)).toEqual(readLetter(SCHOOL, ctx));
  });
});
