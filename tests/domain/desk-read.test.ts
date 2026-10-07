import { readFileSync } from "node:fs";
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
      ["You're invited to Leo's 7th birthday party", "2026-10-25", "14:00", "16:00"],
      ["Reply deadline: You're invited to Leo's 7th birthday party", "2026-10-18", null, null],
    ]);
  });

  it("titles a booking by what it is, without the little words that led into a time", () => {
    expect(readLetter("Your table at Dishoom is confirmed for Friday 14 November at 7:30pm for 2 people.", ctx)[0].title).toBe("Your table at Dishoom");
  });

  it("reads 'closes ... reopens' as the break in between", () => {
    const [p] = readLetter("Christmas holidays: school closes at 1.30pm on Friday 19 December and reopens Monday 5 January.", ctx);
    expect(p).toMatchObject({ kind: "holiday", startDate: "2026-12-20", endDate: "2027-01-04" });
  });
});

describe("readLetter: a school newsletter with headings, sessions and deadlines", () => {
  const OAKFIELD = readFileSync(new URL("../fixtures/oakfield-newsletter.txt", import.meta.url), "utf8");
  const items = readLetter(OAKFIELD, ctx);
  const row = (p: (typeof items)[number]) => [p.role, p.kind, p.title, p.startDate, p.endDate, p.startTime, p.endTime];

  it("finds the 16 things a parent would put in the diary, and skips the newsletter's own date", () => {
    expect(items.filter((p) => p.role !== "optional").map(row)).toEqual([
      ["event", "event", "Year 4 Trip to the Science Museum", "2026-10-13", "2026-10-13", "08:45", "15:45"],
      ["event", "event", "Parents’ Evening", "2026-10-14", "2026-10-14", "15:30", "18:30"],
      ["event", "event", "Parents’ Evening", "2026-10-15", "2026-10-15", "16:00", "19:00"],
      ["deadline", "event", "Parents’ Evening booking deadline", "2026-10-12", "2026-10-12", "12:00", "12:15"],
      ["event", "event", "Individual School Photographs", "2026-10-16", "2026-10-16", null, null],
      ["event", "event", "Sibling photographs", "2026-10-16", "2026-10-16", "08:15", "09:15"],
      ["event", "event", "Harvest Assembly", "2026-10-19", "2026-10-19", "09:15", "10:00"],
      ["event", "holiday", "Half-Term", "2026-10-26", "2026-10-30", null, null],
      ["event", "event", "Children return to school", "2026-11-02", "2026-11-02", "08:45", "09:45"],
      ["deadline", "event", "Year 6 Secondary School Applications deadline", "2026-10-31", "2026-10-31", null, null],
      ["event", "event", "Friends of Oakfield Halloween Disco — Reception–Year 2", "2026-10-22", "2026-10-22", "16:30", "17:30"],
      ["event", "event", "Friends of Oakfield Halloween Disco — Years 3–6", "2026-10-22", "2026-10-22", "18:00", "19:15"],
      ["deadline", "event", "Friends of Oakfield Halloween Disco ticket deadline", "2026-10-20", "2026-10-20", null, null],
      ["event", "event", "Flu Vaccinations", "2026-11-04", "2026-11-04", null, null],
      ["deadline", "event", "Flu Vaccinations consent deadline", "2026-10-28", "2026-10-28", "17:00", "17:15"],
      ["event", "event", "Christmas Fair", "2026-12-05", "2026-12-05", "11:00", "14:00"],
    ]);
  });

  it("notices the food bank and the early finish, but only as optional extras", () => {
    expect(items.filter((p) => p.role === "optional").map((p) => [p.title, p.startDate, p.startTime])).toEqual([
      ["Donations for the local food bank", "2026-10-12", null],
      ["School closes for half-term", "2026-10-23", "15:15"],
    ]);
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
