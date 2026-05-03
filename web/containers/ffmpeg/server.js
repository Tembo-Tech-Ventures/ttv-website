import { createReadStream, createWriteStream } from "node:fs";
/* global Request, Response, fetch */
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const R2_HOST = "http://r2.local";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr}`));
    });
  });
}

async function download(key, target) {
  const response = await fetch(`${R2_HOST}/${encodeURIComponent(key)}`);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${key}: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(target));
}

async function upload(key, source, contentType) {
  const stream = createReadStream(source);
  const response = await fetch(`${R2_HOST}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: stream,
    duplex: "half",
  });
  if (!response.ok) {
    throw new Error(`Unable to upload ${key}: ${response.status}`);
  }
}

async function probeDuration(file) {
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
  return Number.isFinite(duration) ? Math.round(duration) : undefined;
}

async function handleProcess(request) {
  const { recordingId, r2VideoKey } = await request.json();
  if (!recordingId || !r2VideoKey) {
    return Response.json({ error: "recordingId and r2VideoKey are required" }, { status: 400 });
  }

  const workDir = path.join(tmpdir(), recordingId);
  await mkdir(workDir, { recursive: true });
  const input = path.join(workDir, "input.mp4");
  const faststart = path.join(workDir, "faststart.mp4");
  const audio = path.join(workDir, "audio.mp3");

  await download(r2VideoKey, input);
  await run("ffmpeg", ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", faststart]);
  await run("ffmpeg", [
    "-y",
    "-i",
    faststart,
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

  const processedVideoKey = r2VideoKey.endsWith(".mp4")
    ? r2VideoKey.replace(/\.mp4$/, ".faststart.mp4")
    : `${r2VideoKey}.faststart.mp4`;
  const audioKey = `recordings/${recordingId}/audio.mp3`;

  await upload(processedVideoKey, faststart, "video/mp4");
  await upload(audioKey, audio, "audio/mpeg");

  const fileStats = await stat(faststart);
  const durationSeconds = await probeDuration(faststart);

  return Response.json({
    r2VideoKey: processedVideoKey,
    r2AudioKey: audioKey,
    durationSeconds,
    fileSizeBytes: fileStats.size,
  });
}

createServer(async (request, response) => {
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

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(8080);
