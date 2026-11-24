-- One recording access policy (lib/recordings/access.ts). `recording` is referenced by other tables
-- and foreign keys are on, so it is never rebuilt: only ADD COLUMN, UPDATE and triggers here. A
-- missing scope can only mean "admins only".
ALTER TABLE `recording` ADD `accessScope` text DEFAULT 'ADMIN_ONLY' NOT NULL;--> statement-breakpoint
ALTER TABLE `recording` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `recording` ADD `hiddenAt` integer;--> statement-breakpoint
-- Every recording with a cohort is that cohort's, as it was before the policy.
UPDATE `recording` SET `accessScope` = 'COHORT' WHERE `programId` IS NOT NULL AND `accessScope` = 'ADMIN_ONLY';
--> statement-breakpoint
-- The allowed values, here rather than in a table check(), which drizzle-kit would apply by rebuilding the table.
CREATE TRIGGER IF NOT EXISTS recording_access_scope_insert BEFORE INSERT ON `recording`
WHEN NEW.accessScope NOT IN ('COHORT', 'DIRECT', 'COMMUNITY', 'ADMIN_ONLY') BEGIN
 SELECT RAISE(ABORT, 'recording.accessScope must be COHORT, DIRECT, COMMUNITY or ADMIN_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recording_access_scope_update BEFORE UPDATE OF accessScope ON `recording`
WHEN NEW.accessScope NOT IN ('COHORT', 'DIRECT', 'COMMUNITY', 'ADMIN_ONLY') BEGIN
 SELECT RAISE(ABORT, 'recording.accessScope must be COHORT, DIRECT, COMMUNITY or ADMIN_ONLY');
END;
--> statement-breakpoint
-- A Drive import or an upload names no scope: with a cohort it is the cohort's. Migrations run before
-- the new Worker is live, and the old one keeps importing meanwhile (and again after a rollback).
CREATE TRIGGER IF NOT EXISTS recording_cohort_scope_insert AFTER INSERT ON `recording`
WHEN NEW.programId IS NOT NULL AND NEW.accessScope = 'ADMIN_ONLY' BEGIN
 UPDATE `recording` SET accessScope = 'COHORT' WHERE id = NEW.id;
END;
--> statement-breakpoint
-- An admin moving a cohort or admins-only recording to another cohort, or to none, moves its audience
-- with it. A direct conversation's or the community's recording keeps its scope.
CREATE TRIGGER IF NOT EXISTS recording_cohort_scope_update AFTER UPDATE OF programId ON `recording`
WHEN NEW.programId IS NOT OLD.programId AND NEW.accessScope IN ('COHORT', 'ADMIN_ONLY') BEGIN
 UPDATE `recording` SET accessScope = CASE WHEN NEW.programId IS NULL THEN 'ADMIN_ONLY' ELSE 'COHORT' END WHERE id = NEW.id;
END;
