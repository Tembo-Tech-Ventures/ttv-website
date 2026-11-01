-- Channels (src/lib/channels/README.md): schema, the channels flag, the default
-- community channels, and every cohort's channels, including a hook that gives each
-- new program its own. Additive and safe to reapply: new tables, indexes, a view and
-- triggers; the only writes insert rows that do not exist yet. Existing programs,
-- users and flags are never modified, and the channels flag is never switched on.
--
-- A later migration that rebuilds `program` or `channel` (create, copy, drop, rename)
-- must drop and recreate the view `cohort_channel_request` and both triggers below:
-- dropping `program` silently drops the program hook. channels-migration.test.ts
-- applies every migration and fails if new programs stop getting channels.
CREATE TABLE IF NOT EXISTS `channel` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`programId` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`postingPolicy` text DEFAULT 'ALL' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`seedKey` text,
	`archivedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_kind_check" CHECK("channel"."kind" IN ('COHORT','COMMUNITY','DIRECT')),
	CONSTRAINT "channel_program_check" CHECK(("channel"."kind" = 'COHORT') = ("channel"."programId" IS NOT NULL)),
	CONSTRAINT "channel_postingPolicy_check" CHECK("channel"."postingPolicy" IN ('ALL','STAFF')),
	CONSTRAINT "channel_slug_check" CHECK(length("channel"."slug") BETWEEN 1 AND 80 AND "channel"."slug" GLOB '[a-z0-9]*' AND "channel"."slug" NOT GLOB '*[^a-z0-9-]*' AND "channel"."slug" NOT GLOB '*-'),
	CONSTRAINT "channel_name_check" CHECK(length(trim("channel"."name")) > 0 AND length("channel"."name") <= 80),
	CONSTRAINT "channel_topic_check" CHECK(length("channel"."topic") <= 280),
	CONSTRAINT "channel_position_check" CHECK("channel"."position" >= 0),
	CONSTRAINT "channel_time_check" CHECK("channel"."createdAt" >= 0 AND "channel"."updatedAt" >= "channel"."createdAt" AND ("channel"."archivedAt" IS NULL OR "channel"."archivedAt" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_slug_idx` ON `channel` (`slug`) WHERE "channel"."kind" <> 'DIRECT';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_seedKey_idx` ON `channel` (`seedKey`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_kind_idx` ON `channel` (`kind`,`programId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_programId_idx` ON `channel` (`programId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `channel_member` (
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`addedBy` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`channelId`, `userId`),
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "channel_member_time_check" CHECK("channel_member"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_member_userId_idx` ON `channel_member` (`userId`,`channelId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_member_addedBy_idx` ON `channel_member` (`addedBy`) WHERE "channel_member"."addedBy" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `channel_message` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`parentId` text,
	`seq` integer NOT NULL,
	`changeSeq` integer NOT NULL,
	`authorKind` text DEFAULT 'USER' NOT NULL,
	`authorId` text,
	`clientNonce` text,
	`body` text NOT NULL,
	`embeds` text DEFAULT '[]' NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`moderationState` text DEFAULT 'VISIBLE' NOT NULL,
	`moderationReasons` text DEFAULT '[]' NOT NULL,
	`hiddenBy` text,
	`hiddenAt` integer,
	`editedAt` integer,
	`deletedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hiddenBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parentId`,`channelId`) REFERENCES `channel_message`(`id`,`channelId`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_message_seq_check" CHECK("channel_message"."seq" >= 1 AND "channel_message"."changeSeq" >= "channel_message"."seq"),
	CONSTRAINT "channel_message_authorKind_check" CHECK("channel_message"."authorKind" IN ('USER','TEMBO')),
	CONSTRAINT "channel_message_tembo_check" CHECK("channel_message"."authorKind" = 'USER' OR ("channel_message"."authorId" IS NULL AND "channel_message"."parentId" IS NOT NULL)),
	CONSTRAINT "channel_message_nonce_check" CHECK("channel_message"."clientNonce" IS NULL OR (length("channel_message"."clientNonce") BETWEEN 1 AND 128 AND "channel_message"."clientNonce" NOT GLOB '*[^A-Za-z0-9_-]*')),
	CONSTRAINT "channel_message_body_check" CHECK(length("channel_message"."body") <= 10000 AND ("channel_message"."deletedAt" IS NOT NULL OR length(trim("channel_message"."body", ' ' || char(9, 10, 13))) > 0)),
	CONSTRAINT "channel_message_embeds_check" CHECK(json_valid("channel_message"."embeds") AND json_type("channel_message"."embeds") = 'array'),
	CONSTRAINT "channel_message_citations_check" CHECK(json_valid("channel_message"."citations") AND json_type("channel_message"."citations") = 'array'),
	CONSTRAINT "channel_message_moderation_check" CHECK("channel_message"."moderationState" IN ('VISIBLE','FLAGGED','HIDDEN')),
	CONSTRAINT "channel_message_reasons_check" CHECK(json_valid("channel_message"."moderationReasons") AND json_type("channel_message"."moderationReasons") = 'array' AND ("channel_message"."moderationState" = 'VISIBLE' OR json_array_length("channel_message"."moderationReasons") > 0)),
	CONSTRAINT "channel_message_hidden_check" CHECK(("channel_message"."moderationState" = 'HIDDEN') = ("channel_message"."hiddenAt" IS NOT NULL) AND ("channel_message"."hiddenBy" IS NULL OR "channel_message"."moderationState" = 'HIDDEN')),
	CONSTRAINT "channel_message_time_check" CHECK("channel_message"."createdAt" >= 0 AND coalesce("channel_message"."editedAt", 0) >= 0 AND coalesce("channel_message"."deletedAt", 0) >= 0 AND coalesce("channel_message"."hiddenAt", 0) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_message_channel_id_idx` ON `channel_message` (`channelId`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_message_seq_idx` ON `channel_message` (`channelId`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_message_changeSeq_idx` ON `channel_message` (`channelId`,`changeSeq`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_message_thread_idx` ON `channel_message` (`channelId`,`parentId`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channel_message_nonce_idx` ON `channel_message` (`authorId`,`clientNonce`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_message_hiddenBy_idx` ON `channel_message` (`hiddenBy`) WHERE "channel_message"."hiddenBy" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `channel_read` (
	`userId` text NOT NULL,
	`channelId` text NOT NULL,
	`lastReadMessageId` text NOT NULL,
	`readAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `channelId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`,`lastReadMessageId`) REFERENCES `channel_message`(`channelId`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_read_time_check" CHECK("channel_read"."readAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_read_channelId_idx` ON `channel_read` (`channelId`,`lastReadMessageId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_reaction` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`messageId`, `userId`, `kind`),
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_reaction_kind_check" CHECK("message_reaction"."kind" IN ('useful','learned','thanks','agree','congrats')),
	CONSTRAINT "message_reaction_time_check" CHECK("message_reaction"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_reaction_userId_idx` ON `message_reaction` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_report` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`reporterId` text NOT NULL,
	`reason` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_report_reason_check" CHECK(length(trim("message_report"."reason")) > 0 AND length("message_report"."reason") <= 2000),
	CONSTRAINT "message_report_time_check" CHECK("message_report"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `message_report_message_reporter_idx` ON `message_report` (`messageId`,`reporterId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_report_reporter_idx` ON `message_report` (`reporterId`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `moderation_event` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`actorId` text,
	`fromState` text NOT NULL,
	`toState` text NOT NULL,
	`reasons` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "moderation_event_action_check" CHECK("moderation_event"."action" IN ('FLAG','HIDE','RESTORE','KEEP')),
	CONSTRAINT "moderation_event_source_check" CHECK("moderation_event"."source" IN ('DETECTOR','CLEF','REPORT','MENTOR','ADMIN')),
	CONSTRAINT "moderation_event_state_check" CHECK("moderation_event"."fromState" IN ('VISIBLE','FLAGGED','HIDDEN') AND "moderation_event"."toState" IN ('VISIBLE','FLAGGED','HIDDEN')),
	CONSTRAINT "moderation_event_actor_check" CHECK("moderation_event"."source" NOT IN ('DETECTOR','CLEF') OR "moderation_event"."actorId" IS NULL),
	CONSTRAINT "moderation_event_reasons_check" CHECK(json_valid("moderation_event"."reasons") AND json_type("moderation_event"."reasons") = 'array' AND json_array_length("moderation_event"."reasons") > 0),
	CONSTRAINT "moderation_event_time_check" CHECK("moderation_event"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_event_message_idx` ON `moderation_event` (`messageId`,`createdAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_event_actor_idx` ON `moderation_event` (`actorId`,`createdAt`);

--> statement-breakpoint
-- The flag row exists already (0021); recreate it OFF only if it is missing, never
-- overwriting an audience the coordinator has set.
INSERT OR IGNORE INTO `feature_flag` (`key`, `audience`) VALUES ('channels', 'OFF');
--> statement-breakpoint
-- Default community channels, open to every signed-in member. They are seeded once, as
-- a set: when any of them exists, the set is left as staff have shaped it, so a renamed,
-- archived or deleted default stays that way.
WITH `seed` (`slug`, `topic`, `position`) AS (VALUES
	('introductions', 'Say hello: who you are, what you''re working on and what you''d like to learn.', 1),
	('show-your-work', 'Share what you''re building and ask for a second pair of eyes.', 2),
	('help', 'Stuck on something? Ask here, and answer when you can.', 3),
	('opportunities', 'Jobs, internships, gigs and calls for applications that members have found.', 4),
	('design-crit', 'Post a design or a screen and get honest, specific critique.', 5)
)
INSERT INTO `channel` (`id`, `kind`, `slug`, `name`, `topic`, `position`, `seedKey`)
SELECT lower(hex(randomblob(16))), 'COMMUNITY', `seed`.`slug`, `seed`.`slug`, `seed`.`topic`, `seed`.`position`, 'community:' || `seed`.`slug`
FROM `seed`
WHERE NOT EXISTS (SELECT 1 FROM `channel` WHERE `seedKey` LIKE 'community:%')
	AND NOT EXISTS (SELECT 1 FROM `channel` WHERE `kind` <> 'DIRECT' AND `slug` = `seed`.`slug`)
ORDER BY `seed`.`position`;
--> statement-breakpoint
-- Cohort channels: cohort-NN, cNN-help and cNN-announcements (staff post there). They
-- stay open after the cohort ends. Inserting a program id into this view runs the one
-- implementation, which both the program hook and the backfill below use.
--
-- NN is the number straight after "cohort" in the program's name ("Cohort 4" and
-- "TTV Cohort #04" are 04) when no channel uses that number yet. Otherwise it is the next
-- number above every cohort number in use, in channel slugs or program names.
--
-- It cannot make a program insert fail: a program that already has seeded channels is
-- skipped, and every insert first checks that its slug is free. A slug that is somehow
-- taken leaves that channel out instead.
CREATE VIEW IF NOT EXISTS `cohort_channel_request` AS SELECT `id` AS `programId` FROM `program` WHERE 0;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cohort_channel_request_insert`
INSTEAD OF INSERT ON `cohort_channel_request`
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM `program` WHERE `id` = NEW.`programId`)
	AND NOT EXISTS (SELECT 1 FROM `channel` WHERE `programId` = NEW.`programId` AND `seedKey` IS NOT NULL)
BEGIN
	INSERT INTO `channel` (`id`, `kind`, `programId`, `slug`, `name`, `topic`, `position`, `seedKey`)
	SELECT lower(hex(randomblob(16))), 'COHORT', NEW.`programId`, 'cohort-' || `nn`, 'cohort-' || `nn`,
		'Everyday talk for the cohort, its mentors and its instructors.', 1, 'cohort:' || NEW.`programId` || ':main'
	FROM (
		SELECT printf('%02d', CASE
			WHEN `named` BETWEEN 1 AND 999
				AND NOT EXISTS (SELECT 1 FROM `channel` WHERE `kind` <> 'DIRECT' AND `slug` IN ('cohort-' || printf('%02d', `named`), 'c' || printf('%02d', `named`) || '-help', 'c' || printf('%02d', `named`) || '-announcements'))
			THEN `named`
			ELSE 1 + max(
				(SELECT coalesce(max(`n`), 0) FROM (
					SELECT CASE
						WHEN `slug` GLOB 'cohort-[0-9]*' THEN CAST(substr(`slug`, 8) AS INTEGER)
						WHEN `slug` GLOB 'c[0-9]*-help' OR `slug` GLOB 'c[0-9]*-announcements' THEN CAST(substr(`slug`, 2) AS INTEGER)
					END AS `n`
					FROM `channel` WHERE `kind` <> 'DIRECT'
				) WHERE `n` BETWEEN 1 AND 9999),
				(SELECT coalesce(max(`n`), 0) FROM (SELECT CASE WHEN instr(lower(`name`), 'cohort') > 0 THEN CAST(ltrim(substr(`name`, instr(lower(`name`), 'cohort') + 6), ' #:-_') AS INTEGER) ELSE 0 END AS `n` FROM `program`) WHERE `n` BETWEEN 1 AND 999)
			)
		END) AS `nn`
		FROM (SELECT CASE WHEN instr(lower(`name`), 'cohort') > 0 THEN CAST(ltrim(substr(`name`, instr(lower(`name`), 'cohort') + 6), ' #:-_') AS INTEGER) ELSE 0 END AS `named` FROM `program` WHERE `id` = NEW.`programId`)
	)
	WHERE NOT EXISTS (SELECT 1 FROM `channel` WHERE `kind` <> 'DIRECT' AND `slug` = 'cohort-' || `nn`);

	INSERT INTO `channel` (`id`, `kind`, `programId`, `slug`, `name`, `topic`, `position`, `seedKey`)
	SELECT lower(hex(randomblob(16))), 'COHORT', NEW.`programId`, 'c' || substr(`main`.`slug`, 8) || '-help', 'c' || substr(`main`.`slug`, 8) || '-help',
		'Questions about sessions, assignments and setup.', 2, 'cohort:' || NEW.`programId` || ':help'
	FROM `channel` AS `main`
	WHERE `main`.`seedKey` = 'cohort:' || NEW.`programId` || ':main'
		AND NOT EXISTS (SELECT 1 FROM `channel` WHERE `kind` <> 'DIRECT' AND `slug` = 'c' || substr(`main`.`slug`, 8) || '-help');

	INSERT INTO `channel` (`id`, `kind`, `programId`, `slug`, `name`, `topic`, `postingPolicy`, `position`, `seedKey`)
	SELECT lower(hex(randomblob(16))), 'COHORT', NEW.`programId`, 'c' || substr(`main`.`slug`, 8) || '-announcements', 'c' || substr(`main`.`slug`, 8) || '-announcements',
		'News from the cohort team. Only staff post here.', 'STAFF', 3, 'cohort:' || NEW.`programId` || ':announcements'
	FROM `channel` AS `main`
	WHERE `main`.`seedKey` = 'cohort:' || NEW.`programId` || ':main'
		AND NOT EXISTS (SELECT 1 FROM `channel` WHERE `kind` <> 'DIRECT' AND `slug` = 'c' || substr(`main`.`slug`, 8) || '-announcements');
END;
--> statement-breakpoint
-- The hook: every way a program is created (the admin form, the data import, preview
-- and staging fixtures) gives it its channels in the same statement.
CREATE TRIGGER IF NOT EXISTS `program_cohort_channels`
AFTER INSERT ON `program`
FOR EACH ROW
BEGIN
	INSERT INTO `cohort_channel_request` (`programId`) VALUES (NEW.`id`);
END;
--> statement-breakpoint
-- Backfill existing cohorts, one program at a time: those with a number in their name
-- first, so they keep it, then the rest in start order.
INSERT INTO `cohort_channel_request` (`programId`)
SELECT `id` FROM `program`
ORDER BY (CASE WHEN instr(lower(`name`), 'cohort') > 0 THEN CAST(ltrim(substr(`name`, instr(lower(`name`), 'cohort') + 6), ' #:-_') AS INTEGER) ELSE 0 END) BETWEEN 1 AND 999 DESC, `startDate` IS NULL, `startDate`, `createdAt`, `id`;
