import { describe, expect, it } from "vitest";
import type { Busy } from "@/domain/availability";
import { suggestTimes } from "@/domain/free-time";
import { localToInstantCompatible } from "@/domain/time";

const TZ = "Europe/London";
const at = (s: string) => localToInstantCompatible(s, TZ);
const busy = (personId: string, start: string, end: string): Busy => ({
  personId, start: at(start), end: at(end), sourceType: "event", sourceId: start, ownerId: personId, visibility: "shared", title: "x",
});
const work = (p: string, days: string[]) => days.map((d) => busy(p, `${d}T09:00`, `${d}T17:30`));
const base = { now: at("2030-10-07T08:00"), timeZone: TZ, days: 3, childBusy: [] };

describe("free time suggestions", () => {
  it("finds evenings when both adults are free and skips ones where either is busy", () => {
    const slots = suggestTimes({
      ...base, kind: "us", durationMinutes: 120, participantIds: ["a", "s"], carerIds: [], hasChildren: false,
      busy: [...work("a", ["2030-10-07", "2030-10-08", "2030-10-09"]), busy("s", "2030-10-08T18:00", "2030-10-08T23:00")],
    });
    const labels = slots.map((s) => `${s.date} ${s.startTime}`);
    expect(labels).toContain("2030-10-07 18:30");
    expect(labels).toContain("2030-10-09 18:30");
    expect(labels.some((l) => l.startsWith("2030-10-08") && l >= "2030-10-08 17:30")).toBe(false);
    expect(slots.every((s) => s.end - s.start === 120 * 60_000)).toBe(true);
  });

  it("says whether the children are covered during Me time", () => {
    const slots = suggestTimes({
      ...base, days: 1, kind: "me", durationMinutes: 60, participantIds: ["a"], carerIds: ["s"], hasChildren: true,
      busy: [busy("s", "2030-10-07T08:00", "2030-10-07T18:00")],
    });
    const morning = slots.find((s) => s.startTime < "18:00")!;
    const evening = slots.find((s) => s.startTime >= "19:00")!;
    expect(morning.care).toBe("needs_care");
    expect(evening.care).toBe("partner_free");
  });

  it("keeps family time clear of the children's own commitments", () => {
    const slots = suggestTimes({
      ...base, now: at("2030-10-12T07:00"), days: 1, kind: "family", durationMinutes: 180, participantIds: ["a", "s"], carerIds: [], hasChildren: true,
      busy: [], childBusy: [{ start: at("2030-10-12T09:00"), end: at("2030-10-12T13:00") }],
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.start >= at("2030-10-12T13:00") || s.end <= at("2030-10-12T09:00"))).toBe(true);
    expect(slots[0].care).toBe("with_family");
  });
});
