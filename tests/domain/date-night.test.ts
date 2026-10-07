import { describe, expect, it } from "vitest";
import { composeMenu, courseOptions, menuFromNotes, menuToNotes, startWindow } from "@/lib/date-night";

describe("date night concierge", () => {
  it("serves three courses, the same each time for a seed, and another on request", () => {
    const a = composeMenu({ mood: "out", budget: "treat", seed: "h1:2030-10-07" });
    expect(composeMenu({ mood: "out", budget: "treat", seed: "h1:2030-10-07" })).toEqual(a);
    expect(a.entree && a.plat && a.dessert).toBeTruthy();
    const b = composeMenu({ mood: "out", budget: "treat", seed: "h1:2030-10-07", turns: { plat: 1 } });
    expect(b.plat).not.toBe(a.plat);
    expect(b.entree).toBe(a.entree);
  });

  it("offers the household's own places for the main course when going out, never at home", () => {
    const places = [{ name: "The Boathouse", area: "Guildford", kinds: ["us"] }, { name: "Soft Play Land", area: null, kinds: ["family"] }];
    expect(courseOptions("plat", "out", "treat", places)[0]).toEqual({ text: "Dinner at The Boathouse", location: "The Boathouse, Guildford" });
    expect(courseOptions("plat", "out", "treat", places).some((o) => o.text.includes("Soft Play"))).toBe(false);
    expect(courseOptions("plat", "cosy", "treat", places).some((o) => o.location)).toBe(false);
  });

  it("travels in the notes as readable lines and comes back intact", () => {
    const menu = { entree: "A drink with a view", plat: "Dinner at Zia's", dessert: "Ice cream, however cold it is", note: "Wear the blue." };
    const notes = menuToNotes(menu);
    expect(notes).toContain("The main event: Dinner at Zia's");
    expect(menuFromNotes(notes)).toEqual(menu);
    expect(menuFromNotes("Just a normal note")).toBeNull();
  });

  it("starts at home after bedtime, and a daytime date around lunch", () => {
    expect(startWindow("cosy", "evening")[0]).toBe("19:00");
    expect(startWindow("out", "daytime")).toEqual(["10:30", "13:00"]);
  });
});
