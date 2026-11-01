-- Channel code of conduct (src/lib/channels/README.md): one row per person, holding the latest
-- version of "How we talk to each other" they agreed to. Additive and safe to reapply: one new
-- table, no writes to existing data. Rows follow the person out (ON DELETE cascade).
CREATE TABLE IF NOT EXISTS `channel_conduct` (
	`userId` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`acknowledgedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_conduct_version_check" CHECK("channel_conduct"."version" >= 1),
	CONSTRAINT "channel_conduct_time_check" CHECK("channel_conduct"."acknowledgedAt" >= 0)
);
