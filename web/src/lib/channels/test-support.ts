import { readdirSync } from "node:fs";
import type { APIContext } from "astro";
import { drizzle } from "drizzle-orm/d1";
import { withRaw } from "@/lib/attention/test-support";
import * as schema from "@/lib/db/schema";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { CONDUCT_VERSION } from "./conduct";
import { channelRequest, type ChannelOperation, type ChannelRequestOptions } from "./http";

/**
 * A database with every migration applied, so the seeded community channels and each program's
 * cohort channels (from the program trigger) are real. Wanjiku is the caller and takes the
 * fixture's roles; Otieno and Achieng are other members, Faith is cohort A's TA. Everyone except
 * the caller has agreed to the code of conduct.
 */
export const VIEWER = "synthetic-wanjiku";
export const ORIGIN = "https://ttv.example";
const PEOPLE = {
  [VIEWER]: "Wanjiku Njeri", "synthetic-otieno": "Otieno Ouma", "synthetic-achieng": "Achieng Atieno", "synthetic-faith": "Faith Njeri",
} as const;
type Person = keyof typeof PEOPLE;

export function channelDatabase(fixture: Partial<CapabilityCase> = {}) {
  const { database, db: raw } = createSqliteD1();
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate) VALUES
      ('cohort-a','Cohort 04','Test','curriculum',100),('cohort-b','Cohort 05','Test','curriculum',200);`);
  for (const [id, name] of Object.entries(PEOPLE)) {
    database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, name, `${id}@example.test`);
    if (id !== VIEWER) database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,?,1)").run(id, CONDUCT_VERSION);
  }
  database.exec(`INSERT INTO programRole(id,userId,programId,name) VALUES ('faith-ta','synthetic-faith','cohort-a','TA');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES
      ('otieno-a','synthetic-otieno','cohort-a','APPROVED','{}'),('achieng-a','synthetic-achieng','cohort-a','COMPLETED','{}');`);
  for (const name of fixture.globalRoles ?? []) {
    database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(name, name);
    database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`role-${name}`, VIEWER, name);
  }
  for (const [i, application] of (fixture.applications ?? []).entries()) {
    database.prepare("INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,?,?,?,?)")
      .run(`application-${i}`, VIEWER, application.programId, application.status, "{}");
  }
  for (const [i, assignment] of (fixture.assignments ?? []).entries()) {
    database.prepare("INSERT INTO programRole(id,userId,programId,name) VALUES (?,?,?,?)")
      .run(`assignment-${i}`, VIEWER, assignment.programId, assignment.name);
  }
  const d1 = withRaw(database, raw);
  const db = drizzle(d1, { schema });

  /** A channel id by slug: introductions, help, cohort-04, c04-help, c04-announcements, cohort-05 … */
  const channel = (slug: string) => (database.prepare("SELECT id FROM channel WHERE slug = ? AND kind <> 'DIRECT'").get(slug) as { id: string }).id;
  let counter = 0;
  /** Writes a message straight to the table, as the API would number it. Returns its id. */
  function message(slug: string, options: {
    author?: Person | null; body?: string; parentId?: string | null; state?: "VISIBLE" | "FLAGGED" | "HIDDEN";
    deleted?: boolean; createdAt?: number; tembo?: boolean; nonce?: string;
  } = {}): string {
    const id = `message-${++counter}`;
    const { author = "synthetic-otieno", state = "VISIBLE", deleted = false, tembo = false } = options;
    database.prepare(`INSERT INTO channel_message (id, channelId, parentId, seq, changeSeq, authorKind, authorId, clientNonce, body,
        moderationState, moderationReasons, hiddenAt, deletedAt, createdAt)
      SELECT ?, ?, ?, n, n, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM (SELECT coalesce(MAX(changeSeq), 0) + 1 AS n FROM channel_message WHERE channelId = ?)`)
      .run(id, channel(slug), options.parentId ?? null, tembo ? "TEMBO" : "USER", tembo ? null : author, options.nonce ?? null,
        deleted ? "" : options.body ?? `Synthetic message ${counter}`, state, state === "VISIBLE" ? "[]" : '["Synthetic reason"]',
        state === "HIDDEN" ? 1 : null, deleted ? 2 : null, options.createdAt ?? counter * 1000, channel(slug));
    return id;
  }
  const agree = (userId: string = VIEWER, version = CONDUCT_VERSION) =>
    database.prepare("INSERT OR REPLACE INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,?,1)").run(userId, version);

  const env = { DB: d1, PLATFORM_FLAGS_OVERRIDE: "all" } as Parameters<typeof channelRequest>[2];
  /** Calls a channel API as the caller (or `user`), same-origin unless told otherwise. */
  async function call(operation: ChannelOperation, options: {
    id?: string; query?: string; body?: unknown; user?: string | null; origin?: string | null; locals?: Partial<App.Locals>;
    env?: Partial<Parameters<typeof channelRequest>[2]>;
  } & ChannelRequestOptions = {}) {
    const method = { listChannels: "GET", listMessages: "GET", listShareables: "GET", postMessage: "POST", editMessage: "PATCH", deleteMessage: "DELETE",
      reactToMessage: "POST", markChannelRead: "POST" }[operation];
    const headers = new Headers();
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    if (origin) headers.set("Origin", origin);
    const request = new Request(`${ORIGIN}/api/x${options.query ?? ""}`, {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const user = options.user === undefined ? VIEWER : options.user;
    const locals = { user: user === null ? null : { id: user }, personalAccessToken: null, ...options.locals } as App.Locals;
    const context = { request, locals, params: options.id === undefined ? {} : { id: options.id } } as Pick<APIContext, "request" | "locals" | "params">;
    const response = await channelRequest(operation, context, { ...env, ...options.env }, options);
    return { status: response.status, body: await response.json() as unknown, response };
  }
  return { database, d1, db, channel, message, agree, call };
}
export type ChannelFixture = ReturnType<typeof channelDatabase>;

let nonce = 0;
/** A valid post body with a fresh nonce. */
export const post = (body = "Synthetic post", parentId: string | null = null, clientNonce = `nonce-${++nonce}`) =>
  ({ body, clientNonce, parentId, embeds: [] });
