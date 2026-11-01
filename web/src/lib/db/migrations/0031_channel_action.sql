-- Channel edit and reaction rate limits (src/lib/channels/README.md, "Writing"): one row per recent
-- edit or reaction change. Every insert prunes that person's rows of the same kind older than an
-- hour (every window is shorter), so the table stays small. Additive and safe to reapply: one new
-- table, its indexes and a trigger, no writes to existing data. Rows follow the person and the
-- channel out (ON DELETE cascade).
CREATE TABLE IF NOT EXISTS `channel_action` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`channelId` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_action_kind_check" CHECK("channel_action"."kind" IN ('EDIT','REACT')),
	CONSTRAINT "channel_action_time_check" CHECK("channel_action"."at" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_action_user_idx` ON `channel_action` (`userId`,`kind`,`at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_action_channelId_idx` ON `channel_action` (`channelId`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `channel_action_prune` AFTER INSERT ON `channel_action`
BEGIN
	DELETE FROM `channel_action` WHERE `userId` = NEW.`userId` AND `kind` = NEW.`kind` AND `at` <= NEW.`at` - 3600000;
END;
