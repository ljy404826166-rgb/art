import { expect, test } from "@playwright/test";

test("home screen renders", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".screen-title")).toBeVisible();
  await expect(page.locator("#galleryGrid")).toBeVisible();
});
