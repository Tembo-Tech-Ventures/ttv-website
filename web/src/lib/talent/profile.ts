import { z } from "zod";

const httpsUrl = z
  .string()
  .max(300)
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "URL must use HTTPS",
  });

const skillTag = z.string().min(1).max(30);

export const profileEditorSchema = z.object({
  headline: z.string().max(120).optional(),
  bio: z.string().max(4000).optional(),
  location: z.string().max(120).optional(),
  country: z.string().max(56).optional(),
  skills: z.array(skillTag).max(12).optional(),
  portfolioUrl: httpsUrl.optional().or(z.literal("")),
  linkedinUrl: httpsUrl.optional().or(z.literal("")),
  openToFreelance: z.boolean().optional(),
  openToRoles: z.boolean().optional(),
});

export type ProfileEditorInput = z.infer<typeof profileEditorSchema>;

export function parseProfileEditor(data: unknown) {
  return profileEditorSchema.safeParse(data);
}

export function serializeSkills(skills: string[]): string {
  return JSON.stringify(skills);
}

export function parseSkillsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function parseTopicsJson(raw: string | null | undefined): string[] {
  return parseSkillsJson(raw);
}
