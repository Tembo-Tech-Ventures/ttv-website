/**
 * PERF-2 regression: the D1 reads a representative spaces and admin GET make before and while they
 * render, through the real middleware and the real page, on SQLite with every migration. Each D1 call
 * answers on a later macrotask (d1-round-trips.ts), so `depth` (round trips one after another) is
 * deterministic. Authentication is mocked, so its reads (session and user: two in production) are
 * not counted here. Raise a budget only with a reason: each round trip costs a visitor far from D1
 * 200–300 ms (web/docs/performance.md).
 */
import { readdirSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRoundTrips } from "@/test/d1-round-trips";
import { withRaw } from "@/lib/attention/test-support";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { tracePerf } = await import("@/lib/observability/perf-trace");

const STUDENT = "synthetic-wanjiku";
const ADMIN = "synthetic-amina";
const MENTOR = "synthetic-david";
const DIRECT = "synthetic-direct";
const BUILDER = "synthetic-achieng";
const INSTITUTION = "synthetic-joseph";
const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function seeded() {
  const { database: sqlite, db } = createSqliteD1();
  databases.push(sqlite);
  for (const file of readdirSync(new URL("../../lib/db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort 07','Test','curriculum',0,4102444800);
    INSERT INTO user(id,name,email) VALUES ('${STUDENT}','Wanjiku Njeri','wanjiku@example.test'),('${ADMIN}','Amina Hassan','amina@example.test'),
      ('${MENTOR}','David Kamau','david@example.test');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application','${STUDENT}','cohort-a','APPROVED','{}');
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','${ADMIN}',id FROM Roles WHERE name='ADMIN';
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'mentor-role','${MENTOR}',id FROM Roles WHERE name='MENTOR';
    INSERT INTO user(id,name,email) VALUES ('${INSTITUTION}','Joseph Mutua','joseph@example.test');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'institution-role','${INSTITUTION}',id FROM Roles WHERE name='INSTITUTION';
    INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused) VALUES
      ('${MENTOR}','Backend engineer','Reviews APIs.','["Code review"]','["WRITTEN_REVIEW"]',3,0);
    INSERT INTO feedback(id,userId,kind,message,pageUrl,createdAt,updatedAt) VALUES ('feedback','${STUDENT}','CONFUSING','Fictional note.','/dashboard/cohort/sessions',0,0);
    INSERT INTO feedback_theme(id,title,summary,kind,status,createdAt,updatedAt) VALUES ('theme','Session links are hard to find','Fictional theme.','CONFUSING','COLLECTING',0,0);
    INSERT INTO user(id,name,email) VALUES ('synthetic-achieng','Achieng Otieno','achieng@example.test');
    INSERT INTO studentProfile(id,userId,handle,status,headline) VALUES ('profile','synthetic-achieng','achieng-otieno','PUBLISHED','Fictional builder');
    INSERT INTO profileContact(id,profileId,fromName,fromEmail,organization,message) VALUES ('lead','profile','Grace Wanjiru','grace@example.test','Chama Savings','Fictional message.');
    INSERT INTO blogPost(id,profileId,slug,title,contentMarkdown) VALUES ('draft','profile','first-draft','A first draft','Fictional.');
    UPDATE studentProfile SET bio='Builds savings tools.',skills='["TypeScript"]',opportunityGoals='A first role' WHERE userId='synthetic-achieng';
    INSERT INTO communityJourney(id,userId,title,description,occurredAt,visibility) VALUES ('contribution','synthetic-achieng','Savings tracker','Fictional work.','2026-01-01','institution');
    INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('confirmation','contribution','${MENTOR}','Fictional statement.','REVIEWED_WORK',1);
    INSERT INTO clientProject(id,organization,contactName,contactEmail,title,description,status) VALUES ('project','Chama Savings','Grace Wanjiru','grace@example.test','Member savings tracker','Fictional project.','APPROVED');
    INSERT INTO recording(id,programId,title,processingStatus) VALUES ('recording','cohort-a','Week 3: Testing a service','complete');
    INSERT INTO transcript_segment(id,recordingId,startTime,endTime,speaker,text) VALUES ('segment','recording',0,4,'Mentor','Welcome back.');
    UPDATE feature_flag SET audience='ALL';`);
  // One request waiting for the mentor, for the Mentoring space's Requests page.
  sqlite.exec(`INSERT INTO mentor_request(id,requesterId,mentorId,format,note) VALUES ('mentor-request','${STUDENT}','${MENTOR}','WRITTEN_REVIEW','A review?');`);
  const cohortChannel = sqlite.prepare("SELECT id, slug FROM channel WHERE kind='COHORT' AND programId='cohort-a' ORDER BY position LIMIT 1").get() as { id: string; slug: string };
  // The student has agreed to the habits, so their channel pages show the conversation; the admin has
  // not, so theirs show the habits first. One message in each conversation, so its authors are read.
  sqlite.exec(`INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES ('${STUDENT}',1,0);
    INSERT INTO channel(id,kind,slug,name) VALUES ('${DIRECT}','DIRECT','dm','Amina Hassan');
    INSERT INTO channel_member(channelId,userId) VALUES ('${DIRECT}','${STUDENT}'),('${DIRECT}','${ADMIN}');
    INSERT INTO channel_message(id,channelId,seq,changeSeq,authorId,body) VALUES
      ('cohort-hello','${cohortChannel.id}',1,1,'${STUDENT}','Habari, cohort'),('direct-hello','${DIRECT}',1,1,'${ADMIN}','Karibu');`);
  return { db: withRoundTrips(withRaw(sqlite, db)), cohortChannel: cohortChannel.slug };
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const PAGES = {
  "cohort overview": { path: () => "/dashboard/cohort", page: () => import("@/pages/dashboard/index.astro"), user: STUDENT },
  "cohort sessions": { path: () => "/dashboard/cohort/sessions", page: () => import("@/pages/dashboard/sessions/index.astro"), user: STUDENT },
  "session viewer": { path: () => "/dashboard/cohort/sessions/recording", page: () => import("@/pages/dashboard/sessions/[id].astro"), user: STUDENT, id: "recording" },
  "cohort channel": { path: (slug: string) => `/dashboard/cohort/c/${slug}`, page: () => import("@/pages/dashboard/cohort/c/[slug].astro"), user: STUDENT },
  "cohort channel, first visit": { path: (slug: string) => `/dashboard/cohort/c/${slug}`, page: () => import("@/pages/dashboard/cohort/c/[slug].astro"), user: ADMIN },
  conversation: { path: () => `/dashboard/community/dm/${DIRECT}`, page: () => import("@/pages/dashboard/community/dm/[id].astro"), user: STUDENT },
  community: { path: () => "/dashboard/community", page: () => import("@/pages/dashboard/community.astro"), user: STUDENT },
  conduct: { path: () => "/dashboard/community/conduct", page: () => import("@/pages/dashboard/community/conduct.astro"), user: ADMIN },
  mentors: { path: () => "/dashboard/community/mentors", page: () => import("@/pages/dashboard/community/mentors.astro"), user: STUDENT },
  members: { path: () => "/dashboard/community/members", page: () => import("@/pages/dashboard/community/members/index.astro"), user: STUDENT },
  "members, searched": { path: () => "/dashboard/community/members?q=savings&skills=TypeScript&open=roles", page: () => import("@/pages/dashboard/community/members/index.astro"), user: INSTITUTION },
  "member page": { path: () => "/dashboard/community/members/achieng-otieno", page: () => import("@/pages/dashboard/community/members/[handle].astro"), user: STUDENT, handle: "achieng-otieno" },
  discover: { path: () => "/dashboard/discover", page: () => import("@/pages/dashboard/discover.astro"), user: INSTITUTION },
  "discover, a person": { path: () => `/dashboard/discover?profile=${BUILDER}`, page: () => import("@/pages/dashboard/discover.astro"), user: INSTITUTION },
  "mentoring home": { path: () => "/dashboard/mentoring", page: () => import("@/pages/dashboard/mentorship.astro"), user: MENTOR },
  "mentoring confirm": { path: () => "/dashboard/mentoring/confirm", page: () => import("@/pages/dashboard/mentorship.astro"), user: MENTOR },
  "mentoring availability": { path: () => "/dashboard/mentoring/availability", page: () => import("@/pages/dashboard/mentoring/availability.astro"), user: MENTOR },
  "mentors, filtered": { path: () => "/dashboard/community/mentors?area=Code%20review&available=true", page: () => import("@/pages/dashboard/community/mentors.astro"), user: STUDENT },
  "mentoring requests": { path: () => "/dashboard/mentoring/requests", page: () => import("@/pages/dashboard/mentoring/requests.astro"), user: MENTOR },
  application: { path: () => "/dashboard/cohort/application/application", page: () => import("@/pages/dashboard/application/[id].astro"), user: STUDENT, id: "application" },
  apply: { path: () => "/dashboard/cohort/apply", page: () => import("@/pages/dashboard/apply.astro"), user: STUDENT },
  ask: { path: () => "/dashboard/cohort/ask", page: () => import("@/pages/dashboard/ask.astro"), user: STUDENT },
  attention: { path: () => "/dashboard/attention", page: () => import("@/pages/dashboard/attention.astro"), user: STUDENT },
  "admin home": { path: () => "/admin", page: () => import("@/pages/admin/index.astro"), user: ADMIN },
  account: { path: () => "/dashboard/account", page: () => import("@/pages/dashboard/profile.astro"), user: STUDENT },
  "profile overview": { path: () => "/dashboard/me", page: () => import("@/pages/dashboard/me/index.astro"), user: STUDENT },
  "profile overview, published": { path: () => "/dashboard/me", page: () => import("@/pages/dashboard/me/index.astro"), user: BUILDER },
  "your feedback": { path: () => "/dashboard/feedback", page: () => import("@/pages/dashboard/feedback.astro"), user: STUDENT },
  "public profile editor": { path: () => "/dashboard/me/portfolio", page: () => import("@/pages/dashboard/portfolio.astro"), user: BUILDER },
  "visitor messages": { path: () => "/dashboard/me/leads", page: () => import("@/pages/dashboard/leads.astro"), user: BUILDER },
  writing: { path: () => "/dashboard/me/writing", page: () => import("@/pages/dashboard/writing/index.astro"), user: BUILDER },
  opportunities: { path: () => "/dashboard/me/opportunities", page: () => import("@/pages/dashboard/opportunities.astro"), user: BUILDER },
  "admin users": { path: () => "/admin/users", page: () => import("@/pages/admin/users/index.astro"), user: ADMIN },
  "admin user": { path: () => `/admin/users/${STUDENT}`, page: () => import("@/pages/admin/users/[id].astro"), user: ADMIN, id: STUDENT },
  "admin cohorts": { path: () => "/admin/programs", page: () => import("@/pages/admin/programs/index.astro"), user: ADMIN },
  "admin cohort": { path: () => "/admin/programs/cohort-a", page: () => import("@/pages/admin/programs/[id].astro"), user: ADMIN, id: "cohort-a" },
  "admin new cohort": { path: () => "/admin/programs/new", page: () => import("@/pages/admin/programs/new.astro"), user: ADMIN },
  "admin recordings": { path: () => "/admin/recordings", page: () => import("@/pages/admin/recordings/index.astro"), user: ADMIN },
  "admin recording": { path: () => "/admin/recordings/recording", page: () => import("@/pages/admin/recordings/[id].astro"), user: ADMIN, id: "recording" },
  // In staging, where the importer works.
  "admin data migration": { path: () => "/admin/data-migration", page: () => import("@/pages/admin/data-migration.astro"), user: ADMIN, env: { DEPLOYMENT_ENVIRONMENT: "staging" } },
  "admin upload recording": { path: () => "/admin/recordings/upload", page: () => import("@/pages/admin/recordings/upload.astro"), user: ADMIN },
  "admin import recordings": { path: () => "/admin/recordings/import", page: () => import("@/pages/admin/recordings/import.astro"), user: ADMIN },
  "admin tokens": { path: () => "/admin/personal-access-tokens", page: () => import("@/pages/admin/personal-access-tokens.astro"), user: ADMIN },
  // With agent sessions on, as on the previews where the page is used; production never turns them on.
  "admin agent access": { path: () => "/admin/agent-access", page: () => import("@/pages/admin/agent-access.astro"), user: ADMIN, env: { AGENT_AUTH_ENABLED: "true" } },
  // With credential storage set up, as in production.
  "admin integrations": { path: () => "/admin/settings/integrations", page: () => import("@/pages/admin/settings/integrations.astro"), user: ADMIN, env: { CREDENTIALS_ENCRYPTION_KEY: "synthetic-key" } },
  "admin applications": { path: () => "/admin/applications", page: () => import("@/pages/admin/applications/index.astro"), user: ADMIN },
  "admin application": { path: () => "/admin/applications/application", page: () => import("@/pages/admin/applications/[id].astro"), user: ADMIN, id: "application" },
  "admin profiles": { path: () => "/admin/profiles", page: () => import("@/pages/admin/profiles/index.astro"), user: ADMIN },
  "admin profile": { path: () => "/admin/profiles/profile", page: () => import("@/pages/admin/profiles/[id].astro"), user: ADMIN, id: "profile" },
  "admin projects": { path: () => "/admin/projects", page: () => import("@/pages/admin/projects/index.astro"), user: ADMIN },
  "admin project": { path: () => "/admin/projects/project", page: () => import("@/pages/admin/projects/[id].astro"), user: ADMIN, id: "project" },
  "admin access requests": { path: () => "/admin/access-requests", page: () => import("@/pages/admin/access-requests.astro"), user: ADMIN },
  "admin curricula": { path: () => "/admin/curricula", page: () => import("@/pages/admin/curricula/index.astro"), user: ADMIN },
  "admin curriculum": { path: () => "/admin/curricula/curriculum", page: () => import("@/pages/admin/curricula/[id].astro"), user: ADMIN, id: "curriculum" },
  "admin new curriculum": { path: () => "/admin/curricula/new", page: () => import("@/pages/admin/curricula/new.astro"), user: ADMIN },
  "admin feedback detail": { path: () => "/admin/feedback/feedback", page: () => import("@/pages/admin/feedback/[id].astro"), user: ADMIN, id: "feedback" },
  "admin feedback theme": { path: () => "/admin/feedback/themes/theme", page: () => import("@/pages/admin/feedback/themes/[id].astro"), user: ADMIN, id: "theme" },
  "admin feedback themes": { path: () => "/admin/feedback/themes", page: () => import("@/pages/admin/feedback/themes/index.astro"), user: ADMIN },
  "admin feedback": { path: () => "/admin/feedback", page: () => import("@/pages/admin/feedback/index.astro"), user: ADMIN },
  "admin feature flags": { path: () => "/admin/platform-flags", page: () => import("@/pages/admin/platform-flags.astro"), user: ADMIN },
  "admin moderation": { path: () => "/admin/moderation", page: () => import("@/pages/admin/moderation.astro"), user: ADMIN },
  "admin request notes": { path: () => "/admin/moderation?tab=request-notes", page: () => import("@/pages/admin/moderation.astro"), user: ADMIN },
  // The frame alone: a page with no reads of its own (FramePage.astro) in each kind of space.
  "frame only, community": { path: () => "/dashboard/community/conduct", page: () => import("./FramePage.astro"), user: STUDENT, props: { page: "conduct" } },
  "frame only, cohort": { path: () => "/dashboard/cohort", page: () => import("./FramePage.astro"), user: STUDENT, props: { page: "cohort" } },
  "frame only, mentoring": { path: () => "/dashboard/mentoring", page: () => import("./FramePage.astro"), user: MENTOR, props: { page: "mentoring" } },
  "frame only, profile": { path: () => "/dashboard/me", page: () => import("./FramePage.astro"), user: STUDENT, props: { page: "profile" } },
  "frame only, admin": { path: () => "/admin/curricula", page: () => import("./FramePage.astro"), user: ADMIN, props: { page: "adminCurricula", admin: true } },
} as const;
type PageName = keyof typeof PAGES;

/** One signed-in GET through the middleware and the page, traced to the end of its body. */
async function visit(name: PageName) {
  const { db, cohortChannel } = seeded();
  const entry = PAGES[name];
  Object.assign(mocks.env, { DB: db, DEPLOYMENT_ENVIRONMENT: "production", AGENT_AUTH_ENABLED: undefined, CREDENTIALS_ENCRYPTION_KEY: undefined, ...("env" in entry ? entry.env : {}) });
  const { path, page, user: userId } = entry;
  const user = { id: userId, name: "Synthetic", email: `${userId}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) };
  mocks.getSession.mockResolvedValue({ user, session: { id: `${userId}-session`, userId, userAgent: "Mozilla/5.0" } });
  const { default: Page } = await page();
  const url = new URL(path(cohortChannel), "https://ttv.invalid");
  // As on Workers, work after the response (the router's acknowledgement of an approval) goes to
  // waitUntil, off the response's path; it settles after the trace, before the database closes.
  const deferred: Promise<unknown>[] = [];
  const locals = { cfContext: { waitUntil: (task: Promise<unknown>) => deferred.push(task) } } as unknown as App.Locals;
  // A detail page names its record; the conversation page reads the direct channel.
  const params = { slug: cohortChannel, id: "id" in entry ? entry.id : DIRECT, ...("handle" in entry ? { handle: entry.handle } : {}) };
  const context = {
    url, request: new Request(url), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const { result, summary } = await tracePerf(db, async () => {
    const response = await onRequest(context as never, async () =>
      container.renderToResponse(Page, { request: new Request(url), locals, params, props: "props" in entry ? entry.props : {} })) as Response;
    return { status: response.status, body: await response.text() };
  });
  await Promise.allSettled(deferred);
  return { ...result, summary };
}

/**
 * Queries and round trips (depth) per page, auth excluded. Before PERF-2 (main at #329) this test
 * measured, in this order: 23/10, 22/9, 22/9, 26/9, 23/8, 23/14, 19/6, 18/8 and 18/8.
 */
const BUDGETS: Record<PageName, { d1: number; depth: number }> = {
  // The frame alone, which every page pays before its own reads: depth 3 before perf-frame-floor (the
  // sidebar, journey, onboarding and admin counts waited for the whole space context; the Admin
  // space's flags waited for the ADMIN guard). Now flags and capabilities are one round trip and
  // everything the frame reads after them is the next.
  "frame only, community": { d1: 16, depth: 2 },
  "frame only, cohort": { d1: 16, depth: 2 },
  "frame only, mentoring": { d1: 13, depth: 2 },
  "frame only, profile": { d1: 16, depth: 2 },
  "frame only, admin": { d1: 13, depth: 2 },
  "cohort overview": { d1: 16, depth: 2 },
  // Its one read of its own is the recordings, once the router has the space context.
  "cohort sessions": { d1: 15, depth: 3 },
  // The recording and its transcript are one read, started beside the space context; the access check
  // reuses the request's capabilities. The same before the style-guide rollout, where the router's own
  // reads already set the floor.
  "session viewer": { d1: 15, depth: 3 },
  // The conversation's reads chain off the route channel, which the router reads beside the space
  // context (page-channels: 6, 4 and 8 deep before). A first visit reads the view too, unrendered,
  // rather than wait for the habits' answer.
  "cohort channel": { d1: 20, depth: 3 },
  "cohort channel, first visit": { d1: 17, depth: 3 },
  conversation: { d1: 23, depth: 3 },
  // Two more than PERF-2 measured: the journey's profile and entries, read with the page since PERF-3
  // (#330) in place of three API calls after hydration, each with its own middleware and auth reads.
  // One more since the style-guide rollout: a journey's confirmations are read beside its entries, not
  // after them, so a person with no entries pays a query that finds none.
  community: { d1: 19, depth: 3 },
  conduct: { d1: 14, depth: 3 },
  // No island (the island's API calls after hydration before): the criteria form is the frame alone, the
  // Discover space being its access check. A person's profile, journey and confirmations are one round trip,
  // read beside their access check and started beside the space context.
  discover: { d1: 12, depth: 2 },
  "discover, a person": { d1: 16, depth: 3 },
  mentors: { d1: 20, depth: 3 },
  // The page of members (with its count) and the caller's own card, one wave beside the space context,
  // so the page's own reads land at the floor (depth 3). An institution's search pays no more.
  members: { d1: 18, depth: 3 },
  "members, searched": { d1: 15, depth: 3 },
  // The member with their work and its confirmations, one batch beside the space context.
  "member page": { d1: 17, depth: 3 },
  // The router marks an approved mentor request seen after the response (waitUntil), so it is not counted.
  // Its channel list, requests and availability start beside onboarding (depth 5 before).
  "mentoring home": { d1: 16, depth: 3 },
  // The shared work is now read on the server, beside the space context (the island fetched it after
  // hydration, a second request these numbers never saw); its confirmations are read beside its rows.
  "mentoring confirm": { d1: 13, depth: 3 },
  "mentoring availability": { d1: 12, depth: 3 },
  // One directory read, filtered in memory: two (the same statement twice) before the style-guide rollout.
  "mentors, filtered": { d1: 20, depth: 3 },
  // The same before the style-guide rollout: this page reads no onboarding, so starting its reads with the
  // context (resolveSpacePageWith) keeps the depth rather than cuts it. "Worth another look" reads its access first.
  "mentoring requests": { d1: 15, depth: 3 },
  // The application is read beside the space context (16 queries 6 deep in the style-guide audit).
  application: { d1: 15, depth: 3 },
  // The person's applications and the open cohorts are read beside the space context (14 queries 6 deep in the audit,
  // three reads one after another).
  apply: { d1: 16, depth: 3 },
  // The same before the style-guide rollout: the journey and the request's capabilities (shared with the
  // space context) start beside it through resolveSpacePageWith, instead of after it.
  ask: { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: the list waited for the whole space context, and the cohort name for the list.
  attention: { d1: 10, depth: 2 },
  "admin home": { d1: 19, depth: 2 },
  account: { d1: 16, depth: 2 },
  // The profile with its highlights and the GitHub account start beside the space context, and eligibility
  // comes from the frame's journey; the GET no longer calls GitHub or reads the account twice (depth 9 in the audit).
  // Three more since it became the one editor for everyone (PR D): the caller's own work and its confirmations
  // (the community API's journey read) and their GitHub repositories, all in the same wave as the profile.
  "public profile editor": { d1: 19, depth: 3 },
  // Depth 6 (23 queries) for a published builder before the style-guide rollout: the journey, then the
  // profile, then its messages and drafts, then the opportunities, in turn. Now one round trip after the
  // router's, the profile's dependents found through it by subquery: four more queries for someone with
  // no profile (19 before), none of them waiting.
  "profile overview": { d1: 23, depth: 3 },
  "profile overview, published": { d1: 21, depth: 3 },
  // Depth 5 before the style-guide rollout: the notes and their screenshots, then the space context.
  "your feedback": { d1: 16, depth: 3 },
  // Depth 4 before the style-guide rollout: the profile, then its messages, then the space context.
  "visitor messages": { d1: 14, depth: 3 },
  // Depth 4 before the style-guide rollout: the profile, its posts, then the space context, in turn.
  writing: { d1: 14, depth: 3 },
  // Depth 5 before the style-guide rollout: the profile, the projects, the raised hands, then the space
  // context, in turn. The profile is now the journey's, which the frame reads anyway.
  opportunities: { d1: 14, depth: 3 },
  // One more since the style-guide rollout: the list is paged, and the count that says "of 133" is
  // read beside the page of people, in the same round trip.
  "admin users": { d1: 15, depth: 2 },
  // Depth 5 before the style-guide rollout: the person, their pending requests and the space were read in turn.
  "admin user": { d1: 15, depth: 2 },
  "admin cohorts": { d1: 14, depth: 2 },
  // Depth 7 before the style-guide rollout: the flag, the curricula, the cohort, every user, every role and
  // the space were read in turn; now together, with community mentors found in SQL.
  "admin cohort": { d1: 17, depth: 2 },
  // Depth 4 before the style-guide rollout: the curricula, then the space.
  "admin new cohort": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: every recording with its cohort, then the space.
  "admin recordings": { d1: 15, depth: 2 },
  // Depth 5 before the style-guide rollout: the recording with every segment, the cohorts and the space in turn;
  // now together, with the segments counted in SQL.
  "admin recording": { d1: 16, depth: 2 },
  // Depth 4 before the style-guide rollout, with the whole task in a client script.
  "admin data migration": { d1: 13, depth: 2 },
  // Depth 4 before the style-guide rollout: the cohorts, then the space.
  "admin upload recording": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: the credential, then the cohorts and sources, then the space.
  "admin import recordings": { d1: 15, depth: 2 },
  // Depth 4 before the style-guide rollout: the tokens, then the space.
  "admin tokens": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: the sessions, then the space.
  "admin agent access": { d1: 14, depth: 2 },
  // Depth 4 + N before the style-guide rollout: the credential, the activity, its updater, each actor in turn, then the space.
  "admin integrations": { d1: 15, depth: 2 },
  // One more since the style-guide rollout: the list is paged, and the count for each status (which
  // pages it and says how many wait) is read beside the page of applications, in the same round trip.
  "admin applications": { d1: 15, depth: 2 },
  "admin application": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: every profile was read and filtered in JS, then the space.
  "admin profiles": { d1: 17, depth: 2 }, // One bounded work-review queue read, parallel with the profile reads.
  "admin profile": { d1: 16, depth: 3 },
  // Depth 4 before the style-guide rollout: every project with its interests, filtered in JS, then the space.
  "admin projects": { d1: 15, depth: 2 },
  "admin project": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: the list, the decision just made and the space were read in turn.
  "admin access requests": { d1: 14, depth: 2 },
  "admin curricula": { d1: 14, depth: 2 },
  "admin curriculum": { d1: 14, depth: 2 },
  "admin new curriculum": { d1: 13, depth: 2 },
  // Depth 4 before the style-guide rollout: the note, then the themes, then the space.
  "admin feedback detail": { d1: 16, depth: 3 },
  "admin feedback theme": { d1: 15, depth: 2 },
  "admin feedback themes": { d1: 14, depth: 2 },
  // With the seed's one note listed, its attachments are read too (one query, same depth).
  "admin feedback": { d1: 16, depth: 3 },
  "admin feature flags": { d1: 14, depth: 2 },
  // Depth 4 before the style-guide rollout: the queue's channels waited for the flag reads.
  "admin moderation": { d1: 15, depth: 3 },
  "admin request notes": { d1: 14, depth: 2 },
};

describe("D1 round trips per page (PERF-2)", () => {
  it.each(Object.keys(PAGES) as PageName[])("%s stays within its budget", async (name) => {
    const { status, body, summary } = await visit(name);
    if (process.env.PERF_PRINT) {
      console.log(`${name}: ${summary.d1} queries, depth ${summary.depth}`);
      for (const query of summary.queries ?? []) console.log(`  ${query.depth} ${query.phase} ${query.sql.slice(0, 120)}`);
    }
    expect({ status, start: status === 200 ? "" : body.slice(0, 300) }).toEqual({ status: 200, start: "" });
    expect(body).toContain("data-space");
    // No read twice: the same statement in one request would be a duplicate round trip (PERF-2 step 6).
    const statements = (summary.queries ?? []).map((query) => query.statement);
    expect(statements.filter((sql, index) => statements.indexOf(sql) !== index)).toEqual([]);
    expect({ d1: summary.d1, depth: summary.depth }).toEqual({
      d1: Math.min(summary.d1, BUDGETS[name].d1), depth: Math.min(summary.depth, BUDGETS[name].depth),
    });
  }, 60_000);
});
