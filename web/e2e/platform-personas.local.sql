-- Fictional local personas for e2e/platform-personas.spec.ts. Local D1 only: never apply to a deployed database.
-- npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
INSERT OR REPLACE INTO curriculum (id,title,description) VALUES ('ttv-local-persona-curriculum','Full-stack foundations','Fictional local curriculum');
INSERT OR REPLACE INTO program (id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES
 ('ttv-local-persona-cohort-04','Cohort 04','Fictional completed cohort','ttv-local-persona-curriculum',1772323200,1780272000,0),
 ('ttv-local-persona-cohort-05','Cohort 05','Fictional current cohort','ttv-local-persona-curriculum',1788220800,1797292800,0),
 ('ttv-local-persona-cohort-06','Cohort 06','Fictional next cohort','ttv-local-persona-curriculum',1799971200,1807833600,1);
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
