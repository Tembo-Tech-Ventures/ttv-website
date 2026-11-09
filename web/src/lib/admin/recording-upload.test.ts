import { describe, expect, it } from "vitest";
import { videoContentType, videoFromForm, videoKey } from "./recording-upload";

const form = (video?: File | string) => {
  const data = new FormData();
  if (video !== undefined) data.set("video", video);
  return data;
};
const video = (name: string, type: string, size = 4) => new File([new Uint8Array(size)], name, { type });

describe("the uploaded video", () => {
  it("takes a video file, by its type or, with none, by its extension", () => {
    expect(videoFromForm(form(video("week-4.mp4", "video/mp4"))).ok).toBe(true);
    expect(videoFromForm(form(video("week-4.mov", "video/quicktime"))).ok).toBe(true);
    expect(videoFromForm(form(video("week-4.webm", "")))).toMatchObject({ ok: true });
  });

  it("says what is wrong in words: nothing chosen, an empty file, or not a video", () => {
    for (const missing of [undefined, "week-4.mp4", video("week-4.mp4", "video/mp4", 0)]) {
      expect(videoFromForm(form(missing))).toEqual({ ok: false, error: "Choose the video file to upload." });
    }
    expect(videoFromForm(form(video("notes.pdf", "application/pdf")))).toEqual({ ok: false, error: "notes.pdf isn't a video. Choose a video file, such as an MP4." });
    expect(videoFromForm(form(video("notes", "")))).toMatchObject({ ok: false });
  });

  it("keeps it under the recording's id with a known suffix, never one taken unchecked from the name", () => {
    expect(videoKey("rec1", video("Week 4.MOV", "video/quicktime"))).toBe("recordings/rec1/source.mov");
    expect(videoKey("rec1", video("week-4", "video/mp4"))).toBe("recordings/rec1/source.mp4");
    expect(videoKey("rec1", video("week-4.mp4/../../x", "video/mp4"))).toBe("recordings/rec1/source.mp4");
    expect(videoKey("rec1", video("clip.exe", "video/mp4"))).toBe("recordings/rec1/source.mp4");
  });

  it("is served as the browser's video type, else as MP4", () => {
    expect(videoContentType(video("a.webm", "video/webm"))).toBe("video/webm");
    expect(videoContentType(video("a.webm", ""))).toBe("video/mp4");
    expect(videoContentType(video("a.webm", "text/html"))).toBe("video/mp4");
  });
});
