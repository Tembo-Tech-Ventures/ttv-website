-- Checks on mentor request notes (B-4.1 follow-up; src/lib/mentoring/README.md, "Checks"). Two new
-- tables, nothing else changes, and no existing row is read or rewritten: mentor_request_case (at most
-- one per request: opened by Clef's near-certain abuse or the mentor's report, decided KEEP or REMOVE
-- by an admin) and mentor_request_report (the mentor's report, one per request). Idempotent: every
-- statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `mentor_request_case` (
	`requestId` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'OPEN' NOT NULL,
	`clefReasons` text DEFAULT '[]' NOT NULL,
	`openedAt` integer NOT NULL,
	`decision` text,
	`decisionReason` text,
	`decidedBy` text,
	`decidedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`requestId`) REFERENCES `mentor_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mentor_request_case_state_check" CHECK("mentor_request_case"."state" IN ('OPEN','DECIDED')),
	CONSTRAINT "mentor_request_case_clefReasons_check" CHECK(json_valid("mentor_request_case"."clefReasons") AND json_type("mentor_request_case"."clefReasons") = 'array'),
	CONSTRAINT "mentor_request_case_decision_check" CHECK(("mentor_request_case"."decision" IS NULL OR "mentor_request_case"."decision" IN ('KEEP','REMOVE'))
    AND ("mentor_request_case"."decision" IS NULL) = ("mentor_request_case"."decidedAt" IS NULL) AND ("mentor_request_case"."decision" IS NULL) = ("mentor_request_case"."decisionReason" IS NULL)
    AND ("mentor_request_case"."state" = 'OPEN' OR "mentor_request_case"."decision" IS NOT NULL)
    AND ("mentor_request_case"."decisionReason" IS NULL OR (length(trim("mentor_request_case"."decisionReason")) > 0 AND length("mentor_request_case"."decisionReason") <= 2000))),
	CONSTRAINT "mentor_request_case_time_check" CHECK("mentor_request_case"."createdAt" >= 0 AND "mentor_request_case"."updatedAt" >= "mentor_request_case"."createdAt" AND "mentor_request_case"."openedAt" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_case_queue_idx` ON `mentor_request_case` (`state`,`openedAt`,`requestId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_case_decidedBy_idx` ON `mentor_request_case` (`decidedBy`) WHERE "mentor_request_case"."decidedBy" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mentor_request_report` (
	`requestId` text PRIMARY KEY NOT NULL,
	`reporterId` text NOT NULL,
	`reason` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`requestId`) REFERENCES `mentor_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mentor_request_report_reason_check" CHECK(length(trim("mentor_request_report"."reason")) > 0 AND length("mentor_request_report"."reason") <= 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mentor_request_report_reporterId_idx` ON `mentor_request_report` (`reporterId`);