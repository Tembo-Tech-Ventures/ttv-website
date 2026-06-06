import { env } from "cloudflare:workers";

export async function GET({ params }: { params: { key?: string | string[] } }) {
  const requestedKey = Array.isArray(params.key)
    ? params.key.join("/")
    : params.key;

  if (!requestedKey || !requestedKey.startsWith("avatars/")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.BUCKET.get(requestedKey);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, {
    headers,
  });
}
