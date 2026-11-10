import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
const runtime = vi.hoisted(() => ({ env: {} as Env, check: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: runtime.env }));
vi.mock("@/lib/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "member" }, session: {} }) },
  }),
}));
vi.mock("@/lib/talent/github", async () => ({
  ...(await vi.importActual<typeof import("@/lib/talent/github")>(
    "@/lib/talent/github",
  )),
  fetchPublicRepos: async () =>
    ["posted", "draft", "hidden"].map((name) => ({
      full_name: `member/${name}`,
      html_url: `https://github.com/member/${name}`,
      description: "Repository description",
      language: "TypeScript",
      topics: ["web"],
      stargazers_count: 12,
      pushed_at: "2026-11-09T00:00:00Z",
    })),
}));
vi.mock("@/lib/moderation/clef", async () => ({
  ...(await vi.importActual<typeof import("@/lib/moderation/clef")>(
    "@/lib/moderation/clef",
  )),
  checkProfileContent: runtime.check,
}));
import { PUT } from "./highlights";
let database: ReturnType<typeof createSqliteD1>["database"];
beforeEach(() => {
  runtime.check.mockReset().mockResolvedValue({ outcome: "pass", flags: [], scores: {} });
  const fixture = createSqliteD1();
  database = fixture.database;
  runtime.env.DB = fixture.db;
  for (const file of readdirSync(
    new URL("../../../lib/db/migrations/", import.meta.url),
  )
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .toSorted())
    database.exec(readMigration(file));
  database.exec(`INSERT INTO user(id,name,email) VALUES ('member','Synthetic Wanjiku','w@example.test');
    INSERT INTO account(id,accountId,providerId,userId,accessToken) VALUES ('github','member','github','member','synthetic-token');
    INSERT INTO studentProfile(id,userId,handle,publicName) VALUES ('profile','member','member','Synthetic Wanjiku');`);
  for (const [id, state, hidden] of [
    ["posted", "POSTED", 0],
    ["draft", "DRAFT", 0],
    ["hidden", "DRAFT", 1],
  ])
    database
      .prepare(
        `INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility,state,kind,repoFullName,repoUrl,repoDescription,language,topics,stars,snapshotAt,moderatorHidden) VALUES (?,'member',?,'Repository description',?,'2026-11-09','institution',?,'repo',?,?,'Repository description','TypeScript','["web"]',1,123,?)`,
      )
      .run(
        id,
        `member/${id}`,
        `https://github.com/member/${id}`,
        state,
        `member/${id}`,
        `https://github.com/member/${id}`,
        hidden,
      );
  database.exec(
    "INSERT INTO communityConfirmation(id,journeyId,mentorId,statement,method,journeyVersion) VALUES ('c','posted','member','Reviewed','Code',1)",
  );
});
afterEach(() => database.close());
describe("repository refresh storage", () => {
  it("refreshes only posted repositories, preserves draft and hidden rows, and leaves confirmations current", async () => {
    const response = await PUT({
      request: new Request("https://example.test/api/portfolio/highlights", {
        method: "PUT",
      }),
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, refreshed: 1 });
    expect(
      database
        .prepare(
          "SELECT id,state,stars,version FROM communityJourney ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "draft", state: "DRAFT", stars: 1, version: 1 },
      { id: "hidden", state: "DRAFT", stars: 1, version: 1 },
      { id: "posted", state: "POSTED", stars: 12, version: 1 },
    ]);
    expect(
      database
        .prepare(
          "SELECT count(*) n FROM communityConfirmation c JOIN communityJourney w ON w.id=c.journeyId AND w.version=c.journeyVersion",
        )
        .get(),
    ).toEqual({ n: 1 });
  });
});

it("a later repository check cannot overwrite a hold for the same revision", async () => {
  const results: Array<(value: { outcome: string; flags: string[]; scores: object }) => void> = [];
  runtime.check.mockImplementation(() => new Promise(resolve => { results.push(resolve); }));
  const request = () => PUT({ request: new Request("https://example.test/api/portfolio/highlights", { method: "PUT" }) } as never);
  const first = request();
  await vi.waitFor(() => expect(results).toHaveLength(1));
  const second = request();
  await vi.waitFor(() => expect(results).toHaveLength(2));
  results[0]({ outcome: "hold", flags: [], scores: {} });
  expect((await first).status).toBe(422);
  results[1]({ outcome: "pass", flags: [], scores: {} });
  expect((await second).status).toBe(200);
  expect(database.prepare("SELECT moderationOutcome FROM communityJourney WHERE id='posted'").get()).toEqual({ moderationOutcome: "hold" });
});
