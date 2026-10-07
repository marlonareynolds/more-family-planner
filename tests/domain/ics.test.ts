import { describe, expect, it } from "vitest";
import { parseIcs } from "@/domain/ics";

const TZ = "Europe/London";
const window = { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-15T00:00:00Z") };
const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${body.trim().split("\n").map((l) => l.trim()).join("\r\n")}\r\nEND:VCALENDAR\r\n`;

describe("calendar import parsing", () => {
  it("expands a weekly series across the clocks changing, with a skipped and a moved occurrence", () => {
    const out = parseIcs(
      ics(`
        BEGIN:VEVENT
        UID:work-1
        SUMMARY:Office
        DTSTART;TZID=Europe/London:20261019T090000
        DTEND;TZID=Europe/London:20261019T170000
        RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4
        EXDATE;TZID=Europe/London:20261102T090000
        END:VEVENT
        BEGIN:VEVENT
        UID:work-1
        RECURRENCE-ID;TZID=Europe/London:20261026T090000
        SUMMARY:Office (late start)
        DTSTART;TZID=Europe/London:20261026T110000
        DTEND;TZID=Europe/London:20261026T170000
        END:VEVENT
      `),
      window,
      TZ,
    );
    expect(out.map((o) => [o.title, new Date(o.start).toISOString()])).toEqual([
      ["Office", "2026-10-19T08:00:00.000Z"], // BST
      ["Office (late start)", "2026-10-26T11:00:00.000Z"], // GMT after 25 Oct
      ["Office", "2026-11-09T09:00:00.000Z"],
    ]);
    expect(new Set(out.map((o) => o.externalId)).size).toBe(3);
  });

  it("reads all-day, UTC and floating times; skips cancelled and free items", () => {
    const out = parseIcs(
      ics(`
        BEGIN:VEVENT
        UID:leave
        SUMMARY:Annual leave
        DTSTART;VALUE=DATE:20261012
        DTEND;VALUE=DATE:20261014
        END:VEVENT
        BEGIN:VEVENT
        UID:call
        SUMMARY:Call
        DTSTART:20261005T130000Z
        DTEND:20261005T133000Z
        END:VEVENT
        BEGIN:VEVENT
        UID:floating
        SUMMARY:Dentist
        DTSTART:20261006T100000
        DTEND:20261006T110000
        END:VEVENT
        BEGIN:VEVENT
        UID:gone
        SUMMARY:Cancelled
        STATUS:CANCELLED
        DTSTART:20261007T100000Z
        DTEND:20261007T110000Z
        END:VEVENT
        BEGIN:VEVENT
        UID:free
        SUMMARY:Birthday
        TRANSP:TRANSPARENT
        DTSTART;VALUE=DATE:20261008
        END:VEVENT
        BEGIN:VEVENT
        UID:outlook
        SUMMARY:Standup
        DTSTART;TZID=GMT Standard Time:20261007T093000
        DTEND;TZID=GMT Standard Time:20261007T094500
        END:VEVENT
      `),
      window,
      TZ,
    );
    const by = Object.fromEntries(out.map((o) => [o.externalId, o]));
    expect(Object.keys(by).sort()).toEqual(["call", "floating", "leave", "outlook"]);
    expect(by.leave.allDay).toBe(true);
    expect([by.leave.startDate, by.leave.endDateExclusive]).toEqual(["2026-10-12", "2026-10-14"]);
    expect(new Date(by.call.start).toISOString()).toBe("2026-10-05T13:00:00.000Z");
    expect(new Date(by.floating.start).toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(new Date(by.outlook.start).toISOString()).toBe("2026-10-07T08:30:00.000Z");
  });

  it("refuses something that isn't a calendar", () => {
    expect(() => parseIcs("<html>Sign in</html>", window, TZ)).toThrow(/calendar/);
  });
});
