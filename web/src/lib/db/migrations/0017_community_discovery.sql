CREATE TABLE `communityConfirmation` (
	`id` text PRIMARY KEY NOT NULL,
	`journeyId` text NOT NULL,
	`mentorId` text NOT NULL,
	`statement` text NOT NULL,
	`method` text NOT NULL,
	`journeyVersion` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`journeyId`) REFERENCES `communityJourney`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mentorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `communityConfirmation_journeyId_idx` ON `communityConfirmation` (`journeyId`);--> statement-breakpoint
CREATE TABLE `communityJourney` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`evidenceUrl` text,
	`occurredAt` text NOT NULL,
	`visibility` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "communityJourney_visibility_check" CHECK("communityJourney"."visibility" IN ('institution', 'private'))
);
--> statement-breakpoint
CREATE INDEX `communityJourney_userId_visibility_idx` ON `communityJourney` (`userId`,`visibility`);--> statement-breakpoint
CREATE TABLE `communityProfile` (
	`userId` text PRIMARY KEY NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`opportunityGoals` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO "Roles" ("id", "name") VALUES (lower(hex(randomblob(16))), 'INSTITUTION') ON CONFLICT("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Roles" ("id", "name") VALUES (lower(hex(randomblob(16))), 'MENTOR') ON CONFLICT("name") DO NOTHING;
