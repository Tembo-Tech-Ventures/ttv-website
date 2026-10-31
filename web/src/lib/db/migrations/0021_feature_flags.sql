CREATE TABLE IF NOT EXISTS `feature_flag` (
	`key` text PRIMARY KEY NOT NULL,
	`audience` text DEFAULT 'OFF' NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedBy` text,
	FOREIGN KEY (`updatedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feature_flag_audience_check" CHECK("feature_flag"."audience" IN ('OFF', 'STAFF', 'ALL'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `feature_flag` (`key`, `audience`) VALUES
  ('spaces', 'OFF'),
  ('channels', 'OFF'),
  ('tembo_channels', 'OFF'),
  ('mentor_requests', 'OFF');
