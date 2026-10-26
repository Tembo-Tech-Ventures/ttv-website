CREATE TABLE `stagingQaResource` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`kind` text NOT NULL,
	`userId` text NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `stagingQaRun`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stagingQaResource_run_idx` ON `stagingQaResource` (`runId`);--> statement-breakpoint
CREATE TABLE `stagingQaRun` (
	`id` text PRIMARY KEY NOT NULL,
	`issuedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer,
	`version` text NOT NULL,
	`keyFingerprint` text NOT NULL,
	`seedDigest` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stagingQaSession` (
	`tokenHash` text NOT NULL,
	`sessionId` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`userId` text NOT NULL,
	`persona` text NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `stagingQaRun`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stagingQaSession_tokenHash_unique` ON `stagingQaSession` (`tokenHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `stagingQaSession_run_user_idx` ON `stagingQaSession` (`runId`,`userId`);