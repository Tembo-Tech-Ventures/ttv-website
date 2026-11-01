-- Mentor private set-aside (src/lib/mentoring/README.md). Additive and safe to reapply: one new
-- table and its index, no writes to existing data. Rows follow the mentor and the contribution
-- out (ON DELETE cascade); a new revision of the contribution is never covered by an old row.
CREATE TABLE IF NOT EXISTS `communitySetAside` (
	`mentorId` text NOT NULL,
	`journeyId` text NOT NULL,
	`journeyVersion` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`mentorId`, `journeyId`, `journeyVersion`),
	FOREIGN KEY (`mentorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journeyId`) REFERENCES `communityJourney`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "communitySetAside_journeyVersion_check" CHECK("communitySetAside"."journeyVersion" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `communitySetAside_journeyId_idx` ON `communitySetAside` (`journeyId`);
