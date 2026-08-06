import { z } from "zod";

export const contactFormSchema = z.object({
  fromName: z
    .string()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or less"),
  fromEmail: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(254, "Email must be 254 characters or less"),
  organization: z
    .string()
    .max(120, "Organization must be 120 characters or less")
    .optional()
    .or(z.literal("")),
  message: z
    .string()
    .min(1, "Message is required")
    .max(4000, "Message must be 4,000 characters or less"),
});

export type ContactFormInput = z.infer<typeof contactFormSchema>;

export function parseContactForm(formData: FormData): {
  valid: true;
  data: ContactFormInput;
} | {
  valid: false;
  errors: Record<string, string>;
  values: Record<string, string>;
} {
  const raw = {
    fromName: (formData.get("fromName") as string) ?? "",
    fromEmail: (formData.get("fromEmail") as string) ?? "",
    organization: (formData.get("organization") as string) ?? "",
    message: (formData.get("message") as string) ?? "",
  };

  const result = contactFormSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field && !errors[String(field)]) {
      errors[String(field)] = issue.message;
    }
  }

  return { valid: false, errors, values: raw };
}
