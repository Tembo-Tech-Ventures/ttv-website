CREATE TABLE `credentialAuditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text,
	`actorUserId` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `integrationCredential` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`displayMetadata` text,
	`config` text,
	`updatedByUserId` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`updatedByUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrationCredential_provider_unique` ON `integrationCredential` (`provider`);