import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "pages",
  "api",
  "chat",
  "conversations"
);

describe("chat API route contracts", () => {
  it("exposes ownership-scoped conversation CRUD with strict JSON contracts", async () => {
    const [indexRoute, conversationRoute] = await Promise.all([
      readFile(path.join(apiRoot, "index.ts"), "utf8"),
      readFile(path.join(apiRoot, "[id].ts"), "utf8"),
    ]);

    expect(indexRoute).toContain("createConversationSchema.safeParse(payload)");
    expect(indexRoute).toContain("repository.listConversations(user.id)");
    expect(conversationRoute).toContain(
      "repository.findConversation(user.id, conversationId)"
    );
    expect(conversationRoute).toContain(
      "repository.deleteConversation(user.id, conversationId)"
    );
    expect(conversationRoute).toContain('"Cache-Control": "no-store"');
  });

  it("streams server-owned context through the guarded Gateway path", async () => {
    const messageRoute = await readFile(
      path.join(apiRoot, "[id]", "messages.ts"),
      "utf8"
    );

    expect(messageRoute).toContain("sendMessageSchema.safeParse(payload)");
    expect(messageRoute).toContain("env.CHAT_RATE_LIMITER.limit({ key: userId })");
    expect(messageRoute).toContain("isAdmin: Boolean(locals.isAdmin)");
    expect(messageRoute).toContain("openChatCompletionStream(env, messages, signal)");
    expect(messageRoute).not.toContain("conversationHistory");
  });

  it("backfills legacy messages into a durable per-user conversation", async () => {
    const migration = await readFile(
      path.resolve(
        import.meta.dirname,
        "..",
        "db",
        "migrations",
        "0004_silky_silverclaw.sql"
      ),
      "utf8"
    );

    expect(migration).toContain("CREATE TABLE `chat_conversation`");
    expect(migration).toContain("'legacy-' || `userId`");
    expect(migration).toContain("SET `conversationId` = 'legacy-' || `userId`");
    expect(migration).toContain("ADD `model` text");
  });
});
