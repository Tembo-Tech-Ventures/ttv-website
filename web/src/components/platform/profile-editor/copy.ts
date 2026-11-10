/**
 * What the profile editor says, in one place, so every place that posts says the same about who sees it.
 * Describe only what ships (policy 9ef0958f); no savior framing (c3fe647e).
 */

/** Said wherever someone saves their profile or posts work (spec rule 4, word for word). */
export const EVERYONE_SEES =
  "Everyone signed in to TTV can see your profile and everything you post. If you complete a cohort and publish, it's also on the public website, where anyone can see it.";

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
  /** Listed, but held by the automatic check: nothing shows at the address until a person checks it. */
  listedHeld: "You've listed your profile at {path}, but it's waiting for a check, so nothing shows there until a person at TTV has looked at it.",
  unlist: "Take me off the public website",
  unlistTitle: "Take your profile off the public website?",
  unlistBody: "Your page at {path} and the pages of your posts come off the public website. You stay in the members directory, where everyone signed in to TTV can see you. Your handle stays yours, so the same links work again if you list it again.",
  unlistConfirm: "Take me off",
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
} as const;
