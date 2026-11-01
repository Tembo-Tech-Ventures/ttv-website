-- Onboarding (src/lib/onboarding/README.md). Additive and safe to reapply: new tables and
-- indexes only, and the flag row is seeded OFF without overwriting an audience already set.
CREATE TABLE IF NOT EXISTS `access_request` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`note` text NOT NULL,
	`organisation` text,
	`organisationRole` text,
	`link` text,
	`scopeAcknowledgedAt` integer,
	`decisionId` text,
	`decisionMessage` text,
	`decidedBy` text,
	`decidedAt` integer,
	`requesterSeenAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decidedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "access_request_role_check" CHECK("access_request"."role" IN ('MENTOR','INSTITUTION')),
	CONSTRAINT "access_request_status_check" CHECK("access_request"."status" IN ('PENDING','APPROVED','DECLINED','WITHDRAWN')),
	CONSTRAINT "access_request_note_check" CHECK(length(trim("access_request"."note")) >= 20 AND length("access_request"."note") <= 600),
	CONSTRAINT "access_request_institution_check" CHECK("access_request"."role" <> 'INSTITUTION' OR ("access_request"."organisation" IS NOT NULL AND "access_request"."scopeAcknowledgedAt" IS NOT NULL)),
	CONSTRAINT "access_request_mentor_check" CHECK("access_request"."role" <> 'MENTOR' OR ("access_request"."organisation" IS NULL AND "access_request"."organisationRole" IS NULL AND "access_request"."scopeAcknowledgedAt" IS NULL)),
	CONSTRAINT "access_request_organisation_check" CHECK("access_request"."organisation" IS NULL OR (length(trim("access_request"."organisation")) > 0 AND length("access_request"."organisation") <= 200)),
	CONSTRAINT "access_request_organisation_role_check" CHECK("access_request"."organisationRole" IS NULL OR (length(trim("access_request"."organisationRole")) > 0 AND length("access_request"."organisationRole") <= 200)),
	CONSTRAINT "access_request_link_check" CHECK("access_request"."link" IS NULL OR length("access_request"."link") <= 2048),
	CONSTRAINT "access_request_decided_check" CHECK(("access_request"."status" IN ('APPROVED','DECLINED')) = ("access_request"."decidedAt" IS NOT NULL)),
	CONSTRAINT "access_request_message_check" CHECK("access_request"."decisionMessage" IS NULL OR ("access_request"."status" IN ('APPROVED','DECLINED') AND length(trim("access_request"."decisionMessage")) > 0 AND length("access_request"."decisionMessage") <= 600)),
	CONSTRAINT "access_request_seen_check" CHECK("access_request"."requesterSeenAt" IS NULL OR "access_request"."status" IN ('APPROVED','DECLINED')),
	CONSTRAINT "access_request_time_check" CHECK("access_request"."createdAt" >= 0 AND "access_request"."updatedAt" >= "access_request"."createdAt")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `access_request_pending_idx` ON `access_request` (`userId`,`role`) WHERE "access_request"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `access_request_decision_idx` ON `access_request` (`decisionId`) WHERE "access_request"."decisionId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `access_request_queue_idx` ON `access_request` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `access_request_user_idx` ON `access_request` (`userId`,`role`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_intent` (
	`userId` text NOT NULL,
	`intent` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `intent`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_intent_intent_check" CHECK("member_intent"."intent" IN ('MEMBER','MENTOR','INSTITUTION','EXPLORING')),
	CONSTRAINT "member_intent_time_check" CHECK("member_intent"."createdAt" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_onboarding` (
	`userId` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`completedAt` integer,
	`promptDismissedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_onboarding_stage_check" CHECK("member_onboarding"."stage" IN ('NEW','DONE')),
	CONSTRAINT "member_onboarding_done_check" CHECK("member_onboarding"."stage" = 'DONE' OR ("member_onboarding"."completedAt" IS NULL AND "member_onboarding"."promptDismissedAt" IS NULL)),
	CONSTRAINT "member_onboarding_time_check" CHECK("member_onboarding"."createdAt" >= 0 AND "member_onboarding"."updatedAt" >= "member_onboarding"."createdAt")
);--> statement-breakpoint
INSERT OR IGNORE INTO `feature_flag` (`key`, `audience`) VALUES ('onboarding', 'OFF');
