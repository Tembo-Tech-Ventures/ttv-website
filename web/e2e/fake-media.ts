import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Chromium's fake camera and microphone for the call checks (docs/meetings-testing.md). With no
 * files, Chromium draws its own test pattern and plays a beep; CALL_FAKE_VIDEO (a .y4m or .mjpeg)
 * and CALL_FAKE_AUDIO (a .wav) put a recording in their place, for a check that needs real speech or
 * a known picture. The permission prompt is answered yes, so nobody has to click it.
 */

/** Only the variables this reads. */
type Environment = Readonly<Record<string, string | undefined>>;

const FILES = {
  CALL_FAKE_VIDEO: { flag: "--use-file-for-fake-video-capture", extensions: [".y4m", ".mjpeg"] },
  CALL_FAKE_AUDIO: { flag: "--use-file-for-fake-audio-capture", extensions: [".wav"] },
} as const;

export const FAKE_MEDIA_FLAGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] as const;

/**
 * The launch arguments for a fake camera and microphone. A file that is named but missing, or of a
 * kind Chromium can't play, is an error rather than a silent test pattern.
 */
export function fakeMediaArgs(environment: Environment = process.env, exists: (file: string) => boolean = existsSync): string[] {
  const args: string[] = [...FAKE_MEDIA_FLAGS];
  for (const [variable, { flag, extensions }] of Object.entries(FILES)) {
    const file = environment[variable]?.trim();
    if (!file) continue;
    const resolved = path.resolve(file);
    if (!(extensions as readonly string[]).includes(path.extname(resolved).toLowerCase())) {
      throw new Error(`${variable} must be a ${extensions.join(" or ")} file; got ${file}.`);
    }
    if (!exists(resolved)) throw new Error(`${variable} names a file that doesn't exist: ${resolved}.`);
    args.push(`${flag}=${resolved}`);
  }
  return args;
}
