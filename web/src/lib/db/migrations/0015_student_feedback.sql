CREATE TABLE IF NOT EXISTS `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`pageUrl` text NOT NULL,
	`pageTitle` text,
	`context` text DEFAULT '{}' NOT NULL,
	`appVersion` text,
	`status` text DEFAULT 'NEW' NOT NULL,
	`response` text,
	`adminNote` text,
	`resolutionUrl` text,
	`handledById` text,
	`resolvedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`handledById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feedback_kind_check" CHECK("feedback"."kind" in ('BUG', 'CONFUSING', 'IDEA', 'PRAISE', 'OTHER')),
	CONSTRAINT "feedback_status_check" CHECK("feedback"."status" in ('NEW', 'IN_PROGRESS', 'RESOLVED', 'DECLINED')),
	CONSTRAINT "feedback_message_length_check" CHECK(length("feedback"."message") <= 5000),
	CONSTRAINT "feedback_pageUrl_length_check" CHECK(length("feedback"."pageUrl") <= 2000),
	CONSTRAINT "feedback_context_length_check" CHECK(length("feedback"."context") <= 20000),
	CONSTRAINT "feedback_response_length_check" CHECK("feedback"."response" is null or length("feedback"."response") <= 2000),
	CONSTRAINT "feedback_adminNote_length_check" CHECK("feedback"."adminNote" is null or length("feedback"."adminNote") <= 5000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_status_createdAt_idx` ON `feedback` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_userId_createdAt_idx` ON `feedback` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `feedback_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`objectKey` text NOT NULL,
	`contentType` text NOT NULL,
	`size` integer NOT NULL,
	`source` text NOT NULL,
	`position` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedback_attachment_contentType_check" CHECK("feedback_attachment"."contentType" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "feedback_attachment_source_check" CHECK("feedback_attachment"."source" in ('CAPTURE', 'UPLOAD')),
	CONSTRAINT "feedback_attachment_size_check" CHECK("feedback_attachment"."size" > 0),
	CONSTRAINT "feedback_attachment_position_check" CHECK("feedback_attachment"."position" between 0 and 9)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `feedback_attachment_objectKey_unique` ON `feedback_attachment` (`objectKey`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_attachment_feedbackId_idx` ON `feedback_attachment` (`feedbackId`);