import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { McpToolDefinition, McpToolOutcome, McpToolProvider } from "@/lib/community/mcp";
import * as schema from "@/lib/db/schema";
import { ModerationAction, ModerationParams, ModerationQueueQuery } from "@/lib/platform/contracts";
import { requestCapabilities } from "@/lib/platform/server/request-capabilities";
import { isFlagEnabled, type FlagContext } from "@/lib/platform/server/flags";
import { ChannelError } from "../messages";
import { decideModeration } from "./actions";
import { listModerationQueue } from "./queue";

/**
 * MCP tools for moderation triage (B-2.7), served on /api/mcp beside the community tools. An admin
 * lists the queue and decides cases through listModerationQueue and decideModeration, so the API, the
 * page and MCP refuse the same things with the same messages. A token needs admin:read to list and
 * admin:write to decide; a browser session (scopes null) is held to the same origin by /api/mcp. Both
 * tools are missing from tools/list, and unknown to tools/call, while `channels` is off for the caller
 * or the caller is not an admin, checked again on every call. The queue carries each case's evidence,
 * which only admins ever reach.
 */

export interface ModerationMcpContext {
  db: D1Database;
  env: FlagContext["env"];
  /** The request's locals: who is asking, sharing capabilities and flags with the rest of the request. */
  locals: Pick<App.Locals, "user">;
  /** The token's scopes; null for a browser session. */
  scopes: readonly string[] | null;
}

const DecideInput = ModerationAction.extend(ModerationParams.shape);

const TOOLS = [
  {
    name: "list_moderation_queue",
    scope: "admin:read",
    definition: {
      name: "list_moderation_queue",
      description: "List channel moderation cases, newest first, one per message, with each case's evidence; pass nextCursor back for the next page",
      inputSchema: {
        type: "object",
        properties: { state: { type: "string", enum: ["PENDING", "DECIDED"] }, cursor: { type: "string", maxLength: 2048 } },
        additionalProperties: false,
      },
    },
  },
  {
    name: "moderate_message",
    scope: "admin:write",
    definition: {
      name: "moderate_message",
      description: "Decide a channel moderation case: hide a message, restore a hidden one, or keep one as it is (fine as is), with a reason",
      inputSchema: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          action: { type: "string", enum: ["hide", "restore", "keep"] },
          reason: { type: "string", minLength: 1, maxLength: 2000 },
        },
        required: ["messageId", "action", "reason"],
        additionalProperties: false,
      },
    },
  },
] as const satisfies readonly { name: string; scope: string; definition: McpToolDefinition }[];
type Tool = (typeof TOOLS)[number];

export function moderationMcpTools(context: ModerationMcpContext): McpToolProvider {
  const user = context.locals.user;
  const granted = (scope: string) => context.scopes === null || context.scopes.includes(scope);
  /** An admin with `channels` on, or null. */
  const admin = async () => {
    if (!user) return null;
    const capabilities = await requestCapabilities(drizzle(context.db, { schema }), context.locals);
    if (!capabilities.isAdmin) return null;
    const enabled = await isFlagEnabled({ db: context.db, env: context.env, user, isAdmin: true, locals: context.locals }, "channels");
    return enabled ? { user, capabilities } : null;
  };

  async function run(tool: Tool, args: Record<string, unknown>): Promise<McpToolOutcome> {
    const viewer = await admin();
    // Unknown, as everywhere else while the flag is off or to a non-admin.
    if (!viewer) return { error: { code: -32602, message: "Invalid tool parameters" } };
    if (!granted(tool.scope)) return { error: { code: -32003, message: "Insufficient token scope" } };
    if (tool.name === "list_moderation_queue") {
      return { result: await listModerationQueue(context.db, viewer, ModerationQueueQuery.parse(args)) };
    }
    const { messageId, action, reason } = DecideInput.parse(args);
    return { result: await decideModeration({ db: context.db, env: context.env }, viewer, { messageId, action, reason }) };
  }

  return {
    async list() {
      const available = TOOLS.filter((tool) => granted(tool.scope));
      return available.length > 0 && await admin() ? available.map((tool) => tool.definition) : [];
    },
    async call(name, args) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) return null;
      try {
        return await run(tool, args);
      } catch (error) {
        if (error instanceof z.ZodError) return { error: { code: -32602, message: "Invalid tool arguments" } };
        // The same refusals as the API (404, 409, ...), in the same words.
        if (error instanceof ChannelError) return { toolError: error.message };
        throw error;
      }
    },
  };
}
