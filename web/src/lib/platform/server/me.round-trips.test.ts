import { addMemberSchema } from "@/test/member-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { withRoundTrips } from "@/test/d1-round-trips";
import { tracePerf } from "@/lib/observability/perf-trace";
import { createCapabilityDatabase } from "./capabilities.test-support";
import { withRequestScope } from "./request-scope";

vi.mock("cloudflare:workers", () => ({ env: {} }));
import { getMe } from "./me";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup(globalRoles: string[]) {
  const fixture = createCapabilityDatabase({
    globalRoles,
    applications: [{ programId: "cohort-a", status: "APPROVED" }],
  });
  databases.push(fixture.database);
  for (const migration of [
    "0002_married_microbe.sql",
    "0003_absurd_argent.sql",
    "0017_community_discovery.sql",
    "0021_feature_flags.sql",
    "0023_attention_items.sql",
    "0025_onboarding.sql",
    "0027_mentor_set_aside.sql",
    "0028_channels.sql",
    "0032_moderation_pipeline.sql",
    "0035_tembo.sql",
    "0036_mentor_requests.sql",
    "0037_mentor_request_checks.sql",
  ]) {
    fixture.database.exec(readMigration(migration));
  }
  addMemberSchema(fixture.database);
  fixture.database.exec("UPDATE feature_flag SET audience='ALL'");
  const db = withRoundTrips(fixture.db.$client);
  const user = {
    id: "synthetic-wanjiku",
    name: "Wanjiku Njeri",
    image: null,
    email: "w@example.test",
    emailVerified: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const locals = {
    user,
    session: { id: "s", userId: user.id, userAgent: "browser" },
  } as unknown as App.Locals;
  return { fixture, db, locals, env: { DEPLOYMENT_ENVIRONMENT: "production" } };
}

describe("getMe round trips (PERF-2)", () => {
  it("reads flags with capabilities, then attention and Tembo usage together", async () => {
    const { db, locals, env } = setup([]);
    const { result, summary } = await tracePerf(db, () =>
      withRequestScope("GET", () => getMe({ db, env, locals })),
    );
    expect(result.flags.tembo_channels).toBe(true);
    expect(summary.depth).toBe(2);
    expect(
      summary.queries
        ?.filter(({ depth }) => depth === 1)
        .map(({ sql }) => /from "?(\w+)"?/i.exec(sql)?.[1])
        .toSorted(),
    ).toEqual(["Roles", "feature_flag", "programApplication", "programRole"]);
  });

  it("adds a mentor's awaiting count beside attention, not after it", async () => {
    const { db, locals, env } = setup(["MENTOR"]);
    const { result, summary } = await tracePerf(db, () =>
      withRequestScope("GET", () => getMe({ db, env, locals })),
    );
    expect(result.mentoring?.awaitingConfirmation).toBe(0);
    const attention = summary.queries!.find(({ sql }) =>
      sql.includes("attention_item"),
    )!;
    expect(attention.depth).toBe(2);
    expect(summary.depth).toBeLessThanOrEqual(3);
  });

  it("refuses exactly as before when the flag is off, with nothing read after the flag", async () => {
    const { fixture, db, locals, env } = setup(["ADMIN"]);
    fixture.database.exec(
      "UPDATE feature_flag SET audience='OFF' WHERE key='spaces'",
    );
    const { result, summary } = await tracePerf(db, () =>
      withRequestScope("GET", () =>
        getMe({ db, env, locals }).catch((denial: Response) => denial),
      ),
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(await (result as Response).json()).toEqual({
      error: { code: "flag_off", message: "Not found." },
    });
    expect(summary.depth).toBe(1);
  });
});
