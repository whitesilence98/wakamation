import { expect, test } from "@playwright/test";

test("two browser clients load the model, render and move", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const a = await context.newPage();
  const b = await context.newPage();
  const errors: string[] = [];
  a.on("pageerror", error => errors.push(error.message));
  const model = a.waitForResponse(response => response.url().endsWith("/models/character.glb"));
  const run = a.waitForResponse(response => response.url().endsWith("/models/clips/run.glb"));
  await a.goto("http://127.0.0.1:3000");
  await expect(a.getByRole("status")).toContainText("connected", { timeout: 30_000 });
  expect((await model).status()).toBe(200);
  expect((await run).status()).toBe(200);
  await expect(a.locator("html")).toHaveAttribute("data-clip", "Idle");
  await expect(a.locator("canvas")).toBeVisible();
  await b.goto("http://127.0.0.1:3000");
  await expect(a.getByRole("status")).toContainText("connected", { timeout: 20_000 });
  await expect(b.getByRole("status")).toContainText("connected");
  // Other developer tabs may already be in this room.
  await expect.poll(async () => Number((await a.getByRole("status").innerText()).match(/· (\d+)/)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
  await a.bringToFront();
  await a.keyboard.down("KeyW");
  await expect(a.locator("html")).toHaveAttribute("data-clip", "Walk");
  await a.waitForTimeout(350);
  await a.screenshot({ path: "tests/screenshots/arena.png" });
  await a.keyboard.down("ShiftLeft");
  await expect(a.locator("html")).toHaveAttribute("data-clip", "Run");
  await a.waitForTimeout(350);
  await a.keyboard.up("ShiftLeft");
  await expect(a.locator("html")).toHaveAttribute("data-clip", "Walk");
  await a.keyboard.up("KeyW");
  await expect(a.locator("html")).toHaveAttribute("data-clip", "Idle");
  await b.close();
  await expect(a.getByRole("status")).toContainText("connected");
  expect(errors).toEqual([]);
  await context.close();
});

test("missing run clip keeps the walking model usable", async ({ page }) => {
  await page.route("**/models/clips/run.glb", route => route.fulfill({ status: 404, body: "Missing clip" }));
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByRole("status")).toContainText("connected", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-clip", "Idle");
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await expect(page.locator("html")).toHaveAttribute("data-clip", "Walk");
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  await expect(page.locator("html")).toHaveAttribute("data-clip", "Idle");
});
