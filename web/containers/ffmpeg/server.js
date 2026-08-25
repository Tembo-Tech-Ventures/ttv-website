import { createReadStream, createWriteStream } from "node:fs";
/* global Request, Response, console, fetch, performance, process */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

const R2_HOST = "http://r2.local";
export const TRANSCRIPTION_CHUNK_SECONDS = 120;
const TRANSCRIPTION_CHUNK_FILE_PATTERN = /^chunk-(\d{5})\.mp3$/;

function log(event, fields = {}) {
  console.log(
    JSON.stringify({
      event,
      component: "ffmpeg_container",
      ...fields,
    })
  );
}

function elapsedMs(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout || stderr);
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr}`));
    });
  });
}

async function download(key, target) {
  const startedAt = performance.now();
  log("r2_download_start", { key });
  const response = await fetch(`${R2_HOST}/${encodeURIComponent(key)}`);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${key}: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(target));
  const fileStats = await stat(target);
  log("r2_download_done", {
    key,
    bytes: fileStats.size,
    elapsedMs: elapsedMs(startedAt),
  });
}

export async function upload(key, source, contentType) {
  const startedAt = performance.now();
  const fileStats = await stat(source);
  log("r2_upload_start", { key, bytes: fileStats.size, contentType });
  const stream = createReadStream(source);
  const response = await fetch(`${R2_HOST}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      "content-length": String(fileStats.size),
      "content-type": contentType,
    },
    body: stream,
    duplex: "half",
  });
  if (!response.ok) {
    throw new Error(`Unable to upload ${key}: ${response.status}`);
  }
  log("r2_upload_done", {
    key,
    bytes: fileStats.size,
    elapsedMs: elapsedMs(startedAt),
  });
}

async function probeDuration(file) {
  const startedAt = performance.now();
  log("ffprobe_duration_start", { file });
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = Number.parseFloat(output.trim());
  log("ffprobe_duration_done", {
    file,
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
    elapsedMs: elapsedMs(startedAt),
  });
  return Number.isFinite(duration) ? duration : undefined;
}

function validateRecordingId(recordingId) {
  return typeof recordingId === "string" && /^[a-z0-9]+$/i.test(recordingId);
}

async function createTranscriptionChunks({ recordingId, audio, workDir }) {
  const chunksDir = path.join(workDir, "transcription-chunks");
  await rm(chunksDir, { force: true, recursive: true });
  await mkdir(chunksDir, { recursive: true });

  const outputPattern = path.join(chunksDir, "chunk-%05d.mp3");
  const startedAt = performance.now();
  log("ffmpeg_audio_segment_start", {
    recordingId,
    chunkSeconds: TRANSCRIPTION_CHUNK_SECONDS,
  });
  await run("ffmpeg", [
    "-y",
    "-i",
    audio,
    "-map",
    "0:a:0",
    "-c:a",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(TRANSCRIPTION_CHUNK_SECONDS),
    "-segment_format",
    "mp3",
    "-reset_timestamps",
    "1",
    outputPattern,
  ]);

  const files = (await readdir(chunksDir))
    .filter((file) => TRANSCRIPTION_CHUNK_FILE_PATTERN.test(file))
    .toSorted();
  if (files.length === 0) {
    throw new Error("FFmpeg did not create any transcription chunks");
  }

  const chunks = [];
  let offsetSeconds = 0;
  for (const [chunkIndex, file] of files.entries()) {
    const source = path.join(chunksDir, file);
    const durationSeconds = await probeDuration(source);
    if (!durationSeconds || durationSeconds <= 0) {
      throw new Error(`Unable to determine duration for transcription chunk ${file}`);
    }
    const r2AudioKey = `recordings/${recordingId}/transcription/${file}`;
    await upload(r2AudioKey, source, "audio/mpeg");
    chunks.push({
      chunkIndex,
      r2AudioKey,
      offsetSeconds,
      durationSeconds,
    });
    offsetSeconds += durationSeconds;
  }

  log("ffmpeg_audio_segment_done", {
    recordingId,
    chunkCount: chunks.length,
    durationSeconds: offsetSeconds,
    elapsedMs: elapsedMs(startedAt),
  });
  return chunks;
}

export async function handleProcess(request) {
  const { recordingId, r2VideoKey } = await request.json();
  if (!recordingId || !r2VideoKey) {
    return Response.json({ error: "recordingId and r2VideoKey are required" }, { status: 400 });
  }

  if (!validateRecordingId(recordingId)) {
    return Response.json({ error: "Invalid recordingId" }, { status: 400 });
  }
  const workDir = path.join(tmpdir(), recordingId);
  await mkdir(workDir, { recursive: true });
  const input = path.join(workDir, "input.mp4");
  const audio = path.join(workDir, "audio.mp3");

  const processStartedAt = performance.now();
  log("process_start", { recordingId, r2VideoKey });
  await download(r2VideoKey, input);
  let stepStartedAt = performance.now();
  log("ffmpeg_audio_extract_start", { recordingId });
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-ac",
    "1",
    "-ar",
    "16000",
    audio,
  ]);
  log("ffmpeg_audio_extract_done", {
    recordingId,
    bytes: (await stat(audio)).size,
    elapsedMs: elapsedMs(stepStartedAt),
  });

  const audioKey = `recordings/${recordingId}/audio.mp3`;

  await upload(audioKey, audio, "audio/mpeg");

  const fileStats = await stat(input);
  const sourceDurationSeconds = await probeDuration(input);
  const transcriptionChunks = await createTranscriptionChunks({
    recordingId,
    audio,
    workDir,
  });
  const durationSeconds = sourceDurationSeconds
    ? Math.round(sourceDurationSeconds)
    : undefined;

  log("process_done", {
    recordingId,
    r2VideoKey,
    audioKey,
    durationSeconds,
    fileSizeBytes: fileStats.size,
    elapsedMs: elapsedMs(processStartedAt),
  });

  return Response.json({
    r2VideoKey,
    r2AudioKey: audioKey,
    transcriptionChunks,
    durationSeconds,
    fileSizeBytes: fileStats.size,
  });
}

export async function handleSegment(request) {
  const { recordingId, r2AudioKey } = await request.json();
  if (!recordingId || !r2AudioKey) {
    return Response.json(
      { error: "recordingId and r2AudioKey are required" },
      { status: 400 }
    );
  }
  if (!validateRecordingId(recordingId)) {
    return Response.json({ error: "Invalid recordingId" }, { status: 400 });
  }
  if (!r2AudioKey.startsWith(`recordings/${recordingId}/`)) {
    return Response.json(
      { error: "r2AudioKey must belong to the recording" },
      { status: 400 }
    );
  }

  const workDir = path.join(tmpdir(), recordingId);
  await mkdir(workDir, { recursive: true });
  const audio = path.join(workDir, "existing-audio.mp3");
  const processStartedAt = performance.now();
  log("segment_process_start", { recordingId, r2AudioKey });
  await download(r2AudioKey, audio);
  const sourceDurationSeconds = await probeDuration(audio);
  const transcriptionChunks = await createTranscriptionChunks({
    recordingId,
    audio,
    workDir,
  });
  const durationSeconds = sourceDurationSeconds
    ? Math.round(sourceDurationSeconds)
    : undefined;
  log("segment_process_done", {
    recordingId,
    r2AudioKey,
    chunkCount: transcriptionChunks.length,
    durationSeconds,
    elapsedMs: elapsedMs(processStartedAt),
  });

  return Response.json({
    r2AudioKey,
    transcriptionChunks,
    durationSeconds,
  });
}

export function startServer(port = 8080) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/process") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await handleProcess(
          new Request("http://container/process", {
            method: "POST",
            body: Buffer.concat(chunks),
            headers: { "content-type": "application/json" },
          })
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
        return;
      }

      if (request.method === "POST" && request.url === "/segment") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await handleSegment(
          new Request("http://container/segment", {
            method: "POST",
            body: Buffer.concat(chunks),
            headers: { "content-type": "application/json" },
          })
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
        return;
      }

      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.writeHead(404);
      response.end("Not found");
    } catch (error) {
      log("process_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }).listen(port);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
