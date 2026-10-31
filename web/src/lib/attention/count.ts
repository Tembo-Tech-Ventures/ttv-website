import { and, count, eq, isNull } from "drizzle-orm";
import { attentionItem, type Database } from "@/lib/db/schema";
import { AttentionCount, type SpaceUnreadCounts } from "@/lib/platform/contracts";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { attentionAccess } from "./access";

/** Caller supplies authenticated identity after capabilities/flag authorization. */
export async function getAttentionCount(db: Database, userId: string, capabilities: PlatformCapabilities): Promise<AttentionCount> {
  const unreadCounts: SpaceUnreadCounts = { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 };
  const rows = await db.select({ space: attentionItem.space, count: count() })
    .from(attentionItem)
    .where(and(eq(attentionItem.userId, userId), isNull(attentionItem.readAt), attentionAccess(db, userId, capabilities)))
    .groupBy(attentionItem.space);
  for (const row of rows) unreadCounts[row.space] = row.count;
  return AttentionCount.parse({ count: rows.reduce((total, row) => total + row.count, 0), unreadCounts });
}
