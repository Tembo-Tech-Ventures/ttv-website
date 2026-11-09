/** What /dashboard/account says, in one place so its tests and its e2e read the same words. */
export const ACCOUNT_COPY = {
  lead: "Your name and photo, and how you take part.",
  nameSaved: "Name saved",
  photoSaved: "Photo updated",
  nameNotSaved: "Your name wasn't saved",
  photoNotSaved: "Your photo wasn't uploaded",
  notSaved: "Nothing was saved",
  fixBelow: "The field below says what to change.",
  noName: "Enter your name.",
  noPhoto: "Choose an image to upload.",
  unreadable: "That form didn't arrive whole. Try again.",
  unavailable: "That didn't save, through no fault of yours. Try again in a moment.",
  emailHint: "GitHub, where you sign in, manages your email, so it can't be changed here.",
  photoHint: "A PNG, JPG, GIF or WebP image, up to 5 MB. It's resized to at most 1024 by 1024 pixels.",
} as const;
