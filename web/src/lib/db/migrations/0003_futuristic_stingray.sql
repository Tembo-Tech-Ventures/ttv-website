CREATE TABLE `project_board` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ownerId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_board_owner_idx` ON `project_board` (`ownerId`);--> statement-breakpoint
CREATE TABLE `project_board_member` (
	`id` text PRIMARY KEY NOT NULL,
	`boardId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`boardId`) REFERENCES `project_board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_board_member_board_user_unique` ON `project_board_member` (`boardId`,`userId`);--> statement-breakpoint
CREATE INDEX `project_board_member_user_idx` ON `project_board_member` (`userId`);--> statement-breakpoint
CREATE TABLE `project_board_task` (
	`id` text PRIMARY KEY NOT NULL,
	`boardId` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'TODO' NOT NULL,
	`assigneeId` text,
	`dueDate` integer,
	`createdById` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`boardId`) REFERENCES `project_board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigneeId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_board_task_board_status_idx` ON `project_board_task` (`boardId`,`status`);--> statement-breakpoint
CREATE INDEX `project_board_task_assignee_idx` ON `project_board_task` (`assigneeId`);