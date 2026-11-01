-- Channel moderation pipeline (B-2.5; src/lib/channels/README.md, "Moderation"). Additive and safe
-- to reapply: three new tables, their indexes, one index on "user", and triggers. No existing row is
-- rewritten.
--
-- channel_message_version  moderation evidence: the texts a message had (moderators only)
-- moderation_case          the admin queue: one case per message, kept from moderation_event
-- moderation_allowlist     what an admin's "fine as is" allowlisted
--
-- The triggers keep evidence and cases whatever path writes, so no write path can skip them and none
-- spends a statement on them.
CREATE TABLE IF NOT EXISTS `channel_message_version` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`body` text NOT NULL,
	`cause` text NOT NULL,
	`capturedAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_message_version_cause_check" CHECK("channel_message_version"."cause" IN ('EDIT','DELETE','FLAG','REPORT','HIDE')),
	CONSTRAINT "channel_message_version_body_check" CHECK(length("channel_message_version"."body") BETWEEN 1 AND 10000),
	CONSTRAINT "channel_message_version_time_check" CHECK("channel_message_version"."capturedAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_message_version_message_idx` ON `channel_message_version` (`messageId`,`capturedAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `channel_message_version_expiry_idx` ON `channel_message_version` (`capturedAt`) WHERE "channel_message_version"."cause" IN ('EDIT','DELETE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `moderation_allowlist` (
	`key` text PRIMARY KEY NOT NULL,
	`messageId` text,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "moderation_allowlist_key_check" CHECK(length("moderation_allowlist"."key") <= 2048 AND ("moderation_allowlist"."key" GLOB 'text:[0-9a-f]*' OR "moderation_allowlist"."key" GLOB 'phone:+[0-9]*' OR "moderation_allowlist"."key" GLOB 'phone:0[0-9]*' OR "moderation_allowlist"."key" GLOB 'email:?*@?*' OR "moderation_allowlist"."key" GLOB 'link:?*')),
	CONSTRAINT "moderation_allowlist_time_check" CHECK("moderation_allowlist"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_allowlist_messageId_idx` ON `moderation_allowlist` (`messageId`) WHERE "moderation_allowlist"."messageId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_allowlist_createdBy_idx` ON `moderation_allowlist` (`createdBy`) WHERE "moderation_allowlist"."createdBy" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `moderation_case` (
	`messageId` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`reasons` text NOT NULL,
	`reportCount` integer DEFAULT 0 NOT NULL,
	`actorId` text,
	`openedAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`decision` text,
	`decisionReason` text,
	`decidedBy` text,
	`decidedAt` integer,
	`reviewRequestedAt` integer,
	`reviewNote` text,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decidedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "moderation_case_state_check" CHECK("moderation_case"."state" IN ('PENDING','DECIDED')),
	CONSTRAINT "moderation_case_source_check" CHECK("moderation_case"."source" IN ('AI_FLAG','REPORT','MENTOR_HIDE','ADMIN_HIDE')),
	CONSTRAINT "moderation_case_reasons_check" CHECK(json_valid("moderation_case"."reasons") AND json_type("moderation_case"."reasons") = 'array' AND json_array_length("moderation_case"."reasons") > 0),
	CONSTRAINT "moderation_case_reportCount_check" CHECK("moderation_case"."reportCount" >= 0),
	CONSTRAINT "moderation_case_decision_check" CHECK(("moderation_case"."decision" IS NULL OR "moderation_case"."decision" IN ('HIDE','RESTORE','KEEP')) AND ("moderation_case"."state" = 'DECIDED') = ("moderation_case"."decision" IS NOT NULL AND "moderation_case"."decisionReason" IS NOT NULL AND "moderation_case"."decidedAt" IS NOT NULL)),
	CONSTRAINT "moderation_case_review_check" CHECK("moderation_case"."reviewNote" IS NULL OR ("moderation_case"."reviewRequestedAt" IS NOT NULL AND length(trim("moderation_case"."reviewNote")) > 0 AND length("moderation_case"."reviewNote") <= 1000)),
	CONSTRAINT "moderation_case_time_check" CHECK("moderation_case"."openedAt" >= 0 AND "moderation_case"."updatedAt" >= "moderation_case"."openedAt" AND coalesce("moderation_case"."decidedAt", 0) >= 0 AND coalesce("moderation_case"."reviewRequestedAt", 0) >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_case_queue_idx` ON `moderation_case` (`state`,`openedAt`,`messageId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_case_actorId_idx` ON `moderation_case` (`actorId`) WHERE "moderation_case"."actorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `moderation_case_decidedBy_idx` ON `moderation_case` (`decidedBy`) WHERE "moderation_case"."decidedBy" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_name_lower_idx` ON `user` (lower("name"));
--> statement-breakpoint
-- Evidence, on every update of a message's text or moderation. First the text an author's edit or
-- delete replaced; then, when this update flagged or hid the message, its text as it was. Each skips a
-- text equal to the newest one already kept. A flag's time is its moderation_event's, which every
-- write path inserts before the update it describes.
CREATE TRIGGER IF NOT EXISTS `channel_message_version_update`
AFTER UPDATE OF `body`, `moderationState`, `moderationReasons` ON `channel_message`
BEGIN
	INSERT INTO `channel_message_version` (`id`, `messageId`, `body`, `cause`, `capturedAt`)
	SELECT lower(hex(randomblob(16))), OLD.`id`, OLD.`body`,
		CASE WHEN NEW.`deletedAt` IS NOT NULL AND OLD.`deletedAt` IS NULL THEN 'DELETE' ELSE 'EDIT' END,
		coalesce(NEW.`deletedAt`, NEW.`editedAt`, OLD.`createdAt`)
	WHERE OLD.`body` <> NEW.`body` AND OLD.`body` <> ''
		AND OLD.`body` IS NOT (SELECT `body` FROM `channel_message_version` WHERE `messageId` = OLD.`id`
			ORDER BY `capturedAt` DESC, rowid DESC LIMIT 1);
	INSERT INTO `channel_message_version` (`id`, `messageId`, `body`, `cause`, `capturedAt`)
	SELECT lower(hex(randomblob(16))), NEW.`id`, NEW.`body`,
		CASE NEW.`moderationState` WHEN 'HIDDEN' THEN 'HIDE' ELSE 'FLAG' END,
		coalesce((SELECT MAX(`createdAt`) FROM `moderation_event` WHERE `messageId` = NEW.`id`), NEW.`editedAt`, NEW.`createdAt`)
	WHERE NEW.`moderationState` <> 'VISIBLE' AND NEW.`body` <> ''
		AND (OLD.`moderationState` <> NEW.`moderationState` OR OLD.`moderationReasons` <> NEW.`moderationReasons`)
		AND NEW.`body` IS NOT (SELECT `body` FROM `channel_message_version` WHERE `messageId` = NEW.`id`
			ORDER BY `capturedAt` DESC, rowid DESC LIMIT 1);
END;
--> statement-breakpoint
-- Evidence for a message flagged as it was posted.
CREATE TRIGGER IF NOT EXISTS `channel_message_version_insert`
AFTER INSERT ON `channel_message` WHEN NEW.`moderationState` <> 'VISIBLE' AND NEW.`body` <> ''
BEGIN
	INSERT INTO `channel_message_version` (`id`, `messageId`, `body`, `cause`, `capturedAt`)
	VALUES (lower(hex(randomblob(16))), NEW.`id`, NEW.`body`,
		CASE NEW.`moderationState` WHEN 'HIDDEN' THEN 'HIDE' ELSE 'FLAG' END, NEW.`createdAt`);
END;
--> statement-breakpoint
-- Evidence for a report: the text the reporter saw.
CREATE TRIGGER IF NOT EXISTS `message_report_version`
AFTER INSERT ON `message_report`
BEGIN
	INSERT INTO `channel_message_version` (`id`, `messageId`, `body`, `cause`, `capturedAt`)
	SELECT lower(hex(randomblob(16))), m.`id`, m.`body`, 'REPORT', NEW.`createdAt`
	FROM `channel_message` m
	WHERE m.`id` = NEW.`messageId` AND m.`body` <> ''
		AND m.`body` IS NOT (SELECT `body` FROM `channel_message_version` WHERE `messageId` = m.`id`
			ORDER BY `capturedAt` DESC, rowid DESC LIMIT 1);
END;
--> statement-breakpoint
-- Edits and deletes of messages nobody flagged, hid or reported are kept for 14 days (1,209,600,000 ms),
-- so a late report still sees what was said; each new version prunes the expired ones.
CREATE TRIGGER IF NOT EXISTS `channel_message_version_prune`
AFTER INSERT ON `channel_message_version`
BEGIN
	DELETE FROM `channel_message_version`
	WHERE `cause` IN ('EDIT','DELETE') AND `capturedAt` <= NEW.`capturedAt` - 1209600000
		AND NOT EXISTS (SELECT 1 FROM `moderation_event` e WHERE e.`messageId` = `channel_message_version`.`messageId`)
		AND NOT EXISTS (SELECT 1 FROM `message_report` r WHERE r.`messageId` = `channel_message_version`.`messageId`);
END;
--> statement-breakpoint
-- A signal (a detector or Clef flag or hide, a member's report, a moderator's hide) opens a PENDING
-- case, or adds to the open one: reasons merge, reports count, and the strongest source names it
-- (MENTOR_HIDE over REPORT over AI_FLAG). A signal after an admin's decision opens a new case.
CREATE TRIGGER IF NOT EXISTS `moderation_event_case_signal`
AFTER INSERT ON `moderation_event` WHEN NEW.`source` <> 'ADMIN'
BEGIN
	INSERT INTO `moderation_case` (`messageId`, `state`, `source`, `reasons`, `reportCount`, `actorId`, `openedAt`, `updatedAt`)
	VALUES (NEW.`messageId`, 'PENDING',
		CASE NEW.`source` WHEN 'REPORT' THEN 'REPORT' WHEN 'MENTOR' THEN 'MENTOR_HIDE' ELSE 'AI_FLAG' END,
		NEW.`reasons`, NEW.`source` = 'REPORT', CASE WHEN NEW.`source` = 'MENTOR' THEN NEW.`actorId` END,
		NEW.`createdAt`, NEW.`createdAt`)
	ON CONFLICT (`messageId`) DO UPDATE SET
		`source` = CASE WHEN `state` = 'DECIDED'
			OR (CASE excluded.`source` WHEN 'MENTOR_HIDE' THEN 3 WHEN 'REPORT' THEN 2 ELSE 1 END)
				>= (CASE `source` WHEN 'MENTOR_HIDE' THEN 3 WHEN 'REPORT' THEN 2 ELSE 1 END)
			THEN excluded.`source` ELSE `source` END,
		`reasons` = CASE WHEN `state` = 'DECIDED' THEN excluded.`reasons` ELSE (SELECT json_group_array(value)
			FROM (SELECT value FROM json_each(`reasons`) UNION SELECT value FROM json_each(excluded.`reasons`))) END,
		`reportCount` = CASE WHEN `state` = 'DECIDED' THEN 0 ELSE `reportCount` END + excluded.`reportCount`,
		`actorId` = CASE WHEN excluded.`source` = 'MENTOR_HIDE' THEN excluded.`actorId`
			WHEN `state` = 'DECIDED' THEN NULL ELSE `actorId` END,
		`openedAt` = CASE WHEN `state` = 'DECIDED' THEN excluded.`openedAt` ELSE `openedAt` END,
		`updatedAt` = max(`updatedAt`, excluded.`updatedAt`),
		`reviewRequestedAt` = CASE WHEN `state` = 'DECIDED' THEN NULL ELSE `reviewRequestedAt` END,
		`reviewNote` = CASE WHEN `state` = 'DECIDED' THEN NULL ELSE `reviewNote` END,
		`state` = 'PENDING', `decision` = NULL, `decisionReason` = NULL, `decidedBy` = NULL, `decidedAt` = NULL;
END;
--> statement-breakpoint
-- An admin's decision closes the case. Hiding a message with no case opens one already decided
-- (ADMIN_HIDE); restoring or keeping one with no case changes no case.
CREATE TRIGGER IF NOT EXISTS `moderation_event_case_decision`
AFTER INSERT ON `moderation_event` WHEN NEW.`source` = 'ADMIN'
BEGIN
	INSERT INTO `moderation_case` (`messageId`, `state`, `source`, `reasons`, `actorId`, `openedAt`, `updatedAt`,
		`decision`, `decisionReason`, `decidedBy`, `decidedAt`)
	SELECT NEW.`messageId`, 'DECIDED', 'ADMIN_HIDE', NEW.`reasons`, NEW.`actorId`, NEW.`createdAt`, NEW.`createdAt`,
		'HIDE', json_extract(NEW.`reasons`, '$[0]'), NEW.`actorId`, NEW.`createdAt`
	WHERE NEW.`action` = 'HIDE'
	ON CONFLICT (`messageId`) DO NOTHING;
	UPDATE `moderation_case` SET `state` = 'DECIDED', `decision` = NEW.`action`,
		`decisionReason` = json_extract(NEW.`reasons`, '$[0]'), `decidedBy` = NEW.`actorId`, `decidedAt` = NEW.`createdAt`,
		`updatedAt` = max(`updatedAt`, NEW.`createdAt`)
	WHERE `messageId` = NEW.`messageId` AND NEW.`action` IN ('HIDE','RESTORE','KEEP');
END;
