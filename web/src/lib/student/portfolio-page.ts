/** What /dashboard/me/portfolio says after a save, in one place so its tests and e2e read the same words. */
export const PORTFOLIO_COPY = {
  created: "Profile created as a draft",
  draftSaved: "Draft saved",
  live: "Your changes are live",
  published: "Your profile is live",
  notSaved: "Your profile wasn't saved",
  notPublished: "Your profile wasn't published",
  fixBelow: "Fix the fields marked below. Everything you wrote is kept.",
  unavailable: "That didn't save, through no fault of yours. Try again in a moment.",
} as const;
