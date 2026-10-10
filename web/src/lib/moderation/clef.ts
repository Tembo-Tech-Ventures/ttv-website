export const CLEF_PROFILE_MODEL = "@cf/cloudflare/clef-flash";
export const CLEF_TIMEOUT_MS = 3_000;
export const PROFILE_MODERATION_PREVIEW_HEADER = "x-ttv-profile-check";

export const PROFILE_MODERATION_QUESTIONS = {
  contains_contact_details: {
    type: "noul",
    instructions:
      "Does any public profile text contain a phone number, email address, or national identity number? Do not count an HTTPS portfolio or LinkedIn URL by itself.",
    criteria: {
      true: "The text exposes a phone number, email address, or national identity number.",
      false: "The text does not expose those contact or identity details.",
    },
  },
  abusive_or_sexual: {
    type: "noul",
    instructions:
      "Does any public profile text contain abusive, threatening, hateful, or sexual content?",
    criteria: {
      true: "The text contains abusive, threatening, hateful, or sexual content.",
      false: "The text does not contain that content.",
    },
  },
  promotes_unrelated_business: {
    type: "noul",
    instructions:
      "Does this builder profile promote an unrelated business, multi-level marketing scheme, or spam instead of describing the builder and their work?",
    criteria: {
      true: "The profile is primarily unrelated promotion, multi-level marketing, or spam.",
      false: "The profile describes the builder, their work, skills, or availability.",
    },
  },
  impersonation_risk: {
    type: "noul",
    instructions:
      "Does any public profile text falsely claim that the builder represents Tembo Tech Ventures, its staff, or another organisation?",
    criteria: {
      true: "The profile makes a likely false claim of representing an organisation or its staff.",
      false: "The profile makes no such claim.",
    },
  },
} as const;

export type ProfileModerationFlag = keyof typeof PROFILE_MODERATION_QUESTIONS;

export const PROFILE_MODERATION_THRESHOLDS: Record<
  ProfileModerationFlag,
  number
> = {
  contains_contact_details: 0.8,
  abusive_or_sexual: 0.85,
  promotes_unrelated_business: 0.85,
  impersonation_risk: 0.8,
};

export const PROFILE_MODERATION_MESSAGES: Record<
  ProfileModerationFlag,
  string
> = {
  contains_contact_details:
    "Remove phone numbers, email addresses, or ID numbers from your public profile.",
  abusive_or_sexual:
    "Remove abusive, threatening, hateful, or sexual content from your public profile.",
  promotes_unrelated_business:
    "Remove unrelated business promotions, multi-level marketing, or spam from your public profile.",
  impersonation_risk:
    "Remove claims that you represent TTV or another organisation unless that role is accurate.",
};

export interface ProfileModerationState {
  displayName: string;
  handle: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  skills: string[];
  githubLogin: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
}

export interface ProfileModerationResult {
  outcome: "pass" | "hold" | "error";
  flags: ProfileModerationFlag[];
  scores: Partial<Record<ProfileModerationFlag, number>>;
}

interface ClefResponse {
  answers?: Record<string, unknown>;
}

function isNoulAnswer(value: unknown): value is { type: "noul"; noul: number } {
  if (!value || typeof value !== "object") return false;
  const answer = value as Record<string, unknown>;
  return (
    answer.type === "noul" &&
    typeof answer.noul === "number" &&
    Number.isFinite(answer.noul) &&
    answer.noul >= 0 &&
    answer.noul <= 1
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Clef check timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseResponse(response: unknown): ProfileModerationResult {
  if (!response || typeof response !== "object") {
    throw new Error("Invalid Clef response");
  }

  const answers = (response as ClefResponse).answers;
  if (!answers) throw new Error("Missing Clef answers");

  const scores: Partial<Record<ProfileModerationFlag, number>> = {};
  const flags: ProfileModerationFlag[] = [];
  const questionIds = Object.keys(
    PROFILE_MODERATION_QUESTIONS
  ) as ProfileModerationFlag[];

  for (const questionId of questionIds) {
    const answer = answers[questionId];
    if (!isNoulAnswer(answer)) throw new Error("Invalid Clef answer");
    scores[questionId] = answer.noul;
    if (answer.noul >= PROFILE_MODERATION_THRESHOLDS[questionId]) {
      flags.push(questionId);
    }
  }

  return { outcome: flags.length > 0 ? "hold" : "pass", flags, scores };
}

export async function checkProfileContent(
  ai: Pick<Ai, "run">,
  state: ProfileModerationState,
  options: { gatewayName?: string; timeoutMs?: number } = {}
): Promise<ProfileModerationResult> {
  try {
    const request = {
      model: "clef-flash",
      state,
      questions: PROFILE_MODERATION_QUESTIONS,
    };
    const gatewayName = options.gatewayName?.trim();
    if (!gatewayName) throw new Error("AI Gateway is not configured");
    const response = await withTimeout(
      ai.run(
        CLEF_PROFILE_MODEL as Parameters<typeof ai.run>[0],
        request as never,
        { gateway: { id: gatewayName } }
      ) as Promise<unknown>,
      options.timeoutMs ?? CLEF_TIMEOUT_MS
    );
    return parseResponse(response);
  } catch {
    return { outcome: "error", flags: [], scores: {} };
  }
}

export function profileModerationMessages(
  flags: readonly ProfileModerationFlag[]
): string[] {
  return flags.map((flag) => PROFILE_MODERATION_MESSAGES[flag]);
}

export function previewProfileModerationResult(
  deploymentEnvironment: string | undefined,
  agentSession: boolean,
  requestedOutcome: string | null
): ProfileModerationResult | null {
  if (!deploymentEnvironment?.startsWith("agent-") || !agentSession) return null;

  if (requestedOutcome === "pass") {
    return { outcome: "pass", flags: [], scores: {} };
  }
  if (requestedOutcome === "hold") {
    return {
      outcome: "hold",
      flags: ["contains_contact_details"],
      scores: { contains_contact_details: 0.99 },
    };
  }
  if (requestedOutcome === "error") {
    return { outcome: "error", flags: [], scores: {} };
  }
  return null;
}
