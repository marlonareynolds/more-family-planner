import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import AskPage from "@/app/ask/[token]/page";
import { accounts, careArrangements, careAsks, notifications } from "@/db/schema";
import { processOutbox } from "@/server/outbox";
import { deliverPushes, setPushSender } from "@/server/reach/push";
import { answerAsk, askView } from "@/server/commands/village";
import { newWorld, timed } from "./harness";

/** Renders the public helper page exactly as a visitor would get it. */
async function helperPage(token: string): Promise<string> {
  const el = await AskPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) } as unknown as PageProps<"/ask/[token]">);
  return renderToStaticMarkup(el);
}

async function withAsk() {
  const w = await newWorld();
  const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Robin", ageBand: "5-7" });
  const { helperId } = await w.run(w.alex, "AddHelper", { name: "Gran" });
  const ask = await w.run(w.alex, "AskHelper", { helperId, childIds: [childId], span: timed("2030-10-11", "18:30", "23:00"), note: "Robin likes a story" });
  return { w, ask };
}

const PRIVATE = /Robin|story|18:30|Gran/;

describe("R01 helper links only show details while live (BR-01)", () => {
  it("shows the ask while it is open", async () => {
    const { ask } = await withAsk();
    expect(await helperPage(ask.token)).toMatch(/Robin/);
  });

  it("shows nothing once it has expired unanswered", async () => {
    const { w, ask } = await withAsk();
    await w.db.update(careAsks).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await askView(w.db, ask.token)).toBeNull();
    expect(await helperPage(ask.token)).not.toMatch(PRIVATE);
    expect(await helperPage(ask.token)).toMatch(/This link has ended/);
  });

  it("shows nothing after a no, or once the care is withdrawn", async () => {
    const a = await withAsk();
    await answerAsk(a.w.db, a.ask.token, "no");
    expect(await helperPage(a.ask.token)).not.toMatch(PRIVATE);

    const b = await withAsk();
    const [arr] = await b.w.db.select().from(careArrangements).where(eq(careArrangements.id, b.ask.arrangementId));
    await b.w.run(b.w.alex, "RemoveCare", { arrangementId: arr.id, version: arr.version });
    expect(await helperPage(b.ask.token)).not.toMatch(PRIVATE);
  });

  it("after a yes, keeps the time visible until the care has ended, then nothing", async () => {
    const { w, ask } = await withAsk();
    await answerAsk(w.db, ask.token, "yes");
    expect(await askView(w.db, ask.token)).toMatchObject({ childNames: ["Robin"], response: "yes" });
    expect(await askView(w.db, ask.token, new Date("2030-10-11T22:01:00Z"))).toBeNull();
  });

  it("shows nothing when the household is deleted", async () => {
    const { w, ask } = await withAsk();
    await w.run(w.alex, "DeleteHousehold", { confirmName: "The Reynolds" });
    expect(await helperPage(ask.token)).not.toMatch(PRIVATE);
  });
});

const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" });

/** Sam has a phone and no quiet hours; Alex invites Sam to something. */
async function withInvite(status: () => number) {
  const w = await newWorld();
  const pushed: string[] = [];
  setPushSender(async (_t, m) => {
    const code = status();
    if (code === 0) throw new Error("network down");
    if (code < 300) pushed.push(m.body);
    return code;
  });
  await w.run(w.sam, "SavePushSubscription", sub("sam-phone"), { householdId: undefined });
  await w.db.update(accounts).set({ quietStart: "21:00", quietEnd: "21:00" }).where(eq(accounts.id, w.sam.accountId));
  const m = await w.run(w.alex, "CreateMoment", { kind: "family", title: "Zoo", span: timed("2030-10-12", "10:00", "13:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
  await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
  await processOutbox(w.db, new Date());
  const state = async () => (await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId))).map((n) => n.pushState);
  return { w, pushed, state, momentId: m.momentId as string };
}

describe("R03 push delivery has honest states", () => {
  afterEach(() => setPushSender(null));
  const later = (min: number) => new Date(Date.now() + min * 60_000);

  it("BR-04: a failed push is retried with backoff, then sent", async () => {
    let code = 0;
    const { w, pushed, state } = await withInvite(() => code);
    expect((await deliverPushes(w.db, later(0))).retried).toBe(1);
    expect(await state()).toEqual(["retry"]);
    // Not before the backoff.
    code = 201;
    expect((await deliverPushes(w.db, later(0.5))).sent).toBe(0);
    expect((await deliverPushes(w.db, later(2))).sent).toBe(1);
    expect(await state()).toEqual(["sent"]);
    expect(pushed).toHaveLength(1);
  });

  it("BR-04: a provider that never recovers ends as failed, not sent", async () => {
    const { w, state } = await withInvite(() => 503);
    for (let i = 0, t = 0; i < 6; i++, t += 61) await deliverPushes(w.db, later(t));
    expect(await state()).toEqual(["failed"]);
  });

  it("BR-05: deferred by quiet hours, then the plan is cancelled: never pushed", async () => {
    const { w, pushed, state, momentId } = await withInvite(() => 201);
    await w.db.update(accounts).set({ quietStart: "00:00", quietEnd: "23:59" }).where(eq(accounts.id, w.sam.accountId));
    expect((await deliverPushes(w.db, later(0))).deferred).toBe(1);
    const week = await w.week(w.alex, "2030-10-07");
    await w.run(w.alex, "CancelMoment", { momentId, version: week.moments.find((m) => m.id === momentId)!.version });
    await w.db.update(accounts).set({ quietStart: "21:00", quietEnd: "21:00" }).where(eq(accounts.id, w.sam.accountId));
    await deliverPushes(w.db, later(1));
    expect(pushed.filter((b) => /Zoo|planned/.test(b))).toEqual([]);
    expect((await state())[0]).toBe("superseded");
  });

  it("BR-05: someone who left the household is not pushed their old notices", async () => {
    const { w, pushed, state } = await withInvite(() => 201);
    await w.db.update(accounts).set({ quietStart: "00:00", quietEnd: "23:59" }).where(eq(accounts.id, w.sam.accountId));
    await deliverPushes(w.db, later(0));
    await w.run(w.sam, "LeaveHousehold", { confirm: true });
    await w.db.update(accounts).set({ quietStart: "21:00", quietEnd: "21:00" }).where(eq(accounts.id, w.sam.accountId));
    await deliverPushes(w.db, later(1));
    expect(pushed).toEqual([]);
    expect(await state()).toContain("superseded");
  });

  it("BR-06: overlapping runs send once, and a crashed run's claim is taken over", async () => {
    const { w, pushed } = await withInvite(() => 201);
    await Promise.all([deliverPushes(w.db, later(0)), deliverPushes(w.db, later(0))]);
    expect(pushed).toHaveLength(1);

    const b = await withInvite(() => 201);
    // A run claimed it and died: its lease holds, then runs out.
    await b.w.db.update(notifications).set({ pushState: "leased", pushLeaseUntil: later(2) }).where(eq(notifications.accountId, b.w.sam.accountId));
    expect((await deliverPushes(b.w.db, later(1))).sent).toBe(0);
    expect((await deliverPushes(b.w.db, later(3))).sent).toBe(1);
    expect(b.pushed).toHaveLength(1);
  });

  it("holds app reminders for the next bundle when one was already sent this slot", async () => {
    const { w, pushed } = await withInvite(() => 201);
    await deliverPushes(w.db, later(0));
    await w.db.insert(notifications).values({ accountId: w.sam.accountId, householdId: w.householdId, kind: "job.due", text: "Today: Bins.", dedupeKey: "t:job" });
    const s = await deliverPushes(w.db, later(1));
    expect(s.deferred).toBe(1);
    expect(pushed).toHaveLength(1);
    const [job] = await w.db.select().from(notifications).where(eq(notifications.dedupeKey, "t:job"));
    expect(job.pushState).toBe("pending");
    expect(job.pushNextAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
