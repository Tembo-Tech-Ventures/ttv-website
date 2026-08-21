/* global Request */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleProcess, upload } from "../containers/ffmpeg/server.js";

let tempDir;
let originalPath;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalPath !== undefined) {
    process.env.PATH = originalPath;
    originalPath = undefined;
  }
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

  it("extracts audio directly from the source and uploads only the MP3", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ffmpeg-container-test-"));
    const binDir = path.join(tempDir, "bin");
    await writeFile(
      path.join(tempDir, "source.mp4"),
      "not a real mp4, but enough for the fake tools"
    );
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, "ffmpeg"),
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("-movflags")) process.exit(42);
writeFileSync(args.at(-1), "fake mp3");
`
    );
    await writeFile(
      path.join(binDir, "ffprobe"),
      `#!/usr/bin/env node
console.log("123.4");
`
    );
    await chmod(path.join(binDir, "ffmpeg"), 0o755);
    await chmod(path.join(binDir, "ffprobe"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath}`;
    const uploads = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (init?.method === "PUT") {
        uploads.push({
          url: requestUrl,
          contentLength: init.headers["content-length"],
          contentType: init.headers["content-type"],
        });
        return new Response(null, { status: 200 });
      }
      return new Response("source video bytes", { status: 200 });
    });

    const response = await handleProcess(
      new Request("http://container/process", {
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2VideoKey: "recordings/recording1/source.mp4",
        }),
      })
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      r2VideoKey: "recordings/recording1/source.mp4",
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 123,
      fileSizeBytes: 18,
    });
    expect(uploads).toEqual([
      {
        url: "http://r2.local/recordings%2Frecording1%2Faudio.mp3",
        contentLength: "8",
        contentType: "audio/mpeg",
      },
    ]);
  });
});
