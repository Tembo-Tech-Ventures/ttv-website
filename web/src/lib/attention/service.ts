import { and, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { attentionItem, user, type Database } from "@/lib/db/schema";
import { AttentionFilter, AttentionList, Id, Timestamp, type AttentionQuery, type MarkAttentionRead } from "@/lib/platform/contracts";
import { getAttentionCount } from "./count";

export const ATTENTION_PAGE_SIZE = 30;
const PageCursor = z.strictObject({ v: z.literal(1), userId: Id, filter: AttentionFilter,
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
export async function listAttention(db: Database, userId: string, query: AttentionQuery): Promise<AttentionList> {
  const filter = query.filter ?? "all";
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const boundary = Date.now() - 1;
  if (cursor && (cursor.userId !== userId || cursor.filter !== filter || cursor.snapshotAt > boundary || cursor.beforeAt > cursor.snapshotAt)) {
    throw new AttentionCursorError("Invalid attention cursor.");
  }
  const snapshotAt = cursor?.snapshotAt ?? boundary;
  const rows = await db.select({ item: attentionItem, actor: { id: user.id, name: user.name, image: user.image } })
    .from(attentionItem).leftJoin(user, eq(attentionItem.actorId, user.id))
    .where(and(eq(attentionItem.userId, userId), lte(attentionItem.createdAt, snapshotAt),
      filter === "all" ? undefined : eq(attentionItem.category, filter),
      cursor ? or(lt(attentionItem.createdAt, cursor.beforeAt),
        and(eq(attentionItem.createdAt, cursor.beforeAt), lt(attentionItem.id, cursor.beforeId))) : undefined))
    .orderBy(desc(attentionItem.createdAt), desc(attentionItem.id)).limit(ATTENTION_PAGE_SIZE + 1);
  const page = rows.slice(0, ATTENTION_PAGE_SIZE);
  const last = page.at(-1)?.item;
  return AttentionList.parse({
    snapshotAt,
    nextCursor: rows.length > ATTENTION_PAGE_SIZE && last
      ? encodeCursor({ v: 1, userId, filter, snapshotAt, beforeAt: last.createdAt, beforeId: last.id }) : null,
    items: page.map(({ item, actor }) => ({
      id: item.id, kind: item.kind, space: item.space,
      subject: { kind: item.subjectKind, id: item.subjectId, href: item.subjectHref, label: item.subjectLabel },
      actor: actor ? { id: actor.id, name: actor.name, avatarUrl: actor.image, roleBadges: [] } : null,
      summary: item.summary, createdAt: item.createdAt, readAt: item.readAt,
    })),
  });
}

export async function markAttentionRead(db: Database, userId: string, input: MarkAttentionRead) {
  const now = Date.now();
  await db.update(attentionItem).set({ readAt: now }).where(and(
    eq(attentionItem.userId, userId), isNull(attentionItem.readAt),
    "ids" in input ? inArray(attentionItem.id, input.ids) : lte(attentionItem.createdAt, Math.min(input.through, now - 1)),
  ));
  return getAttentionCount(db, userId);
}
