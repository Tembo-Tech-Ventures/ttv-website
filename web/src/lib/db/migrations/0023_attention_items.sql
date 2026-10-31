-- Additive and safe to reapply; existing attention and domain rows are preserved.
CREATE TABLE IF NOT EXISTS `attention_item` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`eventKey` text NOT NULL,
	`kind` text NOT NULL,
	`space` text NOT NULL,
	`category` text NOT NULL,
	`subjectKind` text NOT NULL,
	`subjectId` text NOT NULL,
	`subjectHref` text NOT NULL,
	`subjectLabel` text NOT NULL,
	`actorId` text,
	`summary` text NOT NULL,
	`createdAt` integer NOT NULL,
	`readAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attention_item_space_check" CHECK("attention_item"."space" IN ('cohort','community','mentoring','discover','admin','profile')),
	CONSTRAINT "attention_item_category_check" CHECK("attention_item"."category" IN ('mentions','requests','updates')),
	CONSTRAINT "attention_item_time_check" CHECK("attention_item"."createdAt" >= 0 AND ("attention_item"."readAt" IS NULL OR "attention_item"."readAt" >= "attention_item"."createdAt"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `attention_item_user_event_idx` ON `attention_item` (`userId`,`eventKey`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `attention_item_unread_idx` ON `attention_item` (`userId`,`readAt`,`space`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `attention_item_page_idx` ON `attention_item` (`userId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `attention_item_filter_page_idx` ON `attention_item` (`userId`,`category`,`createdAt`,`id`);