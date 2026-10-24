import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

export const COMMUNITY_EVIDENCE_DIRECTORY = "test-results/staging-community";
export const COMMUNITY_EVIDENCE_FILES = Object.freeze([
  "desktop-member.png", "desktop-mentor.png", "desktop-scout.png", "desktop-known-profile.png",
  "mobile-member.png", "mobile-mentor.png", "mobile-scout.png", "mobile-known-profile.png", "manifest.json",
]);
const origin = "https://staging.tembotechventures.com";
const roles = ["member", "mentor", "institution"];
const profileDraft = Object.freeze({ headline: "Fictional frontend builder", bio: "Synthetic browser verification profile. I build accessible community library interfaces.", skills: ["React", "Accessibility"], opportunityGoals: "Fictional frontend engineering opportunity" });
const statement = "Synthetic review: I checked the fictional keyboard navigation contribution; this is not a real endorsement.";
const method = "Synthetic walkthrough of the fictional library example";
const source = "https://example.com/fictional-library";

// Only same-run synthetic IDs may reach the fixed browser program. No cookies,
// PATs, DB executor, arbitrary scripts or route inputs are accepted here.
export function assertJourneyScope({ baseUrl, contextsByRole, users }) {
  assert.equal(baseUrl, origin);
  let run;
  for (const role of roles) {
    const match = users?.[role]?.userId?.match(new RegExp(`^ttv-staging-fixture-([a-f0-9]{24})-${role}$`));
    assert.ok(match && contextsByRole?.[role]);
    run ??= match[1];
    assert.equal(match[1], run);
  }
}
export function assertSavedEntry(entry, userId, title) {
  assert.equal(entry?.userId, userId);
  assert.equal(entry?.title, title);
  assert.equal(entry?.description, "Synthetic contribution: I built and tested keyboard navigation for a fictional community library.");
  assert.equal(entry?.evidenceUrl, source);
  assert.equal(entry?.visibility, "institution");
  assert.equal(entry?.occurredAt, "2026-10-24");
  assert.equal(entry?.version, 1);
  assert.ok(typeof entry?.id === "string" && entry.id.length > 0);
}
export function assertSavedConfirmation(entry, mentorId) {
  assert.equal(entry.confirmations?.length, 1);
  const confirmation = entry.confirmations[0];
  assert.equal(confirmation.journeyId, entry.id);
  assert.equal(confirmation.mentorId, mentorId);
  assert.equal(confirmation.mentorRole, "MENTOR");
  assert.equal(confirmation.journeyVersion, entry.version);
  assert.equal(confirmation.statement, statement);
  assert.equal(confirmation.method, method);
}
async function read(context, path) {
  const response = await context.request.get(path, { maxRedirects: 0 });
  assert.equal(response.status(), 200);
  return response.json();
}
async function navigate(page, path) {
  const response = await page.goto(origin + path, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  assert.equal(page.url(), origin + path);
  await page.locator(".discovery-app").waitFor({ state: "visible" });
}
async function capture(page, locator, directory, filename) {
  assert.ok(COMMUNITY_EVIDENCE_FILES.includes(filename));
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok(["/dashboard/community", "/dashboard/mentorship", "/dashboard/discover"].includes(new URL(page.url()).pathname));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await locator.screenshot({ path: join(directory, filename), animations: "disabled" });
}

/** Real browser actions + fresh API readback. Never substitutes mocked responses or model answers.
 * The caller owns protected contexts and run-scoped cleanup. Publish evidence ONLY
 * after its cleanup has succeeded; a passed manifest does not attest cleanup/deploy identity.
 */
export async function verifyStagingCommunityJourney({ baseUrl, contextsByRole, users, evidenceDirectory = COMMUNITY_EVIDENCE_DIRECTORY }) {
  const pages = [];
  let failure;
  let stage = "scope";
  const completed = [];
  // Evidence path is not a workflow input. Reject arbitrary writes/deletes.
  if (evidenceDirectory !== COMMUNITY_EVIDENCE_DIRECTORY) throw new Error("Synthetic community evidence directory rejected.");
  await mkdir(evidenceDirectory, { recursive: true });
  await Promise.all(COMMUNITY_EVIDENCE_FILES.map(file => rm(join(evidenceDirectory, file), { force: true })));
  try {
    assertJourneyScope({ baseUrl, contextsByRole, users });
    stage = "identity";
    for (const role of roles) {
      const own = await read(contextsByRole[role], "/api/community/profile");
      assert.equal(own.profile?.userId, users[role].userId);
      assert.ok(own.profile?.name?.startsWith("Fictional "));
    }
    const memberId = users.member.userId;
    const memberName = (await read(contextsByRole.member, "/api/community/profile")).profile.name;
    const profilePath = `/api/community/profiles/${encodeURIComponent(memberId)}`;
    for (const [viewport, dimensions] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
      const member = await contextsByRole.member.newPage(); pages.push(member);
      const mentor = await contextsByRole.mentor.newPage(); pages.push(mentor);
      const institution = await contextsByRole.institution.newPage(); pages.push(institution);
      for (const page of [member, mentor, institution]) { page.setDefaultTimeout(10000); await page.setViewportSize(dimensions); }
      stage = `${viewport}-profile`;
      await navigate(member, "/dashboard/community");
      await member.getByRole("button", { name: "Edit your profile", exact: true }).click();
      await member.getByLabel("Headline", { exact: true }).fill(profileDraft.headline);
      await member.getByRole("textbox", { name: "About your work", exact: true }).fill(profileDraft.bio);
      await member.getByLabel("Skills (comma-separated)", { exact: true }).fill(profileDraft.skills.join(", "));
      await member.getByRole("textbox", { name: "Opportunity goals", exact: true }).fill(profileDraft.opportunityGoals);
      await member.getByRole("button", { name: "Save profile", exact: true }).click();
      await expect(member.getByText("Profile saved.", { exact: true })).toBeVisible();
      const saved = (await read(contextsByRole.member, "/api/community/profile")).profile;
      for (const key of Object.keys(profileDraft)) assert.deepEqual(saved[key], profileDraft[key]);
      await navigate(member, "/dashboard/community");
      await expect(member.getByText(profileDraft.headline, { exact: true })).toBeVisible();
      stage = `${viewport}-contribution`;
      const title = `Fictional keyboard navigation · ${viewport}`;
      await member.getByRole("button", { name: "Add a contribution", exact: true }).click();
      await member.getByLabel("Entry title", { exact: true }).fill(title);
      await member.getByLabel("Your contribution", { exact: true }).fill("Synthetic contribution: I built and tested keyboard navigation for a fictional community library.");
      await member.getByLabel("Date", { exact: true }).fill("2026-10-24");
      await member.getByLabel("Source link", { exact: true }).fill(source);
      await member.getByRole("button", { name: "Save contribution", exact: true }).click();
      await expect(member.getByText("Your contribution has been saved.", { exact: true })).toBeVisible();
      const own = await read(contextsByRole.member, "/api/community/journey");
      assert.ok(own.entries.every(entry => entry.userId === memberId));
      const entries = own.entries.filter(entry => entry.title === title);
      assert.equal(entries.length, 1);
      const entry = entries[0];
      assertSavedEntry(entry, memberId, title);
      assert.equal(entry.confirmations.length, 0);
      await navigate(member, "/dashboard/community");
      await expect(member.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await capture(member, member.locator(".discovery-app"), evidenceDirectory, `${viewport}-member.png`);
      stage = `${viewport}-confirmation`;
      await navigate(mentor, "/dashboard/mentorship");
      const review = mentor.locator("article").filter({ has: mentor.getByRole("heading", { name: title, exact: true }) });
      await expect(review.getByText(memberName, { exact: true })).toBeVisible();
      stage = `${viewport}-review-form`;
      await review.getByRole("combobox", { name: "Decision", exact: true }).selectOption("confirmed");
      await review.getByLabel("How did you check it?", { exact: true }).fill(method);
      await review.getByLabel("What did you personally check?", { exact: true }).fill(statement);
      await review.getByRole("button", { name: "Save review", exact: true }).click();
      await expect(review.getByText(`Claim confirmed: ${title}`, { exact: true })).toBeVisible();
      const confirmed = (await read(contextsByRole.member, "/api/community/journey")).entries.find(item => item.id === entry.id);
      assertSavedEntry(confirmed, memberId, title);
      assertSavedConfirmation(confirmed, users.mentor.userId);
      await navigate(mentor, "/dashboard/mentorship");
      await expect(review.getByText(statement, { exact: true })).toBeVisible();
      // Crop to this synthetic claim, never capture other members' review cards.
      await capture(mentor, review, evidenceDirectory, `${viewport}-mentor.png`);
      stage = `${viewport}-scout`;
      await navigate(institution, "/dashboard/discover");
      await institution.getByLabel("Skills to explore").fill("React, Accessibility");
      await institution.getByLabel("Already have someone in mind?").fill(memberName);
      await institution.getByRole("button", { name: "Discover people", exact: true }).click();
      await expect(institution.getByRole("heading", { name: "1 builder to get to know", exact: true })).toBeVisible();
      const result = institution.locator(".discovery-person").filter({ has: institution.getByRole("heading", { name: memberName, exact: true }) });
      await result.getByRole("button").click();
      await expect(institution.getByRole("heading", { name: memberName, exact: true })).toBeVisible();
      await expect(institution.getByRole("link", { name: "Open profile link", exact: true })).toHaveAttribute("href", `/dashboard/discover?profile=${encodeURIComponent(memberId)}`);
      const detail = await read(contextsByRole.institution, profilePath);
      assert.equal(detail.profile.userId, memberId);
      assert.ok(detail.entries.every(item => item.userId === memberId && item.visibility === "institution"));
      const retrieved = detail.entries.find(item => item.id === entry.id);
      assertSavedEntry(retrieved, memberId, title);
      assertSavedConfirmation(retrieved, users.mentor.userId);
      const claim = institution.locator(".discovery-timeline li").filter({ has: institution.getByRole("heading", { name: title, exact: true }) });
      await expect(claim.getByText(statement, { exact: true })).toBeVisible();
      await expect(claim.getByRole("link")).toHaveAttribute("href", source);
      await expect(claim.getByText("Role when recorded: Mentor", { exact: true })).toBeVisible();
      await expect(claim.getByText(`How it was checked: ${method}`, { exact: true })).toBeVisible();
      await capture(institution, institution.locator(".discovery-app"), evidenceDirectory, `${viewport}-scout.png`);
      stage = `${viewport}-known-profile`;
      await navigate(institution, "/dashboard/discover");
      await institution.getByRole("button", { name: "Find someone you know", exact: true }).click();
      await institution.getByLabel("Name to look up").fill(memberName);
      await institution.getByRole("button", { name: "Look up person", exact: true }).click();
      await expect(institution.getByRole("heading", { name: "1 builder to get to know", exact: true })).toBeVisible();
      await institution.locator(".discovery-person").filter({ has: institution.getByRole("heading", { name: memberName, exact: true }) }).getByRole("button").click();
      await expect(claim.getByText(statement, { exact: true })).toBeVisible();
      // Establish a no-match filter, then demonstrate the direct link is independent.
      await navigate(institution, "/dashboard/discover");
      await institution.getByLabel("Skills to explore").fill("NonexistentSyntheticSkill");
      await institution.getByRole("button", { name: "Discover people", exact: true }).click();
      await expect(institution.getByText("No profiles match those filters yet.", { exact: true })).toBeVisible();
      await navigate(institution, `/dashboard/discover?profile=${encodeURIComponent(memberId)}`);
      await expect(institution.getByRole("heading", { name: memberName, exact: true })).toBeVisible();
      await expect(claim.getByText(statement, { exact: true })).toBeVisible();
      await capture(institution, institution.locator(".discovery-app"), evidenceDirectory, `${viewport}-known-profile.png`);
      completed.push(viewport);
    }
  } catch {
    failure = true;
  } finally {
    const closed = await Promise.allSettled(pages.map(page => page.close()));
    if (closed.some(result => result.status === "rejected")) { failure = true; stage = "page-cleanup"; }
    if (failure) await Promise.all(COMMUNITY_EVIDENCE_FILES.filter(file => file.endsWith(".png")).map(file => rm(join(evidenceDirectory, file), { force: true })));
    await writeFile(join(evidenceDirectory, "manifest.json"), JSON.stringify({ schemaVersion: 1, synthetic: true, verification: "browser-actions-and-api-readback", status: failure ? "failed" : "passed", completedViewports: completed, failureStage: failure ? stage : null, modelCalls: "not-tested", cleanup: "caller-must-verify-before-publication" }, null, 2) + "\n");
  }
  if (failure) throw new Error("Synthetic community journey failed; inspect sanitized manifest.");
}
