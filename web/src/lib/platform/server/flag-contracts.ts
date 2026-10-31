import { z } from "zod";

// TODO(B-0.1): import these schemas from ../contracts once it merges.
export const FlagKey = z.enum(["spaces", "channels", "tembo_channels", "mentor_requests"]);
export type FlagKey = z.infer<typeof FlagKey>;
export const FlagAudience = z.enum(["OFF", "STAFF", "ALL"]);
export type FlagAudience = z.infer<typeof FlagAudience>;
export const Flag = z.object({
  key: FlagKey,
  audience: FlagAudience,
  updatedAt: z.number().int().nonnegative(),
  updatedBy: z.string().nullable(),
});
export type Flag = z.infer<typeof Flag>;
export const FlagsAdmin = z.object({ flags: z.array(Flag).length(FlagKey.options.length) })
  .refine(result => new Set(result.flags.map(flag => flag.key)).size === FlagKey.options.length);
export type FlagsAdmin = z.infer<typeof FlagsAdmin>;
export const UpdateFlag = z.strictObject({ audience: FlagAudience });
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.enum(["not_found", "forbidden", "flag_off", "validation", "server"]),
    message: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
