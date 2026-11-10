-- The status an admin's pause interrupted, so restoring it never lists someone who took themselves off.
ALTER TABLE `studentProfile` ADD `suspendedFrom` text;
--> statement-breakpoint
-- Profiles already paused: before people could take themselves off, a pause only ever followed a
-- listing (publishedAt set) or a draft that had never been listed.
UPDATE `studentProfile` SET `suspendedFrom` = CASE WHEN `publishedAt` IS NOT NULL THEN 'PUBLISHED' ELSE 'DRAFT' END WHERE `status` = 'SUSPENDED';
