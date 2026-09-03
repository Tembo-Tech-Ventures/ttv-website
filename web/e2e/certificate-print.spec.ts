import { expect, test, type Page } from "@playwright/test";

/**
 * Print behaviour of the certificate prototypes.
 *
 * Runs against `/dev/certificate-print/*`, which renders each treatment from a
 * fixture instead of D1 — a real certificate needs a seeded COMPLETED
 * application, and the thing under test here is the stylesheet, not the query.
 *
 * Everything below is asserted under `emulateMedia({ media: "print" })`,
 * because all of it is invisible on screen: the print-only URL swap, the
 * signature block, and the colour that only survives because of
 * `print-color-adjust`. Reading the screen render proves none of it.
 */
test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "The print prototypes are dev-only and intentionally unavailable on deployed environments."
);

const INSTRUCTOR = "Grace Wanjiru Mbeki";
const VERIFY_URL =
  "https://tembotechventures.com/certificate/kx7m2q9v4b1n8t3r6y0w5z2a";

/** Every treatment that is offered as an answer to the signature feedback. */
const PROTOTYPES = [
  { key: "a", name: "one artefact" },
  { key: "b", name: "landscape diploma" },
  { key: "c", name: "ink-light portrait" },
];

async function gotoPrint(page: Page, key: string) {
  await page.emulateMedia({ media: "print" });
  await page.goto(`/dev/certificate-print/${key}`);
}

for (const prototype of PROTOTYPES) {
  test.describe(`prototype ${prototype.key} — ${prototype.name}`, () => {
    /*
     * The feedback that started this: a printed certificate with no signature.
     * Assert both halves — the drawn mark and the typeset name — because a
     * mark with no name is unattributable and a name with no mark is just the
     * metadata row that already existed.
     */
    test("prints the instructor's signature and their name", async ({ page }) => {
      await gotoPrint(page, prototype.key);

      await expect(page.locator("svg.signature").first()).toBeVisible();
      await expect(page.getByText(INSTRUCTOR)).toBeVisible();
      await expect(page.getByText("Lead Instructor")).toBeVisible();
    });

    /*
     * On paper the URL is not clickable, so a bare host is not enough to get
     * back to the credential — the whole path has to be readable.
     */
    test("prints the full verification URL, not just the host", async ({ page }) => {
      await gotoPrint(page, prototype.key);

      await expect(page.getByText(VERIFY_URL)).toBeVisible();
    });

    /*
     * The page box, not the viewport, is what content has to fit inside. A
     * layout that overflows it silently loses the overflow off the edge of the
     * sheet rather than scrolling.
     */
    test("does not overflow the sheet horizontally", async ({ page }) => {
      await gotoPrint(page, prototype.key);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

/*
 * Prototype A is the only treatment that shows different text on screen and on
 * paper, so the swap itself needs a test in both directions: asserting only the
 * print side would still pass if the host line were never hidden.
 */
test.describe("prototype A — screen/print URL swap", () => {
  test("shows the bare host on screen and the full URL in print", async ({
    page,
  }) => {
    await page.goto("/dev/certificate-print/a");

    await expect(page.getByText("tembotechventures.com", { exact: true })).toBeVisible();
    await expect(page.getByText(VERIFY_URL)).toBeHidden();

    await page.emulateMedia({ media: "print" });

    await expect(page.getByText(VERIFY_URL)).toBeVisible();
    await expect(
      page.getByText("tembotechventures.com", { exact: true })
    ).toBeHidden();
  });

  /*
   * "Background graphics" is off by default in Chrome's print dialog, so the
   * cream paper and orange strip only reach the printer because the card sets
   * `print-color-adjust: exact`. Losing that line would degrade the sheet to
   * black-on-white without failing any layout assertion.
   */
  test("forces the brand colour through the browser's background setting", async ({
    page,
  }) => {
    await gotoPrint(page, "a");

    const adjust = await page
      .locator("article.card")
      .evaluate((card) => getComputedStyle(card).printColorAdjust);

    expect(adjust).toBe("exact");
  });
});

/*
 * Prototype C is the only one that models more than one signatory, which is
 * the part of the design that the schema cannot express yet.
 */
test("prototype C prints a second signatory", async ({ page }) => {
  await gotoPrint(page, "c");

  await expect(page.locator("svg.signature")).toHaveCount(2);
  await expect(page.getByText("Daniel Otieno")).toBeVisible();
  await expect(page.getByText("Programme Director")).toBeVisible();
});
