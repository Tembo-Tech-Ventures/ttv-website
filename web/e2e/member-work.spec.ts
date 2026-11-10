import { expect, test } from "@playwright/test";
import { personaSession, signIn } from "./platform-personas";

test("posted work is shared with members while drafts remain author-only", async ({ browser, baseURL }) => {
  const owner = personaSession("community"),
    reader = personaSession("alumna");
  test.skip(typeof owner === "string" || typeof reader === "string", "Requires isolated synthetic persona sessions.");
  if (typeof owner === "string" || typeof reader === "string") return;
  const own = await browser.newContext(),
    other = await browser.newContext();
  let workId: string | undefined;
  const headers = { Origin: baseURL! };
  try {
    await signIn(own, baseURL!, owner);
    await signIn(other, baseURL!, reader);
    const ownProfile = await own.request.get(`${baseURL}/api/community/profile`);
    expect(ownProfile.ok()).toBe(true);
    const { profile } = await ownProfile.json();
    if (!profile.version) {
      const saved = await own.request.put(`${baseURL}/api/community/profile`, {
        headers,
        data: {
          headline: "Fictional preview builder",
          bio: "I build and test tools.",
          skills: ["SQL"],
          opportunityGoals: "Collaborate",
        },
      });
      expect(saved.ok()).toBe(true);
    }
    const created = await own.request.post(`${baseURL}/api/community/journey`, {
      headers,
      data: {
        title: `Fictional work check ${test.info().project.name} ${Date.now()}`,
        description: "Built and tested a fictional fare calculator.",
        occurredAt: "2026-11-09",
        status: "draft",
      },
    });
    expect(created.status()).toBe(201);
    const { entry } = await created.json();
    workId = entry.id;
    expect(entry.status).toBe("draft");
    expect(entry).not.toHaveProperty("visibility");
    const shared = async () => {
      const response = await other.request.get(`${baseURL}/api/community/profiles/${profile.userId}`);
      expect(response.ok()).toBe(true);
      return (await response.json()).entries as {
        id: string;
        status: string;
      }[];
    };
    expect((await shared()).some((item) => item.id === workId)).toBe(false);
    const posted = await own.request.patch(`${baseURL}/api/community/journey/${workId}`, {
      headers,
      data: { status: "posted" },
    });
    expect(posted.ok()).toBe(true);
    expect((await shared()).find((item) => item.id === workId)).toMatchObject({
      status: "posted",
    });
    const page = await own.newPage();
    // The one place work is posted: the profile editor's work form, which asks post or draft, never "visibility".
    await page.goto(`${baseURL}/dashboard/me/portfolio?add=1`);
    const form = page.locator("[data-work-editor='add']");
    await expect(form.locator('[name="status"]')).toHaveCount(2);
    await expect(form.locator('[name="visibility"]')).toHaveCount(0);
  } finally {
    if (workId)
      expect((await own.request.delete(`${baseURL}/api/community/journey/${workId}`, { headers })).ok()).toBe(true);
    await own.close();
    await other.close();
  }
});
