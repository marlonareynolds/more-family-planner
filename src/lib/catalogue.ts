/**
 * Starter activity catalogue (spec 7.3, 8.7). Each template carries the
 * fields the spec asks for: ages, cost basis, duration, setting,
 * preparation, weather and sensory notes, owner and review date.
 *
 * STATUS: illustrative starter content written for development. It has not
 * been expert-reviewed and must not be presented as relationship or
 * parenting guidance until the content owner reviews it.
 */

export type AgeBand = "0-4" | "5-7" | "8-11" | "12-15" | "16+";
export type Setting = "home" | "outdoors" | "out-indoors";
export type Effort = "low" | "medium" | "high";
export const CATEGORIES = ["food", "outdoors", "active", "art", "theatre", "music", "making", "cosy", "ritual"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  food: "Food and drink",
  outdoors: "Outdoors",
  active: "Active",
  art: "Museums and art",
  theatre: "Shows and films",
  music: "Music",
  making: "Making things",
  cosy: "Cosy",
  ritual: "Little rituals",
};

export interface Activity {
  key: string;
  kind: "me" | "us" | "family";
  title: string;
  summary: string;
  category: Category;
  ages?: AgeBand[];
  /** Typical total for the party, in pence; 0 means free. */
  typicalCostMinor: number;
  durationMinutes: number;
  setting: Setting;
  preparation: Effort;
  weatherSensitive: boolean;
  sensoryLoad: "low" | "medium" | "high";
  accessNotes: string;
  /** Usually works without steps or rough ground (wheelchairs, buggies). */
  stepFree?: boolean;
  /** When it makes sense to start, local "HH:MM" to "HH:MM": no stargazing at breakfast. */
  startBetween?: [string, string];
  /** A shorter, easier version for low-energy weeks. */
  simpler?: string;
  backup?: string;
  /** One of the household's own places, not the general catalogue. */
  local?: boolean;
  /** Where it is, for a household place. */
  location?: string;
  owner: string;
  reviewBy: string;
}

const owner = "Content lead (unassigned)";
const reviewBy = "2027-01-31";
const ALL: AgeBand[] = ["0-4", "5-7", "8-11", "12-15", "16+"];

export const CATALOGUE: Activity[] = [
  // Family
  { key: "fam-pancake-morning", startBetween: ["07:30", "10:00"], kind: "family", title: "Pancake morning", summary: "Everyone picks a topping and flips one pancake.", category: "ritual", ages: ALL, typicalCostMinor: 500, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Adapts to most diets with swaps.", simpler: "Shop-bought crumpets with the same topping bar.", stepFree: true, owner, reviewBy },
  { key: "fam-woodland-walk", kind: "family", title: "Woodland walk and den building", summary: "A short loop with time to build a stick den.", category: "outdoors", ages: ["5-7", "8-11", "12-15"], typicalCostMinor: 0, durationMinutes: 120, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Many paths are uneven; check for a surfaced route if needed.", simpler: "Twenty minutes in the nearest park.", backup: "Indoor den with blankets and chairs.", owner, reviewBy },
  { key: "fam-board-games", kind: "family", title: "Board game tournament", summary: "Three short games, a scoreboard and a silly trophy.", category: "cosy", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 90, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Choose games every child can play.", simpler: "One card game after tea.", stepFree: true, owner, reviewBy },
  { key: "fam-swim", kind: "family", title: "Family swim", summary: "Fun session at the local pool.", category: "active", ages: ALL, typicalCostMinor: 1800, durationMinutes: 120, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Check changing facilities and quieter sessions.", owner, reviewBy },
  { key: "fam-museum", startBetween: ["09:30", "11:00"], kind: "family", title: "Free museum morning", summary: "Pick one gallery each and swap favourites over a snack.", category: "art", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 180, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Most national museums have step-free access and quiet hours.", simpler: "One room only, then lunch.", stepFree: true, owner, reviewBy },
  { key: "fam-cinema", startBetween: ["10:00", "15:30"], kind: "family", title: "Cinema trip", summary: "A matinee everyone can enjoy.", category: "theatre", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 3200, durationMinutes: 180, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Look for relaxed screenings.", simpler: "Film night at home with popcorn.", stepFree: true, owner, reviewBy },
  { key: "fam-bake", kind: "family", title: "Bake something together", summary: "Biscuits or a simple loaf, with jobs for every age.", category: "making", ages: ALL, typicalCostMinor: 600, durationMinutes: 90, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Check allergies before choosing a recipe.", simpler: "Decorate shop-bought biscuits.", stepFree: true, owner, reviewBy },
  { key: "fam-picnic", kind: "family", title: "Park picnic", summary: "Everyone packs one thing.", category: "outdoors", ages: ALL, typicalCostMinor: 800, durationMinutes: 150, setting: "outdoors", preparation: "medium", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Choose a park with toilets and level paths if needed.", backup: "Living-room picnic on a blanket.", owner, reviewBy },
  { key: "fam-one-to-one", kind: "family", title: "One adult, one child", summary: "An hour where one child chooses what you do together.", category: "ritual", ages: ALL, typicalCostMinor: 500, durationMinutes: 60, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "The other children need care for the hour.", stepFree: true, owner, reviewBy },
  { key: "fam-cycle", kind: "family", title: "Bike ride", summary: "A traffic-free path with a snack stop.", category: "active", ages: ["8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 150, setting: "outdoors", preparation: "medium", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Needs bikes and helmets for everyone.", simpler: "Scooters round the block.", owner, reviewBy },

  // Us
  { key: "us-dinner-local", startBetween: ["18:30", "20:00"], kind: "us", title: "Dinner somewhere local", summary: "Somewhere walkable, phones away for the first course.", category: "food", typicalCostMinor: 7000, durationMinutes: 150, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Check the menu for dietary needs before booking.", simpler: "A takeaway at home after bedtime.", stepFree: true, owner, reviewBy },
  { key: "us-theatre", kind: "us", title: "A show", summary: "Local theatre or a West End matinee for a bigger occasion.", category: "theatre", typicalCostMinor: 9000, durationMinutes: 240, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Most venues list step-free seats and captioned performances.", simpler: "A filmed stage production at home.", stepFree: true, owner, reviewBy },
  { key: "us-gig", startBetween: ["19:00", "20:30"], kind: "us", title: "Live music", summary: "A small gig, jazz bar or concert.", category: "music", typicalCostMinor: 5000, durationMinutes: 210, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Check venue access and noise levels.", owner, reviewBy },
  { key: "us-walk-pub", startBetween: ["10:00", "12:00"], kind: "us", title: "Walk and a pub lunch", summary: "A circular walk ending somewhere warm.", category: "outdoors", typicalCostMinor: 4000, durationMinutes: 210, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Pick a route to suit both of you.", backup: "Lunch only, with a longer sit.", owner, reviewBy },
  { key: "us-gallery", kind: "us", title: "Gallery and coffee", summary: "One exhibition, then talk about what stayed with you.", category: "art", typicalCostMinor: 3000, durationMinutes: 180, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Most galleries have lifts and seating.", stepFree: true, owner, reviewBy },
  { key: "us-cosy-night", startBetween: ["19:00", "20:30"], kind: "us", title: "A cosy night in", summary: "Something you'd never cook midweek, a film you both pick.", category: "cosy", typicalCostMinor: 2500, durationMinutes: 180, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", simpler: "Dessert and one episode.", stepFree: true, owner, reviewBy },
  { key: "us-breakfast", startBetween: ["08:30", "10:00"], kind: "us", title: "Breakfast date", summary: "After school drop-off, before the day starts.", category: "food", typicalCostMinor: 2500, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },

  // Me
  { key: "me-swim", kind: "me", title: "A swim", summary: "Lengths or just a float.", category: "active", typicalCostMinor: 700, durationMinutes: 90, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", owner, reviewBy },
  { key: "me-long-walk", kind: "me", title: "A long walk alone", summary: "No destination, no podcast unless you want one.", category: "outdoors", typicalCostMinor: 0, durationMinutes: 90, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "", simpler: "Twenty minutes round the block.", owner, reviewBy },
  { key: "me-friend", kind: "me", title: "See a friend", summary: "Coffee, a drink or a walk with someone who's yours.", category: "food", typicalCostMinor: 1200, durationMinutes: 120, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "me-make", kind: "me", title: "Make something", summary: "An hour for the thing you used to do: draw, play, write, build.", category: "making", typicalCostMinor: 0, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "me-nothing", kind: "me", title: "Nothing at all", summary: "Protected time with no plan. Rest counts.", category: "cosy", typicalCostMinor: 0, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },

  // More family
  { key: "fam-rainy-fort", kind: "family", title: "Rainy-day fort and stories", summary: "Build a fort from sofa cushions, then read inside it by torchlight.", category: "cosy", ages: ["0-4", "5-7", "8-11"], typicalCostMinor: 0, durationMinutes: 90, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, simpler: "One story each under a blanket.", owner, reviewBy },
  { key: "fam-library", kind: "family", title: "Library visit", summary: "Everyone borrows one book for someone else in the family.", category: "art", ages: ALL, typicalCostMinor: 0, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Most libraries are step-free and many run free toddler sessions.", stepFree: true, owner, reviewBy },
  { key: "fam-beach", kind: "family", title: "Day at the seaside", summary: "Sandcastles, chips and a paddle, whatever the season.", category: "outdoors", ages: ALL, typicalCostMinor: 3000, durationMinutes: 360, setting: "outdoors", preparation: "high", weatherSensitive: true, sensoryLoad: "medium", accessNotes: "Some beaches lend beach wheelchairs; check before you go.", simpler: "A paddling pool or sprinkler in the garden.", backup: "An aquarium or indoor play centre near the coast.", owner, reviewBy },
  { key: "fam-farm", kind: "family", title: "City farm or petting farm", summary: "Feed the animals and find out everyone's favourite.", category: "outdoors", ages: ["0-4", "5-7", "8-11"], typicalCostMinor: 1500, durationMinutes: 150, setting: "outdoors", preparation: "medium", weatherSensitive: true, sensoryLoad: "medium", accessNotes: "City farms are often free and mostly level.", backup: "Animal-themed drawing and a nature documentary at home.", owner, reviewBy },
  { key: "fam-dance", kind: "family", title: "Kitchen disco", summary: "Each person adds three songs to the playlist. Lights down.", category: "music", ages: ALL, typicalCostMinor: 0, durationMinutes: 30, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Seated dancing counts.", stepFree: true, owner, reviewBy },
  { key: "fam-garden", kind: "family", title: "Plant something", summary: "Seeds in pots or a window box everyone checks on each week.", category: "making", ages: ALL, typicalCostMinor: 800, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Works at a table indoors.", stepFree: true, owner, reviewBy },
  { key: "fam-treasure-hunt", kind: "family", title: "Treasure hunt", summary: "One adult hides clues around the house or park; the prize is pudding.", category: "active", ages: ["5-7", "8-11"], typicalCostMinor: 0, durationMinutes: 60, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Keep clues reachable for everyone.", simpler: "A five-clue hunt in one room.", owner, reviewBy },
  { key: "fam-sunday-roast", startBetween: ["12:00", "17:00"], kind: "family", title: "Sunday dinner together", summary: "Everyone has a job, nobody has a screen.", category: "ritual", ages: ALL, typicalCostMinor: 2000, durationMinutes: 120, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, simpler: "Fish fingers at the table, with one question each about the week.", owner, reviewBy },
  { key: "fam-stargazing", startBetween: ["17:30", "18:30"], kind: "family", title: "Stargazing", summary: "Blankets, hot chocolate and a free star-map app on a clear night.", category: "outdoors", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 60, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "A garden or doorstep works.", backup: "A space documentary with the lights off.", owner, reviewBy },
  { key: "fam-teen-cafe", kind: "family", title: "Café with your teenager", summary: "Their choice of place, your treat, no agenda.", category: "food", ages: ["12-15", "16+"], typicalCostMinor: 1200, durationMinutes: 60, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "fam-soft-play", kind: "family", title: "Soft play", summary: "Let them burn it off while you sit with a coffee, or join in.", category: "active", ages: ["0-4", "5-7"], typicalCostMinor: 1500, durationMinutes: 120, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Many run quieter SEN sessions.", owner, reviewBy },
  { key: "fam-photo-walk", kind: "family", title: "Photo walk", summary: "Everyone gets ten photos of one theme: red things, faces in objects, tiny things.", category: "art", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 60, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Works on pavements.", stepFree: true, backup: "The same game indoors.", owner, reviewBy },

  // More us
  { key: "us-cook-together", kind: "us", title: "Cook something new together", summary: "A recipe neither of you has made, with music on.", category: "food", typicalCostMinor: 2000, durationMinutes: 120, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, simpler: "Make one thing you both loved as children.", owner, reviewBy },
  { key: "us-comedy", startBetween: ["19:00", "20:30"], kind: "us", title: "Comedy night", summary: "A local comedy club or a touring act.", category: "theatre", typicalCostMinor: 4000, durationMinutes: 180, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Basement clubs often have stairs; check first.", simpler: "A stand-up special at home.", owner, reviewBy },
  { key: "us-class", kind: "us", title: "Try a class together", summary: "Pottery, salsa, climbing or a cookery class, a one-off taster.", category: "making", typicalCostMinor: 6000, durationMinutes: 150, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Ask the venue about access when booking.", owner, reviewBy },
  { key: "us-sunset-walk", startBetween: ["17:00", "20:00"], kind: "us", title: "Sunset walk", summary: "Forty minutes to a viewpoint after the children are in bed or with a sitter.", category: "outdoors", typicalCostMinor: 0, durationMinutes: 60, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "", backup: "A drink by the window and the same no-phones rule.", owner, reviewBy },
  { key: "us-questions", kind: "us", title: "The question jar", summary: "Take turns drawing a question you've never asked each other.", category: "ritual", typicalCostMinor: 0, durationMinutes: 45, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "us-lunch-midweek", startBetween: ["12:00", "13:00"], kind: "us", title: "Midweek lunch", summary: "Meet near one of your workplaces while the children are at school.", category: "food", typicalCostMinor: 3000, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "us-night-away", kind: "us", title: "A night away", summary: "One night somewhere close, with the children covered.", category: "ritual", typicalCostMinor: 20000, durationMinutes: 1440, setting: "out-indoors", preparation: "high", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Book an accessible room if needed.", simpler: "An evening at a hotel bar, home by midnight.", owner, reviewBy },

  // More me
  { key: "me-run", kind: "me", title: "A run or parkrun", summary: "Saturday parkrun is free and timed; a solo run works any day.", category: "active", typicalCostMinor: 0, durationMinutes: 60, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "parkrun welcomes walkers and wheelchair users.", backup: "A home workout video.", owner, reviewBy },
  { key: "me-read", kind: "me", title: "Read in a café", summary: "A book, a coffee and no one needing you for an hour.", category: "cosy", typicalCostMinor: 500, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "me-gym", kind: "me", title: "Gym or a class", summary: "Yoga, spin or weights, whatever you'd go back to.", category: "active", typicalCostMinor: 1000, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", owner, reviewBy },
  { key: "me-bath", startBetween: ["19:00", "21:00"], kind: "me", title: "A long bath", summary: "Door shut, someone else on bedtime duty.", category: "cosy", typicalCostMinor: 0, durationMinutes: 45, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", owner, reviewBy },
  { key: "me-lie-in", startBetween: ["07:00", "08:00"], kind: "me", title: "A lie-in", summary: "The other adult does the morning. Swap next week.", category: "ritual", typicalCostMinor: 0, durationMinutes: 120, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", stepFree: true, owner, reviewBy },
  { key: "me-sport-watch", kind: "me", title: "Watch the match", summary: "The whole game, uninterrupted, in a pub or on the sofa.", category: "cosy", typicalCostMinor: 1000, durationMinutes: 150, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "", owner, reviewBy },
  { key: "me-volunteer", kind: "me", title: "Something for someone else", summary: "A volunteering shift, a community garden, or helping a neighbour.", category: "making", typicalCostMinor: 0, durationMinutes: 150, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", owner, reviewBy },
];

export interface CatalogueFilter {
  kind: Activity["kind"];
  childAgeBands?: AgeBand[];
  maxCostMinor?: number | null;
  setting?: Setting | "any";
  lowEffort?: boolean;
  /** Keep ideas that still work if it rains (indoors, or with a backup). */
  rainProof?: boolean;
  calm?: boolean;
  stepFree?: boolean;
  maxMinutes?: number | null;
}

/** Honest matching: hard constraints filter, never re-rank around them. */
export function matchActivities(f: CatalogueFilter, list: readonly Activity[] = CATALOGUE): Activity[] {
  return list.filter((a) => {
    if (a.kind !== f.kind) return false;
    if (f.kind === "family" && f.childAgeBands?.length && a.ages && !f.childAgeBands.every((b) => a.ages!.includes(b))) return false;
    if (f.maxCostMinor !== undefined && f.maxCostMinor !== null && a.typicalCostMinor > f.maxCostMinor) return false;
    if (f.setting && f.setting !== "any" && a.setting !== f.setting) return false;
    if (f.lowEffort && a.preparation !== "low" && !a.simpler) return false;
    if (f.rainProof && a.weatherSensitive && !a.backup) return false;
    if (f.calm && a.sensoryLoad === "high") return false;
    if (f.stepFree && !a.stepFree) return false;
    if (f.maxMinutes && a.durationMinutes > f.maxMinutes) return false;
    return true;
  });
}
