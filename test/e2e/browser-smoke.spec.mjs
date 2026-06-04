import { expect, test } from "@playwright/test";

test("browser automation renders a page", async ({ page }) => {
  await page.setContent("<main><h1>CarPostClub</h1></main>");

  await expect(page.getByRole("heading", { name: "CarPostClub" })).toBeVisible();
});
