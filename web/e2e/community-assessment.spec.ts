import { expect, test } from "@playwright/test";

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "Component harness with fictional API responses; not live evidence.",
);

for (const mode of [
  "completed",
  "unavailable",
  "invalid_output",
  "forbidden",
] as const) {
  test(`explicit evidence assessment: ${mode}`, async ({ page }, testInfo) => {
    const requests: {
      version: number;
      criteria: { id: string; label: string; terms: string[] }[];
    }[] = [];
    await page.route("**/api/community/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/assessment")) {
        const rubric = route.request().postDataJSON();
        requests.push(rubric);
        if (mode === "forbidden")
          return route.fulfill({ status: 403, json: { error: "Forbidden" } });
        return route.fulfill({
          json: {
            assessment: {
              status: mode,
              method: "model-evidence-support-v1",
              model: "fictional-test-model",
              rubric: { id: rubric.id, version: rubric.version },
              subject: { userId: "fictional-member", profileVersion: 2 },
              disclaimer: "Synthetic evidence response",
              ...(mode !== "completed"
                ? {
                    errorCode:
                      mode === "unavailable"
                        ? "provider_unavailable"
                        : "invalid_output",
                  }
                : {}),
              criteria:
                mode !== "completed"
                  ? []
                  : rubric.criteria.map(
                      (
                        criterion: { id: string; label: string },
                        index: number,
                      ) => ({
                        criterionId: criterion.id,
                        label: criterion.label,
                        status: index === 0 ? "assessed" : "insufficient",
                        rating: index === 0 ? 1 : null,
                        explanation:
                          index === 0
                            ? "A limited example is documented."
                            : "No supporting material is documented for this criterion.",
                        citations:
                          index === 0
                            ? [
                                {
                                  kind: "journey",
                                  id: "fictional-entry",
                                  userId: "fictional-member",
                                  version: 3,
                                  url: "https://untrusted.example/ignored",
                                },
                              ]
                            : [],
                      }),
                    ),
            },
          },
        });
      }
      if (path.endsWith("/access"))
        return route.fulfill({
          json: { isAdmin: false, isMentor: false, isInstitution: true },
        });
      return route.fulfill({
        json: {
          profile: {
            userId: "fictional-member",
            name: "Amina Wanjiku",
            image: null,
            headline: "Fictional community builder",
            bio: "Synthetic browser fixture",
            skills: ["Accessibility"],
            opportunityGoals: "Build useful tools",
            version: 2,
            updatedAt: null,
          },
          entries: [
            {
              id: "fictional-entry",
              userId: "fictional-member",
              title: "Library navigation",
              description: "Built keyboard navigation",
              occurredAt: "2026-10-24",
              visibility: "institution",
              version: 3,
              evidenceUrl: "https://example.com/library",
              confirmations: [],
            },
          ],
        },
      });
    });
    await page.goto("/dev/community-ui?api=mock&profile=fictional-member");
    await page
      .getByLabel("Criterion 1", { exact: true })
      .fill("Accessible interfaces");
    await page
      .getByLabel("Supporting terms 1", { exact: true })
      .fill("keyboard navigation, accessibility");
    await page
      .getByRole("button", { name: "Add criterion", exact: true })
      .click();
    await page
      .getByLabel("Criterion 2", { exact: true })
      .fill("Distributed systems");
    await page
      .getByLabel("Supporting terms 2", { exact: true })
      .fill("distributed systems");
    expect(requests).toHaveLength(0);
    await page
      .getByRole("button", { name: "Assess evidence", exact: true })
      .click();
    if (mode === "completed") {
      const output = page.getByLabel("Evidence assessment results");
      await expect(
        output.getByText("Evidence support 1/5", { exact: true }),
      ).toBeVisible();
      await expect(
        output.getByText("Insufficient evidence · Not scored", { exact: true }),
      ).toBeVisible();
      await expect(
        output.getByRole("link", { name: "Supporting work" }),
      ).toHaveAttribute("href", "https://example.com/library");
      await expect(
        output.getByText(/Library navigation · Revision 3/),
      ).toBeVisible();
      await expect(page.locator('a[href*="untrusted.example"]')).toHaveCount(0);
      await page.screenshot({
        path: `test-results/evidence/community/${testInfo.project.name}-assessment.png`,
        fullPage: true,
      });
      await page
        .getByLabel("Criterion 1", { exact: true })
        .fill("Updated criterion");
      await expect(output).toHaveCount(0);
      expect(requests).toHaveLength(1);
    } else if (mode === "forbidden") {
      await expect(page.getByRole("alert")).toContainText(
        "does not have access",
      );
      await expect(page.getByLabel("Criterion 1", { exact: true })).toHaveValue(
        "Accessible interfaces",
      );
    } else {
      await expect(page.getByRole("status")).toContainText(
        "No evidence ratings were produced",
      );
      await expect(
        page.getByText("Insufficient evidence · Not scored", { exact: true }),
      ).toHaveCount(0);
    }
    expect(requests).toHaveLength(1);
    expect(requests[0].criteria[0].terms).toEqual([
      "keyboard navigation",
      "accessibility",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
