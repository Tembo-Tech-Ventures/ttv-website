CREATE TABLE IF NOT EXISTS `errorEvent` (
	`id` text PRIMARY KEY NOT NULL,
	`signature` text NOT NULL,
	`source` text NOT NULL,
	`route` text NOT NULL,
	`message` text NOT NULL,
	`level` text DEFAULT 'error' NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`firstSeenAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastSeenAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastVersion` text NOT NULL,
	`lastNotifiedAt` integer,
	`notifiedCount` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "errorEvent_source_check" CHECK("errorEvent"."source" in ('request', 'queue', 'cron', 'import', 'pipeline')),
	CONSTRAINT "errorEvent_level_check" CHECK("errorEvent"."level" in ('error', 'warning')),
	CONSTRAINT "errorEvent_message_length_check" CHECK(length("errorEvent"."message") <= 500),
	CONSTRAINT "errorEvent_count_check" CHECK("errorEvent"."count" >= 1),
	CONSTRAINT "errorEvent_notifiedCount_check" CHECK("errorEvent"."notifiedCount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `errorEvent_signature_unique` ON `errorEvent` (`signature`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `errorEvent_lastSeenAt_idx` ON `errorEvent` (`lastSeenAt`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `platformAlert` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sentAt` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "platformAlert_kind_check" CHECK("platformAlert"."kind" in ('error.new', 'error.spike', 'recording.failed', 'import.error', 'health.degraded')),
	CONSTRAINT "platformAlert_status_check" CHECK("platformAlert"."status" in ('pending', 'sent')),
	CONSTRAINT "platformAlert_attempts_check" CHECK("platformAlert"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `platformAlert_idempotencyKey_unique` ON `platformAlert` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `platformAlert_status_attempts_idx` ON `platformAlert` (`status`,`attempts`);
