/**
 * What would help, and small kindnesses (Marlon, 7 October 2026). Each
 * partner can tell More privately what would mean a lot to them right now.
 * Nobody else ever sees it. It only tips the odds of the small kindnesses
 * the other partner is offered each week, so whatever arrives is the
 * partner's own idea, never "your partner asked for this".
 *
 * Rule-based and free: a fixed list of needs, a fixed list of kindnesses.
 *
 * The rules that keep it genuine (tests/server/kindness.test.ts):
 * - Everyone gets the card every week, need or no need. A need only makes
 *   matching kindnesses more likely, never certain.
 * - The kindness list is split between the adults like every For Us list
 *   (private-split.ts), so nothing one partner does was ever shown to the
 *   other as a suggestion.
 * - Needs count from the week after they change, so the card never reacts
 *   while someone watches it.
 * - Only finished suggestions leave the server; the seed is secret, so the
 *   order can't be recomputed to see whether a need moved it.
 */

import { myShare, type Shelf } from "./private-split";

export const NEEDS = ["noticed", "load", "rest", "time", "listened", "close", "fun", "surprise"] as const;
export type Need = (typeof NEEDS)[number];

/** In the voice of the person saying it. */
export const NEED_LABEL: Record<Need, { label: string; hint: string }> = {
  noticed: { label: "To feel noticed and appreciated", hint: "A thank you, being seen for what you do" },
  load: { label: "A hand with the everyday load", hint: "Jobs, runs and admin taken off you" },
  rest: { label: "A bit of rest, time to myself", hint: "A lie-in, an hour alone, a bath" },
  time: { label: "More time, just the two of us", hint: "Evenings and outings together" },
  listened: { label: "To talk, and be properly listened to", hint: "Attention, without phones" },
  close: { label: "More closeness and affection", hint: "Warmth, a hug, an early night" },
  fun: { label: "More fun, something new together", hint: "Play, and something to look forward to" },
  surprise: { label: "A little surprise now and then", hint: "Small treats and thoughtful gestures" },
};

export interface Kindness {
  key: string;
  need: Need;
  /** `{name}` is the person it's for. */
  text: string;
}

/**
 * Append only: a kindness's position is its seat on the private split, so
 * adding one at the end never moves another between partners' shelves.
 * Keys say nothing about the need.
 */
export const KINDNESSES: readonly Kindness[] = [
  { key: "k-out-loud", need: "noticed", text: "Tell {name} one thing they did this week that you noticed" },
  { key: "k-hidden-note", need: "noticed", text: "Leave a note somewhere {name} will find it tomorrow" },
  { key: "k-thanks-small", need: "noticed", text: "Thank {name}, out loud, for something small they always do" },
  { key: "k-midday-text", need: "noticed", text: "Send {name} a message in the middle of the day, about nothing in particular" },
  { key: "k-tell-a-friend", need: "noticed", text: "Say something kind about {name} when they can hear it" },
  { key: "k-proud-of", need: "noticed", text: "Tell {name} what you're proud of them for this year" },

  { key: "k-take-a-job", need: "load", text: "Take one of {name}'s jobs this week without being asked" },
  { key: "k-clear-up-alone", need: "load", text: "Do the evening clear-up on your own one night, so {name} can sit down" },
  { key: "k-next-run", need: "load", text: "Offer to do the next school run or pick-up" },
  { key: "k-admin", need: "load", text: "Sort one bit of household admin that's been waiting" },
  { key: "k-cook-midweek", need: "load", text: "Cook on a night that's usually {name}'s" },
  { key: "k-morning-shift", need: "load", text: "Take the morning rush one day so {name} can start slowly" },

  { key: "k-lie-in", need: "rest", text: "Give {name} a lie-in at the weekend" },
  { key: "k-house-to-themselves", need: "rest", text: "Take the children out for a couple of hours so {name} has the house to themselves" },
  { key: "k-bath-and-bedtime", need: "rest", text: "Run {name} a bath and take over bedtime" },
  { key: "k-cover-their-hours", need: "rest", text: "Suggest {name} books some time for themselves, and cover it" },
  { key: "k-early-night-alone", need: "rest", text: "Do the late jobs so {name} can have an early night" },
  { key: "k-quiet-coffee", need: "rest", text: "Bring {name} a coffee and let them drink it in peace" },

  { key: "k-plan-an-evening", need: "time", text: "Plan an evening for the two of you, and sort the childcare yourself" },
  { key: "k-first-hour", need: "time", text: "Keep the first hour after bedtime phone-free, for the two of you" },
  { key: "k-midweek-lunch", need: "time", text: "Ask {name} out for a midweek lunch" },
  { key: "k-weekend-walk", need: "time", text: "Suggest a walk this weekend, just the two of you" },
  { key: "k-breakfast-together", need: "time", text: "Get up a little earlier for a quiet breakfast together" },
  { key: "k-something-to-look-forward-to", need: "time", text: "Put a date in the diary for the two of you, even if it's weeks away" },

  { key: "k-how-are-you-really", need: "listened", text: "Ask {name} how they really are, and just listen" },
  { key: "k-follow-up", need: "listened", text: "Ask about the thing {name} mentioned earlier in the week" },
  { key: "k-tea-and-ten-minutes", need: "listened", text: "Make a cup of tea and sit with {name} for ten minutes, no phones" },
  { key: "k-after-dinner-walk", need: "listened", text: "Suggest a walk after dinner, to talk" },
  { key: "k-best-and-worst", need: "listened", text: "Ask {name} for the best and the hardest part of their week" },
  { key: "k-their-plans", need: "listened", text: "Ask {name} what they'd love to do this year, and remember it" },

  { key: "k-long-hug", need: "close", text: "A longer hug than usual, for no reason" },
  { key: "k-hold-hands", need: "close", text: "Hold {name}'s hand on the next walk" },
  { key: "k-same-sofa", need: "close", text: "Sit together on the sofa tonight, not in separate corners" },
  { key: "k-early-night-together", need: "close", text: "Plan an early night together" },
  { key: "k-shoulder-rub", need: "close", text: "Offer {name} a shoulder rub at the end of a long day" },
  { key: "k-kiss-goodbye", need: "close", text: "A proper goodbye in the morning, not one called from the door" },

  { key: "k-something-new", need: "fun", text: "Suggest something neither of you has done before" },
  { key: "k-old-songs", need: "fun", text: "Put on the songs you both loved when you met" },
  { key: "k-book-ahead", need: "fun", text: "Book something to look forward to, even if it's months away" },
  { key: "k-game-night", need: "fun", text: "Challenge {name} to a game once the children are in bed" },
  { key: "k-silly-plan", need: "fun", text: "Plan a small adventure for the weekend and tell {name} the day before" },
  { key: "k-new-recipe", need: "fun", text: "Cook something you've never tried, and make {name} the taster" },

  { key: "k-favourite-treat", need: "surprise", text: "Bring home {name}'s favourite treat" },
  { key: "k-bedside-coffee", need: "surprise", text: "Leave a coffee by {name}'s side of the bed" },
  { key: "k-made-me-think", need: "surprise", text: "Pick up something small that made you think of {name}" },
  { key: "k-weekend-secret", need: "surprise", text: "Sort a small surprise for the weekend and keep it quiet" },
  { key: "k-flowers", need: "surprise", text: "Flowers, or one stem, for no reason" },
  { key: "k-fill-the-tank", need: "surprise", text: "Fill {name}'s car, or top up their travel card, without saying" },
];

export const kindnessSeat = (key: string) => KINDNESSES.findIndex((k) => k.key === key);
export const kindnessByKey = (key: string) => KINDNESSES.find((k) => k.key === key);

/** How much a need tips the odds: a matching kindness is this many times as likely. */
export const NEED_WEIGHT = 4;

/** A 32-bit hash scaled into (0, 1). */
function unit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/**
 * Weighted order without replacement (Efraimidis and Spirakis): each item
 * draws u^(1/w), highest first. With no needs every order is equally likely;
 * a need moves matching items up on average, never to a fixed place.
 */
export function weightedOrder<T>(items: readonly T[], keyOf: (t: T) => string, weightOf: (t: T) => number, seed: string): T[] {
  return items
    .map((item) => ({ item, score: Math.log(unit(`${seed}:${keyOf(item)}`)) / weightOf(item) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

export interface KindnessDeal {
  shelf: Shelf;
  /** What the other adults said would help, as counted for this week. */
  needs: ReadonlySet<Need>;
  /** Secret, per viewer and week. */
  seed: string;
  /** Asked for another this week. */
  skipped?: ReadonlySet<string>;
  /** Done in an earlier week, recently: rested for a while. */
  rested?: ReadonlySet<string>;
  count?: number;
}

/** This week's small kindnesses for the viewer, from their own shelf. */
export function dealKindnesses(input: KindnessDeal): Kindness[] {
  const mine = myShare(KINDNESSES, (k) => k.key, input.shelf, (k) => kindnessSeat(k.key));
  const open = mine.filter((k) => !input.skipped?.has(k.key) && !input.rested?.has(k.key));
  const pool = open.length ? open : mine.filter((k) => !input.skipped?.has(k.key));
  return weightedOrder(pool, (k) => k.key, (k) => (input.needs.has(k.need) ? NEED_WEIGHT : 1), input.seed).slice(0, input.count ?? 2);
}

export function kindnessText(k: Pick<Kindness, "text">, name: string | null): string {
  return k.text.replaceAll("{name}", name ?? "your partner");
}
