-- Tembo in channels (B-3.1; src/lib/tembo/README.md). Three new tables, nothing else changes, and no
-- existing row is read or rewritten: tembo_ask (one question per asking message, so it is answered
-- once), tembo_usage (accepted questions per person per Africa/Nairobi day) and tembo_feedback
-- ("helpful" or "not quite", one per person and answer). Idempotent: every statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `tembo_ask` (
	`messageId` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`claim` text NOT NULL,
	`answerId` text,
	`claimedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`answerId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tembo_ask_status_check" CHECK("tembo_ask"."status" IN ('PENDING','ANSWERED','FAILED')),
	CONSTRAINT "tembo_ask_answer_check" CHECK("tembo_ask"."answerId" IS NULL OR "tembo_ask"."status" = 'ANSWERED'),
	CONSTRAINT "tembo_ask_day_check" CHECK("tembo_ask"."day" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "tembo_ask_time_check" CHECK("tembo_ask"."claimedAt" >= 0 AND "tembo_ask"."createdAt" >= 0 AND "tembo_ask"."updatedAt" >= "tembo_ask"."createdAt")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tembo_ask_channelId_idx` ON `tembo_ask` (`channelId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tembo_ask_userId_idx` ON `tembo_ask` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tembo_ask_answerId_idx` ON `tembo_ask` (`answerId`) WHERE "tembo_ask"."answerId" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tembo_feedback` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tembo_feedback_kind_check" CHECK("tembo_feedback"."kind" IN ('helpful','not_quite')),
	CONSTRAINT "tembo_feedback_time_check" CHECK("tembo_feedback"."createdAt" >= 0 AND "tembo_feedback"."updatedAt" >= "tembo_feedback"."createdAt")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tembo_feedback_userId_idx` ON `tembo_feedback` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tembo_usage` (
	`userId` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`userId`, `day`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tembo_usage_day_check" CHECK("tembo_usage"."day" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "tembo_usage_count_check" CHECK("tembo_usage"."count" >= 0)
);
