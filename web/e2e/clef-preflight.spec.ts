import { expect, test } from "@playwright/test";

test.describe("Clef preflight", () => {
  const token = process.env.PLAYWRIGHT_AGENT_TOKEN;
  test.skip(!token, "No agent bearer token is configured for this environment.");
  test.use({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  test("runs clef-flash through the preview AI binding", async ({ request }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
    expect(baseUrl).toBeTruthy();

    const response = await request.post("/api/admin/clef-preflight", {
      headers: { Origin: baseUrl! },
    });
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({
      valid: true,
      model: expect.any(String),
      answerType: "noul",
      probabilityIsUnitInterval: true,
      hasUsage: true,
    });
  });
});
