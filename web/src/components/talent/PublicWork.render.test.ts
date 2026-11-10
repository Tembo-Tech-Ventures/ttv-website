import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, expect, it } from "vitest";
import PublicWork from "./PublicWork.astro";
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const work = {
  title: "Community workshop",
  kind: "contribution",
  description: "Built and taught a workshop",
  evidenceUrl: null,
  topics: null,
  language: null,
  stars: 0,
  blurb: null,
  pushedAt: null,
  version: 2,
  confirmations: [],
};
it.each([null, "https://example.test/workshop"])(
  "renders posted contribution with optional evidence %s",
  async (evidenceUrl) => {
    const html = await container.renderToString(PublicWork, {
      props: { work: { ...work, evidenceUrl } },
    });
    expect(html).toContain(work.title);
    expect(html).toContain(work.description);
    if (evidenceUrl) expect(html).toContain(`href="${evidenceUrl}"`);
    else expect(html).not.toContain("<a");
  },
);
it("distinguishes current mentor confirmation from author blurb and omits stale confirmations", async () => {
  const html = await container.renderToString(PublicWork, {
    props: {
      work: {
        ...work,
        blurb: "My own account",
        confirmations: [
          {
            journeyVersion: 2,
            statement: "Saw the workshop",
            method: "Live review",
            mentor: { name: "Synthetic Mentor" },
          },
          {
            journeyVersion: 1,
            statement: "Old evidence",
            method: "Code review",
            mentor: { name: "Old Mentor" },
          },
        ],
      },
    },
  });
  expect(html).toContain("Confirmed by Synthetic Mentor");
  expect(html).toContain('data-confirmation="current"');
  expect(html).toContain("My own account");
  expect(html).not.toContain("Old evidence");
});
