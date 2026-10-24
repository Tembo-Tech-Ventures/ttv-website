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
  await page.getByRole("button", { name: "Explore Amina's work" }).click();
  await expect(
    page.getByRole("heading", { name: "Amina Wanjiku", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Checked by Grace Njeri")).toBeVisible();
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
  await page.getByLabel("Source link").fill("https://example.com/walkthrough");
  await page.getByRole("button", { name: "Save contribution" }).click();
  await expect(
    page.getByRole("heading", { name: "Accessible library search" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Demo entry added");
  await expect(
    page.getByRole("link", { name: /Supporting work/ }),
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
      "I reviewed the borrowing flow and checked its keyboard navigation with Amina.",
    );
  await page
    .getByLabel("How did you check it?")
    .fill("Reviewed the code and tested keyboard navigation together.");
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
  await page
    .getByLabel("How did you check it?")
    .fill("Reviewed the code and tested keyboard navigation together.");
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

test("role-gated workspace refuses discovery before loading member data (mock API)", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route("**/api/community/**", async (route) => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      json: { isAdmin: false, isMentor: false, isInstitution: false },
    });
  });
  await page.goto("/dev/community-ui?api=mock&view=scout");
  await expect(
    page.getByRole("heading", { name: "Institutional access needs approval." }),
  ).toBeVisible();
  expect(calls).toEqual(["/api/community/access"]);
  await expect(
    page.getByRole("button", { name: "Discover people", exact: true }),
  ).toHaveCount(0);
});

test("institution search loads real component API contracts and recovers from chat failure (mock API)", async ({
  page,
}) => {
  const profile = {
    userId: "fictional-member",
    name: "Fictional Builder",
    image: null,
    headline: "Community tools",
    bio: "Building libraries",
    skills: ["React"],
    opportunityGoals: "An apprenticeship",
    version: 1,
    updatedAt: 123,
  };
  let search = "";
  let chatFailed = false;
  await page.route("**/api/community/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/access"))
      return route.fulfill({
        json: { isAdmin: false, isMentor: false, isInstitution: true },
      });
    if (url.pathname.endsWith("/profiles")) {
      search = url.search;
      return route.fulfill({ json: { profiles: [profile] } });
    }
    if (url.pathname.endsWith("/fictional-member"))
      return route.fulfill({ json: { profile, entries: [] } });
    if (!chatFailed) {
      chatFailed = true;
      return route.fulfill({
        status: 503,
        json: { error: "private gateway detail" },
      });
    }
    return route.fulfill({
      json: {
        answer: "Ask about their community tools.",
        grounded: true,
        aiGenerated: true,
        limited: false,
        citations: [
          {
            kind: "profile",
            id: profile.userId,
            userId: profile.userId,
            version: 1,
          },
        ],
      },
    });
  });
  await page.goto("/dev/community-ui?api=mock&view=scout");
  await page.getByLabel("Skills to explore").fill("Rust");
  await page.getByRole("button", { name: "Find someone you know" }).click();
  await page.getByLabel("Name to look up").fill("Fictional");
  await page
    .getByRole("button", { name: "Look up person", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 builder to get to know" }),
  ).toBeVisible();
  expect(new URLSearchParams(search).get("skills") ?? "").toBe("");
  expect(new URLSearchParams(search).get("query")).toBe("Fictional");
  await page.getByRole("button", { name: "Scout by criteria" }).click();
  await page.getByLabel("Skills to explore").fill("React");
  await page
    .getByRole("button", { name: "Discover people", exact: true })
    .click();
  expect(new URLSearchParams(search).get("skills")).toBe("React");
  await page.getByRole("button", { name: "Explore Fictional's work" }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional Builder", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your question").fill("What should I ask next?");
  await page
    .getByRole("button", { name: "Explore evidence", exact: true })
    .click();
  await expect(page.getByRole("alert")).not.toContainText(
    "private gateway detail",
  );
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue(
    "What should I ask next?",
  );
  await page
    .getByRole("button", { name: "Explore evidence", exact: true })
    .click();
  await expect(
    page.getByText("Ask about their community tools."),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Cited community evidence" }),
  ).toContainText("Community profile · Revision 1");
});

test("mentor revision conflict preserves the review and requires a refresh (mock API)", async ({
  page,
}) => {
  let submitted: unknown;
  await page.route("**/api/community/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/access"))
      return route.fulfill({
        json: { isAdmin: false, isMentor: true, isInstitution: false },
      });
    if (path.endsWith("/mentorship"))
      return route.fulfill({
        json: {
          entries: [
            {
              id: "entry",
              userId: "member",
              memberName: "Fictional Builder",
              title: "Library contribution",
              description: "Built the library search with keyboard support",
              occurredAt: "2026-10-24",
              visibility: "institution",
              version: 3,
              evidenceUrl: null,
              confirmations: [],
            },
          ],
        },
      });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 409, json: { error: "revision changed" } });
  });
  await page.goto("/dev/community-ui?api=mock&view=mentor");
  await page
    .getByRole("combobox", { name: "Decision", exact: true })
    .selectOption("confirmed");
  await page
    .getByLabel("What did you personally check?")
    .fill("Reviewed the keyboard navigation and search flow.");
  await page.getByLabel("How did you check it?").fill("Paired code review");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  expect(submitted).toMatchObject({
    expectedRevision: 3,
    method: "Paired code review",
  });
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(page.getByLabel("What did you personally check?")).toHaveValue(
    "Reviewed the keyboard navigation and search flow.",
  );
});

test("TTV palette keeps text and form controls readable across workspace surfaces", async ({
  page,
}) => {
  await page.goto("/dev/community-ui");
  await expect(page.locator(".discovery-app")).toHaveCSS(
    "background-color",
    "rgb(1, 61, 57)",
  );
  await expect(
    page.getByRole("button", { name: "Discover people", exact: true }),
  ).toHaveCSS("background-color", "rgb(242, 141, 104)");
  for (const selector of [
    ".discovery-page-heading h1",
    ".discovery-page-heading > p",
    ".discovery-editorial p",
    ".discovery-field input",
    ".discovery-button",
  ]) {
    const contrast = await page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const rgb = (color: string) =>
          color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        const luminance = (color: string) =>
          rgb(color)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, value, index) =>
                sum + value * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        let surface: Element | null = element;
        while (
          surface &&
          getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)"
        )
          surface = surface.parentElement;
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(
          getComputedStyle(surface!).backgroundColor,
        );
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByLabel("Skills to explore").focus();
  await expect(page.getByLabel("Skills to explore")).toHaveCSS(
    "outline-style",
    "solid",
  );
});

test("known-person lookup ignores scouting filters and restores them on return", async ({
  page,
}) => {
  await page.goto("/dev/community-ui");
  await page.getByLabel("Skills to explore").fill("Rust");
  await page
    .getByLabel("What are you working on?")
    .fill("A separate opportunity");
  await page.getByRole("button", { name: "Find someone you know" }).click();
  await page.getByLabel("Name to look up").fill("Amina");
  await page
    .getByRole("button", { name: "Look up person", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 builder to get to know" }),
  ).toBeVisible();
  await expect(page.getByText("Your opportunity", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Explore Amina's work" }).click();
  await expect(
    page.getByRole("heading", { name: "Amina Wanjiku", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to people" }).click();
  await page.getByRole("button", { name: "Scout by criteria" }).click();
  await expect(page.getByLabel("Skills to explore")).toHaveValue("Rust");
  await expect(page.getByLabel("What are you working on?")).toHaveValue(
    "A separate opportunity",
  );
});

test("profile deep link checks access first and safely handles missing profiles", async ({
  page,
}) => {
  let approved = false;
  let deniedStatus = 0;
  let detailRequests = 0;
  await page.route("**/api/community/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/access"))
      return route.fulfill({
        json: { isAdmin: false, isMentor: false, isInstitution: approved },
      });
    expect(new URL(route.request().url()).pathname).not.toBe(
      "/api/community/profiles",
    );
    detailRequests++;
    if (deniedStatus)
      return route.fulfill({
        status: deniedStatus,
        json: { error: "private detail" },
      });
    return route.fulfill({
      json: {
        profile: {
          userId: "synthetic-lookup",
          name: "Fictional Njeri Kamau",
          image: null,
          headline: "Community tools",
          bio: "A fictional test profile",
          skills: [],
          opportunityGoals: "Learning",
          version: 1,
          updatedAt: 123,
        },
        entries: [],
      },
    });
  });
  await page.goto(
    "/dev/community-ui?api=mock&view=scout&profile=synthetic-lookup",
  );
  await expect(
    page.getByRole("heading", { name: "Institutional access needs approval." }),
  ).toBeVisible();
  expect(detailRequests).toBe(0);
  approved = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Fictional Njeri Kamau", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open profile link" }),
  ).toHaveAttribute("href", "/dashboard/discover?profile=synthetic-lookup");
  expect(detailRequests).toBe(1);
  await page.getByLabel("Your question").fill("An unsent question about Njeri");
  for (const status of [403, 404]) {
    deniedStatus = status;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "We could not open this workspace." }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText("private detail");
    await expect(
      page.getByRole("link", { name: "Start a new discovery" }),
    ).toHaveAttribute("href", "/dashboard/discover");
    await expect(page.getByLabel("Your question")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Fictional Njeri Kamau", exact: true }),
    ).toHaveCount(0);
  }
});

test("changing a profile link discards the prior question and encodes unusual IDs", async ({
  page,
}) => {
  let detailPath = "";
  await page.route("**/api/community/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/access"))
      return route.fulfill({
        json: { isAdmin: false, isMentor: false, isInstitution: true },
      });
    detailPath = path;
    const id = decodeURIComponent(path.split("/").at(-1)!);
    return route.fulfill({
      json: {
        profile: {
          userId: id,
          name: id === "first" ? "Fictional Amina" : "Fictional Brian",
          image: null,
          headline: "Synthetic profile",
          bio: "Fictional evidence only",
          skills: [],
          opportunityGoals: "Learning",
          version: 1,
          updatedAt: 123,
        },
        entries: [],
      },
    });
  });
  await page.goto("/dev/community-ui?api=mock&view=scout&profile=first");
  await page.getByLabel("Your question").fill("Question about Amina only");
  await page.goto(
    "/dev/community-ui?api=mock&view=scout&profile=" +
      encodeURIComponent("second/with?delimiter"),
  );
  await expect(
    page.getByRole("heading", { name: "Fictional Brian", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Fictional Amina", exact: true }),
  ).toHaveCount(0);
  expect(detailPath).toBe("/api/community/profiles/second%2Fwith%3Fdelimiter");
});
