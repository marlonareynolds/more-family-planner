import { describe, expect, it } from "vitest";
import { bookingLinks, safeBookingUrl } from "@/domain/booking";
import { dayWeather, describeCode, isWet, rainDuring, swapOptions, type HourPoint } from "@/domain/weather";
import { CATALOGUE } from "@/lib/catalogue";

const TZ = "Europe/London";
/** A day of hourly points from 00:00 UTC, with rain chances by UTC hour. */
function day(date: string, rain: (hour: number) => number, code = 3): HourPoint[] {
  return Array.from({ length: 24 }, (_, h) => ({ t: Date.parse(`${date}T${String(h).padStart(2, "0")}:00:00Z`), rain: rain(h), mm: rain(h) > 60 ? 1 : 0, code: rain(h) > 60 ? 61 : code, temp: 8 + h / 3 }));
}

describe("weather", () => {
  it("summarises a day by its daytime, worsened only when rain is likely", () => {
    const dry = dayWeather(day("2030-10-12", () => 10, 2), "2030-10-12", TZ)!;
    expect(dry).toMatchObject({ label: "Bright spells", icon: "cloud-sun", rain: 10 });
    const wet = dayWeather(day("2030-10-12", (h) => (h >= 13 && h < 16 ? 80 : 10), 2), "2030-10-12", TZ)!;
    expect(wet).toMatchObject({ label: "Rain", icon: "rain", rain: 80 });
    expect(dayWeather(day("2030-10-12", () => 0), "2030-10-20", TZ)).toBeNull();
    expect(describeCode(95).icon).toBe("storm");
  });

  it("calls a plan wet from the hours it is on, and not past the forecast", () => {
    const hours = day("2030-10-12", (h) => (h >= 13 && h < 16 ? 80 : 10));
    const walk = rainDuring(hours, Date.parse("2030-10-12T13:00:00Z"), Date.parse("2030-10-12T15:00:00Z"));
    expect(walk).toMatchObject({ chance: 80 });
    expect(isWet(walk)).toBe(true);
    expect(isWet(rainDuring(hours, Date.parse("2030-10-12T09:00:00Z"), Date.parse("2030-10-12T11:00:00Z")))).toBe(false);
    expect(rainDuring(hours, Date.parse("2030-10-13T09:00:00Z"), Date.parse("2030-10-13T11:00:00Z"))).toBeNull();
  });

  it("offers the plan's own backup first, then indoor ideas that suit the children", () => {
    const walk = CATALOGUE.find((a) => a.key === "fam-woodland-walk")!;
    const swaps = swapOptions({ activity: walk, ideas: CATALOGUE, childAges: ["5-7"] });
    expect(swaps[0]).toMatchObject({ activityKey: null, title: "Indoor den with blankets and chairs." });
    expect(swaps.length).toBeLessThanOrEqual(3);
    for (const s of swaps.slice(1)) {
      const a = CATALOGUE.find((x) => x.key === s.activityKey)!;
      expect(a.kind).toBe("family");
      expect(a.weatherSensitive).toBe(false);
      expect(a.setting).not.toBe("outdoors");
      expect(!a.ages || a.ages.includes("5-7")).toBe(true);
    }
  });
});

describe("booking links", () => {
  it("only keeps safe https booking pages", () => {
    expect(safeBookingUrl("www.opentable.co.uk/r/the-boathouse")).toBe("https://www.opentable.co.uk/r/the-boathouse");
    expect(safeBookingUrl("http://example.com")).toBeNull();
    expect(safeBookingUrl("javascript:alert(1)")).toBeNull();
    expect(safeBookingUrl("https://user:pw@example.com")).toBeNull();
    expect(safeBookingUrl("https://localhost/x")).toBeNull();
    expect(safeBookingUrl("https://10.0.0.1/x")).toBeNull();
  });

  it("prefers your own place's page, then searches near home for the plan's time", () => {
    expect(bookingLinks({ category: "food", setting: "out-indoors", bookingUrl: "https://book.example.com/t", near: "Guildford" })).toEqual([{ label: "Book", url: "https://book.example.com/t" }]);
    const [table, map] = bookingLinks({ category: "food", setting: "out-indoors", near: "Guildford", localStart: "2030-10-11T19:30", people: 2 });
    expect(table.label).toBe("Find a table");
    expect(new URL(table.url).searchParams.get("dateTime")).toBe("2030-10-11T19:30");
    expect(new URL(table.url).searchParams.get("covers")).toBe("2");
    expect(new URL(map.url).searchParams.get("query")).toBe("restaurants near Guildford");
    expect(bookingLinks({ category: "cosy", setting: "home", near: "Guildford" })).toEqual([]);
    expect(bookingLinks({ category: "food", setting: "out-indoors", near: null })).toEqual([]);
  });
});
