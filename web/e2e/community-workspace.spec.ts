import { expect, test } from "@playwright/test";

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "Labelled fixture route is dev-only; live personas need authorized services.",
);

test("scout a person, inspect claims and sources, and explore evidence", async ({
  page,
}, testInfo) => {
  await page.goto("/dev/community-ui");
  await expect(
    page.getByRole("heading", { name: "Find the person. See the work." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/evidence/community/${testInfo.project.name}-scout.png`,
    fullPage: true,
  });
  await page.getByLabel("Skills to explore").fill("React, Accessibility");
  await page
    .getByRole("button", { name: "Discover people", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 builder to get to know" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore Amara's work" }).click();
  await expect(
    page.getByRole("heading", { name: "Amara Okafor", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Checked by Jules Martin")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Library project walkthrough/ }),
  ).toHaveAttribute("href", "https://example.com/library-demo");
  await page
    .getByRole("button", { name: "What should I ask them next?" })
    .click();
  await page
    .getByRole("button", { name: "Explore evidence", exact: true })
    .click();
  await expect(page.getByText("Sample answer · demo")).toBeVisible();
  await expect(page.getByText(/does not establish quality/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/evidence/community/${testInfo.project.name}-profile.png`,
    fullPage: true,
  });
});

test("no-match searches can be revised without losing the criteria", async ({
  page,
}) => {
  await page.goto("/dev/community-ui");
  await page.getByLabel("Skills to explore").fill("Rust");
  await page
    .getByRole("button", { name: "Discover people", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No profiles match those filters yet." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Adjust your search" }).click();
  await expect(page.getByLabel("Skills to explore")).toHaveValue("Rust");
});

test("add a contribution with evidence and show its unconfirmed provenance", async ({
  page,
}, testInfo) => {
  await page.goto("/dev/community-ui?view=journey");
  await page.getByRole("button", { name: "Add a contribution" }).click();
  await page.getByLabel("Entry title").fill("Accessible library search");
  await page
    .getByLabel("Your contribution", { exact: true })
    .fill(
      "I built and tested keyboard navigation for the community library search.",
    );
  await page.getByLabel("Date", { exact: true }).fill("2026-10-24");
  await page.getByLabel("Source title").fill("My walkthrough");
  await page.getByLabel("Source link").fill("https://example.com/walkthrough");
  await page.getByRole("button", { name: "Save contribution" }).click();
  await expect(
    page.getByRole("heading", { name: "Accessible library search" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Demo entry added");
  await expect(
    page.getByRole("link", { name: /My walkthrough/ }),
  ).toHaveAttribute("href", "https://example.com/walkthrough");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/evidence/community/${testInfo.project.name}-journey.png`,
    fullPage: true,
  });
});

test("save failure preserves a member's contribution", async ({ page }) => {
  await page.goto("/dev/community-ui?view=journey&fail=1");
  await page.getByRole("button", { name: "Add a contribution" }).click();
  await page.getByLabel("Entry title").fill("My saved draft");
  await page
    .getByLabel("Your contribution", { exact: true })
    .fill("A meaningful description of my contribution to the project.");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-24");
  await page.getByRole("button", { name: "Save contribution" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your draft is still here",
  );
  await expect(page.getByLabel("Entry title")).toHaveValue("My saved draft");
});

test("mentor confirms the reviewed claim with a personal note", async ({
  page,
}, testInfo) => {
  await page.goto("/dev/community-ui?view=mentor");
  await page
    .getByRole("combobox", { name: "Decision", exact: true })
    .selectOption("confirmed");
  await page
    .getByLabel("What did you personally check?")
    .fill(
      "I reviewed the borrowing flow and checked its keyboard navigation with Amara.",
    );
  await page.getByRole("button", { name: "Save demo review" }).click();
  await expect(page.locator("output")).toContainText(
    "Claim confirmed: Made a community library easier to use",
  );
  await expect(page.getByLabel("What did you personally check?")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/evidence/community/${testInfo.project.name}-mentor.png`,
    fullPage: true,
  });
});

test("mentor save failure preserves the note for retry", async ({ page }) => {
  await page.goto("/dev/community-ui?view=mentor&fail=1");
  await page
    .getByRole("combobox", { name: "Decision", exact: true })
    .selectOption("confirmed");
  const note =
    "I personally reviewed the implementation and its keyboard navigation.";
  await page.getByLabel("What did you personally check?").fill(note);
  await page.getByRole("button", { name: "Save demo review" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(page.getByLabel("What did you personally check?")).toHaveValue(
    note,
  );
  await expect(
    page.getByRole("button", { name: "Save demo review" }),
  ).toBeEnabled();
});

test("member can edit profile and see updated opportunity goals", async ({
  page,
}) => {
  await page.goto("/dev/community-ui?view=journey");
  await page.getByRole("button", { name: "Edit your profile" }).click();
  await page
    .getByLabel("Headline", { exact: true })
    .fill("Building accessible community tools");
  await page.getByLabel("Opportunity goals").fill("A frontend apprenticeship");
  await page.getByRole("button", { name: "Save demo profile" }).click();
  await expect(
    page.getByText("Demo profile saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary")
      .getByText("A frontend apprenticeship", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close profile editor" }).click();
  await expect(
    page.getByText("Building accessible community tools", { exact: true }),
  ).toBeVisible();
});

test("profile failure keeps edited text available", async ({ page }) => {
  await page.goto("/dev/community-ui?view=journey&fail=1");
  await page.getByRole("button", { name: "Edit your profile" }).click();
  await page.getByLabel("Headline", { exact: true }).fill("My new headline");
  await page.getByRole("button", { name: "Save demo profile" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue(
    "My new headline",
  );
});
