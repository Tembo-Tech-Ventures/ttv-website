-- Reopened moderation cases (B-2.7; src/lib/channels/README.md, "Moderation"). A signal after an
-- admin's decision reopens the case. It used to move openedAt, the queue's order, to that signal, so a
-- case reopened while an admin paged the queue jumped back to page 1 and could be missed. A case now
-- keeps the time it first opened, and reopenedAt records its latest reopening. Additive: one nullable
-- column and the signal trigger, replaced with this one change. No existing row is rewritten.
ALTER TABLE `moderation_case` ADD `reopenedAt` integer;--> statement-breakpoint
DROP TRIGGER IF EXISTS `moderation_event_case_signal`;--> statement-breakpoint
-- As in 0032, except that reopening sets reopenedAt and leaves openedAt.
CREATE TRIGGER `moderation_event_case_signal`
AFTER INSERT ON `moderation_event` WHEN NEW.`source` <> 'ADMIN' AND NEW.`action` IN ('FLAG','HIDE')
BEGIN
	INSERT INTO `moderation_case` (`messageId`, `state`, `source`, `reasons`, `reportCount`, `actorId`, `openedAt`, `updatedAt`)
	VALUES (NEW.`messageId`, 'PENDING',
		CASE NEW.`source` WHEN 'REPORT' THEN 'REPORT' WHEN 'MENTOR' THEN 'MENTOR_HIDE' ELSE 'AI_FLAG' END,
		NEW.`reasons`, NEW.`source` = 'REPORT', CASE WHEN NEW.`source` = 'MENTOR' THEN NEW.`actorId` END,
		NEW.`createdAt`, NEW.`createdAt`)
	ON CONFLICT (`messageId`) DO UPDATE SET
		`source` = CASE WHEN `state` = 'DECIDED'
			OR (CASE excluded.`source` WHEN 'MENTOR_HIDE' THEN 3 WHEN 'REPORT' THEN 2 ELSE 1 END)
				>= (CASE `source` WHEN 'MENTOR_HIDE' THEN 3 WHEN 'REPORT' THEN 2 ELSE 1 END)
			THEN excluded.`source` ELSE `source` END,
		`reasons` = CASE WHEN `state` = 'DECIDED' THEN excluded.`reasons` ELSE (SELECT json_group_array(value)
			FROM (SELECT value FROM json_each(`reasons`) UNION SELECT value FROM json_each(excluded.`reasons`))) END,
		`reportCount` = CASE WHEN `state` = 'DECIDED' THEN 0 ELSE `reportCount` END + excluded.`reportCount`,
		`actorId` = CASE WHEN excluded.`source` = 'MENTOR_HIDE' THEN excluded.`actorId`
			WHEN `state` = 'DECIDED' THEN NULL ELSE `actorId` END,
		`reopenedAt` = CASE WHEN `state` = 'DECIDED' THEN excluded.`openedAt` ELSE `reopenedAt` END,
		`updatedAt` = max(`updatedAt`, excluded.`updatedAt`),
		`reviewRequestedAt` = CASE WHEN `state` = 'DECIDED' THEN NULL ELSE `reviewRequestedAt` END,
		`reviewNote` = CASE WHEN `state` = 'DECIDED' THEN NULL ELSE `reviewNote` END,
		`state` = 'PENDING', `decision` = NULL, `decisionReason` = NULL, `decidedBy` = NULL, `decidedAt` = NULL;
END;
