CREATE TABLE IF NOT EXISTS `feedback_theme` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'COLLECTING' NOT NULL,
	`change` text,
	`issueUrl` text,
	`prUrl` text,
	`decisionNote` text,
	`closedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "feedback_theme_kind_check" CHECK("feedback_theme"."kind" in ('BUG', 'CONFUSING', 'IDEA', 'PRAISE', 'OTHER')),
	CONSTRAINT "feedback_theme_status_check" CHECK("feedback_theme"."status" in ('COLLECTING', 'PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'DECLINED', 'DORMANT')),
	CONSTRAINT "feedback_theme_change_check" CHECK("feedback_theme"."change" is null or "feedback_theme"."change" in ('FIX', 'SIMPLIFY', 'ADD')),
	CONSTRAINT "feedback_theme_title_length_check" CHECK(length("feedback_theme"."title") between 1 and 120),
	CONSTRAINT "feedback_theme_summary_length_check" CHECK(length("feedback_theme"."summary") <= 4000),
	CONSTRAINT "feedback_theme_decisionNote_length_check" CHECK("feedback_theme"."decisionNote" is null or length("feedback_theme"."decisionNote") <= 5000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_theme_status_updatedAt_idx` ON `feedback_theme` (`status`,`updatedAt`);--> statement-breakpoint
ALTER TABLE `feedback` ADD `themeId` text REFERENCES feedback_theme(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `feedback` ADD `sensitive` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_themeId_idx` ON `feedback` (`themeId`);