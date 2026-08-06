INSERT INTO `Roles` (`id`, `name`)
SELECT lower(hex(randomblob(16))), 'ADMIN'
WHERE NOT EXISTS (
	SELECT 1 FROM `Roles` WHERE `name` = 'ADMIN'
);
