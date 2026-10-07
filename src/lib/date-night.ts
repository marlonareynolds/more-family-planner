/**
 * The date night concierge: a rule-based host that composes an evening as a
 * three-course menu (a way to begin, the main event, a way to end) from the
 * mood, the budget and the household's own places. No AI, no cost.
 *
 * The menu travels in a plan's notes as plain lines, so it reads well
 * anywhere notes appear (the calendar feed, an export) and needs no schema.
 */

import { myShare, type Shelf } from "./private-split";

export const DATE_NIGHT_KEY = "date-night-menu";

export type Mood = "cosy" | "out" | "air" | "new";
export type Budget = "free" | "treat" | "splurge";
export type Course = "entree" | "plat" | "dessert";
export type Timing = "evening" | "daytime";

export interface Menu {
  entree: string;
  plat: string;
  dessert: string;
  note: string;
  /** Where the main course happens, when it is one of the household's places. */
  location?: string;
}

export const MOODS: { value: Mood; label: string; line: string }[] = [
  { value: "cosy", label: "Cosy, at home", line: "Once the children are asleep" },
  { value: "out", label: "Out on the town", line: "Dressed up, or at least dressed" },
  { value: "air", label: "Fresh air", line: "A sky, a view, a walk" },
  { value: "new", label: "Something new", line: "A first for the two of you" },
];

export const BUDGETS: { value: Budget; label: string; minor: number }[] = [
  { value: "free", label: "Free, or nearly", minor: 1500 },
  { value: "treat", label: "A treat", minor: 6000 },
  { value: "splurge", label: "Push the boat out", minor: 15000 },
];

export const COURSE_LABEL: Record<Course, string> = { entree: "L'entrée", plat: "Le plat", dessert: "Le dessert" };
export const COURSE_HINT: Record<Course, string> = { entree: "To begin", plat: "The main event", dessert: "To finish" };

const ENTREE: Record<Mood, string[]> = {
  cosy: [
    "Something fizzy and a bowl of olives, before anything else",
    "Phones in a drawer, and a toast to getting through the week",
    "A drink on the doorstep while the street goes quiet",
    "Lay the table properly, cloth and all, as if you were out",
    "A bath run for two and a glass each, before anything else",
    "Your wedding playlist, or the songs from the year you met",
  ],
  out: [
    "A drink somewhere with a view",
    "Meet in town straight from work, like you used to",
    "Take the long way round to dinner, arm in arm",
    "A cocktail at the bar you always walk past",
    "Get ready separately and meet there, like a first date",
    "A glass of something on a terrace before you sit down",
  ],
  air: [
    "A walk to the highest point nearby, as the light turns gold",
    "A flask of something warm on your favourite bench",
    "A path you've never taken, a mile from home",
    "A cold drink by the river, feet up",
    "Bikes out for an hour, nowhere in particular",
    "Watch the light go from the top of the nearest hill",
  ],
  new: [
    "Each bring a question you've never asked the other",
    "A drink at a bar neither of you has tried",
    "A short class together: pottery, salsa or a wine tasting",
    "Get off the train a stop early somewhere you don't know",
    "Order a drink neither of you can pronounce",
    "Each choose half of the evening and keep it secret",
  ],
};

const PLAT: Record<Mood, Record<Budget, string[]>> = {
  cosy: {
    free: ["Cook together with music on, one dish each", "Homemade pizza, toppings chosen in secret for each other", "A picnic on the living room floor", "Breakfast for dinner, done properly"],
    treat: ["A takeaway from the place you went to when you first met", "Something you'd never cook midweek, from a recipe you pick together", "A cheese board and a bottle you've been saving", "A meal kit from a restaurant you love"],
    splurge: ["A feast from a country you want to visit, with a bottle to match", "Steak, a good red and the best candles in the house", "A private chef for the evening, at your own table", "Oysters and champagne, for no reason at all"],
  },
  out: {
    free: ["Street food at the market, sharing everything", "Chips by the water, and nowhere to be", "A free late at a museum, then a walk", "Pizza by the slice, eaten on the move"],
    treat: ["Dinner somewhere local and walkable", "A bistro with a short menu and a long wine list", "Small plates at the counter, ordering as you go", "The curry house everyone says is the best"],
    splurge: ["The restaurant you've been saving for an occasion", "A tasting menu, with nowhere to rush to", "Dinner at a hotel restaurant, dressed for it", "A table by the window somewhere with a view of the city"],
  },
  air: {
    free: ["A picnic dinner as the sun goes down", "Fish and chips eaten outside, whatever the weather", "A flask of soup and sandwiches at the viewpoint", "Something from the barbecue in the garden"],
    treat: ["Pub dinner at the end of a long walk", "A riverside supper, outside if the sky allows", "A beer garden with fairy lights", "Dinner at a farm shop café after a walk"],
    splurge: ["Dinner on a terrace with a view", "A country pub with rooms, dinner and the long way home", "A boat trip with supper on board", "A vineyard tour and tasting, with dinner"],
  },
  new: {
    free: ["An open mic, or a free late at a gallery", "Cook a dish neither of you has ever eaten", "A quiz night at a pub you've never tried", "A talk or reading at the library"],
    treat: ["Live music at a small venue", "A comedy night, then a late bite", "A film at an independent cinema, then a drink", "An escape room, then dinner to argue about it"],
    splurge: ["A play or a show, with dinner after", "A cookery class where you eat what you make", "A jazz club with dinner and a late set", "A wine tasting led by someone who knows"],
  },
};

const DESSERT: Record<Mood, string[]> = {
  cosy: [
    "One episode, one blanket, no scrolling",
    "Dance in the kitchen to the first song you both loved",
    "Write each other one line about this year",
    "Something sweet, eaten straight from the tin",
    "Old photos on the sofa, the ones from before the children",
    "An early night, and no alarm",
  ],
  out: [
    "A crêpe from a stand on the walk home",
    "Ice cream, however cold it is",
    "Late-night chips, shared on a wall",
    "One last drink somewhere with music",
    "A taxi home the long way, past where you first lived",
    "Dessert somewhere else entirely",
  ],
  air: [
    "Hot chocolate and the stars",
    "Find the moon, then walk home the slow way",
    "A last stop at the bench with the best view",
    "A nightcap in the garden under a blanket",
    "Walk back the way you came, slower",
    "Toast marshmallows if there's a fire to be had",
  ],
  new: [
    "Plan the next one before you get home",
    "Swap one thing you'd each love to try this year",
    "A nightcap somewhere you've never been",
    "Write down tonight's best moment and swap",
    "Somewhere for dessert neither of you chose",
    "Tell each other one thing you didn't know until tonight",
  ],
};

/** How long each kind of evening usually takes, in minutes. */
export const MOOD_MINUTES: Record<Mood, number> = { cosy: 180, out: 210, air: 180, new: 210 };

/** When it can start: after bedtime at home, earlier when going out. */
export function startWindow(mood: Mood, timing: Timing): [string, string] {
  if (timing === "daytime") return ["10:30", "13:00"];
  if (mood === "cosy") return ["19:00", "20:00"];
  if (mood === "air") return ["16:30", "18:30"];
  return ["18:30", "19:30"];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PlaceOption {
  name: string;
  area?: string | null;
  kinds: string[];
}

/**
 * Everything the concierge could serve this person for one course. With a
 * shelf, each partner gets their own half of every list, so neither can be
 * offered what the other was.
 */
export function courseOptions(course: Course, mood: Mood, budget: Budget, places: PlaceOption[] = [], shelf?: Shelf): { text: string; location?: string }[] {
  const share = <T>(items: readonly T[], keyOf: (t: T) => string, seatOf?: (t: T) => number) => (shelf ? myShare(items, keyOf, shelf, seatOf) : [...items]);
  // Course lists only grow at the end, so a line's position is its seat.
  const texts = (list: string[]) => share(list, (t) => t, (t) => list.indexOf(t)).map((text) => ({ text }));
  if (course === "entree") return texts(ENTREE[mood]);
  if (course === "dessert") return texts(DESSERT[mood]);
  // The household's own places for the two of you come first when going out.
  // They are dealt on their own so a place stays on the same shelf whatever
  // the mood or budget.
  const own = mood === "cosy" ? [] : share(places.filter((p) => p.kinds.includes("us")), (p) => `place:${p.name}`).map((p) => {
    const location = p.area ? `${p.name}, ${p.area}` : p.name;
    return { text: `Dinner at ${p.name}`, location };
  });
  return [...own, ...texts(PLAT[mood][budget])];
}

/**
 * One suggestion per course. `turns` counts how often each course was
 * shuffled; the seed keeps a person's first suggestion stable for a week.
 */
export function composeMenu(input: { mood: Mood; budget: Budget; seed: string; turns?: Partial<Record<Course, number>>; places?: PlaceOption[]; shelf?: Shelf }): Menu {
  const pick = (course: Course) => {
    const list = courseOptions(course, input.mood, input.budget, input.places, input.shelf);
    return list[(hash(`${input.seed}:${course}:${input.mood}`) + (input.turns?.[course] ?? 0)) % list.length];
  };
  const plat = pick("plat");
  return { entree: pick("entree").text, plat: plat.text, dessert: pick("dessert").text, note: "", location: plat.location };
}

const PREFIX: Record<Course, string> = { entree: "To begin:", plat: "The main event:", dessert: "To finish:" };

/** The menu as plan notes: readable lines, parsed back by `menuFromNotes`. */
export function menuToNotes(menu: Menu): string {
  return [
    "Menu du soir",
    `${PREFIX.entree} ${menu.entree.trim()}`,
    `${PREFIX.plat} ${menu.plat.trim()}`,
    `${PREFIX.dessert} ${menu.dessert.trim()}`,
    ...(menu.note.trim() ? [`A note: ${menu.note.trim()}`] : []),
  ].join("\n");
}

export function menuFromNotes(notes: string): Menu | null {
  const line = (prefix: string) => notes.split("\n").find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
  const menu = { entree: line(PREFIX.entree), plat: line(PREFIX.plat), dessert: line(PREFIX.dessert), note: line("A note:") };
  return menu.entree || menu.plat || menu.dessert ? menu : null;
}
