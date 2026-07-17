import { z } from "zod";

const ffmpegResultSchema = z
  .object({
    r2VideoKey: z.string().trim().min(1),
    r2AudioKey: z.string().trim().min(1),
    durationSeconds: z.number().nonnegative().nullish(),
    fileSizeBytes: z.number().int().nonnegative().nullish(),
  })
  .strict();

export type FfmpegResult = z.infer<typeof ffmpegResultSchema>;

export function parseFfmpegResult(value: unknown): FfmpegResult {
  const parsed = ffmpegResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("FFmpeg container returned an invalid processing result.");
  }
  return parsed.data;
}
