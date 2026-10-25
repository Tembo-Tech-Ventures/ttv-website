import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) {
  test(`discovery mode selection is visible and keyboard operable at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?view=scout');
    const scout = page.getByRole('button', { name: 'Scout by criteria', exact: true });
    const lookup = page.getByRole('button', { name: 'Find someone you know', exact: true });
    const before = process.env.CAPTURE_BEFORE === '1';
    if (!before) {
      await expect(page.getByRole('group', { name: 'Discovery mode' })).toBeVisible();
      await expect(scout).toHaveAttribute('aria-pressed', 'true');
      await expect(lookup).toHaveAttribute('aria-pressed', 'false');
      await expect(scout).toHaveCSS('border-bottom-width', '2px');
      await expect(lookup).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
      expect(await scout.evaluate(el => getComputedStyle(el).borderBottomColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
    await page.screenshot({path:`../docs/hackathon/discovery-polish-2026-10-25/${before ? 'before' : 'after'}-scout-${width}.png`, fullPage:true});
    await lookup.focus();
    await page.keyboard.press('Enter');
    await expect(lookup).toHaveAttribute('aria-pressed', 'true');
    await expect(scout).toHaveAttribute('aria-pressed', 'false');
    if (!before) {
      await expect(scout).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
      expect(await lookup.evaluate(el => getComputedStyle(el).borderBottomColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`../docs/hackathon/discovery-polish-2026-10-25/${before ? 'before' : 'after'}-lookup-${width}.png`, fullPage:true});
  });
}
