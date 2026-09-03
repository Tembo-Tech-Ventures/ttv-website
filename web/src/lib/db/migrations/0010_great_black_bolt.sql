CREATE TABLE `blogPost` (
	`id` text PRIMARY KEY NOT NULL,
	`profileId` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`contentMarkdown` text NOT NULL,
	`contentHtml` text DEFAULT '' NOT NULL,
	`renderedWith` integer DEFAULT 0 NOT NULL,
	`coverImageKey` text,
	`coverImageAlt` text,
	`readingMinutes` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`adminNote` text,
	`publishedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profileId`) REFERENCES `studentProfile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blogPost_profileId_slug_unique` ON `blogPost` (`profileId`,`slug`);--> statement-breakpoint
CREATE INDEX `blogPost_status_publishedAt_idx` ON `blogPost` (`status`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `blogPost_profileId_status_publishedAt_idx` ON `blogPost` (`profileId`,`status`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `blogPost_renderedWith_idx` ON `blogPost` (`renderedWith`);