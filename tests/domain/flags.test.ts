import { describe, expect, it } from "vitest";
import { features } from "@/lib/flags";

/** Review, "stop building or remove": six parts of More are hidden for the household test, never deleted. */
describe("hidden features", () => {
  it("are all off unless named", () => {
    expect(Object.values(features("")).every((v) => v === false)).toBe(true);
  });

  it("come back one at a time, or all together", () => {
    expect(features("places, Weather")).toEqual({ trial: false, "time-shared": false, places: true, "look-back": false, "quiet-phone": false, weather: true });
    expect(Object.values(features("all")).every(Boolean)).toBe(true);
  });
});
