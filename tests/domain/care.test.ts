import { describe, expect, it } from "vitest";
import { assertCanConfirm, coverageFor, groupCoverage, type CareArrangement } from "@/domain/care";

const H = 3_600_000;

describe("care coverage (AT-11, AT-12, AT-07)", () => {
  const kids = ["a", "b", "c", "d"];
  const reqs = kids.map((k) => ({ id: `r-${k}`, childId: k, start: 9 * H, end: 17 * H }));
  const club: CareArrangement = { id: "club", kind: "external", responsibleAccountId: null, providerName: "Holiday club", childIds: kids, start: 9 * H, end: 17 * H, state: "confirmed" };

  it("four children share a club; one leaves early and needs a collection", () => {
    const early: CareArrangement = { ...club, id: "club-early", childIds: ["d"], end: 13 * H };
    const shared: CareArrangement = { ...club, childIds: ["a", "b", "c"] };
    const cov = reqs.map((r) => coverageFor(r, [shared, early]));
    expect(cov.filter((c) => c.state === "covered").map((c) => c.childId)).toEqual(["a", "b", "c"]);
    expect(cov[3].state).toBe("partly_covered");
    expect(cov[3].gaps).toEqual([{ start: 13 * H, end: 17 * H }]);

    const groups = groupCoverage(cov);
    expect(groups).toHaveLength(2);
    expect(groups[0].childIds).toEqual(["a", "b", "c"]);
  });

  it("parent care is invalid where the parent has another commitment", () => {
    const parent: CareArrangement = { ...club, id: "p", kind: "parent", responsibleAccountId: "sam", providerName: null };
    const busy = new Map([["sam", [{ start: 12 * H, end: 13 * H }]]]);
    const c = coverageFor(reqs[0], [parent], busy);
    expect(c.state).toBe("partly_covered");
    expect(c.gaps).toEqual([{ start: 12 * H, end: 13 * H }]);
  });

  it("proposed arrangements never cover", () => {
    expect(coverageFor(reqs[0], [{ ...club, state: "proposed" }]).state).toBe("unresolved");
  });

  it("only the named parent can confirm parent care", () => {
    expect(() => assertCanConfirm({ kind: "parent", responsibleAccountId: "sam" }, "alex")).toThrow();
    expect(() => assertCanConfirm({ kind: "parent", responsibleAccountId: "sam" }, "sam")).not.toThrow();
    expect(() => assertCanConfirm({ kind: "external", responsibleAccountId: null }, "alex")).not.toThrow();
  });
});
