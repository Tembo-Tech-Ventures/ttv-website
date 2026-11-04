CREATE TABLE `staging_sam_login` (
	`id` text PRIMARY KEY NOT NULL,
	`jti` text NOT NULL,
	`samProjectId` text NOT NULL,
	`samUserId` text NOT NULL,
	`samSubject` text NOT NULL,
	`samTaskId` text,
	`samWorkspaceId` text,
	`samAgentSessionId` text,
	`persona` text NOT NULL,
	`userId` text NOT NULL,
	`sessionId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer,
	CONSTRAINT "staging_sam_login_time_check" CHECK("staging_sam_login"."expiresAt" > "staging_sam_login"."createdAt")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staging_sam_login_jti_unique` ON `staging_sam_login` (`jti`);--> statement-breakpoint
CREATE UNIQUE INDEX `staging_sam_login_sessionId_unique` ON `staging_sam_login` (`sessionId`);--> statement-breakpoint
CREATE INDEX `staging_sam_login_sam_user_idx` ON `staging_sam_login` (`samUserId`,`createdAt`);