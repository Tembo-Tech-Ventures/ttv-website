export const HEALTH_PATH = "/api/health";

type HealthRuntimeEnv = Pick<
  Cloudflare.Env,
  "DEPLOYMENT_ENVIRONMENT" | "DEPLOYMENT_VERSION"
>;

export function isHealthCheckPath(pathname: string) {
  return pathname === HEALTH_PATH;
}

export function createHealthPayload(runtimeEnv: HealthRuntimeEnv) {
  return {
    status: "ok" as const,
    service: "ttv-website" as const,
    environment: runtimeEnv.DEPLOYMENT_ENVIRONMENT ?? "unknown",
    version: runtimeEnv.DEPLOYMENT_VERSION ?? "unknown",
  };
}

export function createHealthResponse(runtimeEnv: HealthRuntimeEnv) {
  return Response.json(createHealthPayload(runtimeEnv), {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
