CREATE TABLE `personal_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`label` text NOT NULL,
	`scopes` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`lastUsedAt` integer,
	`revokedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_access_token_tokenHash_unique` ON `personal_access_token` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `personal_access_token_userId_idx` ON `personal_access_token` (`userId`);--> statement-breakpoint
CREATE INDEX `personal_access_token_expiresAt_idx` ON `personal_access_token` (`expiresAt`);