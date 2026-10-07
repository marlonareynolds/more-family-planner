import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { childWishes, households, notifications, outbox, weatherForecasts } from "@/db/schema";
import type { HourPoint } from "@/domain/weather";
import type { HttpFetch } from "@/server/calendar-providers";
import { notifyMeClashes } from "@/server/me-time";
import { processOutbox } from "@/server/outbox";
import { displayView, makeWish } from "@/server/queries/display";
import { queueWeatherSwaps, refreshForecasts } from "@/server/weather";
import { expectCode, newWorld, timed, type World } from "./harness";

const WEEK = "2030-10-07"; // Monday
const NOW = new Date("2030-10-11T09:00:00Z"); // Friday morning

/** A forecast for Fri–Sun with rain on Saturday 12:00–16:00 UTC. */
function forecast(): HourPoint[] {
  const out: HourPoint[] = [];
  for (let t = Date.parse("2030-10-11T00:00:00Z"); t < Date.parse("2030-10-14T00:00:00Z"); t += 3_600_000) {
    const wet = t >= Date.parse("2030-10-12T12:00:00Z") && t < Date.parse("2030-10-12T16:00:00Z");
    out.push({ t, rain: wet ? 85 : 10, mm: wet ? 1.2 : 0, code: wet ? 63 : 2, temp: 12 });
  }
  return out;
}

async function agreedFamily(w: World, fields: Record<string, unknown>) {
  const m = await w.run(w.alex, "CreateMoment", { kind: "family", participantIds: [w.alex.accountId, w.sam.accountId], ...fields });
  await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
  const week = await w.week(w.sam, WEEK, NOW);
  const mv = week.moments.find((x) => x.id === m.momentId)!;
  await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: mv.materialVersion, decision: "accepted" });
  return m.momentId as string;
}

async function withWeather() {
  const w = await newWorld();
  await w.run(w.alex, "SetHouseholdLocation", { placeName: "Guildford, England", latitude: 51.2362, longitude: -0.5704 });
  await w.db.insert(weatherForecasts).values({ householdId: w.householdId, fetchedAt: NOW, hours: forecast() });
  const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
  return { w, childId: childId as string };
}

describe("weather-aware swaps", () => {
  it("offers indoor swaps for a wet outdoor family plan, and swapping keeps the agreement", async () => {
    const { w, childId } = await withWeather();
    const walk = await agreedFamily(w, { title: "Woodland walk and den building", activityKey: "fam-woodland-walk", span: timed("2030-10-12", "13:00", "15:00"), childIds: [childId] });
    const dry = await agreedFamily(w, { title: "Park picnic", activityKey: "fam-picnic", span: timed("2030-10-13", "12:00", "14:30"), childIds: [childId] });

    const week = await w.week(w.alex, WEEK, NOW);
    expect(week.place).toEqual({ name: "Guildford, England" });
    expect(week.weather["2030-10-12"]).toMatchObject({ icon: "rain", rain: 85 });
    expect(week.wetPlans.map((p) => p.momentId)).toEqual([walk]);
    expect(week.wetPlans[0].swaps[0].title).toBe("Indoor den with blankets and chairs.");
    expect(week.attention.some((a) => a.action === "weather" && a.targetId === walk)).toBe(true);
    expect(week.wetPlans.some((p) => p.momentId === dry)).toBe(false);

    // The day before, both adults are told a swap is ready; once only.
    expect(await queueWeatherSwaps(w.db, NOW)).toEqual({ queued: 2 });
    expect(await queueWeatherSwaps(w.db, NOW)).toEqual({ queued: 0 });

    const m = week.moments.find((x) => x.id === walk)!;
    await w.run(w.alex, "SwapActivity", { momentId: walk, version: m.version, title: "Indoor den with blankets and chairs.", activityKey: null });
    const after = await w.week(w.sam, WEEK, NOW);
    const swapped = after.moments.find((x) => x.id === walk)!;
    expect(swapped).toMatchObject({ title: "Indoor den with blankets and chairs.", agreed: true });
    expect(after.wetPlans).toEqual([]);
    await processOutbox(w.db, new Date("2030-10-11T09:05:00Z"));
    const told = await w.db.select().from(notifications).where(eq(notifications.accountId, w.sam.accountId));
    expect(told.map((n) => n.text)).toContain("Alex swapped Woodland walk and den building for Indoor den with blankets and chairs., as rain is likely.");
  });

  it("never nudges about time for the two of you, and fetches forecasts best effort", async () => {
    const { w } = await withWeather();
    const us = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Walk and a pub lunch", activityKey: "us-walk-pub", span: timed("2030-10-12", "13:00", "16:00"), participantIds: [w.alex.accountId, w.sam.accountId] });
    await w.run(w.alex, "ShareMoment", { momentId: us.momentId, version: us.version });
    expect((await w.week(w.alex, WEEK, NOW)).wetPlans).toEqual([]);
    expect(await queueWeatherSwaps(w.db, NOW)).toEqual({ queued: 0 });

    await w.db.delete(weatherForecasts);
    const asked: string[] = [];
    const http: HttpFetch = async (url) => {
      asked.push(url);
      const hours = forecast();
      return new Response(JSON.stringify({ hourly: { time: hours.map((h) => h.t / 1000), precipitation_probability: hours.map((h) => h.rain), precipitation: hours.map((h) => h.mm), weather_code: hours.map((h) => h.code), temperature_2m: hours.map((h) => h.temp) } }), { status: 200 });
    };
    expect(await refreshForecasts(w.db, NOW, http)).toEqual({ refreshed: 1, failed: 0 });
    expect(new URL(asked[0]).searchParams.get("latitude")).toBe("51.240");
    expect(await refreshForecasts(w.db, NOW, http)).toEqual({ refreshed: 0, failed: 0 });

    // Clearing the town forgets the forecast.
    await w.run(w.alex, "SetHouseholdLocation", { placeName: null, latitude: null, longitude: null });
    const [h] = await w.db.select().from(households).where(eq(households.id, w.householdId));
    expect([h.placeName, h.latitude]).toEqual([null, null]);
    expect(await w.db.select().from(weatherForecasts)).toEqual([]);
  });
});

describe("Me time clash protection", () => {
  async function meTime(w: World, childId: string) {
    const m = await w.run(w.alex, "CreateMoment", { kind: "me", title: "Swim", span: timed("2030-10-12", "09:00", "11:00"), participantIds: [w.alex.accountId], needsCare: true });
    await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
    await w.run(w.sam, "ArrangeCare", { kind: "parent", responsibleAccountId: w.sam.accountId, childIds: [childId], span: timed("2030-10-12", "09:00", "11:00") });
    return m.momentId as string;
  }

  it("won't let a partner put you into something during your own time", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    await meTime(w, childId);
    const err = await expectCode(w.run(w.sam, "AddEvent", { title: "Parents' evening", span: timed("2030-10-12", "10:00", "11:00"), adultIds: [w.alex.accountId, w.sam.accountId] }), "CONFLICT");
    expect(err.message).toBe("That's during Alex's own time. Ask Alex first, or leave them out of this one.");
    await expectCode(w.run(w.sam, "AddTrip", { kind: "personal", title: "Wedding", startDate: "2030-10-12", startTime: "08:00", endDate: "2030-10-12", endTime: "23:00", travellerIds: [w.alex.accountId] }), "CONFLICT");
    // Outside it, or without Alex, is fine; Alex can always book over their own time.
    await w.run(w.sam, "AddEvent", { title: "Parents' evening", span: timed("2030-10-12", "11:00", "12:00"), adultIds: [w.alex.accountId] });
    await w.run(w.alex, "AddEvent", { title: "Dentist", span: timed("2030-10-12", "10:00", "10:30"), adultIds: [w.alex.accountId] });
    const week = await w.week(w.alex, WEEK, NOW);
    expect(week.attention.filter((a) => a.action === "me-clash").map((a) => a.text)).toEqual(["Something now overlaps your time tomorrow morning. Move it or keep it?"]);
  });

  it("tells you privately when the cover for your time falls through", async () => {
    const w = await newWorld();
    const { childId } = await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" });
    const swim = await meTime(w, childId);
    expect((await w.week(w.alex, WEEK, NOW)).attention.some((a) => a.action === "me-clash")).toBe(false);

    await w.run(w.sam, "AddEvent", { title: "Five-a-side", span: timed("2030-10-12", "10:00", "11:30"), adultIds: [w.sam.accountId] });
    const alexWeek = await w.week(w.alex, WEEK, NOW);
    expect(alexWeek.attention.filter((a) => a.action === "me-clash")).toMatchObject([{ targetId: swim, text: "Your time tomorrow morning needs cover for the children again" }]);
    expect((await w.week(w.sam, WEEK, NOW)).attention.some((a) => a.action === "me-clash")).toBe(false);

    expect(await notifyMeClashes(w.db, NOW)).toEqual({ queued: 1 });
    expect(await notifyMeClashes(w.db, NOW)).toEqual({ queued: 0 });
    const [job] = await w.db.select().from(outbox).where(eq(outbox.eventType, "notify"));
    expect(job).toBeTruthy();
  });
});

describe("family screens", () => {
  async function household() {
    const w = await newWorld();
    const mia = (await w.run(w.alex, "AddChild", { preferredName: "Mia", ageBand: "5-7" })).childId as string;
    const leo = (await w.run(w.alex, "AddChild", { preferredName: "Leo", ageBand: "8-11" })).childId as string;
    await agreedFamily(w, { title: "Pizza night", notes: "Secret: we're getting ice cream", budgetMinor: 3000, span: timed("2030-10-11", "18:00", "19:30"), childIds: [mia, leo] });
    await w.run(w.alex, "AddEvent", { title: "Swimming lesson", span: timed("2030-10-12", "09:00", "10:00"), childIds: [mia] });
    await w.run(w.sam, "AddEvent", { title: "Football", span: timed("2030-10-12", "10:00", "11:00"), childIds: [leo] });
    await w.run(w.alex, "AddEvent", { title: "Board meeting with Acme", span: timed("2030-10-11", "10:00", "11:00"), adultIds: [w.alex.accountId] });
    const us = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Anniversary dinner", span: timed("2030-10-12", "19:30", "22:00"), participantIds: [w.alex.accountId, w.sam.accountId], needsCare: true });
    await w.run(w.alex, "ShareMoment", { momentId: us.momentId, version: us.version });
    await w.run(w.alex, "ArrangeCare", { kind: "external", providerName: "Grandma", confirmed: true, childIds: [mia, leo], span: timed("2030-10-12", "19:00", "22:30") });
    await w.run(w.sam, "AddTrip", { kind: "work", title: "Conference", startDate: "2030-10-13", startTime: "08:00", endDate: "2030-10-14", endTime: "18:00", travellerIds: [w.sam.accountId] });
    return { w, mia, leo };
  }

  it("shows the kitchen family logistics only, never the adults' own plans, notes or money", async () => {
    const { w } = await household();
    const { token } = await w.run(w.alex, "CreateDisplayLink", { childId: null });
    const view = (await displayView(w.db, token, NOW))!;
    expect(view.mode).toBe("kitchen");
    expect(view.days).toHaveLength(7);
    const titles = view.days.flatMap((d) => d.items.map((i) => `${d.date} ${i.title}`));
    expect(titles).toEqual(expect.arrayContaining(["2030-10-11 Pizza night", "2030-10-12 Swimming lesson", "2030-10-12 Football", "2030-10-12 Grandma is with Mia and Leo", "2030-10-13 Sam away", "2030-10-14 Sam home at 18:00"]));
    const json = JSON.stringify(view);
    for (const secret of ["Acme", "Board", "Anniversary", "dinner", "ice cream", "3000", "Conference"]) expect(json).not.toContain(secret);
  });

  it("gives each child their own view, a turn to choose, and a wish the adults can plan", async () => {
    const { w, mia, leo } = await household();
    const miaLink = await w.run(w.alex, "CreateDisplayLink", { childId: mia });
    const leoLink = await w.run(w.alex, "CreateDisplayLink", { childId: leo });
    const miaView = (await displayView(w.db, miaLink.token, NOW))!;
    expect(miaView.child).toEqual({ id: mia, name: "Mia" });
    expect(miaView.days).toHaveLength(3);
    const items = miaView.days.flatMap((d) => d.items.map((i) => i.title));
    expect(items).toContain("Swimming lesson");
    expect(items).not.toContain("Football");
    expect(items).toContain("Grandma is with you");

    // Mia was added first and neither has chosen yet: her turn, so only she gets ideas.
    expect(miaView.turn).toEqual({ childId: mia, name: "Mia" });
    expect(miaView.choices).toHaveLength(3);
    expect((await displayView(w.db, leoLink.token, NOW))!.choices).toEqual([]);
    expect((await makeWish(w.db, leoLink.token, miaView.choices[0].key, NOW))!.wish).toBeNull();

    const picked = (await makeWish(w.db, miaLink.token, miaView.choices[0].key, NOW))!;
    expect(picked.wish).toBe(miaView.choices[0].title);
    const week = await w.week(w.sam, WEEK, NOW);
    expect(week.wishes).toMatchObject([{ childId: mia, title: miaView.choices[0].title }]);
    expect(week.attention.some((a) => a.action === "wish")).toBe(true);

    // Planning it as Mia's pick answers the wish, and the turn passes to Leo.
    await w.run(w.sam, "CreateMoment", { kind: "family", title: miaView.choices[0].title, activityKey: miaView.choices[0].key, chosenByChildId: mia, span: timed("2030-10-13", "10:00", "12:00"), participantIds: [w.alex.accountId, w.sam.accountId], childIds: [mia, leo] });
    expect((await w.db.select().from(childWishes))[0].handledAt).not.toBeNull();
    expect((await w.week(w.sam, WEEK, NOW)).turnToChoose).toBe(leo);
  });

  it("stops working when switched off or when the child is removed", async () => {
    const { w, mia } = await household();
    const kitchen = await w.run(w.alex, "CreateDisplayLink", { childId: null });
    const own = await w.run(w.alex, "CreateDisplayLink", { childId: mia });
    await w.run(w.sam, "RevokeDisplayLink", { linkId: kitchen.linkId });
    expect(await displayView(w.db, kitchen.token, NOW)).toBeNull();
    const kid = (await w.week(w.alex, WEEK, NOW)).children.find((c) => c.id === mia)!;
    await w.run(w.alex, "ArchiveChild", { childId: mia, version: kid.version });
    expect(await displayView(w.db, own.token, NOW)).toBeNull();
    expect(await displayView(w.db, "not-a-real-token-at-all-xxxxxxxx", NOW)).toBeNull();
  });
});

describe("booking links on places", () => {
  it("keeps a safe booking page and refuses anything else", async () => {
    const w = await newWorld();
    const place = { name: "The Boathouse", area: "Guildford", kinds: ["us"], category: "food", setting: "out-indoors" };
    await expectCode(w.run(w.alex, "AddPlace", { ...place, bookingUrl: "javascript:alert(1)" }), "VALIDATION");
    await w.run(w.alex, "AddPlace", { ...place, bookingUrl: "www.opentable.co.uk/r/boathouse" });
    const week = await w.week(w.alex, WEEK, NOW);
    expect(week.places[0].bookingUrl).toBe("https://www.opentable.co.uk/r/boathouse");
  });
});
