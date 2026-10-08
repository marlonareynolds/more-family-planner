import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

/** Navigate and wait for the client to hydrate (dev compiles on demand). */
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Anything the content security policy blocked, on any page in the journey. */
const blocked: string[] = [];
function watchPolicy(page: Page) {
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) blocked.push(m.text());
  });
}
test.afterEach(() => {
  expect(blocked.splice(0)).toEqual([]);
});

/** A synthetic adult in their own browser context (own cookies). */
async function adult(browser: Browser, name: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ timezoneId: "Europe/London", locale: "en-GB", ...(viewport ? { viewport } : {}) });
  const page = await ctx.newPage();
  watchPolicy(page);
  await go(page, "/sign-in");
  await page.getByLabel("Or use another name").fill(name);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(setup|today)/);
  await page.waitForLoadState("networkidle");
  return page;
}

async function axe(page: Page) {
  // Let opening sheets and toasts finish fading in: half-faded text reads as low contrast.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

function inDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

test("two adults: set up, invite, plan a date, agree, journal stays private", async ({ browser }, info) => {
  const tag = `${info.project.name}-${Date.now().toString(36)}`;
  const vp = info.project.name === "phone" ? { width: 412, height: 915 } : undefined;
  const alex = await adult(browser, `Alex ${tag}`, vp);

  // Setup
  await expect(alex).toHaveURL(/\/setup/);
  await axe(alex);
  await alex.getByLabel("Household name").fill(`Household ${tag}`);
  await alex.getByRole("button", { name: "Start our household" }).click();
  await alex.waitForURL(/\/welcome/);
  await alex.waitForLoadState("networkidle");
  await axe(alex);

  // Getting started: add a child, then skip the rest for now
  await alex.getByLabel("Child 1 name").fill("Robin");
  await alex.getByRole("button", { name: "Save and continue" }).click();
  await expect(alex.getByRole("heading", { name: "School holidays" })).toBeVisible();
  await axe(alex);
  for (const next of ["Your usual week", "Connect a calendar", "Invite your partner"]) {
    await alex.getByRole("button", { name: "Skip for now" }).click();
    await expect(alex.getByRole("heading", { name: next })).toBeVisible();
  }
  await axe(alex);
  await alex.getByRole("button", { name: "Skip for now" }).click();
  await expect(alex.getByRole("link", { name: "Plan this week" })).toBeVisible();

  // Invite from Settings
  await go(alex, "/settings");
  await axe(alex);
  await alex.getByRole("button", { name: "Invite your partner" }).click();
  const link = await alex.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/join\//);

  await expect(alex.getByText("Robin", { exact: true })).toBeVisible();

  // A kitchen display: a no-account screen with family logistics only
  await alex.getByRole("button", { name: "Kitchen display" }).click();
  const screen = await alex.getByLabel(/Kitchen display: open this on that device/).inputValue();
  expect(screen).toMatch(/\/display\//);
  const kitchenContext = await browser.newContext({ viewport: vp });
  const kitchen = await kitchenContext.newPage();
  watchPolicy(kitchen);
  await kitchen.goto(screen);
  await expect(kitchen.getByRole("heading", { name: "Today" })).toBeVisible();
  await axe(kitchen);
  await kitchenContext.close();

  // Sam joins
  const sam = await adult(browser, `Sam ${tag}`, vp);
  await go(sam, new URL(link).pathname);
  await axe(sam);
  await sam.getByRole("button", { name: /join/i }).click();
  await sam.waitForURL(/\/welcome/);

  // Alex plans an evening for the two of them and invites Sam
  await go(alex, "/us");
  await axe(alex);
  await alex.getByRole("button", { name: "+ Plan something" }).click();
  await alex.getByLabel("What", { exact: true }).fill("Dinner at the Italian");
  await alex.getByLabel("Date").fill(inDays(3));
  await alex.getByRole("button", { name: "Save as draft" }).click();
  await expect(alex.getByText("Dinner at the Italian")).toBeVisible();
  await alex.getByRole("button", { name: "Invite" }).click();
  // The invitation has landed once the draft's Invite button is gone.
  await expect(alex.getByRole("button", { name: "Invite" })).toHaveCount(0);

  // Sam sees it waiting and agrees
  await go(sam, "/us");
  await expect(sam.getByText("Waiting for your answer")).toBeVisible();
  await axe(sam);
  await sam.getByRole("button", { name: "Yes, let's do it" }).click();
  await expect(sam.getByText("Waiting for your answer")).toHaveCount(0);

  // Alex hears about it straight away, not at the next daily run
  await go(alex, "/today");
  await expect(alex.getByText(/said yes to your plan/)).toBeVisible();

  // Our Week shows it to both
  await go(alex, `/week`);
  await axe(alex);
  await expect(alex.getByText("Dinner at the Italian").first()).toBeVisible();

  // Alex's journal is invisible to Sam
  await go(alex, "/me");
  await axe(alex);
  await alex.getByRole("button", { name: "+ Write" }).click();
  await alex.getByRole("textbox", { name: "Entry" }).fill(`Private thought ${tag}`);
  await alex.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(alex.getByText(`Private thought ${tag}`)).toBeVisible();
  await go(sam, "/me");
  await expect(sam.getByText(`Private thought ${tag}`)).toHaveCount(0);

  // A household job, asked of Sam, who says yes
  await go(alex, "/jobs");
  await axe(alex);
  await alex.getByRole("button", { name: "+ Bins out" }).click();
  await alex.getByText(`Ask Sam ${tag}`).click();
  await alex.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(alex.getByText(/asked Sam/)).toBeVisible();
  await go(sam, "/today");
  await sam.getByRole("button", { name: "Yes, it's mine" }).click();
  await go(sam, "/jobs");
  await expect(sam.getByText("Yours").first()).toBeVisible();

  // Alex promised to look after Robin, then privately asks Sam to take over (R08)
  const careDay = inDays(1);
  await go(alex, `/holidays?date=${careDay}`);
  await alex.getByRole("button", { name: "Arrange care" }).click();
  await alex.getByLabel("Date").fill(careDay);
  await alex.getByLabel("Starts").fill("18:00");
  await alex.getByLabel("Ends").fill("21:00");
  await alex.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await alex.getByRole("button", { name: "Still OK?" }).click();
  await expect(alex.getByText("Only you see this.")).toBeVisible();
  await axe(alex);
  await alex.getByRole("button", { name: `Ask Sam ${tag} to take over` }).click();
  await go(sam, `/holidays?date=${careDay}`);
  await expect(sam.getByText(/Take over looking after Robin/)).toBeVisible();
  await expect(sam.getByRole("button", { name: "Still OK?" })).toHaveCount(0);
  await sam.getByRole("button", { name: "Yes, I'll do it" }).click();
  await expect(sam.getByRole("button", { name: "Still OK?" })).toBeVisible();
  await go(alex, `/holidays?date=${careDay}`);
  await expect(alex.getByRole("button", { name: "Still OK?" })).toHaveCount(0);

  // One of our places shows first in ideas
  await go(alex, "/places");
  await axe(alex);
  await alex.getByRole("button", { name: "+ Add a place" }).click();
  await alex.getByLabel("Name").fill("The Boathouse");
  await alex.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(alex.getByRole("heading", { name: "The Boathouse" })).toBeVisible();

  // The date night concierge composes a menu and sends it as an invitation
  await go(alex, "/us/date-night");
  await alex.getByRole("radio", { name: /Cosy, at home/ }).click();
  await expect(alex.getByRole("article", { name: "Menu du soir" })).toBeVisible();
  await expect(alex.getByRole("radiogroup", { name: "Date and time" })).toBeVisible();
  await axe(alex);
  await alex.getByRole("button", { name: /Another main/ }).click();
  await alex.getByRole("button", { name: /Send the invitation/ }).click();
  await alex.waitForURL(/\/us$/);
  await go(sam, "/today");
  await expect(sam.getByRole("article", { name: "Menu du soir" }).first()).toBeVisible();
  await axe(sam);

  // Remaining screens render and pass axe
  for (const path of ["/today", "/family", "/holidays", "/plan", "/look-back", "/settings"]) {
    await go(sam, path);
    await expect(sam.locator("main")).toBeVisible();
    await axe(sam);
  }
  await alex.screenshot({ path: `test-results/me-${info.project.name}.png`, fullPage: true });
  await go(sam, "/week");
  await sam.screenshot({ path: `test-results/week-${info.project.name}.png`, fullPage: true });
});

test("an adult answers the weekly trial questions", async ({ browser }, info) => {
  const tag = `${info.project.name}-t${Date.now().toString(36)}`;
  const vp = info.project.name === "phone" ? { width: 412, height: 915 } : undefined;
  const alex = await adult(browser, `Alex ${tag}`, vp);
  await alex.getByLabel("Household name").fill(`Household ${tag}`);
  await alex.getByRole("button", { name: "Start our household" }).click();
  await alex.waitForURL(/\/welcome/);

  await go(alex, "/trial");
  await axe(alex);
  await alex.getByLabel("As a couple").fill("2");
  await alex.getByLabel("Outside More").fill("45");
  await alex.getByRole("radio", { name: "Yes" }).click();
  await alex.getByRole("button", { name: "Save answers" }).click();
  await expect(alex.getByRole("status")).toHaveText("Saved");
  await go(alex, "/trial");
  await expect(alex.getByText("You: 1 week")).toBeVisible();
  await expect(alex.getByText(/Moments: – \/ 2 \/ –/)).toBeVisible();
});

test("an adult leaves the household from Settings", async ({ browser }, info) => {
  const tag = `${info.project.name}-l${Date.now().toString(36)}`;
  const vp = info.project.name === "phone" ? { width: 412, height: 915 } : undefined;
  const alex = await adult(browser, `Alex ${tag}`, vp);
  await alex.getByLabel("Household name").fill(`Household ${tag}`);
  await alex.getByRole("button", { name: "Start our household" }).click();
  await alex.waitForURL(/\/welcome/);
  await go(alex, "/settings");
  await alex.getByRole("button", { name: "Leave household" }).click();
  await alex.getByRole("dialog").getByRole("button", { name: "Leave", exact: true }).click();
  await alex.waitForURL(/\/setup/);
});

test("what would help stays private, and the partner gets small kindnesses", async ({ browser }, info) => {
  const tag = `${info.project.name}-${Date.now().toString(36)}`;
  const vp = info.project.name === "phone" ? { width: 412, height: 915 } : undefined;
  const alex = await adult(browser, `Alex ${tag}`, vp);
  await alex.getByLabel("Household name").fill(`Household ${tag}`);
  await alex.getByRole("button", { name: "Start our household" }).click();
  await alex.waitForURL(/\/welcome/);
  await go(alex, "/settings");
  await alex.getByRole("button", { name: "Invite your partner" }).click();
  const link = await alex.getByLabel("Invitation link").inputValue();
  const sam = await adult(browser, `Sam ${tag}`, vp);
  await go(sam, new URL(link).pathname);
  await sam.getByRole("button", { name: /join/i }).click();
  await sam.waitForURL(/\/welcome/);

  // Alex says, privately, what would help
  await go(alex, "/us");
  await alex.getByText("What would help you").click();
  await expect(alex.getByText("Only you will ever see this.")).toBeVisible();
  await alex.getByRole("checkbox", { name: /To feel noticed and appreciated/ }).check();
  await alex.getByRole("textbox", { name: /In your own words/ }).fill(`Secret wish ${tag}`);
  await axe(alex);
  await alex.getByRole("button", { name: "Save, just for me" }).click();
  await expect(alex.getByText("Saved, just for you.").first()).toBeVisible();
  await go(alex, "/us");
  await alex.getByText("What would help you").click();
  await expect(alex.getByRole("checkbox", { name: /To feel noticed and appreciated/ })).toBeChecked();
  await expect(alex.getByRole("textbox", { name: /In your own words/ })).toHaveValue(`Secret wish ${tag}`);
  await alex.screenshot({ path: `test-results/what-would-help-${info.project.name}.png`, fullPage: true });

  // Sam gets a kindness card, and nothing of what Alex said
  await go(sam, "/us");
  await expect(sam.getByRole("heading", { name: "A small kindness this week" })).toBeVisible();
  await expect(sam.getByText(`Secret wish ${tag}`)).toHaveCount(0);
  expect(await sam.content()).not.toContain(`Secret wish ${tag}`);
  await sam.getByText("What would help you").click();
  await expect(sam.getByRole("checkbox", { name: /To feel noticed and appreciated/ })).not.toBeChecked();
  await axe(sam);
  await sam.getByRole("button", { name: "I did this" }).first().click();
  await expect(sam.getByRole("button", { name: "Done" })).toBeVisible();
  await sam.screenshot({ path: `test-results/kindness-${info.project.name}.png`, fullPage: true });
});

test("the household desk reads a pasted letter on the phone and adds only what's ticked", async ({ browser }, info) => {
  const tag = `${info.project.name}-d${Date.now().toString(36)}`;
  const vp = info.project.name === "phone" ? { width: 412, height: 915 } : undefined;
  const alex = await adult(browser, `Alex ${tag}`, vp);
  await alex.getByLabel("Household name").fill(`Household ${tag}`);
  await alex.getByRole("button", { name: "Start our household" }).click();
  await alex.waitForURL(/\/welcome/);
  await alex.getByLabel("Child 1 name").fill("Robin");
  await alex.getByRole("button", { name: "Save and continue" }).click();
  await expect(alex.getByRole("heading", { name: "School holidays" })).toBeVisible();

  // The letter itself never leaves the browser: only the chosen items are sent.
  const sent: string[] = [];
  alex.on("request", (r) => {
    const body = r.postData();
    if (body) sent.push(body);
  });
  const uk = (d: string) => d.split("-").reverse().join("/");
  await go(alex, "/desk");
  await axe(alex);
  const letter = [
    "From: School office <office@school.example>",
    "Dear parents,",
    `Half term is from ${uk(inDays(20))} to ${uk(inDays(24))}.`,
    `Parents' evening: ${uk(inDays(10))}, 3.30pm - 6pm. Robin's teacher will be there.`,
    `Cake sale ${uk(inDays(12))}.`,
  ].join("\n");
  await alex.getByLabel("Letter, email or booking").fill(letter);
  await alex.getByRole("button", { name: "Read it" }).click();
  await expect(alex.getByRole("heading", { name: "Found 3 things" })).toBeVisible();
  await axe(alex);
  // Leave the cake sale out.
  await alex.getByRole("listitem").filter({ hasText: "Cake sale" }).getByLabel("Add this").uncheck();
  await alex.getByRole("button", { name: "Add 2 things" }).click();
  await expect(alex.getByText("Added: Parents' evening")).toBeVisible();
  await expect(alex.getByText("Added: Half term")).toBeVisible();
  expect(sent.some((b) => b.includes("Robin's teacher") || b.includes("office@school.example") || b.includes("Cake sale"))).toBe(false);

  // Reading the same letter again: the server remembers, so nothing goes in twice.
  await alex.getByRole("button", { name: "Start again" }).click();
  await alex.getByLabel("Letter, email or booking").fill(letter);
  await alex.getByRole("button", { name: "Read it" }).click();
  await expect(alex.getByText(/Already in the diary: added by you/)).toHaveCount(2);
  await expect(alex.getByRole("button", { name: "Add 1 thing" })).toBeVisible();
  expect(sent.some((b) => b.includes("Robin's teacher") || b.includes("office@school.example"))).toBe(false);

  await go(alex, "/holidays");
  await expect(alex.getByText("Half term", { exact: true })).toBeVisible();
});
