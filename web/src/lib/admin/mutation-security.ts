const UNSAFE_ADMIN_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const ADMIN_MUTATION_ORIGIN_ERROR =
  "Forbidden: a same-origin admin request is required.";

function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

export function requiresAdminMutationOrigin(
  method: string,
  pathname: string
): boolean {
  return UNSAFE_ADMIN_METHODS.has(method.toUpperCase()) && isAdminPath(pathname);
}

export function hasMatchingRequestOrigin(request: Request): boolean {
  const header = request.headers.get("Origin");
  if (!header) return false;

  try {
    const origin = new URL(header);
    const requestUrl = new URL(request.url);
    const isHttpOrigin =
      origin.protocol === "http:" || origin.protocol === "https:";
    const hasOnlyOriginComponents =
      origin.username === "" &&
      origin.password === "" &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === "";

    return (
      isHttpOrigin &&
      hasOnlyOriginComponents &&
      origin.origin === requestUrl.origin
    );
  } catch {
    return false;
  }
}

export function enforceAdminMutationOrigin(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (!requiresAdminMutationOrigin(request.method, pathname)) return null;
  if (hasMatchingRequestOrigin(request)) return null;

  return new Response(ADMIN_MUTATION_ORIGIN_ERROR, {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
