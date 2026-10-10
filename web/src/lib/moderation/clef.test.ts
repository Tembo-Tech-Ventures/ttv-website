import { describe, expect, it, vi } from "vitest";
import {
  CLEF_PROFILE_MODEL,
  PROFILE_MODERATION_THRESHOLDS,
  checkProfileContent,
  previewProfileModerationResult,
  profileModerationMessages,
  type ProfileModerationState,
} from "./clef";

const state: ProfileModerationState = {
  displayName: "Amina Builder",
  handle: "amina",
  headline: "Builder",
  bio: "I build useful software.",
  location: "Nairobi",
  country: "Kenya",
  skills: ["TypeScript"],
  githubLogin: "amina",
  portfolioUrl: "https://example.com",
  linkedinUrl: null,
};

function response(scores: Record<string, number>) {
  return {
    model: "clef-flash",
    answers: Object.fromEntries(
      Object.entries(scores).map(([key, noul]) => [
        key,
        { type: "noul", noul },
      ]),
    ),
    usage: { input_tokens: 100, output_tokens: 4 },
  };
}

const clearScores = {
  contains_contact_details: 0.1,
  abusive_or_sexual: 0.05,
  promotes_unrelated_business: 0.2,
  impersonation_risk: 0.1,
};

function aiReturning(value: unknown) {
  return { run: vi.fn().mockResolvedValue(value) } as unknown as Pick<
    Ai,
    "run"
  >;
}

describe("checkProfileContent", () => {
  it("passes clear content and uses the documented binding schema", async () => {
    const ai = aiReturning(response(clearScores));

    await expect(
      checkProfileContent(ai, state, { gatewayName: "ttv-ai" }),
    ).resolves.toEqual({ outcome: "pass", flags: [], scores: clearScores });
    expect(ai.run).toHaveBeenCalledWith(
      CLEF_PROFILE_MODEL,
      expect.objectContaining({
        model: "clef-flash",
        state,
        questions: expect.objectContaining({
          contains_contact_details: expect.objectContaining({ type: "noul" }),
        }),
      }),
      { gateway: { id: "ttv-ai", collectLog: false } },
    );
  });

  it("embeds the avatar using Clef's documented images array", async () => {
    const ai = aiReturning(response(clearScores));
    const avatarImage = "data:image/webp;base64,AQID";

    await expect(
      checkProfileContent(ai, state, {
        gatewayName: "ttv-ai",
        loadAvatarImage: () => Promise.resolve(avatarImage),
      }),
    ).resolves.toMatchObject({ outcome: "pass" });
    expect(ai.run).toHaveBeenCalledWith(
      CLEF_PROFILE_MODEL,
      expect.objectContaining({ images: [avatarImage] }),
      { gateway: { id: "ttv-ai", collectLog: false } },
    );
  });

  it("fails open when an avatar cannot be loaded", async () => {
    const ai = aiReturning(response(clearScores));
    await expect(
      checkProfileContent(ai, state, {
        gatewayName: "ttv-ai",
        loadAvatarImage: () => Promise.reject(new Error("avatar unavailable")),
      }),
    ).resolves.toEqual({ outcome: "error", flags: [], scores: {} });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("holds content at a question's threshold and returns fixed flags", async () => {
    const scores = {
      ...clearScores,
      contains_contact_details:
        PROFILE_MODERATION_THRESHOLDS.contains_contact_details,
      impersonation_risk: 0.95,
    };

    await expect(
      checkProfileContent(aiReturning(response(scores)), state, {
        gatewayName: "ttv-ai",
      }),
    ).resolves.toEqual({
      outcome: "hold",
      flags: ["contains_contact_details", "impersonation_risk"],
      scores,
    });
    expect(profileModerationMessages(["contains_contact_details"])[0]).toMatch(
      /remove phone numbers/i,
    );
  });

  it("returns a fail-open error result when the binding rejects", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("Workers AI unavailable")),
    } as unknown as Pick<Ai, "run">;

    await expect(
      checkProfileContent(ai, state, { gatewayName: "ttv-ai" }),
    ).resolves.toEqual({
      outcome: "error",
      flags: [],
      scores: {},
    });
  });

  it("returns a fail-open error result on timeout", async () => {
    const ai = {
      run: vi.fn(
        () =>
          new Promise(() => {
            // Intentionally never settles so the timeout path wins.
          }),
      ),
    } as unknown as Pick<Ai, "run">;

    await expect(
      checkProfileContent(ai, state, { gatewayName: "ttv-ai", timeoutMs: 5 }),
    ).resolves.toEqual({ outcome: "error", flags: [], scores: {} });
  });

  it("applies the same timeout while loading an avatar", async () => {
    const ai = aiReturning(response(clearScores));
    await expect(
      checkProfileContent(ai, state, {
        gatewayName: "ttv-ai",
        timeoutMs: 5,
        loadAvatarImage: () =>
          new Promise(() => {
            // Intentionally never settles so media loading cannot extend the check.
          }),
      }),
    ).resolves.toEqual({ outcome: "error", flags: [], scores: {} });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("returns a fail-open error result for malformed output", async () => {
    await expect(
      checkProfileContent(aiReturning({ answers: {} }), state, {
        gatewayName: "ttv-ai",
      }),
    ).resolves.toEqual({ outcome: "error", flags: [], scores: {} });
  });

  it("fails open without bypassing the required AI Gateway", async () => {
    const ai = aiReturning(response(clearScores));
    await expect(checkProfileContent(ai, state)).resolves.toEqual({
      outcome: "error",
      flags: [],
      scores: {},
    });
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("previewProfileModerationResult", () => {
  it("provides deterministic pass, hold, and error outcomes only to agent previews", () => {
    expect(
      previewProfileModerationResult("agent-pr-123", true, "pass"),
    ).toEqual({
      outcome: "pass",
      flags: [],
      scores: {},
    });
    expect(
      previewProfileModerationResult("agent-pr-123", true, "hold"),
    ).toEqual({
      outcome: "hold",
      flags: ["contains_contact_details"],
      scores: { contains_contact_details: 0.99 },
    });
    expect(
      previewProfileModerationResult("agent-pr-123", true, "error"),
    ).toEqual({
      outcome: "error",
      flags: [],
      scores: {},
    });
  });

  it("ignores preview controls outside an authenticated agent preview", () => {
    expect(
      previewProfileModerationResult("production", true, "hold"),
    ).toBeNull();
    expect(
      previewProfileModerationResult("agent-pr-123", false, "hold"),
    ).toBeNull();
    expect(
      previewProfileModerationResult("agent-pr-123", true, "unknown"),
    ).toBeNull();
  });
});
