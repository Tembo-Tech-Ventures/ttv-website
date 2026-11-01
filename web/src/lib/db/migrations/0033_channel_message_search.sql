-- Channel message search (B-2.6; src/lib/search/README.md, "Messages"). Additive and safe to reapply:
-- one table, one FTS5 index over it, triggers and an idempotent backfill. No existing row is rewritten.
--
-- channel_message_search  one row per searchable message: its id and body, nothing else
-- channel_message_fts     the FTS5 index over those bodies (external content)
--
-- Searchable means not deleted and not HIDDEN. FLAGGED messages stay visible, so they stay searchable.
-- Only the body is indexed: stored embed snapshots are never searchable, because embeds are checked
-- again on every read (src/lib/channels/README.md, "Embeds") and an index cannot be.
--
-- The index keys on its own INTEGER PRIMARY KEY rather than on channel_message's implicit rowid,
-- which a table rebuild or VACUUM may renumber. channel_message_search maps message ids to those
-- keys, so rebuilding channel_message leaves search intact; rebuilding channel_message_search means
-- running the FTS5 'rebuild' command afterwards.
--
-- The triggers keep the index in step with every write path, so no path can forget it and none
-- spends a statement on it.
CREATE TABLE IF NOT EXISTS `channel_message_search` (
	`id` integer PRIMARY KEY,
	`messageId` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_message_search_messageId_idx` ON `channel_message_search` (`messageId`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `channel_message_fts` USING fts5(
	`body`,
	content = 'channel_message_search',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- The FTS5 index follows its content table (the external content pattern).
CREATE TRIGGER IF NOT EXISTS `channel_message_search_insert` AFTER INSERT ON `channel_message_search`
BEGIN
	INSERT INTO `channel_message_fts` (`rowid`, `body`) VALUES (NEW.`id`, NEW.`body`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `channel_message_search_delete` AFTER DELETE ON `channel_message_search`
BEGIN
	INSERT INTO `channel_message_fts` (`channel_message_fts`, `rowid`, `body`) VALUES ('delete', OLD.`id`, OLD.`body`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `channel_message_search_update` AFTER UPDATE ON `channel_message_search`
BEGIN
	INSERT INTO `channel_message_fts` (`channel_message_fts`, `rowid`, `body`) VALUES ('delete', OLD.`id`, OLD.`body`);
	INSERT INTO `channel_message_fts` (`rowid`, `body`) VALUES (NEW.`id`, NEW.`body`);
END;
--> statement-breakpoint
-- A new message is searchable unless it was posted hidden (or deleted, which no path does).
CREATE TRIGGER IF NOT EXISTS `channel_message_fts_insert` AFTER INSERT ON `channel_message`
WHEN NEW.`deletedAt` IS NULL AND NEW.`moderationState` <> 'HIDDEN'
BEGIN
	INSERT INTO `channel_message_search` (`messageId`, `body`) VALUES (NEW.`id`, NEW.`body`);
END;
--> statement-breakpoint
-- An edit re-indexes the body in place; an author's delete (the placeholder) or a hide removes the
-- row; a restore adds it back. Reactions, read markers and changeSeq moves leave the index alone.
-- The three statements converge on the right row whatever the index held before.
CREATE TRIGGER IF NOT EXISTS `channel_message_fts_update`
AFTER UPDATE OF `id`, `body`, `deletedAt`, `moderationState` ON `channel_message`
WHEN OLD.`id` IS NOT NEW.`id` OR OLD.`body` IS NOT NEW.`body`
	OR (OLD.`deletedAt` IS NULL AND OLD.`moderationState` <> 'HIDDEN') <> (NEW.`deletedAt` IS NULL AND NEW.`moderationState` <> 'HIDDEN')
BEGIN
	DELETE FROM `channel_message_search` WHERE `messageId` = OLD.`id`
		AND NOT (OLD.`id` = NEW.`id` AND NEW.`deletedAt` IS NULL AND NEW.`moderationState` <> 'HIDDEN');
	UPDATE `channel_message_search` SET `body` = NEW.`body`
		WHERE `messageId` = NEW.`id` AND `body` IS NOT NEW.`body`
			AND NEW.`deletedAt` IS NULL AND NEW.`moderationState` <> 'HIDDEN';
	INSERT INTO `channel_message_search` (`messageId`, `body`)
		SELECT NEW.`id`, NEW.`body`
		WHERE NEW.`deletedAt` IS NULL AND NEW.`moderationState` <> 'HIDDEN'
			AND NOT EXISTS (SELECT 1 FROM `channel_message_search` WHERE `messageId` = NEW.`id`);
END;
--> statement-breakpoint
-- Deleting the row itself (its channel, program or thread root went) takes it out of the index.
CREATE TRIGGER IF NOT EXISTS `channel_message_fts_delete` AFTER DELETE ON `channel_message`
BEGIN
	DELETE FROM `channel_message_search` WHERE `messageId` = OLD.`id`;
END;
--> statement-breakpoint
-- Backfill every searchable message not indexed yet, oldest first. Reapplying adds nothing.
INSERT INTO `channel_message_search` (`messageId`, `body`)
	SELECT m.`id`, m.`body` FROM `channel_message` m
	WHERE m.`deletedAt` IS NULL AND m.`moderationState` <> 'HIDDEN'
		AND NOT EXISTS (SELECT 1 FROM `channel_message_search` s WHERE s.`messageId` = m.`id`)
	ORDER BY m.`createdAt`, m.`channelId`, m.`seq`;
