import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export function validateBrowserChat(payload, memberId, entries, profileVersion) {
  assert.equal(payload?.grounded, true);
  assert.equal(payload.aiGenerated, true);
  assert.equal(payload.limited, false);
  assert.equal(payload.error, null);
  assert.ok(typeof payload.answer === "string" && payload.answer.length > 0 && payload.answer.length <= 12000);
  assert.deepEqual(payload.assessments, []);
  const execution = payload.execution;
  assert.equal(execution?.model, "@cf/zai-org/glm-5.3-flash");
  assert.ok(Number.isInteger(execution.modelSteps) && execution.modelSteps >= 1 && execution.modelSteps <= 3);
  assert.ok(Number.isInteger(execution.executedToolCalls) && execution.executedToolCalls >= 1 && execution.executedToolCalls <= 6);
  assert.ok(Array.isArray(payload.citations) && payload.citations.length > 0 && payload.citations.length <= 30);
  for (const citation of payload.citations) {
    assert.equal(citation.userId, memberId);
    assert.ok(citation.kind === "profile" && citation.id === memberId && citation.version === profileVersion || entries.some(entry =>
      citation.kind === "journey" && citation.id === entry.id && citation.version === entry.version ||
      citation.kind === "confirmation" && entry.confirmations.some(c => citation.id === c.id && citation.version === c.journeyVersion)));
  }
  assert.ok(payload.citations.some(c => c.kind === "journey" || c.kind === "confirmation"));
  return { model: execution.model, modelSteps: execution.modelSteps, executedToolCalls: execution.executedToolCalls, citationCount: payload.citations.length };
}

// One UI submission, no retries or rubric assessment. The caller cleans all fixture records.
export async function verifyBrowserChat({ page, memberId, entries, profileVersion }) {
  await page.getByLabel("Your question", { exact: true }).fill("Use your get_selected_profile tool to retrieve the current documented contributions and mentor confirmations. Why should I interview this fictional person for keyboard navigation work? Cite the supporting contribution and explain what remains unknown. Do not rate or assess criteria.");
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/community/chat" && response.request().method() === "POST", { timeout: 70000 });
  const [response] = await Promise.all([responsePromise, page.getByRole("button", { name: "Explore evidence", exact: true }).click()]);
  assert.equal(response.status(), 200);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 64000);
  const payload = JSON.parse(text);
  const result = validateBrowserChat(payload, memberId, entries, profileVersion);
  const rendered = page.locator(".discovery-answer");
  await expect(rendered.getByText("Evidence response", { exact: true })).toBeVisible();
  await expect(rendered.locator("p").first()).toHaveText(payload.answer);
  await expect(rendered.getByRole("list", { name: "Cited community evidence", exact: true }).locator("li")).toHaveCount(result.citationCount);
  await expect(rendered.getByRole("link").first()).toHaveAttribute("href", "https://example.com/fictional-library");
  return result;
}
