import { Container } from "@cloudflare/containers";
import { handle } from "@astrojs/cloudflare/handler";
import { processRecordingMessage } from "@/lib/recordings/pipeline";

export class FfmpegContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "2m";
}

FfmpegContainer.outboundByHost = {
  "r2.local": async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

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
} satisfies ExportedHandler<Env, unknown>;
