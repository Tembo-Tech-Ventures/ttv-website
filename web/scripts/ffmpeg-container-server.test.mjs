import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upload } from "../containers/ffmpeg/server.js";

let tempDir;

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("FFmpeg container R2 uploads", () => {
  it("sends content-length so ContainerProxy accepts the stream", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ffmpeg-container-test-"));
    const source = path.join(tempDir, "audio.mp3");
    await writeFile(source, "fixed length");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await upload("recordings/recording1/audio.mp3", source, "audio/mpeg");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://r2.local/recordings%2Frecording1%2Faudio.mp3",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "content-length": "12",
          "content-type": "audio/mpeg",
        },
        duplex: "half",
      })
    );
  });
});
