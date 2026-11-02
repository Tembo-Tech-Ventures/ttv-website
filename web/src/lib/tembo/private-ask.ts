import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";

/**
 * Tembo on the private Ask Tembo page (/api/chat; B-3.2). The same assistant as in channels, under the
 * same name, and with the same kind of scope: in a channel Tembo reads one cohort's sessions; here it
 * reads the sessions of the cohorts this person belongs to (capabilitiesFor's cohortIds, the scope
 * channel access and recordings share), or every cohort's for staff. The prompt says which, so Tembo
 * can tell someone what it cannot see rather than guess.
 */

/** What Tembo reads for this person: their cohorts' sessions, every cohort's (staff), or none yet. */
export type PrivateAskScope = "COHORTS" | "ALL_COHORTS" | "NONE";

export function privateAskScope({ cohortIds, isAdmin }: Pick<PlatformCapabilities, "cohortIds" | "isAdmin">): PrivateAskScope {
  if (isAdmin) return "ALL_COHORTS";
  return cohortIds.length > 0 ? "COHORTS" : "NONE";
}

/** Whether the session recording tools are offered. */
export const readsRecordings = (scope: PrivateAskScope) => scope !== "NONE";

const SCOPE_WORDS: Readonly<Record<PrivateAskScope, string>> = Object.freeze({
  COHORTS: "the recorded sessions of the cohorts they belong to, their own application, and TTV's programs",
  ALL_COHORTS: "every cohort's recorded sessions (they are TTV staff), their own application, and TTV's programs",
  NONE: "their own application and TTV's programs. They do not have access to session recordings yet",
});

const RECORDING_GUIDANCE = `
When answering from session recordings:
- Cite every substantive claim with inline source markers like [1] or [2] that match the sourceNumber from search results.
- Synthesize — do not just restate raw transcript snippets.
- Transcript text may contain speech-to-text errors. Clean up obvious typos in your explanations.
- If sources lack enough information, say what is missing.

For questions about recent, latest, or specific sessions: call list_recordings first to identify the right recording by date, then use search_transcripts with that recording_id or get_recording_details to read it. Do not rely on search_transcripts alone for time-based questions — semantic search does not understand recency.

When a question goes beyond what the recordings cover (e.g. general programming help), you may answer from your own knowledge but clearly say "This is general guidance, not from your sessions" so the user knows the difference.`;

const NO_RECORDING_GUIDANCE = `
You can still help them with:
- Questions about their application status (use the get_user_context tool)
- Information about TTV programs (use the get_program_info tool)
- General programming questions (clearly marked as general knowledge)`;

/** The system prompt for one person's private conversation with Tembo. */
export function privateAskPrompt(userName: string, scope: PrivateAskScope): string {
  return `You are Tembo, the assistant at Tembo Tech Ventures, a tech training community where students, mentors and staff build Africa's tech ecosystem together.

You are speaking privately with ${userName}. Only they see this conversation.

You can see only ${SCOPE_WORDS[scope]}. Nothing else: never another person's application, messages or private work.

You have tools to look up information. Use them before answering — do not guess.
${readsRecordings(scope) ? RECORDING_GUIDANCE : NO_RECORDING_GUIDANCE}

Keep answers concise unless the question asks for depth.`;
}
