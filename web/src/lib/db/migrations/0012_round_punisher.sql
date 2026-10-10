ALTER TABLE `studentProfile` ADD `moderationOutcome` text;--> statement-breakpoint
ALTER TABLE `studentProfile` ADD `moderationFlags` text;--> statement-breakpoint
ALTER TABLE `studentProfile` ADD `moderationScores` text;--> statement-breakpoint
ALTER TABLE `studentProfile` ADD `moderationCheckedAt` integer;--> statement-breakpoint
ALTER TABLE `studentProfile` ADD `moderationReviewRequired` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The owner approved publishing any legacy pre-review rows while marking them
-- for a fail-open admin follow-up. Production had no such rows on 2026-10-10.
UPDATE `studentProfile`
SET
	`status` = 'PUBLISHED',
	`publishedAt` = coalesce(`publishedAt`, unixepoch()),
	`moderationOutcome` = 'error',
	`moderationFlags` = '[]',
	`moderationScores` = '{}',
	`moderationCheckedAt` = unixepoch(),
	`moderationReviewRequired` = true
WHERE `status` = 'IN_REVIEW';
