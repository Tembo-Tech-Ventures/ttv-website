CREATE TABLE `stagingFixtureIdentity` (
	`userId` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`runId` text NOT NULL,
	`persona` text NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stagingFixtureIdentity_sessionId_unique` ON `stagingFixtureIdentity` (`sessionId`);--> statement-breakpoint
CREATE INDEX `stagingFixtureIdentity_runId_idx` ON `stagingFixtureIdentity` (`runId`);