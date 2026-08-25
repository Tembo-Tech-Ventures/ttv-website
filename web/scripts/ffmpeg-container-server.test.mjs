/* global Request */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleProcess,
  handleSegment,
  TRANSCRIPTION_CHUNK_SECONDS,
  upload,
} from "../containers/ffmpeg/server.js";

let tempDir;
let originalPath;

async function installFakeFfmpegTools() {
  const binDir = path.join(tempDir, "bin");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "ffmpeg"),
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const segmentTimeIndex = args.indexOf("-segment_time");
if (segmentTimeIndex >= 0) {
  if (args[segmentTimeIndex + 1] !== "120") process.exit(43);
  const outputPattern = args.at(-1);
  const chunksDir = path.dirname(outputPattern);
  writeFileSync(path.join(chunksDir, "chunk-00000.mp3"), "fake chunk 0");
  writeFileSync(path.join(chunksDir, "chunk-00001.mp3"), "fake chunk 1");
} else {
  writeFileSync(args.at(-1), "fake mp3");
}
`
  );
  await writeFile(
    path.join(binDir, "ffprobe"),
    `#!/usr/bin/env node
const file = process.argv.at(-1);
if (file.endsWith("chunk-00000.mp3")) console.log("60.25");
else if (file.endsWith("chunk-00001.mp3")) console.log("63.15");
else console.log("123.4");
`
  );
  await chmod(path.join(binDir, "ffmpeg"), 0o755);
  await chmod(path.join(binDir, "ffprobe"), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath}`;
}

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

  it("extracts audio and uploads independently valid time-based MP3 chunks", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ffmpeg-container-test-"));
    await writeFile(
      path.join(tempDir, "source.mp4"),
      "not a real mp4, but enough for the fake tools"
    );
    await installFakeFfmpegTools();
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
      transcriptionChunks: [
        {
          chunkIndex: 0,
          r2AudioKey:
            "recordings/recording1/transcription/chunk-00000.mp3",
          offsetSeconds: 0,
          durationSeconds: 60.25,
        },
        {
          chunkIndex: 1,
          r2AudioKey:
            "recordings/recording1/transcription/chunk-00001.mp3",
          offsetSeconds: 60.25,
          durationSeconds: 63.15,
        },
      ],
    });
    expect(uploads).toEqual([
      {
        url: "http://r2.local/recordings%2Frecording1%2Faudio.mp3",
        contentLength: "8",
        contentType: "audio/mpeg",
      },
      {
        url: "http://r2.local/recordings%2Frecording1%2Ftranscription%2Fchunk-00000.mp3",
        contentLength: "12",
        contentType: "audio/mpeg",
      },
      {
        url: "http://r2.local/recordings%2Frecording1%2Ftranscription%2Fchunk-00001.mp3",
        contentLength: "12",
        contentType: "audio/mpeg",
      },
    ]);
    expect(TRANSCRIPTION_CHUNK_SECONDS).toBe(120);
  });

  it("segments an existing R2 audio object for transcription retries", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ffmpeg-container-test-"));
    await installFakeFfmpegTools();
    const uploads = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (init?.method === "PUT") {
        uploads.push(requestUrl);
        return new Response(null, { status: 200 });
      }
      return new Response("existing audio bytes", { status: 200 });
    });

    const response = await handleSegment(
      new Request("http://container/segment", {
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2AudioKey: "recordings/recording1/audio.mp3",
        }),
      })
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      r2AudioKey: "recordings/recording1/audio.mp3",
      durationSeconds: 123,
      transcriptionChunks: [
        {
          chunkIndex: 0,
          r2AudioKey:
            "recordings/recording1/transcription/chunk-00000.mp3",
          offsetSeconds: 0,
          durationSeconds: 60.25,
        },
        {
          chunkIndex: 1,
          r2AudioKey:
            "recordings/recording1/transcription/chunk-00001.mp3",
          offsetSeconds: 60.25,
          durationSeconds: 63.15,
        },
      ],
    });
    expect(uploads).toEqual([
      "http://r2.local/recordings%2Frecording1%2Ftranscription%2Fchunk-00000.mp3",
      "http://r2.local/recordings%2Frecording1%2Ftranscription%2Fchunk-00001.mp3",
    ]);
  });

  it("rejects attempts to segment audio owned by another recording", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await handleSegment(
      new Request("http://container/segment", {
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2AudioKey: "recordings/recording2/audio.mp3",
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "r2AudioKey must belong to the recording",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
