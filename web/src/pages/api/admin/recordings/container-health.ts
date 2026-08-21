import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

const HEALTH_INSTANCE_NAME = "recording-container-health";

type StartableContainer = DurableObjectStub & {
  start(): void;
};

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const container = env.FFMPEG_CONTAINER.getByName(
      HEALTH_INSTANCE_NAME
    ) as StartableContainer;
    container.start();
    const response = await container.fetch("https://ffmpeg/health");
    if (!response.ok) {
      return Response.json(
        { error: "FFmpeg container health check failed." },
        { status: 502 }
      );
    }

    const result = (await response.json()) as { ok?: unknown };
    if (result.ok !== true) {
      return Response.json(
        { error: "FFmpeg container returned an invalid health response." },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, service: "ffmpeg-container" });
  } catch {
    return Response.json(
      { error: "FFmpeg container could not be reached." },
      { status: 502 }
    );
  }
};
