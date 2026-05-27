CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recording` (
	`id` text PRIMARY KEY NOT NULL,
	`programId` text,
	`title` text NOT NULL,
	`description` text,
	`driveFileId` text,
	`r2VideoKey` text,
	`r2AudioKey` text,
	`durationSeconds` integer,
	`fileSizeBytes` integer,
	`recordedAt` integer,
	`processingStatus` text DEFAULT 'pending' NOT NULL,
	`processingError` text,
	`transcriptText` text,
	`transcriptVtt` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transcript_segment` (
	`id` text PRIMARY KEY NOT NULL,
	`recordingId` text NOT NULL,
	`startTime` real NOT NULL,
	`endTime` real NOT NULL,
	`speaker` text,
	`text` text NOT NULL,
	`chunkIndex` integer,
	`vectorId` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recordingId`) REFERENCES `recording`(`id`) ON UPDATE no action ON DELETE cascade
);
