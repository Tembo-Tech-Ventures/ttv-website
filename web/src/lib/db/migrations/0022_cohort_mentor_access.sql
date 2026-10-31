-- D1 applies each migration atomically. Keep foreign keys enabled throughout.
-- No table references programRole; both outbound NO ACTION foreign keys survive.
-- Reapplication rebuilds the same rows (including MENTOR) without resetting ids
-- or timestamps. Unexpected legacy names abort the copy rather than losing data.
CREATE INDEX IF NOT EXISTS `programApplication_userId_programId_status_idx` ON `programApplication` (`userId`,`programId`,`status`);--> statement-breakpoint
CREATE TABLE `__new_programRole` (
	`id` text PRIMARY KEY NOT NULL,
	`programId` text NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`programId`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "programRole_name_check" CHECK("__new_programRole"."name" IN ('INSTRUCTOR', 'TA', 'MENTOR'))
);
--> statement-breakpoint
INSERT INTO `__new_programRole`("id", "programId", "userId", "name", "createdAt", "updatedAt") SELECT "id", "programId", "userId", "name", "createdAt", "updatedAt" FROM `programRole`;--> statement-breakpoint
DROP TABLE `programRole`;--> statement-breakpoint
ALTER TABLE `__new_programRole` RENAME TO `programRole`;--> statement-breakpoint
CREATE UNIQUE INDEX `programRole_programId_userId_name_unique` ON `programRole` (`programId`,`userId`,`name`);--> statement-breakpoint
CREATE INDEX `programRole_userId_programId_name_idx` ON `programRole` (`userId`,`programId`,`name`);