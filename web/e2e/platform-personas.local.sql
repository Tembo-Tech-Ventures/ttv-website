-- Fictional local personas for e2e/platform-personas.spec.ts. Local D1 only: never apply to a deployed database.
-- npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
INSERT OR REPLACE INTO curriculum (id,title,description) VALUES ('ttv-local-persona-curriculum','Full-stack foundations','Fictional local curriculum');
-- An upsert, not INSERT OR REPLACE: replacing a program deletes it first, and that cascades to its cohort channels and their messages.
INSERT INTO program (id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES
 ('ttv-local-persona-cohort-04','Cohort 04','Fictional completed cohort','ttv-local-persona-curriculum',1772323200,1780272000,0),
 ('ttv-local-persona-cohort-05','Cohort 05','Fictional current cohort','ttv-local-persona-curriculum',1788220800,1797292800,0),
 ('ttv-local-persona-cohort-06','Cohort 06','Fictional next cohort','ttv-local-persona-curriculum',1799971200,1807833600,1)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, curriculumId=excluded.curriculumId,
 startDate=excluded.startDate, endDate=excluded.endDate, applicationsOpen=excluded.applicationsOpen;
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-student','Wanjiku Mwangi','wanjiku@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-alumna','Achieng Otieno','achieng@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-mentor','David Kamau','david@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-community','Lucy Chebet','lucy@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-institution','Joseph Mutua','joseph@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-staff','Amina Hassan','amina@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-applicant','Njeri Wambui','njeri@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-newcomer','Brian Kiprono','brian@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-reviewee','Mercy Akinyi','mercy@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-student-session',1893456000,'ttv-local-persona-student-token',NULL,'local','ttv-local-persona-student',1793400000,1793400000),
 ('ttv-local-persona-alumna-session',1893456000,'ttv-local-persona-alumna-token',NULL,'local','ttv-local-persona-alumna',1793400000,1793400000),
 ('ttv-local-persona-mentor-session',1893456000,'ttv-local-persona-mentor-token',NULL,'local','ttv-local-persona-mentor',1793400000,1793400000),
 ('ttv-local-persona-community-session',1893456000,'ttv-local-persona-community-token',NULL,'local','ttv-local-persona-community',1793400000,1793400000),
 ('ttv-local-persona-institution-session',1893456000,'ttv-local-persona-institution-token',NULL,'local','ttv-local-persona-institution',1793400000,1793400000),
 ('ttv-local-persona-staff-session',1893456000,'ttv-local-persona-staff-token',NULL,'local','ttv-local-persona-staff',1793400000,1793400000),
 ('ttv-local-persona-applicant-session',1893456000,'ttv-local-persona-applicant-token',NULL,'local','ttv-local-persona-applicant',1793400000,1793400000),
 ('ttv-local-persona-newcomer-session',1893456000,'ttv-local-persona-newcomer-token',NULL,'local','ttv-local-persona-newcomer',1793400000,1793400000),
 ('ttv-local-persona-reviewee-session',1893456000,'ttv-local-persona-reviewee-token',NULL,'local','ttv-local-persona-reviewee',1793400000,1793400000);
INSERT OR REPLACE INTO UserRoles (id,userId,roleId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-role-david','ttv-local-persona-mentor',(SELECT id FROM Roles WHERE name='MENTOR'),1793400000,1793400000),
 ('ttv-local-persona-role-joseph','ttv-local-persona-institution',(SELECT id FROM Roles WHERE name='INSTITUTION'),1793400000,1793400000),
 ('ttv-local-persona-role-amina','ttv-local-persona-staff',(SELECT id FROM Roles WHERE name='ADMIN'),1793400000,1793400000);
INSERT OR REPLACE INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-app-student','ttv-local-persona-cohort-05','ttv-local-persona-student','APPROVED','{}',NULL,1785000000,1786000000),
 ('ttv-local-persona-app-alumna','ttv-local-persona-cohort-04','ttv-local-persona-alumna','COMPLETED','{}',1780272000,1770000000,1780272000),
 -- e2e/platform-application.spec.ts: a pending application imported from the old stack, which carries its own questions.
 ('ttv-local-persona-app-applicant','ttv-local-persona-cohort-06','ttv-local-persona-applicant','PENDING','{"version":"1","name":"Njeri Wambui","partnerId":"","submission":[{"type":"string","name":"name","label":"Name","value":"Njeri Wambui"},{"type":"requiredBoolean","name":"htmlCssDone","label":"Did you complete the free portion of the [HTML/CSS course](https://www.codecademy.com/learn/learn-html)?","value":true},{"type":"requiredBoolean","name":"gitDone","label":"Did you complete the free portion of the [Git course](https://www.codecademy.com/learn/learn-git-introduction)?","value":false},{"type":"textarea","name":"previousProjects","label":"What projects have you built in the past? (either tech or non-tech)","value":"A savings tracker for my chama, kept in a shared spreadsheet."},{"type":"textarea","name":"project","label":"Propose an idea for a project you would like to build.","value":"An SMS reminder for chama contributions."}]}',NULL,1793300000,1793300000);
-- e2e/platform-application.spec.ts approves this one as staff while Mercy edits it; re-seeding makes it pending again.
INSERT OR REPLACE INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-app-reviewee','ttv-local-persona-cohort-06','ttv-local-persona-reviewee','PENDING','{"version":"1","submission":[{"type":"requiredBoolean","name":"gitDone","label":"Did you complete the free portion of the [Git course](https://www.codecademy.com/learn/learn-git-introduction)?","value":true},{"type":"textarea","name":"project","label":"Propose an idea for a project you would like to build.","value":"A shared calendar for a youth football league."}]}',NULL,1793300000,1793300000);
-- The newcomer applies during e2e/platform-application.spec.ts; re-seeding starts them over with no application.
DELETE FROM programApplication WHERE userId = 'ttv-local-persona-newcomer';
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,headline,bio,location,country,skills,publishedAt) VALUES
 ('ttv-local-persona-profile-alumna','ttv-local-persona-alumna','achieng-otieno','PUBLISHED','Backend builder','I build payment and ledger tools for small groups.','Kisumu','KE','["TypeScript","SQL"]',1781000000);
-- One processed cohort-05 session with a short transcript and no media (the player cannot load it locally).
INSERT OR REPLACE INTO recording (id,programId,title,durationSeconds,recordedAt,processingStatus) VALUES
 ('ttv-local-persona-recording-05','ttv-local-persona-cohort-05','Week 4: SQL joins and indexes',90,1791800000,'complete');
INSERT OR REPLACE INTO transcript_segment (id,recordingId,startTime,endTime,speaker,text) VALUES
 ('ttv-local-persona-segment-1','ttv-local-persona-recording-05',0,4,'Mentor','Welcome back, everyone.'),
 ('ttv-local-persona-segment-2','ttv-local-persona-recording-05',4,75,NULL,'Today is about joins, and when an index helps.'),
 ('ttv-local-persona-segment-3','ttv-local-persona-recording-05',75,90,NULL,'Questions before we start?');
-- Institutional discovery lists only saved community profiles: Achieng has saved
-- one, so Joseph can discover her. Wanjiku and Lucy have not, so he cannot.
INSERT OR REPLACE INTO communityProfile (userId,headline,bio,skills,opportunityGoals,version,createdAt,updatedAt) VALUES
 ('ttv-local-persona-alumna','Backend builder','Fictional local profile. I build payment and ledger tools for small groups.','["TypeScript","SQL"]','A backend developer role',1,1793400000,1793400000);
-- e2e/platform-access-requests.spec.ts: people asking for mentor or organisation access (onboarding SPEC S6).
-- Re-seeding starts them over: requests, roles, intents and decision items are cleared, then the queue is rebuilt.
-- Otieno asks to mentor and is approved; Njambi asks for organisation access and Peter asks again after a
-- decline, and both stay pending for the screenshots; Wairimu asks during the run, and is declined.
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-mentor-request','Otieno Ouma','otieno@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-org-request','Njambi Karanja','njambi@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-declined-request','Peter Njoroge','peter@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-note-request','Wairimu Kamau','wairimu@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-mentor-request-session',1893456000,'ttv-local-persona-mentor-request-token',NULL,'local','ttv-local-persona-mentor-request',1793400000,1793400000),
 ('ttv-local-persona-org-request-session',1893456000,'ttv-local-persona-org-request-token',NULL,'local','ttv-local-persona-org-request',1793400000,1793400000),
 ('ttv-local-persona-declined-request-session',1893456000,'ttv-local-persona-declined-request-token',NULL,'local','ttv-local-persona-declined-request',1793400000,1793400000),
 ('ttv-local-persona-note-request-session',1893456000,'ttv-local-persona-note-request-token',NULL,'local','ttv-local-persona-note-request',1793400000,1793400000);
DELETE FROM access_request WHERE userId IN ('ttv-local-persona-mentor-request','ttv-local-persona-org-request','ttv-local-persona-declined-request','ttv-local-persona-note-request');
DELETE FROM member_intent WHERE userId IN ('ttv-local-persona-mentor-request','ttv-local-persona-org-request','ttv-local-persona-declined-request','ttv-local-persona-note-request');
DELETE FROM attention_item WHERE kind IN ('access_request','access_decided') AND (userId LIKE 'ttv-local-persona-%' OR subjectId LIKE 'ttv-local-access-%');
DELETE FROM UserRoles WHERE userId IN ('ttv-local-persona-mentor-request','ttv-local-persona-org-request','ttv-local-persona-declined-request','ttv-local-persona-note-request');
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,githubLogin) VALUES
 ('ttv-local-persona-profile-mentor-request','ttv-local-persona-mentor-request','otieno-ouma','DRAFT','otieno-ouma'),
 ('ttv-local-persona-profile-declined-request','ttv-local-persona-declined-request','peter-njoroge','DRAFT','pnjoroge');
INSERT INTO access_request (id,userId,role,status,note,organisation,organisationRole,link,scopeAcknowledgedAt,decisionId,decisionMessage,decidedAt,createdAt,updatedAt) VALUES
 ('ttv-local-access-peter-earlier','ttv-local-persona-declined-request','MENTOR','DECLINED','I can help with SQL questions when I have time.',NULL,NULL,NULL,NULL,'ttv-local-access-peter-earlier-decision','Thanks for offering. Tell us a little more about the work you have reviewed before.',1789207200000,1788256800000,1789207200000),
 ('ttv-local-access-otieno','ttv-local-persona-mentor-request','MENTOR','PENDING','Android and offline-first apps. I lead a mobile team and can review Kotlin and sync code.',NULL,NULL,'https://github.com/otieno-ouma',NULL,NULL,NULL,NULL,1793439000000,1793439000000),
 ('ttv-local-access-njambi','ttv-local-persona-org-request','INSTITUTION','PENDING','Junior engineers who have built mobile or payments features, so we can understand their work before we talk to them.','Mto Labs','Engineering lead',NULL,1793505600000,NULL,NULL,NULL,1793505600000,1793505600000),
 ('ttv-local-access-peter','ttv-local-persona-declined-request','MENTOR','PENDING','Backend and data work: SQL, APIs, testing. I review pull requests at work every week.',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1793509200000,1793509200000);
INSERT INTO member_intent (userId,intent,createdAt) VALUES
 ('ttv-local-persona-mentor-request','MENTOR',1793439000000),
 ('ttv-local-persona-org-request','INSTITUTION',1793505600000),
 ('ttv-local-persona-declined-request','MENTOR',1789207200000);
-- Onboarding (U-O.2, e2e/platform-onboarding-framing.spec.ts): one fictional person per landing in
-- onboarding SPEC §3. Every persona's onboarding starts over on each seed: tests that choose, dismiss
-- or withdraw change these rows. Timestamps here are epoch milliseconds, as the onboarding domain writes.
-- Only the onb- personas below are reset here; e2e/platform-access-requests.spec.ts seeds and resets its own.
DELETE FROM access_request WHERE userId LIKE 'ttv-local-persona-onb-%';
DELETE FROM member_intent WHERE userId LIKE 'ttv-local-persona-onb-%';
DELETE FROM member_onboarding WHERE userId LIKE 'ttv-local-persona-onb-%';
DELETE FROM UserRoles WHERE id IN ('ttv-local-persona-role-kevin','ttv-local-persona-role-wanjiku');
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-onb-otieno','Otieno Barasa','otieno.barasa@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-mercy','Mercy Wambui','mercy.wambui@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-njambi','Njambi Kariuki','njambi.kariuki@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-daniel','Daniel Kiplagat','daniel.kiplagat@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-wairimu','Wairimu Ndungu','wairimu.ndungu@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-kevin','Kevin Omondi','kevin.omondi@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-faith','Faith Chepkoech','faith.chepkoech@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-grace','Grace Wanjiru','grace.wanjiru@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-zawadi','Zawadi Mutiso','zawadi.mutiso@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-amani','Amani Wekesa','amani.wekesa@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-baraka','Baraka Mwangi','baraka.mwangi@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-onb-wanjiku','Wanjiku Kamau','wanjiku.kamau@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-onb-otieno-session',1893456000,'ttv-local-persona-onb-otieno-token',NULL,'local','ttv-local-persona-onb-otieno',1793400000,1793400000),
 ('ttv-local-persona-onb-mercy-session',1893456000,'ttv-local-persona-onb-mercy-token',NULL,'local','ttv-local-persona-onb-mercy',1793400000,1793400000),
 ('ttv-local-persona-onb-njambi-session',1893456000,'ttv-local-persona-onb-njambi-token',NULL,'local','ttv-local-persona-onb-njambi',1793400000,1793400000),
 ('ttv-local-persona-onb-daniel-session',1893456000,'ttv-local-persona-onb-daniel-token',NULL,'local','ttv-local-persona-onb-daniel',1793400000,1793400000),
 ('ttv-local-persona-onb-wairimu-session',1893456000,'ttv-local-persona-onb-wairimu-token',NULL,'local','ttv-local-persona-onb-wairimu',1793400000,1793400000),
 ('ttv-local-persona-onb-kevin-session',1893456000,'ttv-local-persona-onb-kevin-token',NULL,'local','ttv-local-persona-onb-kevin',1793400000,1793400000),
 ('ttv-local-persona-onb-faith-session',1893456000,'ttv-local-persona-onb-faith-token',NULL,'local','ttv-local-persona-onb-faith',1793400000,1793400000),
 ('ttv-local-persona-onb-grace-session',1893456000,'ttv-local-persona-onb-grace-token',NULL,'local','ttv-local-persona-onb-grace',1793400000,1793400000),
 ('ttv-local-persona-onb-zawadi-session',1893456000,'ttv-local-persona-onb-zawadi-token',NULL,'local','ttv-local-persona-onb-zawadi',1793400000,1793400000),
 ('ttv-local-persona-onb-amani-session',1893456000,'ttv-local-persona-onb-amani-token',NULL,'local','ttv-local-persona-onb-amani',1793400000,1793400000),
 ('ttv-local-persona-onb-baraka-session',1893456000,'ttv-local-persona-onb-baraka-token',NULL,'local','ttv-local-persona-onb-baraka',1793400000,1793400000),
 ('ttv-local-persona-onb-wanjiku-session',1893456000,'ttv-local-persona-onb-wanjiku-token',NULL,'local','ttv-local-persona-onb-wanjiku',1793400000,1793400000);
-- Kevin's mentor request was approved and he has not seen it yet; Faith and Grace are alumnae from before onboarding.
-- Wanjiku has mentored since before onboarding (F-6, QAO-10): her one-time card opens with Mentor already Active.
-- Baraka's mentor request was declined; he sends a new one from Account (F-6, QAO-02 to QAO-05).
INSERT OR REPLACE INTO UserRoles (id,userId,roleId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-role-kevin','ttv-local-persona-onb-kevin',(SELECT id FROM Roles WHERE name='MENTOR'),1793400000,1793400000),
 ('ttv-local-persona-role-wanjiku','ttv-local-persona-onb-wanjiku',(SELECT id FROM Roles WHERE name='MENTOR'),1793400000,1793400000);
INSERT OR REPLACE INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-app-faith','ttv-local-persona-cohort-04','ttv-local-persona-onb-faith','COMPLETED','{}',1780272000,1770000000,1780272000),
 ('ttv-local-persona-app-grace','ttv-local-persona-cohort-04','ttv-local-persona-onb-grace','COMPLETED','{}',1780272000,1770000000,1780272000);
INSERT INTO member_onboarding (userId,stage,completedAt,promptDismissedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-onb-otieno','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-mercy','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-njambi','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-daniel','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-wairimu','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-kevin','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-amani','DONE',1793500000000,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-onb-baraka','DONE',1793500000000,NULL,1793500000000,1793500000000);
INSERT INTO member_intent (userId,intent,createdAt) VALUES
 ('ttv-local-persona-onb-otieno','MENTOR',1793500000000),
 ('ttv-local-persona-onb-mercy','MEMBER',1793500000000),
 ('ttv-local-persona-onb-mercy','MENTOR',1793500000000),
 ('ttv-local-persona-onb-njambi','INSTITUTION',1793500000000),
 ('ttv-local-persona-onb-daniel','MENTOR',1793500000000),
 ('ttv-local-persona-onb-wairimu','EXPLORING',1793500000000),
 ('ttv-local-persona-onb-kevin','MENTOR',1793500000000),
 ('ttv-local-persona-onb-amani','MEMBER',1793500000000),
 ('ttv-local-persona-onb-amani','MENTOR',1793500000000),
 ('ttv-local-persona-onb-baraka','MENTOR',1793500000000);
INSERT INTO access_request (id,userId,role,status,note,organisation,organisationRole,link,scopeAcknowledgedAt,decisionId,decisionMessage,decidedAt,requesterSeenAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-request-otieno','ttv-local-persona-onb-otieno','MENTOR','PENDING','Backend reviews: SQL, APIs and tests for small teams.',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-request-mercy','ttv-local-persona-onb-mercy','MENTOR','PENDING','Android and offline-first apps. I can review Kotlin and sync code.',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-request-njambi','ttv-local-persona-onb-njambi','INSTITUTION','PENDING','Junior engineers who have built mobile or payments features.','Mto Labs','Engineering lead',NULL,1793500000000,NULL,NULL,NULL,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-request-daniel','ttv-local-persona-onb-daniel','MENTOR','DECLINED','Backend and data work: SQL, APIs, testing.',NULL,NULL,NULL,NULL,'ttv-local-persona-decision-daniel','Thanks for offering, Daniel. <b>We can’t add this right now.</b>',1793510000000,NULL,1793500000000,1793510000000),
 ('ttv-local-persona-request-kevin','ttv-local-persona-onb-kevin','MENTOR','APPROVED','Mobile reviews: Flutter, offline sync and testing.',NULL,NULL,NULL,NULL,'ttv-local-persona-decision-kevin',NULL,1793510000000,NULL,1793500000000,1793510000000),
 ('ttv-local-persona-request-amani','ttv-local-persona-onb-amani','MENTOR','PENDING','Design reviews: accessibility, layout and plain language.',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1793500000000,1793500000000),
 ('ttv-local-persona-request-baraka','ttv-local-persona-onb-baraka','MENTOR','DECLINED','Data pipelines and SQL reviews for small teams.',NULL,NULL,NULL,NULL,'ttv-local-persona-decision-baraka','Thanks, Baraka. Tell us a little more about the work you could review.',1793510000000,NULL,1793500000000,1793510000000);
-- U-2.3: every persona meets "How we talk to each other" afresh on each seed (e2e/platform-channels.spec.ts agrees as the alumna).
DELETE FROM channel_conduct WHERE userId LIKE 'ttv-local-persona-%';
-- U-2.3: Lucy's session delegated to an agent (userAgent "ttv-agent:…"), so e2e/platform-channels.spec.ts can show
-- that the real channel and conduct pages tell an agent why it cannot agree for her, and refuse its post.
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-community-agent-session',1893456000,'ttv-local-persona-community-agent-token',NULL,'ttv-agent:local e2e','ttv-local-persona-community',1793400000,1793400000);
-- U-2.4: moderation cases in #help for e2e/platform-moderation-queue.spec.ts, one per decision the queue offers.
-- Re-seeding deletes them (their versions, events and cases cascade) and opens them again as waiting cases.
DELETE FROM channel_message WHERE id LIKE 'ttv-local-moderation-%';
WITH help AS (SELECT id FROM channel WHERE seedKey = 'community:help'),
 base AS (SELECT coalesce(max(changeSeq), 0) AS seq FROM channel_message WHERE channelId = (SELECT id FROM help)),
 seed (key, n, authorId, body, state, reasons, hiddenBy, at) AS (VALUES
  ('flagged', 1, 'ttv-local-persona-student', 'Happy to pair on the auth bug. Call me on 0712 345 678 tonight.', 'FLAGGED', '["Contact details"]', NULL, 1793570000000),
  ('reported', 2, 'ttv-local-persona-community', 'Anyone who still uses var should not be writing JavaScript.', 'VISIBLE', '[]', NULL, 1793571000000),
  ('mentor-hidden', 3, 'ttv-local-persona-alumna', 'This is a beginner mistake. Read the docs before asking.', 'HIDDEN', '["Unkind to another member"]', 'ttv-local-persona-mentor', 1793572000000),
  ('tembo-hidden', 4, 'ttv-local-persona-newcomer', 'Cheap followers for your portfolio, message me for a price list.', 'HIDDEN', '["Spam"]', NULL, 1793573000000),
  ('stale', 5, 'ttv-local-persona-student', 'Here is my number for the study group: 0722 000 111.', 'FLAGGED', '["Contact details"]', NULL, 1793574000000))
INSERT INTO channel_message (id, channelId, seq, changeSeq, authorId, body, moderationState, moderationReasons, hiddenBy, hiddenAt, createdAt)
SELECT 'ttv-local-moderation-' || key, (SELECT id FROM help), (SELECT seq FROM base) + n, (SELECT seq FROM base) + n,
 authorId, body, state, reasons, hiddenBy, CASE state WHEN 'HIDDEN' THEN at END, at FROM seed;
-- The signals that open each case (the triggers on moderation_event keep moderation_case).
INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt) VALUES
 ('ttv-local-moderation-flagged-event', 'ttv-local-moderation-flagged', 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', '["Contact details"]', 1793570000000),
 ('ttv-local-moderation-reported-event', 'ttv-local-moderation-reported', 'FLAG', 'REPORT', 'ttv-local-persona-student', 'VISIBLE', 'VISIBLE', '["Unkind to another member"]', 1793571500000),
 ('ttv-local-moderation-mentor-hidden-event', 'ttv-local-moderation-mentor-hidden', 'HIDE', 'MENTOR', 'ttv-local-persona-mentor', 'VISIBLE', 'HIDDEN', '["Unkind to another member"]', 1793572000000),
 ('ttv-local-moderation-tembo-hidden-event', 'ttv-local-moderation-tembo-hidden', 'HIDE', 'CLEF', NULL, 'VISIBLE', 'HIDDEN', '["Spam"]', 1793573000000),
 ('ttv-local-moderation-stale-event', 'ttv-local-moderation-stale', 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', '["Contact details"]', 1793574000000);
