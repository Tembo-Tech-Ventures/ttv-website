import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The post editor's design contract.
 *
 * These run against `/dev/writing-ui`, which renders the real `PostEditor` in
 * the real `ImmersiveLayout` with fixed data — the authenticated route needs a
 * session and a published profile, neither of which a local dev server has, and
 * the layout under test is identical.
 *
 * The assertions are the contract rather than decoration. An immersive writing
 * surface is exactly the kind of page where a regression is invisible in review:
 * it still looks like an editor with a second scrollbar, with a toolbar hanging
 * off the edge of the window, or with a closed settings panel every one of whose
 * controls is still reachable by Tab. Each of those was true at some point while
 * this was being built.
 */
test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "The mock writing page is dev-only and intentionally unavailable on deployed environments."
);

const EVIDENCE_DIR = "test-results/evidence/writing";

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  const path = `${EVIDENCE_DIR}/${testInfo.project.name}-${name}.png`;
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/**
 * Elements that are actually scrolling: on screen, overflowing, and scrollable.
 *
 * Visibility is part of the definition, not a detail. The closed settings panel
 * has its own scrolling region, and counting that would make this assertion fail
 * for a surface the author cannot see or reach.
 */
async function countScrollableRegions(page: Page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
        (element) => {
          const style = getComputedStyle(element);
          const scrolls =
            style.overflowY === "auto" || style.overflowY === "scroll";
          return (
            scrolls &&
            element.scrollHeight > element.clientHeight + 1 &&
            element.checkVisibility({
              visibilityProperty: true,
              opacityProperty: true,
            })
          );
        }
      ).length
  );
}

async function open(page: Page, state: "empty" | "draft" | "published") {
  await page.goto(`/dev/writing-ui?state=${state}`);
  await expect(page.getByRole("button", { name: "Post settings" })).toBeVisible();
  await expect(page.locator("[data-post-body]")).toBeVisible();
  if (state !== "empty") {
    // The canvas exists before the Markdown has been imported into it. Waiting
    // for a block that only the fixture's content produces is what makes the
    // difference between testing the editor and testing an empty div.
    await expect(page.locator("[data-post-body] blockquote")).toBeVisible();
  }
}

/** Selects a phrase in the body, the way a mouse drag would. */
async function selectPhrase(page: Page, phrase: string) {
  await page.evaluate((needle) => {
    const body = document.querySelector("[data-post-body]")!;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`No text node contains ${JSON.stringify(needle)}`);
  }, phrase);
  await page.mouse.up();
}

test.describe("the writing surface", () => {
  test("gives the page to the post and never scrolls the document", async ({
    page,
  }, testInfo) => {
    await open(page, "draft");

    const documentScrolls = await page.evaluate(
      () =>
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight + 1
    );
    expect(documentScrolls).toBe(false);

    // One region, and it is the canvas. A second scrollbar on this page means
    // the author has to work out which one holds their post.
    expect(await countScrollableRegions(page)).toBe(1);

    await shoot(page, testInfo, "canvas");
  });

  test("keeps the closed settings panel out of the page", async ({ page }) => {
    await open(page, "published");

    const slug = page.getByLabel("Address");
    await expect(slug).toBeHidden();

    // Hidden to the eye is not enough, and asserting the CSS would only restate
    // the implementation. Tab out of the toggle and check that focus never
    // lands inside the panel: `aria-hidden` on its own leaves every control in
    // there reachable, which is how a keyboard user ends up typing into a panel
    // they cannot see.
    await page.getByRole("button", { name: "Post settings" }).focus();
    const reached: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        return active && active.closest("aside")
          ? (active.getAttribute("aria-label") ?? active.tagName)
          : null;
      });
      if (inside) reached.push(inside);
    }
    expect(reached).toEqual([]);

    // And it must not widen the page. `visibility: hidden` leaves the parked
    // panel in layout, so without clipping it extends past the right edge — and
    // a mobile browser answers that by zooming the whole document out to fit,
    // which is measurable here as a layout viewport wider than the device.
    // When that happened the editor was crushed to a 73px strip.
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      page.viewportSize()!.width
    );
  });

  test("opens the settings panel with the post's address and excerpt", async ({
    page,
  }, testInfo) => {
    await open(page, "published");
    await page.getByRole("button", { name: "Post settings" }).click();

    await expect(page.getByLabel("Address")).toHaveValue("ten-conversations");
    await expect(page.getByLabel("Excerpt")).toContainText("");
    await expect(page.getByRole("link", { name: /\/blog\/amara\// })).toBeVisible();
    await shoot(page, testInfo, "panel");

    await page.getByRole("button", { name: "Close post settings" }).click();
    await expect(page.getByLabel("Address")).toBeHidden();
  });

  test("offers formatting over a selection, inside the window", async ({
    page,
  }, testInfo) => {
    await open(page, "draft");
    await selectPhrase(page, "The spreadsheet is the product");

    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(toolbar).toBeVisible();

    // Centred on the selection, but never past the edge: the selection this
    // toolbar belongs to can sit anywhere on the line.
    const box = (await toolbar.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);

    // The phrase is inside a blockquote, so Quote reports itself as applied.
    // Scoped to this toolbar: on a phone the block bar offers a Quote button
    // too, and it is a different control with a different job.
    await expect(
      toolbar.getByRole("button", { name: "Quote" })
    ).toHaveAttribute("aria-pressed", "true");

    await shoot(page, testInfo, "toolbar");
  });

  test("applies a format from the toolbar to the selected text", async ({
    page,
  }) => {
    await open(page, "draft");
    await selectPhrase(page, "Nobody trusts the numbers");

    await page
      .getByRole("toolbar", { name: "Text formatting" })
      .getByRole("button", { name: "Bold" })
      .click();

    await expect(
      page.locator("[data-post-body] strong", {
        hasText: "Nobody trusts the numbers",
      })
    ).toBeVisible();
  });

  test("turns typed Markdown into formatting as you write", async ({ page }) => {
    await open(page, "empty");

    await page.locator("[data-post-body]").click();
    await page.keyboard.type("## A subheading");

    // `##` is a subheading in the editor and an `<h3>` once published: every
    // heading shifts down one so the post title keeps the page's only `<h1>`.
    await expect(
      page.locator("[data-post-body] h2", { hasText: "A subheading" })
    ).toBeVisible();
  });

  test("inserts a block from the gutter menu on an empty line", async ({
    page,
  }, testInfo) => {
    test.skip(
      page.viewportSize()!.width < 1024,
      "The gutter has no room on a phone; the same menu is the bar above the keyboard."
    );
    await open(page, "empty");

    await page.locator("[data-post-body]").click();
    await page.keyboard.type("A first line.");
    await page.keyboard.press("Enter");

    const trigger = page.getByRole("button", { name: "Insert block" }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await shoot(page, testInfo, "block-menu");

    await page.getByRole("menuitem", { name: "Quote" }).click();
    await expect(page.locator("[data-post-body] blockquote")).toBeVisible();
  });

  test("shows the same post as Markdown and brings it back", async ({
    page,
  }, testInfo) => {
    await open(page, "draft");

    await page.getByRole("button", { name: "Edit Markdown" }).click();
    const markdown = page.getByLabel("Post body, as Markdown");
    await expect(markdown).toBeVisible();
    const source = await markdown.inputValue();
    expect(source).toContain("# What we heard");
    expect(source).toContain("> The spreadsheet is the product.");
    await shoot(page, testInfo, "markdown");

    await markdown.fill(`${source}\n\n## Added by hand`);
    await page.getByRole("button", { name: "Edit formatted" }).click();

    // The rich editor re-reads the Markdown on the way back. Without that it
    // would return holding the document it had before the switch and silently
    // discard everything typed in Markdown mode.
    await expect(
      page.locator("[data-post-body] h2", { hasText: "Added by hand" })
    ).toBeVisible();
  });

  test("will not publish a post with no title", async ({ page }) => {
    await open(page, "empty");

    const publish = page.getByRole("button", { name: "Publish" }).first();
    await expect(publish).toBeDisabled();
    await expect(publish).toHaveAttribute("title", /Add a title/);
  });

  test("reports where the post stands rather than what the save is doing", async ({
    page,
  }) => {
    await open(page, "published");
    // A save indicator reading "Draft" on a published post says the opposite of
    // the truth, which is why the two are separate.
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
  });
});
