CREATE TABLE `recording_import_source` (
	`id` text PRIMARY KEY NOT NULL,
	`programId` text NOT NULL,
	`name` text NOT NULL,
	`driveFolderId` text NOT NULL,
	`filenameContains` text,
	`enabled` integer DEFAULT true NOT NULL,
	`lastSyncedAt` integer,
	`lastError` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_driveFileId_unique` ON `recording` (`driveFileId`);