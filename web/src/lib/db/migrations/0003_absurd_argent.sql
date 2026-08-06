CREATE TABLE `clientProject` (
	`id` text PRIMARY KEY NOT NULL,
	`organization` text NOT NULL,
	`contactName` text NOT NULL,
	`contactEmail` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`skills` text,
	`budgetBand` text DEFAULT 'UNDISCLOSED' NOT NULL,
	`timeline` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `formSubmissionLog` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`ipHash` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `formSubmissionLog_scope_ipHash_createdAt_idx` ON `formSubmissionLog` (`scope`,`ipHash`,`createdAt`);--> statement-breakpoint
CREATE TABLE `profileContact` (
	`id` text PRIMARY KEY NOT NULL,
	`profileId` text NOT NULL,
	`fromName` text NOT NULL,
	`fromEmail` text NOT NULL,
	`organization` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'NEW' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profileId`) REFERENCES `studentProfile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profileHighlight` (
	`id` text PRIMARY KEY NOT NULL,
	`profileId` text NOT NULL,
	`repoFullName` text NOT NULL,
	`repoUrl` text NOT NULL,
	`description` text,
	`language` text,
	`topics` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`pushedAt` integer,
	`blurb` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`snapshotAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profileId`) REFERENCES `studentProfile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profileHighlight_profileId_repoFullName_unique` ON `profileHighlight` (`profileId`,`repoFullName`);--> statement-breakpoint
CREATE TABLE `projectInterest` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`profileId` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'INTERESTED' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `clientProject`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profileId`) REFERENCES `studentProfile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projectInterest_projectId_profileId_unique` ON `projectInterest` (`projectId`,`profileId`);--> statement-breakpoint
CREATE TABLE `studentProfile` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`handle` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`headline` text,
	`bio` text,
	`location` text,
	`country` text,
	`skills` text,
	`openToFreelance` integer DEFAULT false NOT NULL,
	`openToRoles` integer DEFAULT false NOT NULL,
	`githubLogin` text,
	`portfolioUrl` text,
	`linkedinUrl` text,
	`publishedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studentProfile_userId_unique` ON `studentProfile` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `studentProfile_handle_unique` ON `studentProfile` (`handle`);