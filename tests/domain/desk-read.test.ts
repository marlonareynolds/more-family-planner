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
    expect(readLetter("Your table at Dishoom is confirmed for Friday 14 November at 7:30pm for 2 people.", ctx)[0].title).toBe("Table at Dishoom");
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

describe("readLetter: the same newsletter copied in other ways", () => {
  const OAKFIELD = readFileSync(new URL("../fixtures/oakfield-newsletter.txt", import.meta.url), "utf8");
  const HEADINGS = ["Year 4 Trip to the Science Museum", "Parents’ Evening", "Individual School Photographs", "Harvest Assembly", "Half-Term", "Year 6 Secondary School Applications", "Friends of Oakfield Halloween Disco", "Flu Vaccinations", "Looking Ahead"];
  const DATE = /((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d{1,2} (?:October|November|December))/g;
  const rows = (text: string) => readLetter(text, ctx).map((p) => [p.role, p.kind, p.title, p.startDate, p.endDate, p.startTime, p.endTime]);
  const expected = rows(OAKFIELD);
  const byLine = (f: (line: string) => string) => OAKFIELD.split("\n").map(f).join("\n");
  const variants: [string, string][] = [
    ["markdown headings and bold dates", byLine((l) => (HEADINGS.includes(l) ? `### ${l}` : l.replace(DATE, "**$1**")))],
    ["bold headings", byLine((l) => (HEADINGS.includes(l) ? `**${l}**` : l))],
    ["headings ending in a colon", byLine((l) => (HEADINGS.includes(l) ? `${l}:` : l))],
    ["headings in capitals", byLine((l) => (HEADINGS.includes(l) ? l.toUpperCase() : l))],
    ["HTML from an email", `<html><body>${OAKFIELD.split("\n").map((l) => (HEADINGS.includes(l) ? `<h3>${l}</h3>` : `<p>${l.replace(DATE, "<b>$1</b>")}</p>`)).join("")}</body></html>`],
    ["Windows line endings and non-breaking spaces", OAKFIELD.replace(/\n/g, "\r\n").replace(/(\d) (October|November|December)/g, "$1\u00a0$2")],
    ["blank lines between paragraphs", OAKFIELD.replace(/\n/g, "\n\n")],
    ["quoted in a forwarded email", `---------- Forwarded message ---------\nFrom: Oakfield Office <office@oakfield.example>\nSubject: Newsletter\n\n${byLine((l) => `> ${l}`)}`],
  ];

  it.each(variants)("reads %s exactly as the plain letter", (_, text) => {
    const got = rows(text);
    expect(got.map((r) => (r[2] as string).toLowerCase())).toEqual(expected.map((r) => (r[2] as string).toLowerCase()));
    expect(got.map((r) => [r[0], r[1], ...r.slice(3)])).toEqual(expected.map((r) => [r[0], r[1], ...r.slice(3)]));
    expect(got.some((r) => /[#*<>|]|looking ahead/i.test(r[2] as string))).toBe(false);
  });
});

describe("readLetter: other kinds of letter", () => {
  const read = (name: string) =>
    readLetter(readFileSync(new URL(`../fixtures/${name}.txt`, import.meta.url), "utf8"), ctx).map((p) => [p.role, p.kind, p.title, p.startDate, p.endDate, p.startTime, p.endTime]);

  it("reads a bulleted dates-for-your-diary list, with repeats, early finishes and payments", () => {
    expect(read("diary-dates-list")).toEqual([
      ["event", "event", "Non-uniform day (£1 donation)", "2026-10-17", "2026-10-17", null, null],
      ["event", "event", "Year 5 swimming", "2026-10-20", "2026-10-20", null, null],
      ["event", "event", "Class 3 assembly, parents welcome", "2026-10-22", "2026-10-22", "14:30", "15:30"],
      ["event", "event", "Last day of term, school finishes at 2pm", "2026-10-23", "2026-10-23", null, null],
      ["event", "holiday", "INSET day (school closed)", "2026-11-03", "2026-11-03", null, null],
      ["event", "event", "Children back", "2026-11-04", "2026-11-04", null, null],
      ["deadline", "event", "Trip consent slip deadline", "2026-10-17", "2026-10-17", null, null],
      ["deadline", "event", "Payment of £12 for the pantomime deadline", "2026-10-31", "2026-10-31", null, null],
    ]);
  });

  it("reads a club email: a cancelled session is not a school break, and 'be there by' is not a deadline", () => {
    expect(read("football-club")).toEqual([
      ["event", "event", "No training due to half term", "2026-10-28", "2026-10-28", null, null],
      ["event", "event", "Tournament", "2026-11-16", "2026-11-16", "10:00", "13:00"],
      ["deadline", "event", "Subs of £30 deadline", "2026-11-01", "2026-11-01", null, null],
    ]);
  });

  it("titles an appointment by who and where, not by the confirmation heading", () => {
    expect(read("dentist-appointment")).toEqual([["event", "event", "Appointment with Dr Shah at Greenway Dental", "2026-10-30", "2026-10-30", "16:20", "17:20"]]);
  });

  it("turns check-in and check-out into one stay", () => {
    expect(read("holiday-park-booking")).toEqual([["event", "trip", "Stay at Seaview Holiday Park", "2026-10-24", "2026-10-27", "16:00", "10:00"]]);
  });

  it("reads a nursery letter: closures, the days between last day and reopening, and a reply by", () => {
    expect(read("nursery-letter")).toEqual([
      ["event", "holiday", "Nursery closed for staff training", "2026-10-31", "2026-10-31", null, null],
      ["event", "event", "Christmas party for the children", "2026-12-17", "2026-12-17", "10:00", "12:00"],
      ["event", "holiday", "Christmas holidays", "2026-12-20", "2027-01-04", null, null],
      ["deadline", "event", "Reply deadline: Let us know if your child has any allergies", "2026-12-01", "2026-12-01", null, null],
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
