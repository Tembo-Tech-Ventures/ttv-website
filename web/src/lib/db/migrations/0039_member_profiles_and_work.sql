-- D1 keeps foreign keys enabled. NEVER rebuild either referenced table here.
-- D1 atomically applies this once and records its filename in d1_migrations.
-- ADD COLUMN has no IF NOT EXISTS in SQLite; replay through the migration ledger.
-- All existing ids and dependent rows survive. visibility is retired: new writes
-- use the legacy NOT NULL constant 'institution'; authorization reads state.
ALTER TABLE studentProfile ADD COLUMN opportunityGoals text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN state text NOT NULL DEFAULT 'POSTED';
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN kind text NOT NULL DEFAULT 'contribution';
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN profileId text REFERENCES studentProfile(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN repoFullName text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN repoUrl text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN repoDescription text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN language text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN topics text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN stars integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN pushedAt integer;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN blurb text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN sortOrder integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN snapshotAt integer;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderationOutcome text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderationFlags text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderationScores text;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderationCheckedAt integer;
--> statement-breakpoint
ALTER TABLE communityJourney ADD COLUMN moderationReviewRequired integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE communityJourney SET state='DRAFT' WHERE visibility='private';
--> statement-breakpoint
UPDATE communityJourney SET visibility='institution';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS communityJourney_userId_repoFullName_unique ON communityJourney(userId,repoFullName);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS communityJourney_userId_state_idx ON communityJourney(userId,state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studentProfile_directory_idx ON studentProfile(status,handle,userId);
--> statement-breakpoint
-- Existing cohort values win ties. Reconcile each overlapping field separately;
-- opportunityGoals has no cohort equivalent and is always copied.
UPDATE studentProfile SET
 headline=CASE WHEN c.updatedAt>studentProfile.updatedAt THEN c.headline ELSE studentProfile.headline END,
 bio=CASE WHEN c.updatedAt>studentProfile.updatedAt THEN c.bio ELSE studentProfile.bio END,
 skills=CASE WHEN c.updatedAt>studentProfile.updatedAt THEN c.skills ELSE studentProfile.skills END,
 opportunityGoals=c.opportunityGoals,
 contentVersion=max(studentProfile.contentVersion,c.version),
 updatedAt=max(studentProfile.updatedAt,c.updatedAt)
FROM communityProfile c WHERE c.userId=studentProfile.userId;
--> statement-breakpoint
-- Numbered fallback handles are allocated beyond every occupied member-N handle.
-- This handles duplicate names, reserved words, and existing generated handles.
WITH numbered AS (
 SELECT c.*, row_number() OVER (ORDER BY c.userId) + coalesce((
 SELECT max(CAST(substr(handle,8) AS INTEGER)) FROM studentProfile
 WHERE handle GLOB 'member-[0-9]*'),0) AS handleNumber
 FROM communityProfile c WHERE NOT EXISTS (SELECT 1 FROM studentProfile p WHERE p.userId=c.userId)
)
INSERT INTO studentProfile(id,userId,handle,headline,bio,skills,opportunityGoals,contentVersion,publicName,createdAt,updatedAt)
SELECT 'member-profile-'||c.userId,c.userId,'member-'||c.handleNumber,c.headline,c.bio,c.skills,c.opportunityGoals,c.version,u.name,c.createdAt,c.updatedAt
FROM numbered c JOIN user u ON u.id=c.userId WHERE true
ON CONFLICT(userId) DO NOTHING;
--> statement-breakpoint
INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility,state,kind,profileId,
 repoFullName,repoUrl,repoDescription,language,topics,stars,pushedAt,blurb,sortOrder,snapshotAt,createdAt,updatedAt)
SELECT 'repo-'||h.id,p.userId,h.repoFullName,coalesce(h.blurb,h.description,''),h.repoUrl,
 strftime('%Y-%m-%d',coalesce(h.pushedAt,h.createdAt),'unixepoch'),'institution','POSTED','repo',p.id,
 h.repoFullName,h.repoUrl,h.description,h.language,h.topics,h.stars,h.pushedAt,h.blurb,h.sortOrder,h.snapshotAt,h.createdAt,h.updatedAt
FROM profileHighlight h JOIN studentProfile p ON p.id=h.profileId WHERE true
ON CONFLICT(userId,repoFullName) DO NOTHING;
--> statement-breakpoint
DROP TABLE IF EXISTS profileHighlight;
--> statement-breakpoint
DROP TABLE IF EXISTS communityProfile;
