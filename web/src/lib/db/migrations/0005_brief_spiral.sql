ALTER TABLE `program` ADD `applicationsOpen` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `programApplication_programId_userId_unique` ON `programApplication` (`programId`,`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `programRole_programId_userId_name_unique` ON `programRole` (`programId`,`userId`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `UserRoles_userId_roleId_unique` ON `UserRoles` (`userId`,`roleId`);