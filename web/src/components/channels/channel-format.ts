import type { Channel, EffectiveFlags, Message, ModerationState } from "@/lib/platform/contracts";

/*
 * Pure display rules for the channel view (U-2.1): days, times, message
 * bodies, thread summaries, moderation notices and which composer tools a
 * channel offers. No React, so every rule is unit tested on its own.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/*
 * One fixed zone, as attention-display does, so the server and the browser
 * render the same day names and hydration agrees. Most TTV members are in Kenya.
 */
const ZONE = "Africa/Nairobi";
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONE });
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONE });
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: ZONE });
const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: ZONE });
const datedYearFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: ZONE });
const fullFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: ZONE });

/** The calendar day in Nairobi, "2026-11-03". */
export function dayKey(timestamp: number): string {
  return dayKeyFormat.format(timestamp);
}

/** "Today", "Yesterday", a weekday within the week, then the date. */
export function dayLabel(timestamp: number, now: number): string {
  const key = dayKey(timestamp);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(now - DAY)) return "Yesterday";
  const age = now - timestamp;
  if (age >= 0 && age < 6 * DAY) return weekdayFormat.format(timestamp);
  return key.slice(0, 4) === dayKey(now).slice(0, 4) ? dateFormat.format(timestamp) : datedYearFormat.format(timestamp);
}

/** "16:40", in the 24-hour clock Kenya reads. */
export function clock(timestamp: number): string {
  return clockFormat.format(timestamp);
}

/** The whole moment, for a time element's title: "Monday 3 November 2026 at 09:40". */
export function fullTime(timestamp: number): string {
  return fullFormat.format(timestamp);
}

/** "12 min ago", "3 h ago", "yesterday", "on Monday": how long since a reply. */
export function ago(timestamp: number, now: number): string {
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (dayKey(timestamp) === dayKey(now)) return `${Math.floor(age / HOUR)} h ago`;
  const day = dayLabel(timestamp, now);
  return day === "Yesterday" ? "yesterday" : `on ${day}`;
}

export type DayGroup = { key: string; label: string; messages: Message[] };

/** Messages, oldest first, under one heading per calendar day. */
export function groupByDay(messages: readonly Message[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const key = dayKey(message.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.messages.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt, now), messages: [message] });
  }
  return groups;
}

/** "34:12", or "1:02:03" past an hour: a position in a recording. */
export function clipTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---- Bodies ----

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; tembo: boolean }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

const LINK = /^https?:\/\/[^\s<>"]+/i;
/** Punctuation that ends a sentence rather than a link. */
const LINK_TAIL = /[.,;:!?)\]'"]+$/;
const WORD = /^[\p{L}\p{N}_'’-]+/u;

/**
 * Split a message body into paragraphs of text, mentions, inline code and
 * plain links. Deliberately not Markdown: a member's message never renders
 * markup, images or labelled links whose text hides where they go.
 *
 * A mention is `@tembo`, or `@` plus the longest name in `names` it starts
 * with ("@David Kamau"), or else `@` plus one word.
 */
export function parseBody(body: string, names: readonly string[] = []): BodySegment[][] {
  const known = [...new Set(names.map((name) => name.trim()).filter(Boolean))].toSorted((a, b) => b.length - a.length);
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => parseInline(paragraph, known));
}

function parseInline(text: string, names: readonly string[]): BodySegment[] {
  const segments: BodySegment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) segments.push({ kind: "text", text: plain });
    plain = "";
  };
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const boundary = index === 0 || /[\s([{"'“‘]/.test(text[index - 1]);
    if (rest[0] === "`") {
      const end = rest.indexOf("`", 1);
      if (end > 1) {
        flush();
        segments.push({ kind: "code", text: rest.slice(1, end) });
        index += end + 1;
        continue;
      }
    }
    if (boundary && rest[0] === "@") {
      const mention = matchMention(rest.slice(1), names);
      if (mention) {
        flush();
        segments.push({ kind: "mention", text: `@${mention}`, tembo: mention.toLowerCase() === "tembo" });
        index += mention.length + 1;
        continue;
      }
    }
    if (boundary) {
      const link = LINK.exec(rest)?.[0].replace(LINK_TAIL, "");
      if (link && link.length > "https://".length) {
        flush();
        segments.push({ kind: "link", text: link, href: link });
        index += link.length;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  flush();
  return segments;
}

function matchMention(rest: string, names: readonly string[]): string | null {
  const lower = rest.toLowerCase();
  const ends = (length: number) => length === rest.length || !WORD.test(rest.slice(length, length + 1));
  if (lower.startsWith("tembo") && ends(5)) return rest.slice(0, 5);
  for (const name of names) {
    if (lower.startsWith(name.toLowerCase()) && ends(name.length)) return rest.slice(0, name.length);
  }
  return WORD.exec(rest)?.[0] ?? null;
}

/** Whether a body asks Tembo, as the composer and server read it. */
export function mentionsTembo(body: string): boolean {
  return parseBody(body).some((paragraph) => paragraph.some((segment) => segment.kind === "mention" && segment.tembo));
}

// ---- The "New" divider ----

/**
 * Where the "New" divider goes when a channel opens: before the first message by
 * someone else (not deleted or hidden) after the reader's marker. A marker older than everything loaded
 * (or none yet) puts it before the last `unreadCount` messages by others. Chosen
 * once per visit, so reading on never moves or removes it.
 */
export function openingDivider(
  messages: readonly Message[],
  read: { markerId: string | null; unreadCount: number | null },
  viewerId: string | null,
): string | null {
  // Unread counts skip deleted and hidden messages (B-2.3), so the divider does too: a moderator
  // receives hidden ones, and "New" must not open on a message members can't see.
  const byOthers = (message: Message) => !message.deleted && message.moderation?.state !== "HIDDEN" && message.author.id !== viewerId;
  const marker = read.markerId === null ? -1 : messages.findIndex((message) => message.id === read.markerId);
  if (marker >= 0) return messages.slice(marker + 1).find(byOthers)?.id ?? null;
  const unread = read.unreadCount ?? 0;
  if (unread <= 0) return null;
  const others = messages.filter(byOthers);
  return others[Math.max(0, others.length - unread)]?.id ?? null;
}

// ---- Threads ----

/** "5 replies · last 12 min ago". */
export function threadSummary(message: Message, now: number): { replies: string; last: string | null } {
  const { replyCount, lastReplyAt } = message.thread;
  return { replies: plural(replyCount, "reply", "replies"), last: lastReplyAt === null ? null : `last ${ago(lastReplyAt, now)}` };
}

// ---- Moderation, as the author (or a moderator) sees it ----

export type ModerationNotice = { state: Exclude<ModerationState, "VISIBLE">; title: string; detail: string };

/**
 * What a flagged or hidden message says about itself. The server sends
 * `moderation` only to the message's author and to moderators; ordinary
 * readers never receive a flagged state, and never receive a hidden message.
 * Wording follows the owner's rule: a flag keeps the message up until a person
 * decides; only people hide messages.
 */
export function moderationNotice(message: Message, viewerId: string | null): ModerationNotice | null {
  const moderation = message.moderation;
  if (!moderation || moderation.state === "VISIBLE" || message.deleted) return null;
  const own = viewerId !== null && message.author.id === viewerId;
  const reasons = moderation.reasons.join(", ");
  if (moderation.state === "FLAGGED") {
    return own
      ? {
          state: "FLAGGED",
          title: reasons ? `Flagged for a moderator: ${reasons}` : "Flagged for a moderator",
          detail: "Your message stays up until a person looks at it. Only you can see this note.",
        }
      : {
          state: "FLAGGED",
          title: reasons ? `Flagged: ${reasons}` : "Flagged",
          detail: "Still visible to everyone until a moderator decides.",
        };
  }
  return own
    ? {
        state: "HIDDEN",
        title: reasons ? `Hidden from the channel: ${reasons}` : "Hidden from the channel",
        detail: "Only you can see this message now.",
      }
    : {
        state: "HIDDEN",
        title: reasons ? `Hidden from members: ${reasons}` : "Hidden from members",
        detail: "Moderators can still see it.",
      };
}

// ---- Reporting, hiding and asking for a review ----

/** Why a member reports a message. The words go to the moderators as the report's reason. */
export const REPORT_REASONS = [
  { key: "unkind", label: "Unkind or disrespectful" },
  { key: "spam", label: "Spam or unrelated promotion" },
  { key: "personal", label: "Shares someone's contact or personal details" },
  { key: "other", label: "Something else" },
] as const;
export type ReportReasonKey = (typeof REPORT_REASONS)[number]["key"];

/** Longest reason or note the server takes (ReportMessage, ModerationAction). */
export const MAX_REASON = 2_000;

/** The report's reason as the moderators read it: the choice, then the reporter's words. "Something else" needs words. */
export function reportReason(key: ReportReasonKey, details: string): string | null {
  const words = details.trim();
  if (key === "other") return words ? words.slice(0, MAX_REASON) : null;
  const label = REPORT_REASONS.find((reason) => reason.key === key)!.label;
  return (words ? `${label}: ${words}` : label).slice(0, MAX_REASON);
}

/** The first name, for sentences about a person ("Dennis will still see it"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Why a report, a hide or a restore did not go through, in words the person
 * can act on. Nothing was changed when this shows.
 */
export function moderationFailure(error: unknown, kind: "report" | "moderate" | "review"): string {
  const { code, status, retryAfterMs } = (error ?? {}) as { code?: string; status?: number; retryAfterMs?: number };
  if (status === 429 || code === "rate_limited") {
    const seconds = retryAfterMs === undefined ? null : Math.max(1, Math.ceil(retryAfterMs / 1_000));
    return seconds === null ? "That's a lot at once. Try again in a moment." : `That's a lot at once. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  }
  if (status === 401) return "Your session ended. Sign in again, then try again.";
  if (status === 404) return "That message is no longer here.";
  if (status === 409) {
    return kind === "moderate"
      ? "An admin has already decided on this message, or it has changed. Close this and look again."
      : "That message has changed since you opened this. Close it and look again.";
  }
  if (status === 403) {
    return kind === "moderate" ? "You can't moderate this channel." : kind === "review" ? "You can ask for a review of your own messages only." : "You can't report this message.";
  }
  if (code === "network_error" || code === "aborted") return "Couldn't reach TTV. Check your connection and try again.";
  return "Something went wrong on our side. Try again.";
}

// ---- The composer ----

export type Posting = "open" | "staff" | "archived" | "closed";

/** Whether this person can write here, and if not, why not. */
export function postingFor(channel: Channel): Posting {
  if (channel.archivedAt !== null) return "archived";
  if (channel.capabilities.canPost) return "open";
  return channel.postingPolicy === "STAFF" ? "staff" : "closed";
}

export type ComposerTools = { shareProject: boolean; sessionClip: boolean; askTembo: boolean };

/**
 * The tools a composer offers. A session clip is offered only in a cohort
 * channel the server says may carry one (every member can see that
 * recording), never in a community channel or a conversation, whatever the
 * capability says. Ask Tembo stays hidden until `tembo_channels` is on.
 */
export function composerTools(channel: Channel, flags: EffectiveFlags): ComposerTools {
  return {
    shareProject: true,
    sessionClip: channel.kind === "COHORT" && channel.capabilities.canShareSessionClip,
    askTembo: flags.tembo_channels === true,
  };
}

/** What Tembo reads when asked here (plan §3), in a channel or in one of its threads. */
export function temboReach(channel: Channel, inThread = false): string {
  switch (channel.kind) {
    case "COHORT":
      return "this cohort's recordings and this channel";
    case "COMMUNITY":
      return inThread ? "this thread and public projects" : "this channel and public projects";
    case "DIRECT":
      return "only this conversation";
  }
}

/** Tembo's reach as a sentence, with what it never reads, said before anyone asks. One source for every line that says it. */
export function temboScope(channel: Channel, inThread = false): string {
  if (channel.kind === "DIRECT") return "Only this conversation, and only when you ask.";
  const reach = temboReach(channel, inThread);
  const never = channel.kind === "COHORT" ? "Never private conversations or other cohorts." : "Never cohort recordings or private conversations.";
  return `${reach.charAt(0).toUpperCase()}${reach.slice(1)}. ${never}`;
}

/** "# show-your-work", the way a channel is written. Conversations use the person's name. */
export function channelTitle(channel: Channel): string {
  return channel.kind === "DIRECT" ? channel.name : `#${channel.slug}`;
}
