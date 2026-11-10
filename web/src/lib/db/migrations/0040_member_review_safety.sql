-- Additive follow-up: 0039 already ran in persistent PR previews.
ALTER TABLE studentProfile ADD COLUMN rotationSeed integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderatorHidden integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE communityJourney SET moderationReviewRequired=1 WHERE kind='contribution' AND state='POSTED' AND moderationCheckedAt IS NULL AND moderationOutcome IS NULL;
--> statement-breakpoint
-- TODO: remove these compatibility triggers only after every Worker predating 0039
-- is retired, including rollback versions. D1 migrations precede Worker deployment.
CREATE TRIGGER IF NOT EXISTS communityJourney_legacy_private_insert AFTER INSERT ON communityJourney
WHEN NEW.visibility='private' BEGIN
 UPDATE communityJourney SET state='DRAFT',visibility='institution' WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS communityJourney_legacy_private_update AFTER UPDATE OF visibility ON communityJourney
WHEN NEW.visibility='private' BEGIN
 UPDATE communityJourney SET state='DRAFT',visibility='institution' WHERE id=NEW.id;
END;
--> statement-breakpoint
WITH RECURSIVE hashes(id,pos,h) AS (
 SELECT id,0,5381 FROM studentProfile UNION ALL
 SELECT id,pos+1,(h*33+unicode(substr(id,pos+1,1))) & 4294967295 FROM hashes WHERE pos<length(id)
) UPDATE studentProfile SET rotationSeed=(SELECT h FROM hashes WHERE hashes.id=studentProfile.id AND pos=length(id));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS studentProfile_rotation_seed AFTER INSERT ON studentProfile BEGIN
 UPDATE studentProfile SET rotationSeed=(WITH RECURSIVE hash(pos,h) AS (
  SELECT 0,5381 UNION ALL SELECT pos+1,(h*33+unicode(substr(NEW.id,pos+1,1))) & 4294967295 FROM hash WHERE pos<length(NEW.id)
 ) SELECT h FROM hash WHERE pos=length(NEW.id)) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS communityJourney_review_idx ON communityJourney(moderationOutcome,updatedAt,id) WHERE moderationReviewRequired=1 AND state='POSTED' AND moderatorHidden=0;
--> statement-breakpoint
DROP INDEX IF EXISTS communityJourney_userId_visibility_idx;

--> statement-breakpoint
-- Older Workers omit moderation columns when posting. Queue these writes too.
CREATE TRIGGER IF NOT EXISTS communityJourney_unchecked_post_insert AFTER INSERT ON communityJourney
WHEN NEW.state='POSTED' AND NEW.visibility<>'private' AND NEW.moderationCheckedAt IS NULL AND NEW.moderationOutcome IS NULL BEGIN
 UPDATE communityJourney SET moderationReviewRequired=1 WHERE id=NEW.id;
END;
