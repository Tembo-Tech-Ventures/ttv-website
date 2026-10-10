ALTER TABLE `studentProfile` ADD `publicName` text;--> statement-breakpoint
ALTER TABLE `studentProfile` ADD `publicAvatarUrl` text;--> statement-breakpoint
UPDATE `studentProfile`
SET
  `publicName` = (
    SELECT `name`
    FROM `user`
    WHERE `user`.`id` = `studentProfile`.`userId`
  ),
  `publicAvatarUrl` = (
    SELECT CASE
      WHEN `image` LIKE '/api/avatar/%' THEN `image`
      ELSE NULL
    END
    FROM `user`
    WHERE `user`.`id` = `studentProfile`.`userId`
  )
WHERE `status` IN ('PUBLISHED', 'SUSPENDED');
