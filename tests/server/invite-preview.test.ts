import { describe, expect, it } from "vitest";
import { previewInvite } from "@/server/queries/invite";
import { newWorld } from "./harness";

/**
 * Review (27 Oct 2026): "The join page doesn't say who invited you; a dead
 * link looks valid until tapped." The join page now reads the link first.
 */
describe("a join link says who it's from, and whether it still works", () => {
  it("names the inviter and household on an open link, and says why a dead one is dead", async () => {
    const w = await newWorld({ partner: false });
    const first = (await w.run(w.alex, "CreateInvite", {})) as { token: string; invitationId: string };
    expect(await previewInvite(w.db, first.token)).toEqual({ state: "open", inviterName: "Alex", householdName: "The Reynolds" });

    // A new link replaces the old one.
    const second = (await w.run(w.alex, "CreateInvite", {})) as { token: string };
    expect((await previewInvite(w.db, first.token)).state).toBe("cancelled");
    expect((await previewInvite(w.db, second.token, new Date(Date.now() + 8 * 86_400_000))).state).toBe("expired");

    await w.run(w.sam, "JoinHousehold", { token: second.token });
    expect((await previewInvite(w.db, second.token)).state).toBe("used");
    expect(await previewInvite(w.db, "not-a-real-invitation-token")).toEqual({ state: "unknown", inviterName: null, householdName: null });
  });
});
