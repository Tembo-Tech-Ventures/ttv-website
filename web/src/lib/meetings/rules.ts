/**
 * In-app calls: the fixed rules and the values each column may hold (src/lib/meetings/README.md).
 * Zod-free and import-free, so the schema, the wire contracts and client islands share one list.
 * The limits are the owner's decisions of 23 November 2026, which override the plan documents'
 * 60 minutes: keep every limit here, never as a literal at the place that enforces it.
 */

/** Every call ends this many minutes after its room opens. */
export const CALL_LIMIT_MINUTES = 90;
/** "15 minutes left" is said this many minutes before a call's end, at 75 minutes. */
export const CALL_WARNING_MINUTES_LEFT = 15;
/** A check-in ends this many minutes after both people are in. */
export const CHECKIN_LIMIT_MINUTES = 30;
/** The most people in one call, hosts included. */
export const MAX_PEOPLE_PER_CALL = 15;
/** Of those places, how many are always kept for a host. */
export const SEATS_KEPT_FOR_HOST = 1;
/** A cohort session or an event with no host in it for this long ends ("No host is here"). */
export const NO_HOST_END_MINUTES = 5;
/** A call between two people that the second person never joins ends this long after it opened. */
export const NOBODY_CAME_END_MINUTES = 15;
/** A call with nobody in it ends this long after the last person left. */
export const EMPTY_ROOM_END_MINUTES = 2;
/** Estimated recording spend in a UTC month that alerts admins, once, in US dollars. */
export const RECORDING_ALERT_USD = 10;
/** Estimated recording spend in a UTC month above which no new recording starts, in US dollars. */
export const RECORDING_LIMIT_USD = 25;

/** A cohort session is booked in steps of this many minutes, from one step up to CALL_LIMIT_MINUTES. */
export const SESSION_LENGTH_STEP_MINUTES = 15;
/** The most weeks one weekly series of cohort sessions covers: about a cohort and a half. */
export const SESSION_SERIES_MAX_WEEKS = 26;
/** How far ahead a cohort session may be booked, in days. */
export const SESSION_BOOK_AHEAD_DAYS = 366;

/** What a call is for: a cohort session, a check-in on one piece of work, a call between two people, a community event. */
export const MEETING_PURPOSES = ["SESSION", "CHECKIN", "CALL", "EVENT"] as const;
export type MeetingPurpose = (typeof MEETING_PURPOSES)[number];

/** SCHEDULED until a host opens the room, LIVE while it is open, then ENDED; CANCELLED never opened. An ended call never reopens. */
export const MEETING_STATES = ["SCHEDULED", "LIVE", "ENDED", "CANCELLED"] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

/**
 * Whether and how a call is recorded: ALWAYS (a cohort session, from the first second, no pause),
 * BOTH_AGREE (a call between two people, only once both said yes; either may stop it), HOST (an event
 * whose host chose to record; the host may stop it), or NONE.
 */
export const MEETING_RECORDING_POLICIES = ["ALWAYS", "BOTH_AGREE", "HOST", "NONE"] as const;
export type MeetingRecordingPolicy = (typeof MEETING_RECORDING_POLICIES)[number];

/** Why a call ended: a host ended it, it reached its limit, no host was there, the other person never came, or the room was empty. */
export const MEETING_END_REASONS = ["HOST_ENDED", "LIMIT", "NO_HOST", "NOBODY_CAME", "EMPTY"] as const;
export type MeetingEndReason = (typeof MEETING_END_REASONS)[number];

/** A person's role in a call when they took their seat. */
export const MEETING_SEAT_ROLES = ["HOST", "MEMBER"] as const;
export type MeetingSeatRole = (typeof MEETING_SEAT_ROLES)[number];

/** HELD while the person is in the call; RELEASED when they left; REMOVED by a host, who keeps them out. */
export const MEETING_SEAT_STATES = ["HELD", "RELEASED", "REMOVED"] as const;
export type MeetingSeatState = (typeof MEETING_SEAT_STATES)[number];

/** A person's answer, before a call between two people, to recording it. */
export const MEETING_CONSENT_ANSWERS = ["RECORD", "DONT_RECORD"] as const;
export type MeetingConsentAnswer = (typeof MEETING_CONSENT_ANSWERS)[number];

/**
 * A recording's way in: STARTING (TTV's row written before the provider is asked), RECORDING,
 * STOPPED (waiting for the file), PROMOTED (copied in, its `recording` row made), and the ends:
 * FAILED, TOO_SHORT (the provider records nothing under a few seconds) and REFUSED (the month's
 * spending limit was reached, so it never started).
 */
export const MEETING_RECORDING_STATES = ["STARTING", "RECORDING", "STOPPED", "PROMOTED", "FAILED", "TOO_SHORT", "REFUSED"] as const;
export type MeetingRecordingState = (typeof MEETING_RECORDING_STATES)[number];

/** A suggested call between two people: OPEN until one time is picked, "Not now", withdrawn, or every time has passed. */
export const CALL_PROPOSAL_STATES = ["OPEN", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"] as const;
export type CallProposalState = (typeof CALL_PROPOSAL_STATES)[number];
/** A suggestion is a call between two people or a check-in on one piece of work. */
export const CALL_PROPOSAL_PURPOSES = ["CHECKIN", "CALL"] as const satisfies readonly MeetingPurpose[];
export type CallProposalPurpose = (typeof CALL_PROPOSAL_PURPOSES)[number];
/** The most times one suggestion offers. */
export const MAX_PROPOSED_TIMES = 3;

/** Which provider minted a join token, so the room loads the matching client (provider.ts). */
export const CALL_PROVIDER_KINDS = ["fake", "realtimekit"] as const;
export type CallProviderKind = (typeof CALL_PROVIDER_KINDS)[number];
