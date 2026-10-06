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
export type Category = "theatre" | "food" | "music" | "art" | "outdoors" | "cosy" | "active" | "making" | "ritual";

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
  /** A shorter, easier version for low-energy weeks. */
  simpler?: string;
  backup?: string;
  owner: string;
  reviewBy: string;
}

const owner = "Content lead (unassigned)";
const reviewBy = "2027-01-31";
const ALL: AgeBand[] = ["0-4", "5-7", "8-11", "12-15", "16+"];

export const CATALOGUE: Activity[] = [
  // Family
  { key: "fam-pancake-morning", kind: "family", title: "Pancake morning", summary: "Everyone picks a topping and flips one pancake.", category: "ritual", ages: ALL, typicalCostMinor: 500, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Adapts to most diets with swaps.", simpler: "Shop-bought crumpets with the same topping bar.", owner, reviewBy },
  { key: "fam-woodland-walk", kind: "family", title: "Woodland walk and den building", summary: "A short loop with time to build a stick den.", category: "outdoors", ages: ["5-7", "8-11", "12-15"], typicalCostMinor: 0, durationMinutes: 120, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Many paths are uneven; check for a surfaced route if needed.", simpler: "Twenty minutes in the nearest park.", backup: "Indoor den with blankets and chairs.", owner, reviewBy },
  { key: "fam-board-games", kind: "family", title: "Board game tournament", summary: "Three short games, a scoreboard and a silly trophy.", category: "cosy", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 90, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Choose games every child can play.", simpler: "One card game after tea.", owner, reviewBy },
  { key: "fam-swim", kind: "family", title: "Family swim", summary: "Fun session at the local pool.", category: "active", ages: ALL, typicalCostMinor: 1800, durationMinutes: 120, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Check changing facilities and quieter sessions.", owner, reviewBy },
  { key: "fam-museum", kind: "family", title: "Free museum morning", summary: "Pick one gallery each and swap favourites over a snack.", category: "art", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 180, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Most national museums have step-free access and quiet hours.", simpler: "One room only, then lunch.", owner, reviewBy },
  { key: "fam-cinema", kind: "family", title: "Cinema trip", summary: "A matinee everyone can enjoy.", category: "theatre", ages: ["5-7", "8-11", "12-15", "16+"], typicalCostMinor: 3200, durationMinutes: 180, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Look for relaxed screenings.", simpler: "Film night at home with popcorn.", owner, reviewBy },
  { key: "fam-bake", kind: "family", title: "Bake something together", summary: "Biscuits or a simple loaf, with jobs for every age.", category: "making", ages: ALL, typicalCostMinor: 600, durationMinutes: 90, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "Check allergies before choosing a recipe.", simpler: "Decorate shop-bought biscuits.", owner, reviewBy },
  { key: "fam-picnic", kind: "family", title: "Park picnic", summary: "Everyone packs one thing.", category: "outdoors", ages: ALL, typicalCostMinor: 800, durationMinutes: 150, setting: "outdoors", preparation: "medium", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Choose a park with toilets and level paths if needed.", backup: "Living-room picnic on a blanket.", owner, reviewBy },
  { key: "fam-one-to-one", kind: "family", title: "One adult, one child", summary: "An hour where one child chooses what you do together.", category: "ritual", ages: ALL, typicalCostMinor: 500, durationMinutes: 60, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "The other children need care for the hour.", owner, reviewBy },
  { key: "fam-cycle", kind: "family", title: "Bike ride", summary: "A traffic-free path with a snack stop.", category: "active", ages: ["8-11", "12-15", "16+"], typicalCostMinor: 0, durationMinutes: 150, setting: "outdoors", preparation: "medium", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Needs bikes and helmets for everyone.", simpler: "Scooters round the block.", owner, reviewBy },

  // Us
  { key: "us-dinner-local", kind: "us", title: "Dinner somewhere local", summary: "Somewhere walkable, phones away for the first course.", category: "food", typicalCostMinor: 7000, durationMinutes: 150, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Check the menu for dietary needs before booking.", simpler: "A takeaway at home after bedtime.", owner, reviewBy },
  { key: "us-theatre", kind: "us", title: "A show", summary: "Local theatre or a West End matinee for a bigger occasion.", category: "theatre", typicalCostMinor: 9000, durationMinutes: 240, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Most venues list step-free seats and captioned performances.", simpler: "A filmed stage production at home.", owner, reviewBy },
  { key: "us-gig", kind: "us", title: "Live music", summary: "A small gig, jazz bar or concert.", category: "music", typicalCostMinor: 5000, durationMinutes: 210, setting: "out-indoors", preparation: "medium", weatherSensitive: false, sensoryLoad: "high", accessNotes: "Check venue access and noise levels.", owner, reviewBy },
  { key: "us-walk-pub", kind: "us", title: "Walk and a pub lunch", summary: "A circular walk ending somewhere warm.", category: "outdoors", typicalCostMinor: 4000, durationMinutes: 210, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "Pick a route to suit both of you.", backup: "Lunch only, with a longer sit.", owner, reviewBy },
  { key: "us-gallery", kind: "us", title: "Gallery and coffee", summary: "One exhibition, then talk about what stayed with you.", category: "art", typicalCostMinor: 3000, durationMinutes: 180, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "Most galleries have lifts and seating.", owner, reviewBy },
  { key: "us-cosy-night", kind: "us", title: "A cosy night in", summary: "Something you'd never cook midweek, a film you both pick.", category: "cosy", typicalCostMinor: 2500, durationMinutes: 180, setting: "home", preparation: "medium", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", simpler: "Dessert and one episode.", owner, reviewBy },
  { key: "us-breakfast", kind: "us", title: "Breakfast date", summary: "After school drop-off, before the day starts.", category: "food", typicalCostMinor: 2500, durationMinutes: 75, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", owner, reviewBy },

  // Me
  { key: "me-swim", kind: "me", title: "A swim", summary: "Lengths or just a float.", category: "active", typicalCostMinor: 700, durationMinutes: 90, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", owner, reviewBy },
  { key: "me-long-walk", kind: "me", title: "A long walk alone", summary: "No destination, no podcast unless you want one.", category: "outdoors", typicalCostMinor: 0, durationMinutes: 90, setting: "outdoors", preparation: "low", weatherSensitive: true, sensoryLoad: "low", accessNotes: "", simpler: "Twenty minutes round the block.", owner, reviewBy },
  { key: "me-friend", kind: "me", title: "See a friend", summary: "Coffee, a drink or a walk with someone who's yours.", category: "food", typicalCostMinor: 1200, durationMinutes: 120, setting: "out-indoors", preparation: "low", weatherSensitive: false, sensoryLoad: "medium", accessNotes: "", owner, reviewBy },
  { key: "me-make", kind: "me", title: "Make something", summary: "An hour for the thing you used to do: draw, play, write, build.", category: "making", typicalCostMinor: 0, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", owner, reviewBy },
  { key: "me-nothing", kind: "me", title: "Nothing at all", summary: "Protected time with no plan. Rest counts.", category: "cosy", typicalCostMinor: 0, durationMinutes: 60, setting: "home", preparation: "low", weatherSensitive: false, sensoryLoad: "low", accessNotes: "", owner, reviewBy },
];

export interface CatalogueFilter {
  kind: Activity["kind"];
  childAgeBands?: AgeBand[];
  maxCostMinor?: number | null;
  setting?: Setting | "any";
  lowEffort?: boolean;
}

/** Honest matching: hard constraints filter, never re-rank around them. */
export function matchActivities(f: CatalogueFilter): Activity[] {
  return CATALOGUE.filter((a) => {
    if (a.kind !== f.kind) return false;
    if (f.kind === "family" && f.childAgeBands?.length && a.ages && !f.childAgeBands.every((b) => a.ages!.includes(b))) return false;
    if (f.maxCostMinor !== undefined && f.maxCostMinor !== null && a.typicalCostMinor > f.maxCostMinor) return false;
    if (f.setting && f.setting !== "any" && a.setting !== f.setting) return false;
    if (f.lowEffort && a.preparation !== "low" && !a.simpler) return false;
    return true;
  });
}
