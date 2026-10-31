import { and, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { attentionItem, user, type Database } from "@/lib/db/schema";
import { AttentionFilter, AttentionList, Id, Timestamp, WebLink, type AttentionQuery, type MarkAttentionRead } from "@/lib/platform/contracts";
import { getAttentionCount } from "./count";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
import { attentionAccess } from "./access";

export const ATTENTION_PAGE_SIZE = 30;
const PageCursor = z.strictObject({ v: z.literal(1), owner: z.string().regex(/^[a-f0-9]{64}$/), filter: AttentionFilter,
  snapshotAt: Timestamp, beforeAt: Timestamp, beforeId: Id });
type PageCursor = z.infer<typeof PageCursor>;
export class AttentionCursorError extends Error {}

function encodeCursor(cursor: PageCursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))));
}
function decodeCursor(value: string): PageCursor {
  try {
    return PageCursor.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value), character => character.charCodeAt(0)),
    )));
  } catch { throw new AttentionCursorError("Invalid attention cursor."); }
}

/** Fixed snapshot + (createdAt,id) keyset. IDs break ties; they are not clocks. */
export async function listAttention(db: Database, userId: string, query: AttentionQuery, capabilities: PlatformCapabilities): Promise<AttentionList> {
  const filter = query.filter ?? "all";
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  // Fixed-size owner binding keeps cursors below the wire limit even for legal
  // 255-character Unicode IDs. This is not an authorization credential.
  const owner = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId))),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const boundary = Date.now() - 1;
  if (cursor && (cursor.owner !== owner || cursor.filter !== filter || cursor.snapshotAt > boundary || cursor.beforeAt > cursor.snapshotAt)) {
    throw new AttentionCursorError("Invalid attention cursor.");
  }
  const snapshotAt = cursor?.snapshotAt ?? boundary;
  const rows = await db.select({ item: attentionItem, actor: { id: user.id, name: user.name, image: user.image } })
    .from(attentionItem).leftJoin(user, eq(attentionItem.actorId, user.id))
    .where(and(eq(attentionItem.userId, userId), attentionAccess(db, userId, capabilities), lte(attentionItem.createdAt, snapshotAt),
      filter === "all" ? undefined : eq(attentionItem.category, filter),
      cursor ? or(lt(attentionItem.createdAt, cursor.beforeAt),
        and(eq(attentionItem.createdAt, cursor.beforeAt), lt(attentionItem.id, cursor.beforeId))) : undefined))
    .orderBy(desc(attentionItem.createdAt), desc(attentionItem.id)).limit(ATTENTION_PAGE_SIZE + 1);
  const page = rows.slice(0, ATTENTION_PAGE_SIZE);
  const last = page.at(-1)?.item;
  return AttentionList.parse({
    snapshotAt,
    nextCursor: rows.length > ATTENTION_PAGE_SIZE && last
      ? encodeCursor({ v: 1, owner, filter, snapshotAt, beforeAt: last.createdAt, beforeId: last.id }) : null,
    items: page.map(({ item, actor }) => ({
      id: item.id, kind: item.kind, space: item.space,
      subject: { kind: item.subjectKind, id: item.subjectId, href: item.subjectHref, label: item.subjectLabel },
      actor: actor ? { id: actor.id, name: actor.name.trim() || "Member", avatarUrl: WebLink.safeParse(actor.image).data ?? null, roleBadges: [] } : null,
      summary: item.summary, createdAt: item.createdAt, readAt: item.readAt,
    })),
  });
}

export async function markAttentionRead(db: Database, userId: string, input: MarkAttentionRead, capabilities: PlatformCapabilities) {
  const now = Date.now();
  await db.update(attentionItem).set({ readAt: sql`max(${now}, ${attentionItem.createdAt})` }).where(and(
    eq(attentionItem.userId, userId), isNull(attentionItem.readAt), attentionAccess(db, userId, capabilities),
    "ids" in input ? sql`${attentionItem.id} IN (SELECT value FROM json_each(${JSON.stringify(input.ids)}))`
      : lte(attentionItem.createdAt, Math.min(input.through, now - 1)),
  ));
  return getAttentionCount(db, userId, capabilities);
}
