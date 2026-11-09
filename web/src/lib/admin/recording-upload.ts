/*
 * The video an admin uploads as a new recording: what the form must carry, and
 * where the file is kept. The page stores the file, then the row, then queues
 * the recording; each step that can fail says so in words.
 */

/** Extensions the pipeline's ffmpeg reads, as the key's suffix; anything else is stored as `.mp4`. */
const EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "mpeg", "mpg", "ogv", "3gp"]);

export type VideoUpload = { ok: true; file: File } | { ok: false; error: string };

/** The form's video, or what is wrong with it. A browser can't keep a chosen file across a refusal, so each error says to choose it again. */
export function videoFromForm(formData: FormData): VideoUpload {
  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the video file to upload." };
  const extension = extensionOf(file.name);
  const isVideo = file.type ? file.type.startsWith("video/") : EXTENSIONS.has(extension ?? "");
  if (!isVideo) return { ok: false, error: `${file.name || "That file"} isn't a video. Choose a video file, such as an MP4.` };
  return { ok: true, file };
}

function extensionOf(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match ? match[1].toLowerCase() : null;
}

/** Where the recording's source video is kept in R2, with a suffix that never comes from an unchecked file name. */
export function videoKey(recordingId: string, file: File): string {
  const extension = extensionOf(file.name);
  return `recordings/${recordingId}/source.${extension && EXTENSIONS.has(extension) ? extension : "mp4"}`;
}

/** The type the video is served with: the browser's, when it is a video type. */
export function videoContentType(file: File): string {
  return file.type.startsWith("video/") ? file.type : "video/mp4";
}
