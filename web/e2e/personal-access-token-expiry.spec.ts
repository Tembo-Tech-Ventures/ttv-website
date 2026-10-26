import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";
import { PersonalAccessTokenExpiry } from "../src/components/admin/PersonalAccessTokenExpiry";

// Exercise the actual server-rendered control without issuing credentials.
// The standard Playwright projects run this at desktop and mobile sizes.
test("admin token expiry choices submit the intended duration", async ({ page }) => {
  await page.setContent(`<form>${renderToStaticMarkup(createElement(PersonalAccessTokenExpiry))}</form>`);
  const expiry = page.getByRole("combobox", { name: "Expires" });
  await expect(expiry).toBeVisible();
  await expect(expiry).toHaveValue("24");
  await expect(expiry.locator("option")).toHaveText([
    "1 day", "3 days", "7 days", "30 days (1 month)",
    "2 months", "3 months", "6 months", "12 months",
  ]);
  for (const hours of [24, 72, 168, 720, 1440, 2160, 4320, 8640]) {
    await expiry.selectOption(String(hours));
    expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("duration"))).toBe(String(hours));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
