import type { APIContext } from "astro";
import type { Me, MentorAvailability } from "@/lib/platform/contracts";
import { recordError } from "@/lib/observability/errors";
import { mentorsServer } from "./server";

export interface MentoringOverviewData {
  /** Requests waiting for this mentor's answer, or null when not known (a floor of a full first page is still a number). */
  waiting: number | null;
  availability: MentorAvailability | null;
  now: number;
}

/**
 * What the Mentoring overview says about requests and availability (U-4.1). A failed read is
 * recorded and the overview says nothing it cannot back: the cards still link to their pages.
 */
export async function loadMentoringOverview(context: Pick<APIContext, "locals" | "url">, env: Env, me: Me): Promise<MentoringOverviewData> {
  const now = Date.now();
  const server = mentorsServer(context, env, me, now);
  const [waiting, availability] = await Promise.all([
    server.requests({ as: "mentor", status: "PENDING" }).then((page) => page.items.length, (error: unknown) => report(env, error)),
    server.availability().catch((error: unknown) => report(env, error)),
  ]);
  return { waiting, availability, now };
}

async function report(env: Env, error: unknown): Promise<null> {
  await recordError(env.DB, { source: "request", route: "/dashboard/mentoring", error, level: "warning" });
  return null;
}
