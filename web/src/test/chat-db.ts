import { readdirSync } from "node:fs";
import { createSqliteD1, readMigration } from "./sqlite-d1";

export const ASKER = { id: "user-wanjiru", name: "Wanjiru Kamau", email: "wanjiru@example.com" };
export const OTHER_ASKER = { id: "user-otieno", name: "Brian Otieno", email: "otieno@example.com" };

/** In-memory D1 with every migration applied and two signed-up users, for chat tests. */
export function createChatTestDb() {
  const { database, db } = createSqliteD1();
  const migrations = readdirSync(new URL("../lib/db/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  for (const name of migrations) database.exec(readMigration(name));
  const insertUser = database.prepare(`INSERT INTO "user" ("id", "name", "email") VALUES (?, ?, ?)`);
  for (const user of [ASKER, OTHER_ASKER]) insertUser.run(user.id, user.name, user.email);

  function sessions(userId?: string) {
    const rows = userId
      ? database.prepare(`SELECT * FROM "chat_session" WHERE "userId" = ? ORDER BY "id"`).all(userId)
      : database.prepare(`SELECT * FROM "chat_session" ORDER BY "id"`).all();
    return rows.map((row) => ({ ...row }));
  }

  function messages(sessionId: string) {
    return database
      .prepare(`SELECT "userId", "role", "content", "citations" FROM "chat_message" WHERE "sessionId" = ? ORDER BY rowid`)
      .all(sessionId)
      .map((row) => ({ ...row }));
  }

  /** A conversation as an earlier release left it; `ageSeconds` backdates it. */
  function seedSession(id: string, userId: string, { ageSeconds = 0, messageCount = 0 } = {}) {
    database
      .prepare(
        `INSERT INTO "chat_session" ("id", "userId", "title", "createdAt", "updatedAt")
         VALUES (?, ?, ?, unixepoch() - ?, unixepoch() - ?)`
      )
      .run(id, userId, `Conversation ${id}`, ageSeconds, ageSeconds);
    const insertMessage = database.prepare(
      `INSERT INTO "chat_message" ("id", "sessionId", "userId", "role", "content", "createdAt")
       VALUES (?, ?, ?, ?, ?, unixepoch() - ?)`
    );
    for (let index = 0; index < messageCount; index++) {
      insertMessage.run(`${id}-message-${index}`, id, userId, index % 2 ? "assistant" : "user", `Message ${index}`, ageSeconds);
    }
  }

  return { database, db, sessions, messages, seedSession };
}
