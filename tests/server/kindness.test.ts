import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { needNotes, partnerNeeds } from "@/db/schema";
import { currentWeekKey, weekInterval } from "@/domain/time";
import { KINDNESSES, NEED_LABEL } from "@/lib/kindness";
import { myShare } from "@/lib/private-split";
import { accountFor } from "@/server/auth";
import { executeCommand } from "@/server/commands";
import { purgeNeeds } from "@/server/commands/needs";
import { exportAccount, exportHousehold } from "@/server/queries/exports";
import { conciergeStarts, kindnessCard, myNeeds, needsShaping } from "@/server/queries/needs";
import { getProjection } from "@/server/queries/week";
import { expectCode, newWorld, type World } from "./harness";

const TZ = "Europe/London";
const NOTE = "I miss being looked at the way we used to";
const DAY = 86_400_000;
const thisWeek = () => weekInterval(currentWeekKey(TZ), TZ).start;
const nextWeek = () => thisWeek() + 7 * DAY + 2 * 3_600_000; // safely past next Monday 00:00, whatever the clocks do
const adultsOf = async (w: World) => (await getProjection(w.db, w.alex, currentWeekKey(TZ), 7)).adults;
const card = async (w: World, viewer: World["alex"], now = new Date()) =>
  kindnessCard(w.db, { viewerId: viewer.accountId, householdId: w.householdId, adults: await adultsOf(w), timeZone: TZ, now });
/** Move a saved need back in time, as if it was saved in an earlier week. */
const backdate = (w: World, days: number) => w.db.execute(sql`update partner_needs set since = since - make_interval(days => ${days})`);

describe("What would help stays with the person who said it", () => {
  it("the author gets their needs and words back; the note is sealed at rest", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "noticed", shapes: true }, { need: "rest", shapes: false }], note: NOTE });
    const mine = await myNeeds(w.db, w.alex.accountId, [w.alex.accountId, w.sam.accountId]);
    expect(mine.needs.map((n) => [n.need, n.shapes, n.paused]).sort()).toEqual([["noticed", true, false], ["rest", false, false]]);
    expect(mine.note).toBe(NOTE);
    const [raw] = await w.db.select().from(needNotes).where(eq(needNotes.accountId, w.alex.accountId));
    expect(raw.sealed).not.toContain("looked");
    // Sam's own list is empty: nothing of Alex's is readable as Sam's.
    expect(await myNeeds(w.db, w.sam.accountId, [w.alex.accountId, w.sam.accountId])).toEqual({ needs: [], note: "" });
  });

  it("nothing the partner's browser or exports receive carries the need or the words", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "noticed", shapes: true }, { need: "close", shapes: true }], note: NOTE });
    await backdate(w, 14);
    const view = await getProjection(w.db, w.sam, currentWeekKey(TZ), 7);
    const places = view.places.map((p) => ({ name: p.name, area: p.area, kinds: p.kinds }));
    const samSees = JSON.stringify({
      view,
      card: await card(w, w.sam),
      starts: await conciergeStarts(w.db, { viewerId: w.sam.accountId, householdId: w.householdId, adultIds: view.adults.map((a) => a.id), timeZone: TZ, places }),
      account: await exportAccount(w.db, w.sam),
      household: await exportHousehold(w.db, w.sam),
    });
    for (const secret of [NOTE, NEED_LABEL.noticed.label, NEED_LABEL.close.label, '"noticed"', '"close"', "whatWouldHelp\":{\"needs\":[{"]) expect(samSees).not.toContain(secret);
    // The kindness card is finished text and a done flag: no reason, weight or need.
    const c = (await card(w, w.sam))!;
    for (const item of c.items) expect(Object.keys(item).sort()).toEqual(["done", "key", "text"]);
    // Alex's own export has it.
    const alexExport = await exportAccount(w.db, w.alex);
    expect(alexExport.whatWouldHelp.note).toBe(NOTE);
    expect(alexExport.whatWouldHelp.needs.map((n) => n.need).sort()).toEqual(["close", "noticed"]);
  });

  it("a change counts from next week, never this one, in both directions", async () => {
    const w = await newWorld();
    const adults = [w.alex.accountId, w.sam.accountId];
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "listened", shapes: true }] });
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, thisWeek()))]).toEqual([]);
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, nextWeek()))]).toEqual(["listened"]);

    // As if it had been there a fortnight: it counts now. Taking it away still leaves this week as it was.
    await backdate(w, 14);
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, thisWeek()))]).toEqual(["listened"]);
    await w.run(w.alex, "SaveNeeds", { needs: [] });
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, thisWeek()))]).toEqual(["listened"]);
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, nextWeek()))]).toEqual([]);
    expect((await myNeeds(w.db, w.alex.accountId, adults)).needs).toEqual([]);
  });

  it("'Just for me' shapes nothing, and a need never shapes its own author's card", async () => {
    const w = await newWorld();
    const adults = [w.alex.accountId, w.sam.accountId];
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "fun", shapes: false }] });
    await w.run(w.sam, "SaveNeeds", { needs: [{ need: "load", shapes: true }] });
    await backdate(w, 14);
    expect([...(await needsShaping(w.db, w.sam.accountId, adults, thisWeek()))]).toEqual([]);
    expect([...(await needsShaping(w.db, w.alex.accountId, adults, thisWeek()))]).toEqual(["load"]);
  });
});

describe("Small kindnesses on For Us", () => {
  it("only appear once there is someone to be kind to", async () => {
    const w = await newWorld({ partner: false });
    expect(await card(w, w.alex)).toBeNull();
    // Needs can still be kept, as a private note, about nobody yet.
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "time", shapes: true }] });
    const [row] = await w.db.select().from(partnerNeeds);
    expect(row.aboutId).toBeNull();
  });

  it("each partner's cards come from their own shelf, week after week", async () => {
    const w = await newWorld();
    const alexKeys = new Set<string>();
    const samKeys = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const at = new Date(Date.now() + i * 7 * DAY);
      for (const k of (await card(w, w.alex, at))!.items) alexKeys.add(k.key);
      for (const k of (await card(w, w.sam, at))!.items) samKeys.add(k.key);
    }
    expect([...alexKeys].filter((k) => samKeys.has(k))).toEqual([]);
    const samShelf = myShare(KINDNESSES, (k) => k.key, { householdId: w.householdId, accountId: w.sam.accountId, adultIds: [w.alex.accountId, w.sam.accountId] }, (k) => KINDNESSES.indexOf(k)).map((k) => k.key);
    expect([...samKeys].every((k) => samShelf.includes(k))).toBe(true);
    expect((await card(w, w.sam))!.items[0].text).toContain("Alex");
  });

  it("'I did this' stays ticked privately; 'Another' brings a different one", async () => {
    const w = await newWorld();
    const weekKey = currentWeekKey(TZ);
    const before = (await card(w, w.sam))!;
    await w.run(w.sam, "MarkKindness", { weekKey, key: before.items[0].key, mark: "done" });
    await w.run(w.sam, "MarkKindness", { weekKey, key: before.items[1].key, mark: "skip" });
    const after = (await card(w, w.sam))!;
    expect(after.items[0]).toMatchObject({ key: before.items[0].key, done: true });
    expect(after.items.map((k) => k.key)).not.toContain(before.items[1].key);
    expect(after.items).toHaveLength(2);
    // Alex's card knows nothing about it.
    expect(JSON.stringify(await card(w, w.alex))).not.toContain(before.items[0].key);
    await expectCode(w.run(w.sam, "MarkKindness", { weekKey, key: "not-a-kindness", mark: "done" }), "VALIDATION");
  });
});

describe("When the household changes", () => {
  it("needs about a partner who left shape nobody, and say so to their author", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "close", shapes: true }] });
    await backdate(w, 14);
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    const jo = await accountFor(w.db, { subject: "test:jo", displayName: "Jo" });
    const { token } = await w.run(w.alex, "CreateInvite", {});
    await executeCommand(jo, { command: "JoinHousehold", idempotencyKey: randomUUID(), payload: { token } });
    const adults = [w.alex.accountId, jo.accountId];
    expect([...(await needsShaping(w.db, jo.accountId, adults, nextWeek()))]).toEqual([]);
    expect((await myNeeds(w.db, w.alex.accountId, adults)).needs).toEqual([{ need: "close", shapes: true, paused: true }]);
    // Saving again points them at the new partner, from the week after.
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "close", shapes: true }] });
    expect((await myNeeds(w.db, w.alex.accountId, adults)).needs[0].paused).toBe(false);
    expect([...(await needsShaping(w.db, jo.accountId, adults, thisWeek()))]).toEqual([]);
    expect([...(await needsShaping(w.db, jo.accountId, adults, nextWeek()))]).toEqual(["close"]);
  });

  it("closing your account erases what you said would help and what you marked", async () => {
    const w = await newWorld();
    await w.run(w.sam, "SaveNeeds", { needs: [{ need: "surprise", shapes: true }], note: "Anything at all" });
    await w.run(w.sam, "MarkKindness", { weekKey: currentWeekKey(TZ), key: KINDNESSES[0].key, mark: "done" });
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    await w.run(w.sam, "CloseAccount", { confirm: "close" });
    for (const table of ["partner_needs", "need_notes", "kindness_marks"]) {
      const res = await w.db.execute(sql.raw(`select count(*)::int as c from ${table}`));
      expect((res as unknown as { rows: { c: number }[] }).rows[0].c, table).toBe(0);
    }
  });

  it("ended needs are erased once they can no longer count for any week", async () => {
    const w = await newWorld();
    await w.run(w.alex, "SaveNeeds", { needs: [{ need: "rest", shapes: true }] });
    await w.run(w.alex, "SaveNeeds", { needs: [] });
    expect(await w.db.select().from(partnerNeeds)).toHaveLength(1);
    expect((await purgeNeeds(w.db, new Date())).ended).toBe(0);
    expect((await purgeNeeds(w.db, new Date(Date.now() + 9 * DAY))).ended).toBe(1);
    expect(await w.db.select().from(partnerNeeds)).toHaveLength(0);
  });
});
