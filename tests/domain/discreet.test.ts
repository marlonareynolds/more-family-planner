import { describe, expect, it } from "vitest";
import { plansWith, whenPhrase } from "@/domain/discreet";

const tz = "Europe/London";
const at = (s: string) => Date.parse(s);

describe("lock-screen wording", () => {
  it("says who and when, never what", () => {
    const now = at("2030-10-07T08:00:00Z"); // Monday
    expect(whenPhrase(at("2030-10-07T18:30:00Z"), now, tz)).toBe("tonight");
    expect(whenPhrase(at("2030-10-07T11:00:00Z"), now, tz)).toBe("this afternoon");
    expect(whenPhrase(at("2030-10-08T18:30:00Z"), now, tz)).toBe("tomorrow evening");
    expect(whenPhrase(at("2030-10-11T18:30:00Z"), now, tz)).toBe("Friday evening");
    expect(whenPhrase(at("2030-10-20T09:00:00Z"), now, tz)).toBe("20 October");
    expect(plansWith("Sam")).toBe("Plans with Sam");
    expect(plansWith(null)).toBe("Plans with your partner");
  });
});
