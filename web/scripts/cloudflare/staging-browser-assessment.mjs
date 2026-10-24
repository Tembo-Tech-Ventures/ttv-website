import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const model = "workers-ai/@cf/google/gemma-4-26b-a4b-it";
export function validateBrowserAssessment(payload, memberId, entries, profileVersion) {
  const { assessment: a, probe } = payload ?? {};
  assert.equal(a?.status, "completed");
  assert.equal(a.model, model);
  assert.equal(a.subject.userId, memberId);
  if (profileVersion !== undefined) assert.equal(a.subject.profileVersion, profileVersion);
  assert.equal(probe?.claimed, true);
  for (const key of ["payloadBytes", "payloadCharacters"]) assert.ok(Number.isInteger(probe[key]) && probe[key] > 0 && probe[key] <= 8000);
  assert.equal(a.criteria.length, 1);
  const criterion = a.criteria[0];
  assert.equal(criterion.criterionId, "criterion-1");
  assert.equal(criterion.status, "assessed");
  assert.ok(Number.isInteger(criterion.rating) && criterion.rating >= 1 && criterion.rating <= 5);
  assert.ok(criterion.citations.length > 0);
  for (const citation of criterion.citations) {
    assert.equal(citation.userId, memberId);
    assert.ok(citation.kind === "profile" && citation.id === memberId && citation.version === profileVersion || entries.some(entry => citation.kind === "journey" && citation.id === entry.id && citation.version === entry.version ||
      citation.kind === "confirmation" && entry.confirmations.some(c => citation.id === c.id && citation.version === c.journeyVersion)));
  }
  assert.ok(criterion.citations.some(c => c.kind === "journey" || c.kind === "confirmation"));
  return { rating: criterion.rating, citationCount: criterion.citations.length };
}

/** Called once, after both browser journeys: the existing atomic claim consumes this session. */
export async function verifyBrowserAssessment({ page, context, memberId, entries, profileVersion }) {
  const path = `/api/community/profiles/${memberId}/assessment`;
  await page.getByLabel("Criterion 1", { exact: true }).fill("Documented keyboard navigation contribution");
  await page.getByLabel("Supporting terms 1", { exact: true }).fill("keyboard navigation");
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST", { timeout: 25000 });
  const [response] = await Promise.all([responsePromise, page.getByRole("button", { name: "Assess evidence", exact: true }).click()]);
  assert.equal(response.status(), 200);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 64000);
  const result = validateBrowserAssessment(JSON.parse(text), memberId, entries, profileVersion);
  const rendered = page.locator('.discovery-assessment-results');
  await expect(rendered.getByText(`Evidence support ${result.rating}/5`, { exact: true })).toBeVisible();
  await expect(rendered.getByText("AI-generated evidence support", { exact: true })).toBeVisible();
  const citations = rendered.getByRole("list", { name: "Sources for Documented keyboard navigation contribution", exact: true });
  await expect(citations.locator("li")).toHaveCount(result.citationCount);
  await expect(citations.getByRole("link").first()).toHaveAttribute("href", "https://example.com/fictional-library");
  const consumed = await context.request.get(`/api/community/profiles/${memberId}`, { maxRedirects: 0 });
  assert.ok([401, 403].includes(consumed.status()));
  return result;
}
