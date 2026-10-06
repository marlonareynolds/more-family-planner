import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

/** Navigate and wait for the client to hydrate (dev compiles on demand). */
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** A synthetic adult in their own browser context (own cookies). */
async function adult(browser: Browser, name: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ timezoneId: "Europe/London", locale: "en-GB", ...(viewport ? { viewport } : {}) });
  const page = await ctx.newPage();
  await go(page, "/sign-in");
  await page.getByLabel("Or use another name").fill(name);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(setup|today)/);
  await page.waitForLoadState("networkidle");
  return page;
}

async function axe(page: Page) {
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
  await alex.waitForURL(/\/today/);
  await alex.waitForLoadState("networkidle");
  await axe(alex);

  // Invite from Settings
  await go(alex, "/settings");
  await axe(alex);
  await alex.getByRole("button", { name: "Invite your partner" }).click();
  const link = await alex.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/join\//);

  // Add a child
  await alex.getByRole("button", { name: "+ Add a child" }).click();
  await alex.getByLabel("Name they go by").fill("Robin");
  await alex.getByLabel("Age band").selectOption("5-7");
  await alex.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(alex.getByText("Robin")).toBeVisible();

  // Sam joins
  const sam = await adult(browser, `Sam ${tag}`, vp);
  await go(sam, new URL(link).pathname);
  await axe(sam);
  await sam.getByRole("button", { name: /join/i }).click();
  await sam.waitForURL(/\/today/);

  // Alex plans an evening for the two of them and invites Sam
  await go(alex, "/us");
  await axe(alex);
  await alex.getByRole("button", { name: "+ Plan something" }).click();
  await alex.getByLabel("What").fill("Dinner at the Italian");
  await alex.getByLabel("Date").fill(inDays(3));
  await alex.getByRole("button", { name: "Save as draft" }).click();
  await expect(alex.getByText("Dinner at the Italian")).toBeVisible();
  await alex.getByRole("button", { name: "Invite" }).click();

  // Sam sees it waiting and agrees
  await go(sam, "/us");
  await expect(sam.getByText("Waiting for your answer")).toBeVisible();
  await axe(sam);
  await sam.getByRole("button", { name: "Yes, let's do it" }).click();
  await expect(sam.getByText("Waiting for your answer")).toHaveCount(0);

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

  // Remaining screens render and pass axe
  for (const path of ["/today", "/family", "/holidays"]) {
    await go(sam, path);
    await expect(sam.locator("main")).toBeVisible();
    await axe(sam);
  }
  await alex.screenshot({ path: `test-results/me-${info.project.name}.png`, fullPage: true });
  await go(sam, "/week");
  await sam.screenshot({ path: `test-results/week-${info.project.name}.png`, fullPage: true });
});
