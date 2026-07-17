CREATE TABLE `chat_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_conversation_user_updated_idx` ON `chat_conversation` (`userId`,`updatedAt`);--> statement-breakpoint
INSERT INTO `chat_conversation` (`id`, `userId`, `title`, `createdAt`, `updatedAt`)
SELECT 'legacy-' || `userId`, `userId`, 'Previous conversation', MIN(`createdAt`), MAX(`createdAt`)
FROM `chat_message`
GROUP BY `userId`;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `conversationId` text REFERENCES chat_conversation(id);--> statement-breakpoint
UPDATE `chat_message`
SET `conversationId` = 'legacy-' || `userId`
WHERE `conversationId` IS NULL;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `model` text;--> statement-breakpoint
CREATE INDEX `chat_message_conversation_created_idx` ON `chat_message` (`conversationId`,`createdAt`);
