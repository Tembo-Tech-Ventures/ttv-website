import { expect, type Page } from "@playwright/test";
import { VALUES } from "../src/components/homepage/values";

/** Shared by the real homepage live check and its component-only rehearsal. */
export async function assertHomepageValues(page: Page) {
  const rows = page.locator("#values .value-commitment-row");
  await expect(rows).toHaveCount(VALUES.length);
  for (const [index, value] of VALUES.entries()) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".value-word")).toHaveText(value.word);
    await expect(row.locator(".value-commitment-copy")).toHaveText(value.commitment);
    await expect.poll(() => row.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return [".value-word", ".value-commitment-copy"].every((selector) => {
        const child = el.querySelector(selector)!;
        const box = child.getBoundingClientRect();
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && child.scrollWidth <= child.clientWidth + 1;
      });
    }), { message: `${value.word} and commitment must fit the static row` }).toBe(true);
  }

  const carousel = page.getByRole("region", { name: "Our values" });
  await carousel.scrollIntoViewIfNeeded();
  const next = carousel.getByRole("button", { name: "Next value" });
  // Wait for the client:visible island to hydrate before asserting interaction.
  await next.focus();
  await expect.poll(async () => {
    await next.press("End");
    return carousel.locator(".value-word").innerText();
  }).toBe("HONESTY");
  await next.press("Home");
  for (const value of VALUES) {
    await expect(carousel.locator(".value-word")).toHaveText(value.word);
    await expect(carousel.locator(".values-bubble p")).toHaveText(value.commitment);
    await expect.poll(() => carousel.evaluate((el) => {
      const word = el.querySelector(".value-word")!.getBoundingClientRect();
      const container = el.querySelector(".value-word-container")!.getBoundingClientRect();
      const bubble = el.querySelector(".values-bubble")!.getBoundingClientRect();
      return word.left >= container.left - 1 && word.right <= container.right + 1 && bubble.top >= word.bottom && bubble.right <= el.getBoundingClientRect().right + 1;
    }), { message: `${value.word} must fit without bubble overlap` }).toBe(true);
    await next.click();
    await expect(next).toBeFocused();
  }
  await expect(carousel.locator(".value-word")).toHaveText("COMMUNITY");
}
