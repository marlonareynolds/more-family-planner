import { describe, expect, it } from "vitest";
import { PRIVACY } from "@/content/legal/privacy";
import { TERMS } from "@/content/legal/terms";
import { fillLegal, legalIdentity, stripReview } from "@/lib/legal";

describe("legal texts", () => {
  it("shows a visible gap, not a made-up name, until the operator publishes one", () => {
    const who = legalIdentity({});
    expect(who.complete).toBe(false);
    expect(who.controller).toMatch(/not published yet/);
    expect(fillLegal("Contact: {{contact}}.", who)).toBe("Contact: the [help page](/support).");
  });

  it("fills every placeholder once the operator's details are set", () => {
    const who = legalIdentity({ MORE_CONTROLLER_NAME: "A Person, trading as More", MORE_SUPPORT_EMAIL: "help@example.com", MORE_CONTROLLER_ADDRESS: "1 High St", MORE_ICO_NUMBER: "ZB000000" });
    expect(who.complete).toBe(true);
    for (const text of [PRIVACY, TERMS]) {
      const page = fillLegal(stripReview(text), who);
      expect(page).not.toMatch(/\{\{|\[REVIEW/);
      expect(page).toContain("A Person, trading as More");
    }
    expect(fillLegal(PRIVACY, who)).toContain("[help@example.com](mailto:help@example.com)");
  });

  it("keeps review notes in the source but strips them for readers", () => {
    expect(PRIVACY).toContain("[REVIEW:");
    expect(stripReview("A clause. [REVIEW: check this] Next.")).toBe("A clause. Next.");
  });

  it("says plainly that reminders are not guaranteed and letters go to Anthropic", () => {
    expect(TERMS).toContain("More does not guarantee reminders.");
    expect(PRIVACY).toMatch(/sent to Anthropic/);
  });
});
