import { describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/lib/platform/contracts";
import { CONDUCT_PATH, SPACE_PATHS, WELCOME_PATH } from "@/lib/platform/server/space-routes";
import { ATTENTION_PAGE_HREF } from "@/components/platform/attention/attention-display";
import {
  channelReadMarkerPath, DEMO_CUTOFF, DEMO_ORIGIN, demoEnabled, demoPathAllowed,
  SPACES_APPLY_PATH, SPACES_MARK_READ_PATH, SPACES_READ_PATHS, type DemoPersona,
} from "./staging-demo-policy";
import { QA_CUTOFF, qaPathAllowed } from "./staging-qa-policy";
import { validateQaIdentity } from "./staging-qa-access";
import { stagingFixturePathAllowed } from "./staging-fixture-policy";
import { resolveStagingFixtureIdentity } from "./staging-fixtures";

/** Each restricted staging identity, reduced to one allow decision. */
const IDENTITIES = {
  demo: (path: string, method: string) => demoPathAllowed(path, method),
  "qa:member-noncohort": (path: string, method: string) => qaPathAllowed("member-noncohort", path, method),
  "qa:mentor": (path: string, method: string) => qaPathAllowed("mentor", path, method),
  "qa:institution": (path: string, method: string) => qaPathAllowed("institution", path, method),
  fixture: (path: string, method: string) => stagingFixturePathAllowed(path, method),
} as const;
type Identity = keyof typeof IDENTITIES;
const ALL = Object.keys(IDENTITIES) as Identity[];
const READ = ["GET", "HEAD"];
const WRITE = ["POST", "PUT", "PATCH", "DELETE"];

/** [path, identities allowed GET/HEAD, identities allowed POST]; every other method is denied. */
const SURFACES: [string, Identity[], Identity[]][] = [
  [ROUTES.getMe.path, ALL, []],
  [ROUTES.listAttention.path, ALL, []],
  [`${ROUTES.listAttention.path}/`, ALL, []],
  [ROUTES.countAttention.path, ALL, []],
  [ATTENTION_PAGE_HREF, ALL, []],
  // Own rows only. Fixture cleanup deletes the user and cascades; retained personas have no ledger.
  [SPACES_MARK_READ_PATH, [], ["fixture"]],
  // GET only: a submitted application has no QA ledger or cleanup (QA-1 limit).
  [`${SPACE_PATHS.cohort}/apply`, ["demo", "qa:member-noncohort", "fixture"], []],
  [`${SPACE_PATHS.cohort}/apply/`, ["demo", "qa:member-noncohort", "fixture"], []],
  ["/dashboard/apply", ["demo", "qa:member-noncohort", "fixture"], []],
  // Space homes keep the existing per-persona QA gates.
  [SPACE_PATHS.community, ALL, ["fixture"]],
  [SPACE_PATHS.mentoring, ["demo", "qa:mentor", "fixture"], ["fixture"]],
  [`${SPACE_PATHS.mentoring}/confirm`, ["demo", "qa:mentor", "fixture"], ["fixture"]],
  [SPACE_PATHS.discover, ["demo", "qa:institution", "fixture"], ["fixture"]],
  [SPACE_PATHS.cohort, ALL, []],
  ["/dashboard", ALL, []],
  // Onboarding (B-O.4): partner-page hints must resolve, but no persona chooses or asks for access.
  [WELCOME_PATH, ALL, []],
  [`${WELCOME_PATH}/`, ALL, []],
  // Channel pages and the code of conduct (B-2.2): read-only. Agreeing, posting and reacting stay
  // closed, because retained personas have no cleanup. The flag and channel access still decide.
  ["/dashboard/community/c/introductions", ALL, []],
  ["/dashboard/community/c/show-your-work/", ALL, []],
  ["/dashboard/cohort/c/cohort-04", ALL, []],
  ["/dashboard/cohort/c/c04-announcements", ALL, []],
  [CONDUCT_PATH, ALL, []],
  [`${CONDUCT_PATH}/`, ALL, []],
  // What those pages poll (B-2.3): reads for everyone; the read marker only for fixtures, whose
  // cleanup deletes the user and its markers. Posting, editing and reacting stay closed.
  [ROUTES.listChannels.path, ALL, []],
  [`${ROUTES.listChannels.path}/`, ALL, []],
  ["/api/channels/0f3c9a1be2d84c7aa1b2c3d4e5f60718/messages", ALL, []],
  ["/api/channels/clh3am8hi0000qwer1234abcd/messages/", ALL, []],
  ["/api/channels/0f3c9a1be2d84c7aa1b2c3d4e5f60718/read", [], ["fixture"]],
];

/** Lookalikes, traversal and surfaces that stay closed to every identity and method. */
const DENIED = [
  "/api/attention-x", "/api/attentionx", "/api/attention/x", "/api/attention/read/x", "/api/attention/count/x",
  "/api/attention/../admin/users", "/api/attention/%2e%2e/admin", "/api/attention/count%2f..%2fread",
  // Search stays closed: its handler refuses fixture and QA identities (B-1.4).
  ROUTES.search.path, `${ROUTES.search.path}/`, "/api/search-x", "/api/search/x", "/api/search/../admin", "/api/search/..%2fadmin", "/API/search", "//api/search",
  "/api/platform", "/api/platform/me/x", "/api/platform/me-x", "/api/platform/flags",
  "/dashboard/attention/x", "/dashboard/attention-x", "/dashboard/attention/../../admin",
  "/dashboard/cohort/apply/x", "/dashboard/cohort/apply/../../admin", "/dashboard/apply/x", "/dashboard/applyx", "/dashboard/cohort/applyx",
  SPACE_PATHS.admin, "/admin/users", "/api/admin/users", ROUTES.getFlags.path, "/admin/personal-access-tokens",
  SPACE_PATHS.profile, `${SPACE_PATHS.profile}/portfolio`, "/dashboard/account", "/dashboard/profile",
  "/dashboard/cohort/ask", "/dashboard/ask", "/api/chat", "/api/recordings", "/api/recordings/private", "/dashboard/cohort/sessions/private",
  "/api/messages/x", "/api/messages/x/reactions", ROUTES.listMentors.path, ROUTES.createMentorRequest.path,
  // Channel API lookalikes: one plain id segment, and only the list, messages and read routes.
  "/api/channels/x", "/api/channels/x/messages/y", "/api/channels/x/tembo", "/api/channels//messages", "/api/channels/x%2f..%2fadmin/messages",
  "/api/channels/x.y/messages", "/api/channels/../admin/messages", "/api/channelsx", "/api/channels/x/readx", "/api/channels/x/read/y",
  ROUTES.getMentorAvailability.path, ROUTES.listModerationQueue.path,
  // Moderation (B-2.5): restricted identities neither report, hide, ask for review nor read the queue.
  "/api/messages/x/report", "/api/messages/x/review", "/api/moderation/x", "/api/moderation/queue/x",
  "/dashboard/mentoring/requests", "/dashboard/mentoring/availability", "/dashboard/community/dm/private",
  // Channel lookalikes: only valid slugs, one segment, in the cohort and community spaces.
  "/dashboard/community/c", "/dashboard/community/c/", "/dashboard/community/c/Help", "/dashboard/community/c/help-",
  "/dashboard/community/c/help/x", "/dashboard/community/c/help/messages", "/dashboard/community/c/..%2fadmin",
  "/dashboard/community/c/%2e%2e", "/dashboard/cohort/c/cohort-04/../../../admin", "/dashboard/mentoring/c/help",
  "/dashboard/me/c/help", "/dashboard/c/help", `${CONDUCT_PATH}/x`, `${CONDUCT_PATH}x`, "/dashboard/cohort/conduct",
  // Onboarding writes and lookalikes: retained personas have no cleanup, and agents never decide access.
  `${WELCOME_PATH}/x`, `${WELCOME_PATH}x`, "/dashboard/welcome/../../admin", "/dashboard/welcome%2f..%2fadmin",
  ROUTES.getOnboarding.path, `${ROUTES.getOnboarding.path}/`, "/api/platform/access-requests", "/api/platform/access-requests/x/withdraw",
  "/api/platform/access-requests/x/dismiss", "/api/admin/access-requests", "/api/admin/access-requests/x/decision", "/admin/access-requests",
];

describe("restricted staging identities reach only the Phase 1 spaces surfaces", () => {
  describe.each(SURFACES)("%s", (path, reads, posts) => {
    it.each(ALL)("%s", identity => {
      const allowed = IDENTITIES[identity];
      for (const method of READ) expect(allowed(path, method), `${identity} ${method}`).toBe(reads.includes(identity));
      expect(allowed(path, "POST"), `${identity} POST`).toBe(posts.includes(identity));
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        // Existing fixture space homes are path-scoped; their pages still enforce methods.
        const legacyAnyMethod = identity === "fixture" && posts.includes("fixture") && path !== SPACES_MARK_READ_PATH
          && !channelReadMarkerPath(path);
        expect(allowed(path, method), `${identity} ${method}`).toBe(legacyAnyMethod);
      }
    });
  });

  it.each(DENIED)("denies %s to every identity and method", path => {
    for (const identity of ALL) {
      for (const method of [...READ, ...WRITE]) expect(IDENTITIES[identity](path, method), `${identity} ${method}`).toBe(false);
    }
  });

  it("denies traversal after the router resolves it", () => {
    for (const raw of ["/api/search/../admin", "/api/attention/../admin/users", "/dashboard/cohort/apply/../../admin"]) {
      const resolved = new URL(raw, DEMO_ORIGIN).pathname;
      for (const identity of ALL) expect(IDENTITIES[identity](resolved, "GET"), `${identity} ${resolved}`).toBe(false);
    }
  });

  it("derives the surfaces from the canonical route constants", () => {
    expect([...SPACES_READ_PATHS].toSorted()).toEqual(["/api/attention", "/api/attention/count", "/api/platform/me", "/dashboard/attention", "/dashboard/welcome"]);
    expect(SPACES_APPLY_PATH).toBe("/dashboard/apply");
    expect(SPACES_MARK_READ_PATH).toBe(ROUTES.markAttentionRead.path);
    expect(ROUTES.markAttentionRead.method).toBe("POST");
    for (const route of [ROUTES.getMe, ROUTES.listAttention, ROUTES.countAttention]) expect(route.method).toBe("GET");
  });

  it("never lets the cohort persona open Apply through QA", () => {
    expect(qaPathAllowed("member-cohort" as DemoPersona, SPACES_APPLY_PATH, "GET")).toBe(false);
  });
});

describe("production keeps every restricted identity disabled", () => {
  const beforeCutoffs = Math.min(DEMO_CUTOFF, QA_CUTOFF) - 60;
  const production = ["production", "Staging", "agent-pr-1", "", undefined];

  it.each(production)("demo and QA personas stay disabled in %s", environment => {
    expect(demoEnabled(environment, "true", DEMO_ORIGIN, beforeCutoffs)).toBe(false);
  });

  it.each(production)("QA identities fail before any database read in %s", async environment => {
    const prepare = vi.fn();
    await expect(validateQaIdentity({ DB: { prepare } as unknown as D1Database, DEPLOYMENT_ENVIRONMENT: environment, STAGING_DEMO_ENABLED: "true" }, "unit", beforeCutoffs))
      .rejects.toThrow("QA access");
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(production)("fixture identities fail before any database read in %s", async environment => {
    const prepare = vi.fn();
    const userId = `ttv-staging-fixture-${"a".repeat(24)}-member`;
    await expect(resolveStagingFixtureIdentity({
      db: { prepare } as unknown as D1Database, envName: environment, isPat: false,
      user: { id: userId, email: `${userId}@invalid.ttv` }, session: { id: `${userId}-session`, userAgent: `ttv-agent:synthetic-staging:${"a".repeat(24)}` },
    })).rejects.toMatchObject({ status: 403 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("demo and QA stay closed on staging after the cutoff or off the staging origin", () => {
    expect(demoEnabled("staging", "true", DEMO_ORIGIN, DEMO_CUTOFF)).toBe(false);
    expect(demoEnabled("staging", "true", "https://tembotechventures.com", beforeCutoffs)).toBe(false);
  });
});
