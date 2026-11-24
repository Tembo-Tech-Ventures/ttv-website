-- In-app calls, the foundation (src/lib/meetings/README.md): every table later slices need, three
-- flags seeded OFF, and fail-closed recording scopes. `recording` and `communityConfirmation` are
-- referenced by other tables and foreign keys are on, so neither is rebuilt: only ADD COLUMN,
-- UPDATE and triggers touch them. Every CREATE, trigger and seed may run again; the ADD COLUMNs run once.
CREATE TABLE IF NOT EXISTS `call_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`proposedBy` text NOT NULL,
	`purpose` text NOT NULL,
	`journeyId` text,
	`journeyVersion` integer,
	`times` text NOT NULL,
	`bookedMinutes` integer NOT NULL,
	`askToRecord` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'OPEN' NOT NULL,
	`meetingId` text,
	`messageId` text,
	`decidedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journeyId`) REFERENCES `communityJourney`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`meetingId`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "call_proposal_purpose_check" CHECK("call_proposal"."purpose" IN ('CHECKIN','CALL')),
	CONSTRAINT "call_proposal_state_check" CHECK("call_proposal"."state" IN ('OPEN','ACCEPTED','DECLINED','WITHDRAWN','EXPIRED')),
	CONSTRAINT "call_proposal_journey_check" CHECK(("call_proposal"."purpose" <> 'CHECKIN' OR "call_proposal"."journeyVersion" IS NOT NULL) AND coalesce("call_proposal"."journeyVersion", 1) >= 1),
	CONSTRAINT "call_proposal_times_check" CHECK(json_valid("call_proposal"."times") AND json_type("call_proposal"."times") = 'array' AND json_array_length("call_proposal"."times") BETWEEN 1 AND 3),
	CONSTRAINT "call_proposal_minutes_check" CHECK("call_proposal"."bookedMinutes" >= 1),
	CONSTRAINT "call_proposal_askToRecord_check" CHECK("call_proposal"."askToRecord" IN (0, 1)),
	CONSTRAINT "call_proposal_decided_check" CHECK(("call_proposal"."state" = 'OPEN') = ("call_proposal"."decidedAt" IS NULL)),
	CONSTRAINT "call_proposal_time_check" CHECK("call_proposal"."createdAt" >= 0 AND "call_proposal"."updatedAt" >= "call_proposal"."createdAt" AND coalesce("call_proposal"."decidedAt", "call_proposal"."createdAt") >= "call_proposal"."createdAt")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `call_proposal_open_idx` ON `call_proposal` (`channelId`) WHERE "call_proposal"."state" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_proposal_channel_idx` ON `call_proposal` (`channelId`,`createdAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_proposal_proposedBy_idx` ON `call_proposal` (`proposedBy`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_proposal_journeyId_idx` ON `call_proposal` (`journeyId`) WHERE "call_proposal"."journeyId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_proposal_meetingId_idx` ON `call_proposal` (`meetingId`) WHERE "call_proposal"."meetingId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_proposal_messageId_idx` ON `call_proposal` (`messageId`) WHERE "call_proposal"."messageId" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meeting` (
	`id` text PRIMARY KEY NOT NULL,
	`channelId` text NOT NULL,
	`purpose` text NOT NULL,
	`title` text NOT NULL,
	`seriesId` text,
	`scheduledStartAt` integer NOT NULL,
	`bookedMinutes` integer NOT NULL,
	`limitMinutes` integer NOT NULL,
	`recordingPolicy` text NOT NULL,
	`state` text DEFAULT 'SCHEDULED' NOT NULL,
	`openedAt` integer,
	`hardEndAt` integer,
	`endedAt` integer,
	`endReason` text,
	`journeyId` text,
	`journeyVersion` integer,
	`messageId` text,
	`providerMeetingId` text,
	`createdBy` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journeyId`) REFERENCES `communityJourney`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`messageId`) REFERENCES `channel_message`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_minutes_check" CHECK("meeting"."bookedMinutes" >= 1 AND "meeting"."limitMinutes" >= "meeting"."bookedMinutes"),
	CONSTRAINT "meeting_time_check" CHECK("meeting"."scheduledStartAt" >= 0 AND "meeting"."createdAt" >= 0 AND "meeting"."updatedAt" >= "meeting"."createdAt" AND coalesce("meeting"."openedAt", 0) >= 0 AND coalesce("meeting"."hardEndAt", "meeting"."openedAt", 0) >= coalesce("meeting"."openedAt", 0) AND coalesce("meeting"."endedAt", 0) >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_channel_idx` ON `meeting` (`channelId`,`scheduledStartAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_state_idx` ON `meeting` (`state`,`scheduledStartAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_seriesId_idx` ON `meeting` (`seriesId`) WHERE "meeting"."seriesId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_journeyId_idx` ON `meeting` (`journeyId`) WHERE "meeting"."journeyId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_messageId_idx` ON `meeting` (`messageId`) WHERE "meeting"."messageId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_createdBy_idx` ON `meeting` (`createdBy`) WHERE "meeting"."createdBy" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meeting_providerMeetingId_idx` ON `meeting` (`providerMeetingId`) WHERE "meeting"."providerMeetingId" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meeting_consent` (
	`meetingId` text NOT NULL,
	`userId` text NOT NULL,
	`answer` text NOT NULL,
	`wordingVersion` integer NOT NULL,
	`answeredAt` integer NOT NULL,
	PRIMARY KEY(`meetingId`, `userId`),
	FOREIGN KEY (`meetingId`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_consent_answer_check" CHECK("meeting_consent"."answer" IN ('RECORD','DONT_RECORD')),
	CONSTRAINT "meeting_consent_wording_check" CHECK("meeting_consent"."wordingVersion" >= 1),
	CONSTRAINT "meeting_consent_time_check" CHECK("meeting_consent"."answeredAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_consent_userId_idx` ON `meeting_consent` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meeting_recording` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`state` text DEFAULT 'STARTING' NOT NULL,
	`providerRecordingId` text,
	`reservedSeconds` integer DEFAULT 0 NOT NULL,
	`usedSeconds` integer,
	`ingestKey` text,
	`recordingId` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`startedAt` integer,
	`stoppedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`meetingId`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recordingId`) REFERENCES `recording`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_recording_state_check" CHECK("meeting_recording"."state" IN ('STARTING','RECORDING','STOPPED','PROMOTED','FAILED','TOO_SHORT','REFUSED')),
	CONSTRAINT "meeting_recording_seconds_check" CHECK("meeting_recording"."reservedSeconds" >= 0 AND coalesce("meeting_recording"."usedSeconds", 0) >= 0 AND "meeting_recording"."attempts" >= 0),
	CONSTRAINT "meeting_recording_error_check" CHECK("meeting_recording"."lastError" IS NULL OR length("meeting_recording"."lastError") <= 2000),
	CONSTRAINT "meeting_recording_time_check" CHECK("meeting_recording"."createdAt" >= 0 AND "meeting_recording"."updatedAt" >= "meeting_recording"."createdAt" AND coalesce("meeting_recording"."startedAt", 0) >= 0 AND coalesce("meeting_recording"."stoppedAt", "meeting_recording"."startedAt", 0) >= coalesce("meeting_recording"."startedAt", 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meeting_recording_meetingId_idx` ON `meeting_recording` (`meetingId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_recording_state_idx` ON `meeting_recording` (`state`,`updatedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meeting_recording_provider_idx` ON `meeting_recording` (`providerRecordingId`) WHERE "meeting_recording"."providerRecordingId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meeting_recording_recordingId_idx` ON `meeting_recording` (`recordingId`) WHERE "meeting_recording"."recordingId" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meeting_seat` (
	`meetingId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'HELD' NOT NULL,
	`providerParticipantId` text,
	`lastSeenAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`meetingId`, `userId`),
	FOREIGN KEY (`meetingId`) REFERENCES `meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_seat_role_check" CHECK("meeting_seat"."role" IN ('HOST','MEMBER')),
	CONSTRAINT "meeting_seat_state_check" CHECK("meeting_seat"."state" IN ('HELD','RELEASED','REMOVED')),
	CONSTRAINT "meeting_seat_time_check" CHECK("meeting_seat"."createdAt" >= 0 AND "meeting_seat"."updatedAt" >= "meeting_seat"."createdAt" AND "meeting_seat"."lastSeenAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_seat_state_idx` ON `meeting_seat` (`meetingId`,`state`,`role`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `meeting_seat_userId_idx` ON `meeting_seat` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meeting_seat_participant_idx` ON `meeting_seat` (`providerParticipantId`) WHERE "meeting_seat"."providerParticipantId" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meeting_usage_month` (
	`month` text PRIMARY KEY NOT NULL,
	`recordingSecondsReserved` integer DEFAULT 0 NOT NULL,
	`recordingSecondsUsed` integer DEFAULT 0 NOT NULL,
	`participantSeconds` integer DEFAULT 0 NOT NULL,
	`alertedAt` integer,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "meeting_usage_month_month_check" CHECK("meeting_usage_month"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
	CONSTRAINT "meeting_usage_month_seconds_check" CHECK("meeting_usage_month"."recordingSecondsReserved" >= 0 AND "meeting_usage_month"."recordingSecondsUsed" >= 0 AND "meeting_usage_month"."participantSeconds" >= 0),
	CONSTRAINT "meeting_usage_month_time_check" CHECK("meeting_usage_month"."updatedAt" >= 0 AND coalesce("meeting_usage_month"."alertedAt", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE `communityConfirmation` ADD `meetingId` text REFERENCES meeting(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `communityConfirmation_meetingId_idx` ON `communityConfirmation` (`meetingId`) WHERE "communityConfirmation"."meetingId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `recording` ADD `meetingId` text REFERENCES meeting(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `recording` ADD `channelId` text REFERENCES channel(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `recording` ADD `scopeChosen` integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `recording_meetingId_idx` ON `recording` (`meetingId`) WHERE "recording"."meetingId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `recording_channelId_idx` ON `recording` (`channelId`) WHERE "recording"."channelId" IS NOT NULL;--> statement-breakpoint
-- Recording scopes fail closed (replacing 0042's cohort triggers, which widened). A Worker from
-- before this migration names no scope (Drizzle sends the 'ADMIN_ONLY' default) and never sets
-- scopeChosen: its imports with a cohort stay in that cohort. Every later insert sets scopeChosen
-- and states its scope, which is then kept, ADMIN_ONLY with a cohort included.
DROP TRIGGER IF EXISTS recording_cohort_scope_insert;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recording_unscoped_insert AFTER INSERT ON `recording`
WHEN NEW.scopeChosen IS NULL AND NEW.programId IS NOT NULL AND NEW.accessScope = 'ADMIN_ONLY' BEGIN
 UPDATE `recording` SET accessScope = 'COHORT' WHERE id = NEW.id;
END;
--> statement-breakpoint
-- Moving a cohort's recording out of every cohort makes it admins only. Nothing else follows a
-- cohort change: moving an admins-only recording into a cohort keeps it admins only, and a
-- cohort's recording moved to another cohort is that cohort's.
DROP TRIGGER IF EXISTS recording_cohort_scope_update;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recording_cohort_scope_leave AFTER UPDATE OF programId ON `recording`
WHEN NEW.programId IS NULL AND NEW.accessScope = 'COHORT' BEGIN
 UPDATE `recording` SET accessScope = 'ADMIN_ONLY' WHERE id = NEW.id;
END;
--> statement-breakpoint
-- `meeting` is cited by other tables (a confirmation with ON DELETE CASCADE), so it must never be
-- rebuilt either: its allowed values and shape are triggers a later migration can replace, not table
-- checks. The lists are lib/meetings/rules.ts's.
CREATE TRIGGER IF NOT EXISTS meeting_values_insert BEFORE INSERT ON `meeting`
WHEN NEW.purpose NOT IN ('SESSION', 'CHECKIN', 'CALL', 'EVENT')
  OR NEW.state NOT IN ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED')
  OR NEW.recordingPolicy NOT IN ('ALWAYS', 'BOTH_AGREE', 'HOST', 'NONE')
  OR NEW.endReason NOT IN ('HOST_ENDED', 'LIMIT', 'NO_HOST', 'NOBODY_CAME', 'EMPTY') BEGIN
 SELECT RAISE(ABORT, 'meeting: purpose, state, recordingPolicy and endReason take only their allowed values');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS meeting_values_update BEFORE UPDATE OF purpose, state, recordingPolicy, endReason ON `meeting`
WHEN NEW.purpose NOT IN ('SESSION', 'CHECKIN', 'CALL', 'EVENT')
  OR NEW.state NOT IN ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED')
  OR NEW.recordingPolicy NOT IN ('ALWAYS', 'BOTH_AGREE', 'HOST', 'NONE')
  OR NEW.endReason NOT IN ('HOST_ENDED', 'LIMIT', 'NO_HOST', 'NOBODY_CAME', 'EMPTY') BEGIN
 SELECT RAISE(ABORT, 'meeting: purpose, state, recordingPolicy and endReason take only their allowed values');
END;
--> statement-breakpoint
-- A title of 1 to 120 characters; a check-in names a revision of its work; a live call has opened;
-- an ended call has an end and a reason, and nothing else has either.
CREATE TRIGGER IF NOT EXISTS meeting_shape_insert BEFORE INSERT ON `meeting`
WHEN length(trim(NEW.title)) = 0 OR length(NEW.title) > 120
  OR (NEW.purpose = 'CHECKIN' AND NEW.journeyVersion IS NULL) OR NEW.journeyVersion < 1
  OR (NEW.state = 'LIVE' AND NEW.openedAt IS NULL)
  OR (NEW.state = 'ENDED') <> (NEW.endedAt IS NOT NULL) OR (NEW.state = 'ENDED') <> (NEW.endReason IS NOT NULL) BEGIN
 SELECT RAISE(ABORT, 'meeting: a 1 to 120 character title, a check-in''s revision, and an end only when ended');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS meeting_shape_update BEFORE UPDATE OF title, purpose, journeyVersion, state, openedAt, endedAt, endReason ON `meeting`
WHEN length(trim(NEW.title)) = 0 OR length(NEW.title) > 120
  OR (NEW.purpose = 'CHECKIN' AND NEW.journeyVersion IS NULL) OR NEW.journeyVersion < 1
  OR (NEW.state = 'LIVE' AND NEW.openedAt IS NULL)
  OR (NEW.state = 'ENDED') <> (NEW.endedAt IS NOT NULL) OR (NEW.state = 'ENDED') <> (NEW.endReason IS NOT NULL) BEGIN
 SELECT RAISE(ABORT, 'meeting: a 1 to 120 character title, a check-in''s revision, and an end only when ended');
END;
--> statement-breakpoint
-- The three flags, OFF everywhere until staff and then the owner turn them on. meetings needs
-- channels and spaces; meeting_checkins needs meetings and mentor_requests; meeting_events needs
-- meetings (lib/platform/server/flags.ts).
INSERT OR IGNORE INTO `feature_flag` (`key`, `audience`) VALUES ('meetings', 'OFF'), ('meeting_checkins', 'OFF'), ('meeting_events', 'OFF');
