CREATE TABLE `chat_session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_session_userId_updatedAt_idx` ON `chat_session` (`userId`,`updatedAt`);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `sessionId` text REFERENCES chat_session(id);