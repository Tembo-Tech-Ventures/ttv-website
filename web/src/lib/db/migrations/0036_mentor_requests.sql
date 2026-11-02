-- Mentor connections (B-4.1; src/lib/mentoring/README.md). Two new tables, nothing else changes, and
-- no existing row is read or rewritten: mentor_profile (a mentor's availability: headline, areas,
-- formats, monthly capacity, pause) and mentor_request (asking a mentor for time, PENDING until it is
-- accepted, redirected, declined or withdrawn; one PENDING request per pair). Idempotent: every
-- statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `mentor_profile` (
	`userId` text PRIMARY KEY NOT NULL,
	`headline` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`areas` text DEFAULT '[]' NOT NULL,
	`formats` text DEFAULT '["WRITTEN_REVIEW","CALL_30_MIN","QUICK_QUESTION"]' NOT NULL,
	`monthlyCapacity` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mentor_profile_headline_check" CHECK(length(trim("mentor_profile"."headline")) > 0 AND length("mentor_profile"."headline") <= 120),
	CONSTRAINT "mentor_profile_bio_check" CHECK(length("mentor_profile"."bio") <= 2000),
	CONSTRAINT "mentor_profile_areas_check" CHECK(json_valid("mentor_profile"."areas") AND json_type("mentor_profile"."areas") = 'array'),
	CONSTRAINT "mentor_profile_formats_check" CHECK(json_valid("mentor_profile"."formats") AND json_type("mentor_profile"."formats") = 'array' AND json_array_length("mentor_profile"."formats") > 0),
	CONSTRAINT "mentor_profile_capacity_check" CHECK("mentor_profile"."monthlyCapacity" BETWEEN 0 AND 20),
	CONSTRAINT "mentor_profile_paused_check" CHECK("mentor_profile"."paused" IN (0, 1)),
	CONSTRAINT "mentor_profile_time_check" CHECK("mentor_profile"."createdAt" >= 0 AND "mentor_profile"."updatedAt" >= "mentor_profile"."createdAt")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mentor_request` (
	`id` text PRIMARY KEY NOT NULL,
	`requesterId` text NOT NULL,
	`mentorId` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`format` text NOT NULL,
	`note` text NOT NULL,
	`noteReasons` text DEFAULT '[]' NOT NULL,
	`journeyId` text,
	`journeyVersion` integer,
	`project` text,
	`channelId` text,
	`redirectedToId` text,
	`responseNote` text,
	`acceptedAt` integer,
	`decidedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`requesterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mentorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journeyId`) REFERENCES `communityJourney`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redirectedToId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mentor_request_parties_check" CHECK("mentor_request"."requesterId" <> "mentor_request"."mentorId"),
	CONSTRAINT "mentor_request_status_check" CHECK("mentor_request"."status" IN ('PENDING','ACCEPTED','REDIRECTED','DECLINED','WITHDRAWN')),
	CONSTRAINT "mentor_request_format_check" CHECK("mentor_request"."format" IN ('WRITTEN_REVIEW','CALL_30_MIN','QUICK_QUESTION')),
	CONSTRAINT "mentor_request_note_check" CHECK(length(trim("mentor_request"."note")) > 0 AND length("mentor_request"."note") <= 2000),
	CONSTRAINT "mentor_request_noteReasons_check" CHECK(json_valid("mentor_request"."noteReasons") AND json_type("mentor_request"."noteReasons") = 'array'),
	CONSTRAINT "mentor_request_project_check" CHECK(("mentor_request"."project" IS NULL) = ("mentor_request"."journeyVersion" IS NULL) AND ("mentor_request"."project" IS NULL OR json_valid("mentor_request"."project")) AND coalesce("mentor_request"."journeyVersion", 1) >= 1),
	CONSTRAINT "mentor_request_accepted_check" CHECK(("mentor_request"."status" = 'ACCEPTED') = ("mentor_request"."acceptedAt" IS NOT NULL) AND ("mentor_request"."status" = 'ACCEPTED') = ("mentor_request"."channelId" IS NOT NULL)),
	CONSTRAINT "mentor_request_decided_check" CHECK(("mentor_request"."status" = 'PENDING') = ("mentor_request"."decidedAt" IS NULL)),
	CONSTRAINT "mentor_request_redirect_check" CHECK("mentor_request"."redirectedToId" IS NULL OR "mentor_request"."status" = 'REDIRECTED'),
	CONSTRAINT "mentor_request_response_check" CHECK("mentor_request"."responseNote" IS NULL OR ("mentor_request"."status" IN ('REDIRECTED','DECLINED') AND length(trim("mentor_request"."responseNote")) > 0 AND length("mentor_request"."responseNote") <= 2000)),
	CONSTRAINT "mentor_request_time_check" CHECK("mentor_request"."createdAt" >= 0 AND "mentor_request"."updatedAt" >= "mentor_request"."createdAt" AND coalesce("mentor_request"."decidedAt", "mentor_request"."createdAt") >= "mentor_request"."createdAt" AND coalesce("mentor_request"."acceptedAt", 0) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mentor_request_pending_idx` ON `mentor_request` (`requesterId`,`mentorId`) WHERE "mentor_request"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_mentor_idx` ON `mentor_request` (`mentorId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_mentor_status_idx` ON `mentor_request` (`mentorId`,`status`,`acceptedAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_requester_idx` ON `mentor_request` (`requesterId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_channelId_idx` ON `mentor_request` (`channelId`) WHERE "mentor_request"."channelId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_journeyId_idx` ON `mentor_request` (`journeyId`) WHERE "mentor_request"."journeyId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_redirectedToId_idx` ON `mentor_request` (`redirectedToId`) WHERE "mentor_request"."redirectedToId" IS NOT NULL;