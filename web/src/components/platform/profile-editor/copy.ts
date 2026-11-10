/**
 * What the profile editor says, in one place, so every place that posts says the same about who sees it.
 * Describe only what ships (policy 9ef0958f); no savior framing (c3fe647e).
 */

/** Said wherever someone saves their profile or posts work (spec rule 4, word for word). */
export const EVERYONE_SEES =
  "Everyone signed in to TTV can see your profile and everything you post. If you complete a cohort and publish, it's also on the public website, where anyone can see it.";

/**
 * For mentors and TTV staff, who are not listed in the members directory or on the public website (by
 * decision), so EVERYONE_SEES isn't true for them.
 */
export const STAFF_SEES =
  "Mentors and TTV staff aren't listed in the members directory or on the public website. Work you share in a channel is seen by that channel.";

/** A profile the team paused: shown nowhere, and nothing new can be posted to it. */
export const PAUSED_SEES =
  "Your profile is paused, so nobody else sees it or the work on it. Reach out to the team for next steps.";

/** Posting a piece of work: who sees it, in the choice's hint. */
export const POSTED_SEEN_BY = "Everyone signed in to TTV can see it, and mentors can confirm it.";
export const POSTED_SEEN_BY_STAFF = "Mentors and TTV staff aren't listed, so it shows where you share it: everyone in that channel sees it.";

/** Work a moderator took down: said the same wherever it shows, with the one thing left to do. */
export const TAKEN_DOWN = "A moderator took this down, so only you and the team can see it, and it can't be changed.";
export const TAKEN_DOWN_DELETE = "You can delete it.";

/** A piece of work, as its author sees it in a list: held by the check, or a draft. */
export const HELD_ENTRY = "Saved, and waiting for a person at TTV to check it. Only you and the team can see it until then.";
export const DRAFT_ENTRY = "A draft: only you can see it.";

/** The profile, held by the check, wherever its owner sees it. */
export const PROFILE_HELD = "It's saved. A person at TTV checks it before anyone else can see it; until then only you and the team can.";

/** A draft is the one thing nobody else sees. */
export const DRAFT_ONLY_YOU = "A draft is only for you. Nobody else sees it until you post it.";

export const PUBLIC_SITE = {
  title: "The public website",
  /** For someone who has not completed a cohort: one honest line on how they get there. */
  notYet: "The public website lists people who have completed a TTV cohort. Once you complete one, you can choose to list this profile there.",
  /** A graduate who has not listed themselves yet. */
  offer: "You've completed a cohort, so you can list this profile on the public website, at /talent/{handle}, where anyone can see it, with the work you've posted.",
  list: "List me on the public website",
  /** A graduate who is listed, and the way off, which is theirs to take. */
  listed: "You're on the public website at",
  listedAfter: ", with your posted work. Anyone can see it there.",
  /** A graduate who took themselves off: the way back is the same press. */
  unlisted: "You took yourself off the public website. You can list yourself again whenever you like, at /talent/{handle}, with the work you've posted.",
  /** Held by the automatic check and not listed: listing waits for the person who checks it. */
  heldWaiting: "Your profile is waiting for a check. Once a person at TTV has looked at it, you can list it on the public website.",
  /** Listed, but no longer shown: the public website is for people who completed a cohort. */
  listedNotShown: "You chose to list your profile, but the public website only shows people who have completed a TTV cohort, so it isn't there now.",
  /** Mentors and staff, whatever their status. */
  staff: "Mentors and TTV staff aren't listed on the public website.",
  /** A mentor or staff member whose earlier listing still stands: it shows nowhere, and coming off is still theirs to choose. */
  staffListed: "Mentors and TTV staff aren't listed on the public website, so your page there doesn't show. You can still take your listing off.",
  /** Listed, but held by the automatic check: nothing shows at the address until a person checks it. */
  listedHeld: "You've listed your profile at {path}, but it's waiting for a check, so nothing shows there until a person at TTV has looked at it.",
  unlist: "Take me off the public website",
  unlistTitle: "Take your profile off the public website?",
  unlistBody: "Your page at {path} and your blog posts come off the public website, and Writing and Opportunities close until you list yourself again. Nothing is deleted. You stay in the members directory, where everyone signed in to TTV can see you. Our sitemap and feed catch up within an hour; search engines can take longer to drop the old pages. Your handle stays yours, so the same links work again if you list yourself again.",
  unlistConfirm: "Take me off",
  /** A graduate who has saved nothing yet. */
  saveFirst: "You've completed a cohort, so once you've saved your profile you can list it on the public website, where anyone can see it.",
  /** Suspended by the team. */
  paused: "Your profile is paused, so it isn't shown anywhere. Reach out to the team for next steps.",
} as const;

export const SAVED = {
  profile: "Profile saved",
  profilePublic: "Profile saved, here and on the public website",
  listed: "You're on the public website",
  unlisted: "You're off the public website",
  added: "Posted",
  addedDraft: "Saved as a draft",
  updated: "Changes saved",
  posted: "Posted",
  drafted: "Moved to your drafts",
  deleted: "Deleted",
  /** Saved, but the automatic check is holding the profile (said as a warning flash). */
  profileHeld: "Profile saved, and waiting for a check",
  profileHeldDetail: "A person at TTV looks at it before anyone else can see the changes. Until then only you and the team can.",
  /** Posted, but the automatic check is holding it (said as a warning flash). */
  held: "Saved, and waiting for a check",
  heldDetail: "A person at TTV looks at it before anyone else can see it. Until then only you and the team can.",
} as const;

export const NOT_SAVED = {
  profile: "Your profile wasn't saved",
  listed: "You weren't listed on the public website",
  unlisted: "You're still on the public website",
  work: "Your work wasn't saved",
  kept: "Everything you wrote is still here.",
  fixBelow: "Fix the fields marked below. Everything you wrote is kept.",
  unavailable: "That didn't save, through no fault of yours. Try again in a moment.",
  changed: "This changed since you opened it. Reload before editing. Everything you wrote is still here.",
  takenDown: "A moderator took this down, so it can't be changed. You can delete it.",
  /** A listed profile's edit held by the check: nothing written, the live version unchanged. */
  heldChanges: "Your changes weren't saved",
  heldChangesDetail: "They need a check before they go live. Your public page stays as it was, and everything you wrote is still here.",
  /** The same, for a listing the public website doesn't show (held, or no completed cohort): there's no public page to keep. */
  heldChangesDetailHidden: "They need a check before they go live. Your profile stays as it was, and everything you wrote is still here.",
  /** Unlisting a paused profile: it isn't anywhere to come off. */
  paused: "Your profile is paused",
} as const;

/** The handle: the address of the member page, and of the public page and post links once listed. */
export const HANDLE = {
  hint: "Your page's address: 3 to 39 lowercase letters, numbers and hyphens. Your GitHub username works well.",
  /** Locked after the first save, so links to the member page keep working; changing it is a deliberate step. */
  current: "Your page's address. Links to it keep working as long as you keep it.",
  change: "Change handle",
  changeWarning: "Your member page moves to the new address, and links to the old one stop working.",
  /** Ever listed on the public website: it is part of every post link, so it stays. */
  locked: "Your handle stays the same once you've been on the public website, because it's part of your post links.",
} as const;
