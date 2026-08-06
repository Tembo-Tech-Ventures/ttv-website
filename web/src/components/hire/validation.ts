import { z } from "zod";

const BUDGET_BAND_VALUES = [
  "UNDER_1K",
  "FROM_1K_TO_5K",
  "FROM_5K_TO_15K",
  "OVER_15K",
  "UNDISCLOSED",
] as const;

export const hireFormSchema = z.object({
  organization: z
    .string()
    .min(1, "Organization is required.")
    .max(120, "Organization must be 120 characters or fewer."),
  contactName: z
    .string()
    .min(1, "Your name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  contactEmail: z
    .string()
    .min(1, "Email is required.")
    .max(254, "Email must be 254 characters or fewer.")
    .email("Please enter a valid email address."),
  title: z
    .string()
    .min(1, "Project title is required.")
    .max(160, "Title must be 160 characters or fewer."),
  description: z
    .string()
    .min(1, "A brief project description is required.")
    .max(4000, "Description must be 4,000 characters or fewer."),
  skillsRaw: z
    .string()
    .max(1000, "Skills input is too long.")
    .optional()
    .default(""),
  budgetBand: z.enum(BUDGET_BAND_VALUES, {
    errorMap: () => ({ message: "Please select a budget range." }),
  }),
  timeline: z
    .string()
    .max(120, "Timeline must be 120 characters or fewer.")
    .optional()
    .default(""),
});

export type HireFormInput = z.infer<typeof hireFormSchema>;

export function parseSkillTags(raw: string): string[] {
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.slice(0, 30));
  return tags.slice(0, 12);
}

export const interestNoteSchema = z
  .string()
  .max(500, "Note must be 500 characters or fewer.")
  .optional()
  .default("");

export type ProfileStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "SUSPENDED";

export type OpportunityGateState = "no_profile" | "not_published" | "published";

export function resolveGateState(
  profile: { status: ProfileStatus } | null | undefined
): { state: OpportunityGateState; message: string } {
  if (!profile) {
    return {
      state: "no_profile",
      message:
        "Create and publish your builder profile to see client projects.",
    };
  }

  if (profile.status !== "PUBLISHED") {
    const statusMessages: Record<string, string> = {
      DRAFT:
        "Once your profile is published, client projects will open up here.",
      IN_REVIEW:
        "Your profile is being reviewed. Once it is published, client projects will open up here.",
      SUSPENDED:
        "Your profile is currently suspended. Contact the TTV team for help.",
    };
    return {
      state: "not_published",
      message:
        statusMessages[profile.status] ??
        "Once your profile is published, client projects will open up here.",
    };
  }

  return { state: "published", message: "" };
}
