import { Container } from "@cloudflare/containers";
export { ContainerProxy } from "@cloudflare/containers";
import { handle } from "@astrojs/cloudflare/handler";
import { processRecordingMessage } from "@/lib/recordings/pipeline";
import { syncEnabledRecordingImportSources } from "@/lib/recordings/importer";

export class FfmpegContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "2m";

  async onActivityExpired() {
    await this.destroy();
  }

  async checkHealth() {
    return await this.fetchJsonWithShutdown("https://ffmpeg/health");
  }

  async processRecording(payload: { recordingId: string; r2VideoKey: string }) {
    return await this.fetchJsonWithShutdown("https://ffmpeg/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async segmentAudio(payload: { recordingId: string; r2AudioKey: string }) {
    return await this.fetchJsonWithShutdown("https://ffmpeg/segment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private async fetchJsonWithShutdown(input: string, init?: RequestInit) {
    await this.start();
    try {
      const response = await this.containerFetch(input, init);
      return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      };
    } finally {
      await this.destroy();
    }
  }
}

FfmpegContainer.outboundByHost = {
  "r2.local": async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

    if (!key.startsWith("recordings/")) {
      return new Response("Forbidden: access restricted to recordings/", { status: 403 });
    }

    if (request.method === "GET") {
      const object = await env.BUCKET.get(key);
      return new Response(object?.body ?? null, {
        status: object ? 200 : 404,
        headers: object
          ? {
              "content-type":
                object.httpMetadata?.contentType ?? "application/octet-stream",
              "content-length": String(object.size),
            }
          : undefined,
      });
    }

    if (request.method === "PUT") {
      await env.BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType:
            request.headers.get("content-type") ?? "application/octet-stream",
        },
      });
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      await processRecordingMessage(message.body, env);
      message.ack();
    }
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(syncEnabledRecordingImportSources(env));
  },
} satisfies ExportedHandler<Env, unknown>;
